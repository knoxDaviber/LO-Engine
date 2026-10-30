import { z } from "zod/v4";
import { CLASSES, DRAFT_ACTIONS, DRAFT_ACTORS, DRAFT_SOURCES } from "./enums";

const pct = z.number();

export const rulesSchema = z.strictObject({
  damage: z.strictObject({ min_damage: z.number().min(0), crit_multiplier: z.number().positive() }),
  guard: z.strictObject({ damage_reduction_percent: z.number().min(0).max(100), total_reduction_cap_percent: z.number().min(0).max(100) }),
  matchup: z.strictObject({ advantage_damage_percent: pct, advantage_hit: z.number(), disadvantage_damage_percent: pct }),
  timeline: z.strictObject({ interval_constant: z.number().positive(), min_spd: z.number().positive() }),
  pp: z.strictObject({ base_active: z.number().int().min(0), base_passive: z.number().int().min(0), max: z.number().int().positive() }),
  board: z.strictObject({ rows: z.number().int().positive(), columns: z.number().int().positive(), hero_rows: z.number().int().positive() }),
  class_advantage: z.array(z.strictObject({ attacker: z.enum(CLASSES), defender: z.enum(CLASSES) })),
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
  cost: z.strictObject({
    stat_weights: z.strictObject({
      HP: z.number(), ATK: z.number(), INT: z.number(), DEF: z.number(), MDEF: z.number(), SPD: z.number(),
      HIT: z.number(), SKL: z.number(), CRIT: z.number(), GUARD: z.number(), EVA: z.number(),
    }),
    skill_price: z.number().min(0),
    aura_price: z.number().min(0),
    squad_price: z.number().min(0),
    caps: z.strictObject({ per_hero: z.number().positive().nullable(), protected_or_anchor: z.number().positive().nullable(), roster: z.number().positive().nullable() }),
  }),
});
export type Rules = z.infer<typeof rulesSchema>;
