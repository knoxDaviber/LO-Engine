import type { Character, Equipment, Rules, Skill, SoldierType } from "../schema";

const STAT_KEYS = ["HP", "ATK", "INT", "DEF", "MDEF", "SPD", "HIT", "SKL", "CRIT", "GUARD", "EVA"] as const;

/**
 * Computed by default, overridable:
 * hero part = weighted base stats + aura price + an official aura's cost_adjustment, or hero.cost_override when set. Each skill adds
 * its cost_override or the flat skill_price, each item its cost_override or its weighted stat_modifiers, a squad a flat price.
 * Every number is a placeholder in rules.yaml until the gauntlet calibrates them.
 */
export function heroCost(hero: Character, rules: Rules, opts: { squad?: SoldierType | null; equipment?: Equipment[]; skills?: Skill[] } = {}): number {
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
    else for (const k of STAT_KEYS) total += e.stat_modifiers[k] * w[k];
  }
  if (opts.squad) total += rules.cost.squad_price;
  return Math.round(total * 10) / 10;
}
