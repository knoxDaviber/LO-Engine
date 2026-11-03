// What-if option parsers shared by the sim / batch CLIs (src/cliBattle.ts flags) and the editor API. Pure: no Node imports.
import { DAMAGE_FORMULAS, type DamageFormulaName } from "./schema";
import type { FormulaOption } from "./engine";

/** PP override bounds for the what-if knob (sim, batch, editor). */
export const PP_OVERRIDE_MAX = 10;

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

/** Parses one hero_hits value: a positive finite decimal number (`4`, `2.5`). Returns an error message on anything else. */
export function parseHeroHits(spec: string): number | string {
  const v = Number(spec);
  return NUM_RE.test(spec) && Number.isFinite(v) && v > 0 ? v : `hero-hits must be a positive decimal number (got '${spec}')`;
}
