// Shared by the sim and batch CLIs: read a battle file, validate the content pack and the battle. Each step prints and exits on failure
// (exit codes as the validate CLI: 2 load failure, 1 validation errors).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "yaml";
import { DAMAGE_FORMULAS, parseBattleInput, type BattleInput, type DamageFormulaName } from "./schema";
import type { FormulaOption } from "./engine";
import { Collector, type Issue } from "./types";
import { validateContent } from "./validate";
import { validateBattle } from "./validate/battle";
import type { Pack } from "./validate/pack";

const print = (issues: Issue[]) => {
  for (const i of issues) console.error(`ERROR ${i.code}  ${[i.file, i.id, i.path].filter(Boolean).join(" > ")}\n       ${i.message}`);
};

/** Parsed YAML of a battle file; exits 2 when it cannot be read or parsed. */
export function readBattleFile(file: string): unknown {
  try {
    return parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`error: cannot read ${file}: ${(e as Error).message}`);
    process.exit(2);
  }
}

/** The validated content pack (sample battles in content/battles are not part of it); exits 1 on content errors. */
export function loadContentPack(dir = "content"): Pack {
  const { pack, report } = validateContent(dir);
  const contentErrors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/"));
  if (!pack || contentErrors.length > 0) {
    print(contentErrors);
    console.error("content has validation errors; refusing to run");
    process.exit(1);
  }
  return pack;
}

/** Validates a battle input (either form) against the pack and parses it; exits 1 on errors. */
export function checkBattle(raw: unknown, file: string, pack: Pack): BattleInput {
  const c = new Collector();
  validateBattle(raw, pack, c, { file: basename(file), tier: "official" });
  const errors = c.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    print(errors);
    console.error(`${file} has ${errors.length} validation error(s); refusing to run`);
    process.exit(1);
  }
  return parseBattleInput(raw);
}

/** PP override bounds for the what-if knob (sim, batch, editor). */
export const PP_OVERRIDE_MAX = 10;

/**
 * Parses `--pp-active=` / `--pp-passive=` (comma lists when `list`). Returns undefined when the flag is absent; calls `fail` on a value that is
 * not a decimal integer in [0, PP_OVERRIDE_MAX], on a repeated value or on a list where a single value is expected.
 */
export function ppFlag(args: string[], name: "pp-active" | "pp-passive", list: boolean, fail: (msg: string) => never): number[] | undefined {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  if (a === undefined) return undefined;
  const parts = a.slice(name.length + 3).split(",");
  const msg = `--${name} must be ${list ? "a comma list of distinct decimal integers" : "a decimal integer"} in [0, ${PP_OVERRIDE_MAX}]`;
  if (!list && parts.length !== 1) fail(msg);
  const vals = parts.map((s) => (/^\d+$/.test(s) && Number(s) <= PP_OVERRIDE_MAX ? Number(s) : fail(msg)));
  if (new Set(vals).size !== vals.length) fail(msg);
  return vals;
}

/** A formula override and its label (the spec as written: `ratio:150`). */
export interface FormulaSpec { label: string; option: FormulaOption }

const NUM_RE = /^\d+(\.\d+)?$/;

/**
 * Parses one formula spec: `pool`, `subtract`, `ratio[:K]` (K > 0), `scaled_subtract[:FLOOR_PCT[:DEF_WEIGHT]]` (floor 0..100, weight >= 0). Omitted
 * parameters keep the rules.yaml values. Returns an error message on anything else.
 */
export function parseFormula(spec: string): FormulaSpec | string {
  const [name, ...params] = spec.split(":");
  const err = `formula must be pool, subtract, ratio[:K] or scaled_subtract[:FLOOR_PCT[:DEF_WEIGHT]] with decimal numbers (got '${spec}')`;
  if (!(DAMAGE_FORMULAS as readonly string[]).includes(name!)) return err;
  if (params.some((p) => !NUM_RE.test(p) || !Number.isFinite(Number(p)))) return err;
  const n = params.map(Number);
  const formula = name as DamageFormulaName;
  if (formula === "pool" || formula === "subtract") return n.length === 0 ? { label: spec, option: { formula } } : err;
  if (formula === "ratio") return n.length <= 1 && (n[0] ?? 1) > 0 ? { label: spec, option: { formula, ...(n.length ? { ratio_k: n[0] } : {}) } } : err;
  if (n.length > 2 || (n[0] ?? 0) > 100) return err;
  return { label: spec, option: { formula, ...(n.length > 0 ? { floor_pct: n[0] } : {}), ...(n.length > 1 ? { def_weight: n[1] } : {}) } };
}

/** Parses `--formula=` (a comma list of distinct specs when `list`). Undefined when absent; calls `fail` on a bad, repeated or extra spec. */
export function formulaFlag(args: string[], list: boolean, fail: (msg: string) => never): FormulaSpec[] | undefined {
  const a = args.find((x) => x.startsWith("--formula="));
  if (a === undefined) return undefined;
  const parts = a.slice("--formula=".length).split(",");
  if (!list && parts.length !== 1) fail("--formula takes a single formula here");
  if (new Set(parts).size !== parts.length) fail("--formula values must be distinct");
  return parts.map((p) => {
    const r = parseFormula(p);
    return typeof r === "string" ? fail(`--${r}`) : r;
  });
}

/** Parses one hero_hits value: a positive finite decimal number (`4`, `2.5`). Returns an error message on anything else. */
export function parseHeroHits(spec: string): number | string {
  const v = Number(spec);
  return NUM_RE.test(spec) && Number.isFinite(v) && v > 0 ? v : `hero-hits must be a positive decimal number (got '${spec}')`;
}

/** Parses `--hero-hits=` (a comma list of distinct values when `list`). Undefined when absent; calls `fail` on a bad, repeated or extra value. */
export function heroHitsFlag(args: string[], list: boolean, fail: (msg: string) => never): number[] | undefined {
  const a = args.find((x) => x.startsWith("--hero-hits="));
  if (a === undefined) return undefined;
  const parts = a.slice("--hero-hits=".length).split(",");
  if (!list && parts.length !== 1) fail("--hero-hits takes a single value here");
  const vals = parts.map((p) => {
    const r = parseHeroHits(p);
    return typeof r === "string" ? fail(`--${r}`) : r;
  });
  if (new Set(vals).size !== vals.length) fail("--hero-hits values must be distinct");
  return vals;
}

/** Calls `fail` when any `--name=` flag in `names` is given more than once. */
export function rejectRepeats(args: string[], names: string[], fail: (msg: string) => never): void {
  for (const n of names) if (args.filter((a) => a.startsWith(`--${n}=`)).length > 1) fail(`--${n} given more than once`);
}
