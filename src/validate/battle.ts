import { resolveDraft } from "../draft";
import { sideAtPhase } from "../edits";
import { rowOverflows } from "../formation";
import { battleSchema, isRosterForm, rosterBattleSchema, type Battle } from "../schema";
import type { Collector, Tier } from "../types";
import type { Pack } from "./pack";
import { checkRoster, checkRosterHero } from "./roster";
import { reportZod } from "./schemaPass";

const SEED_LIMIT = 2 ** 32; // the rng does seed >>> 0
const SIDES = ["challenger", "defender"] as const;
const LAST_PHASE = 3;

/**
 * Validates a battle input against a content pack. Two forms:
 *  - fielded: two fielded sides (hero entries reuse the roster hero checks);
 *  - roster: two 6-hero rosters (the roster layer, defender with anchor / ban sheet / battlefield) plus human draft picks; the draft
 *    (src/draft.ts) is run here and its issues reported.
 * Both forms may carry challenger edits between phases, checked against the fielded (drafted) sides.
 */
export function validateBattle(raw: unknown, pack: Pack, c: Collector, opts: { file: string; tier: Tier }): void {
  const { file } = opts;
  // A wrong seed count/value is its own stable code; pull it out of the generic schema report.
  const seeds = (raw as { seeds?: unknown } | null)?.seeds;
  const seedsOk = Array.isArray(seeds) && seeds.length === 3 && seeds.every((s) => Number.isInteger(s) && (s as number) >= 0 && (s as number) < SEED_LIMIT);
  if (raw && typeof raw === "object" && "seeds" in raw && !seedsOk) {
    c.error("E_BATTLE_SEEDS", "seeds must be exactly 3 integers in [0, 2^32), one per phase", { file, path: "seeds" });
    raw = { ...(raw as object), seeds: [0, 0, 0] };
  }
  if (isRosterForm(raw)) validateRosterBattle(raw, pack, c, opts);
  else validateFieldedBattle(raw, pack, c, opts);
}

function validateFieldedBattle(raw: unknown, pack: Pack, c: Collector, opts: { file: string; tier: Tier }): void {
  const { file, tier } = opts;
  const parsed = battleSchema.safeParse(raw);
  if (!parsed.success) return void reportZod(c, parsed.error.issues, { file });
  const b = parsed.data;
  const { fielded } = pack.rules.draft;

  if (b.battlefield != null && !pack.byId.terrains.has(b.battlefield)) {
    c.error("E_BATTLE_TERRAIN", `battlefield '${b.battlefield}' is not a known terrain`, { file, path: "battlefield" });
  }

  const seen = new Map<string, string>(); // char_id -> side it was first seen on
  for (const side of SIDES) {
    const s = b[side];
    if (s.heroes.length < 1 || s.heroes.length > fielded) {
      c.error("E_BATTLE_SIZE", `${side} fields ${s.heroes.length} heroes; must be between 1 and ${fielded}`, { file, path: `${side}.heroes` });
    }
    if (!s.heroes.some((h) => h.char_id === s.leader)) {
      c.error("E_BATTLE_LEADER", `${side} leader '${s.leader}' is not one of that side's heroes`, { file, path: `${side}.leader` });
    }
    s.heroes.forEach((h, i) => {
      const prev = seen.get(h.char_id);
      if (prev) {
        const where = prev === side ? "twice on " + side : "on both sides";
        c.error("E_BATTLE_DUP", `hero '${h.char_id}' appears ${where}`, { file, id: h.char_id, path: `${side}.heroes[${i}]` });
      }
      else seen.set(h.char_id, side);
      checkRosterHero(h, { file, id: h.char_id, path: `${side}.heroes[${i}]` }, pack, c, tier);
    });
  }
  // Row capacity, using the same placement the engine uses. Only meaningful once heroes resolve to known characters.
  for (const side of SIDES) {
    if (!b[side].heroes.every((h) => pack.byId.characters.has(h.char_id))) continue;
    for (const row of rowOverflows(pack, b[side])) {
      c.error("E_BATTLE_ROW_FULL", `${side} ${row} row holds more than ${pack.rules.board.columns} heroes`, { file, path: `${side}.heroes` });
    }
  }
  checkEdits(b, pack, c, opts);
}

function validateRosterBattle(raw: unknown, pack: Pack, c: Collector, opts: { file: string; tier: Tier }): void {
  const { file, tier } = opts;
  const parsed = rosterBattleSchema.safeParse(raw);
  if (!parsed.success) return void reportZod(c, parsed.error.issues, { file });
  const b = parsed.data;
  const before = c.issues.filter((i) => i.severity === "error").length;
  for (const side of SIDES) checkRoster(b[side].roster, pack, c, { role: side, tier, file, base: `${side}.roster` });
  // Unit ids are char_ids, unique across a battle: the two rosters may not share a hero.
  const theirs = new Set(b.defender.roster.heroes.map((h) => h.char_id));
  b.challenger.roster.heroes.forEach((h, i) => {
    if (theirs.has(h.char_id)) c.error("E_BATTLE_DUP", `hero '${h.char_id}' appears on both sides`, { file, id: h.char_id, path: `challenger.roster.heroes[${i}]` });
  });
  if (c.issues.filter((i) => i.severity === "error").length > before) return; // the draft needs two valid rosters
  const d = resolveDraft(pack, b);
  for (const i of d.issues) c.error(i.code, i.message, { file, path: i.path });
  if (d.battle) checkEdits(d.battle, pack, c, opts);
}

/** Challenger edits between phases (design 5.5), against the fielded sides: allowed fields only (E_EDIT_LOCKED comes from the schema). */
function checkEdits(b: Battle, pack: Pack, c: Collector, opts: { file: string; tier: Tier }): void {
  const { file, tier } = opts;
  for (const side of SIDES) {
    const s = b[side];
    const edits = s.edits ?? [];
    if (side === "defender" && edits.length > 0) {
      c.error("E_EDIT_LOCKED", "defenders are frozen snapshots; only the challenger edits between phases", { file, path: "defender.edits" });
      continue;
    }
    const ids = s.heroes.map((h) => h.char_id);
    const phases = new Set<number>();
    edits.forEach((e, i) => {
      const at = `${side}.edits[${i}]`;
      if (e.phase < 2 || e.phase > LAST_PHASE || phases.has(e.phase)) {
        c.error("E_EDIT_PHASE", `edit phase ${e.phase} must be 2..${LAST_PHASE} (before that phase) and appear once`, { file, path: `${at}.phase` });
        return;
      }
      phases.add(e.phase);
      if (e.leader !== undefined && !ids.includes(e.leader)) {
        c.error("E_EDIT_HERO", `edit names leader '${e.leader}', who is not a fielded ${side} hero`, { file, path: `${at}.leader` });
      }
      const now = sideAtPhase(s, e.phase);
      (e.heroes ?? []).forEach((eh, j) => {
        const k = ids.indexOf(eh.char_id);
        const loc = { file, id: eh.char_id, path: `${at}.heroes[${j}]` };
        if (k < 0) return void c.error("E_EDIT_HERO", `edit hero '${eh.char_id}' is not a fielded ${side} hero`, loc);
        checkRosterHero(now.heroes[k]!, loc, pack, c, tier); // the entry as edited: tactic sheet, squad row
      });
      if (now.heroes.every((h) => pack.byId.characters.has(h.char_id))) {
        for (const row of rowOverflows(pack, now)) {
          c.error("E_BATTLE_ROW_FULL", `after the phase ${e.phase} edit, ${side} ${row} row holds more than ${pack.rules.board.columns} heroes`, { file, path: at });
        }
      }
    });
  }
}
