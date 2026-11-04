// The editor's JSON API core, with no Node imports: it runs in Node behind the Vite dev server (editor/api.ts createApi reads content/ from
// disk) and in the browser in the static build (editor/src/staticApi.ts, content bundled at build time). It takes the content files as texts
// (path relative to content/ -> YAML) plus a ContentStore for the battle / roster files the UI lists, opens and saves. The pack is built once
// per core.
import { parse, stringify } from "yaml";
import { z } from "zod/v4";
import { rawFromTexts } from "../src/content";
import { resolveDraft } from "../src/draft";
import { equipmentStats, equipmentType } from "../src/equipmentBase";
import { parseFormula, parseHeroHits, PP_OVERRIDE_MAX } from "../src/options";
import { allBreakdowns, preBattleState, renderLog, runBattle, type BattleOptions } from "../src/engine";
import { LEAF_REFS, LEAF_REGISTRY } from "../src/registry/conditions";
import { isRosterBattle, parseBattleInput, ROWS, type Battle } from "../src/schema";
import { Collector } from "../src/types";
import { validateRaw } from "../src/validate/raw";
import { validateBattle } from "../src/validate/battle";
import type { Pack } from "../src/validate/pack";
import { buildCatalog } from "./catalog";
import type { ApiIssue, BreakdownResult, ContentInfo, SimResult } from "./apiTypes";

/** Where the battle / roster files live. Paths are already checked (`battles/x.yaml` or `rosters/x.yaml`). */
export interface ContentStore {
  /** Relative paths (`battles/x.yaml`) of one folder's YAML files, sorted. */
  list(folder: "battles" | "rosters"): string[];
  /** The file's text, or undefined when it does not exist (404). May throw an ApiError. */
  read(rel: string): string | undefined;
  /** Stores a validated battle (Node: writes it, 409 when it exists and `overwrite` is false; browser: downloads it). May throw an ApiError. */
  write(rel: string, text: string, overwrite: boolean): void;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: ApiIssue[]) {
    super(message);
  }
}

const FOLDERS = ["battles", "rosters"] as const;
const FILE_RE = /^(battles|rosters)\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.yaml$/;

/** `battles/x.yaml` or `rosters/x.yaml` (no subfolders, no `..`); anything else is a 400. Save allows only `battles/`. */
export function checkPath(path: unknown, folders: readonly string[] = FOLDERS): string {
  if (typeof path !== "string" || !FILE_RE.test(path) || path.includes("..") || !folders.includes(path.split("/")[0]!)) {
    throw new ApiError(400, `path must be ${folders.map((f) => `${f}/<name>.yaml`).join(" or ")}`);
  }
  return path;
}

export function createCore(texts: Record<string, string>, store: ContentStore) {
  const { pack, report } = validateRaw(rawFromTexts(texts));
  const contentErrors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/") && !i.file?.startsWith("rosters/"));
  if (!pack || contentErrors.length > 0) throw new Error(`content has validation errors: ${contentErrors.map((i) => i.code).join(", ")}`);
  const p: Pack = pack;

  function issuesOf(battle: unknown): ApiIssue[] {
    const c = new Collector();
    validateBattle(battle, p, c, { file: "editor", tier: "official" });
    return c.issues.map((i) => ({ severity: i.severity, code: i.code, path: i.path ?? "", ...(i.id ? { id: i.id } : {}), message: i.message }));
  }

  /** A battle with no validation errors, parsed; 422 with the issues otherwise. */
  function checked(battle: unknown) {
    const issues = issuesOf(battle);
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length > 0) throw new ApiError(422, `battle has ${errors.length} validation error(s)`, errors);
    return parseBattleInput(battle);
  }

  const leafInfos = (ctx: string) => Object.entries(LEAF_REGISTRY)
    .filter(([, spec]) => (spec.contexts as readonly string[]).includes(ctx))
    .map(([type, spec]) => ({ type, description: spec.description, params: z.toJSONSchema(spec.fields, { unrepresentable: "any" }) as Record<string, unknown> }));

  function content(): ContentInfo {
    const skill = (id: string) => p.byId.skills.get(id);
    return {
      characters: [...p.byId.characters.values()].map((ch) => ({
        id: ch.id, name: ch.name, class: ch.class, preferred_row: ch.preferred_row,
        skills: ch.skills.flatMap((id) => {
          const s = skill(id);
          return s ? [{ id, name: s.name, kind: s.category, pp_pool: s.pp_pool, pp_cost: s.pp_cost, trigger: s.trigger, shape: s.targeting.shape, side: s.targeting.side, default_main: s.targeting.default_main }] : [];
        }),
      })),
      equipment: [...p.byId.equipment.values()].map((e) => ({
        id: e.id, name: e.name, slot: e.slot, type: equipmentType(e) ?? null,
        base: Object.fromEntries(Object.entries(equipmentStats(e, p.rules.equipment_bases)).filter(([, v]) => v !== 0)), eligible: e.eligible,
      })),
      gods: [...p.byId.gods.values()].map((g) => ({ id: g.id, name: g.name, blessing: g.blessing.name })),
      soldiers: [...p.byId.soldiers.values()].map((s) => ({
        id: s.id, name: s.name, class: s.class, default_soldier_row: s.default_soldier_row, allowed_soldier_rows: s.allowed_soldier_rows, mounted: s.mounted,
        eligible_heroes: s.eligible_heroes, eligible_classes: s.eligible_classes,
      })),
      terrains: [...p.byId.terrains.values()].map((t) => ({ id: t.id, name: t.name })),
      statuses: [...p.byId.statuses.values()].map((s) => ({ id: s.id, name: s.name, category: s.category })),
      factions: [...p.byId.factions.values()].map((f) => ({ id: f.id, name: f.name })),
      rules: { max_tactics: p.rules.limits.max_tactics, fielded: p.rules.draft.fielded, roster_size: p.rules.draft.roster_size, columns: p.rules.board.columns },
      leaves: leafInfos("tactic"),
      ban_leaves: leafInfos("ban"),
      leaf_refs: LEAF_REFS,
      rows: [...ROWS],
      files: { battles: store.list("battles"), rosters: store.list("rosters") },
    };
  }

  let catalogCache: ReturnType<typeof buildCatalog> | undefined;
  /** Full content + rules + leaf descriptions for the describe formatter (built once; the pack does not change while the server runs). */
  const catalog = () => (catalogCache ??= buildCatalog(p));

  function file(path: unknown): { path: string; data: unknown } {
    const rel = checkPath(path);
    const text = store.read(rel);
    if (text === undefined) throw new ApiError(404, `${rel} does not exist`);
    try {
      return { path: rel, data: parse(text) };
    } catch (e) {
      throw new ApiError(400, `${rel} is not valid YAML: ${(e as Error).message}`);
    }
  }

  const validate = (battle: unknown): { issues: ApiIssue[] } => ({ issues: issuesOf(battle) });

  /** The engine's PP option from a request's optional `pp` field: integers 0..PP_OVERRIDE_MAX per pool, absent / null = content values; 400 otherwise. */
  function ppOption(pp: unknown): BattleOptions {
    if (pp === undefined || pp === null) return {};
    const bad = () => new ApiError(400, `pp must be { active?, passive? } with integers 0..${PP_OVERRIDE_MAX}`);
    if (typeof pp !== "object" || Array.isArray(pp)) throw bad();
    const out: { active?: number; passive?: number } = {};
    for (const [k, v] of Object.entries(pp as Record<string, unknown>)) {
      if (k !== "active" && k !== "passive") throw bad();
      if (v === null || v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > PP_OVERRIDE_MAX) throw bad();
      out[k] = v;
    }
    return { pp: out };
  }

  /** The engine's formula option from a request's optional `formula` string (`ratio:150`, as the CLI flag); absent / null / "" = rules.yaml; 400 otherwise. */
  function formulaOption(formula: unknown): BattleOptions {
    if (formula === undefined || formula === null || formula === "") return {};
    const r = typeof formula === "string" ? parseFormula(formula) : "formula must be a string";
    if (typeof r === "string") throw new ApiError(400, r);
    return { formula: r.option };
  }

  /** The engine's hero_hits option from a request's optional `hero_hits` (a positive finite number, as the CLI flag); absent / null = rules.yaml; 400 otherwise. */
  function heroHitsOption(hh: unknown): BattleOptions {
    if (hh === undefined || hh === null) return {};
    if (typeof hh !== "number" || !Number.isFinite(hh) || hh <= 0) throw new ApiError(400, "hero_hits must be a positive finite number");
    return { heroHits: hh };
  }

  /** Section 9.1 breakdown of every hero and squad after the pre-battle steps of `phase` (edits applied; HP is not carried over). */
  function breakdown(battle: unknown, phase = 1, pp?: unknown, formula?: unknown, heroHits?: unknown): BreakdownResult {
    if (![1, 2, 3].includes(phase)) throw new ApiError(400, "phase must be 1, 2 or 3");
    const opts = { ...ppOption(pp), ...formulaOption(formula), ...heroHitsOption(heroHits) };
    const input = checked(battle);
    let fielded: Battle;
    let banned = { challenger: [] as string[], defender: [] as string[] };
    if (isRosterBattle(input)) {
      const d = resolveDraft(p, input);
      if (!d.battle) throw new ApiError(422, "draft failed");
      fielded = d.battle;
      if (d.sides) banned = { challenger: d.sides.challenger.banned, defender: d.sides.defender.banned };
    } else fielded = input;
    const state = preBattleState(p, fielded, phase, opts);
    return {
      phase,
      banned,
      units: state.units.map((u) => ({
        id: u.id, name: u.name, side: u.side, kind: u.kind, leader: u.leaderId ?? null, stats: allBreakdowns(u, p),
        pp: u.kind === "hero" ? { active: u.pp.active.max, passive: u.pp.passive.max } : null,
      })),
    };
  }

  function sim(battle: unknown, pp?: unknown, formula?: unknown, heroHits?: unknown): SimResult {
    const opts = { ...ppOption(pp), ...formulaOption(formula), ...heroHitsOption(heroHits) };
    const result = runBattle(p, checked(battle), opts);
    return { winner: result.winner, reason: result.reason, log: renderLog(result.events), events: result.events as SimResult["events"] };
  }

  /** Stores a battle with no errors (ContentStore.write; on disk an existing file is only replaced with `overwrite: true`, 409 otherwise, so the UI can ask first). */
  function save(path: unknown, battle: unknown, overwrite = false): { path: string; saved: true } {
    const rel = checkPath(path, ["battles"]);
    checked(battle);
    store.write(rel, stringify(battle, { lineWidth: 0 }), overwrite === true);
    return { path: rel, saved: true };
  }

  /** Routes one request; used by the Vite middleware and the static build's client. Errors become { error, issues? } with the ApiError status (500 otherwise). */
  function handle(method: string, url: string, body: any): { status: number; json: unknown } {
    const u = new URL(url, "http://local");
    try {
      const route = `${method} ${u.pathname}`;
      const b = body ?? {};
      switch (route) {
        case "GET /api/content": return { status: 200, json: content() };
        case "GET /api/catalog": return { status: 200, json: catalog() };
        case "GET /api/file": return { status: 200, json: file(u.searchParams.get("path")) };
        case "POST /api/validate": return { status: 200, json: validate(b.battle) };
        case "POST /api/breakdown": return { status: 200, json: breakdown(b.battle, b.phase ?? 1, b.pp, b.formula, b.hero_hits) };
        case "POST /api/sim": return { status: 200, json: sim(b.battle, b.pp, b.formula, b.hero_hits) };
        case "POST /api/save": return { status: 200, json: save(b.path, b.battle, b.overwrite === true) };
        default: return { status: 404, json: { error: `no route ${route}` } };
      }
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, json: { error: e.message, ...(e.issues ? { issues: e.issues } : {}) } };
      return { status: 500, json: { error: (e as Error).message } };
    }
  }

  return { content, catalog, file, validate, breakdown, sim, save, handle, pack: p };
}
export type Core = ReturnType<typeof createCore>;
