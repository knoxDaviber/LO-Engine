import { equipmentStats } from "../equipmentBase";
import type { Character, Effect, Equipment, Rules, Skill, SoldierType } from "../schema";

const STAT_KEYS = ["HP", "ATK", "INT", "DEF", "MDEF", "SPD", "HIT", "SKL", "CRIT", "GUARD", "EVA"] as const;

/**
 * Computed by default, overridable:
 * hero part = weighted base stats + aura price + an official aura's cost_adjustment, or hero.cost_override when set. Each skill adds
 * its cost_override or the flat skill_price, each item its cost_override or its type's weighted base stats (rules.equipment_bases), a squad a flat price, each effect of an
 * unlocked blessing tier (devotion, src/devotion.ts) its `effectPrice`.
 * Every number is a placeholder in rules.yaml until the gauntlet calibrates them.
 */
export function heroCost(hero: Character, rules: Rules, opts: { squad?: SoldierType | null; equipment?: Equipment[]; skills?: Skill[]; blessings?: Effect[] } = {}): number {
  const w = rules.cost.stat_weights;
  let total = 0;
  if (hero.cost_override != null) total += hero.cost_override;
  else {
    for (const k of STAT_KEYS) total += hero.base_stats[k] * w[k];
    total += rules.cost.aura_price + (hero.leader_aura.cost_adjustment ?? 0);
  }
  for (const s of opts.skills ?? []) total += s.cost_override ?? rules.cost.skill_price;
  for (const e of opts.equipment ?? []) {
    if (e.cost_override != null) total += e.cost_override;
    else {
      const flat = equipmentStats(e, rules.equipment_bases);
      for (const k of STAT_KEYS) total += flat[k] * w[k];
    }
  }
  if (opts.squad) total += rules.cost.squad_price;
  for (const e of opts.blessings ?? []) total += effectPrice(e, hero, rules);
  return Math.round(total * 10) / 10;
}

/**
 * [DEFAULT] Price of one blessing effect (there is no general effect pricing yet): an unconditional modify_stat is priced like a stat line, flat
 * = value * weight, percent = value% of the hero's base stat * weight; anything else (conditional lines, reflect, heals, reductions, ...) costs
 * the flat rules.cost.effect_price.
 */
export function effectPrice(e: Effect, hero: Character, rules: Rules): number {
  const w = rules.cost.stat_weights;
  if (e.type === "modify_stat" && !e.condition && (!e.trigger || e.trigger === "always")) {
    return (e.mode === "flat" ? e.value : (e.value / 100) * hero.base_stats[e.stat]) * w[e.stat];
  }
  return rules.cost.effect_price;
}
