import { z } from "zod/v4";
import { CLASSES, DRAFT_ACTIONS, DRAFT_ACTORS, DRAFT_SOURCES, EQUIPMENT_TAGS, STATS } from "./enums";

const pct = z.number();

/** Damage formulas for the base step (power vs defense); see rules.yaml damage and design Section 8. */
export const DAMAGE_FORMULAS = ["pool", "subtract", "ratio", "scaled_subtract"] as const;
export type DamageFormulaName = (typeof DAMAGE_FORMULAS)[number];

/**
 * Flat stat lines per equipment type (Decision 133): every item of a type has the same base; items differ only by pp_modifiers and effects.
 * Every type needs an entry; stats left out are 0.
 */
const equipmentBases = z.partialRecord(z.enum(EQUIPMENT_TAGS), z.partialRecord(z.enum(STATS), z.number())).superRefine((v, ctx) => {
  for (const t of EQUIPMENT_TAGS) if (!v[t]) ctx.addIssue({ code: "custom", message: `equipment type '${t}' has no base stats`, path: [t] });
});

export const rulesSchema = z.strictObject({
  damage: z.strictObject({
    min_damage: z.number().min(0),
    crit_multiplier: z.number().positive(),
    formula: z.enum(DAMAGE_FORMULAS).default("pool"),
    ratio_k: z.number().positive().default(100), // ratio: power * K / (K + defense)
    floor_pct: z.number().min(0).max(100).default(20), // scaled_subtract: never below this percent of power
    def_weight: z.number().min(0).default(1), // scaled_subtract: defense weight
    hero_hits: z.number().positive().default(4), // hero damage (not squads, not heals) x this, after everything else [DEFAULT]
  }),
  guard: z.strictObject({ damage_reduction_percent: z.number().min(0).max(100), total_reduction_cap_percent: z.number().min(0).max(100) }),
  matchup: z.strictObject({ advantage_damage_percent: pct, advantage_hit: z.number(), disadvantage_damage_percent: pct }),
  timeline: z.strictObject({ interval_constant: z.number().positive(), min_spd: z.number().positive() }),
  pp: z.strictObject({ base_active: z.number().int().min(0), base_passive: z.number().int().min(0), max: z.number().int().positive() }),
  board: z.strictObject({ rows: z.number().int().positive(), columns: z.number().int().positive(), hero_rows: z.number().int().positive() }),
  // damage_percent (optional) replaces matchup.advantage_damage_percent for that pair only; hit bonus and the disadvantage side are unchanged.
  class_advantage: z.array(z.strictObject({ attacker: z.enum(CLASSES), defender: z.enum(CLASSES), damage_percent: z.number().min(0).optional() })),
  stun_pushback_counts: z.number().positive().nullable(),
  rolls: z.strictObject({
    hit_min: z.number(), hit_max: z.number(), crit_min: z.number(), crit_max: z.number(), guard_min: z.number(), guard_max: z.number(),
    skl_divisor: z.number().positive(),
  }),
  class_traits: z.strictObject({ flyer_melee_eva_bonus: z.number().nullable(), aquatic_water_spd_bonus: z.number().nullable() }),
  phase: z.strictObject({ max_actions_per_phase: z.number().int().positive().nullable() }),
  draft: z.strictObject({
    roster_size: z.number().int().positive(),
    fielded: z.number().int().positive(),
    defender_anchor: z.boolean(),
    steps: z.array(z.strictObject({ actor: z.enum(DRAFT_ACTORS), action: z.enum(DRAFT_ACTIONS), source: z.enum(DRAFT_SOURCES) })).min(1),
  }),
  limits: z.strictObject({
    max_tactics: z.number().int().positive(),
    max_effects_per_skill: z.number().int().positive().nullable(),
    max_skills_per_hero: z.number().int().positive().nullable(),
    stat_ceiling: z.number().positive().nullable(),
  }),
  equipment_bases: equipmentBases,
  cost: z.strictObject({
    stat_weights: z.strictObject({
      HP: z.number(), ATK: z.number(), INT: z.number(), DEF: z.number(), MDEF: z.number(), SPD: z.number(),
      HIT: z.number(), SKL: z.number(), CRIT: z.number(), GUARD: z.number(), EVA: z.number(),
    }),
    skill_price: z.number().min(0),
    effect_price: z.number().min(0), // a blessing effect that is not an unconditional modify_stat (devotion pricing, cost.ts)
    aura_price: z.number().min(0),
    squad_price: z.number().min(0),
    caps: z.strictObject({ per_hero: z.number().positive().nullable(), protected_or_anchor: z.number().positive().nullable(), roster: z.number().positive().nullable() }),
  }),
});
export type Rules = z.infer<typeof rulesSchema>;
