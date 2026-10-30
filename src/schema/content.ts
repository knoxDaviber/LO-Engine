import { z } from "zod/v4";
import { conditionNode } from "./condition";
import { effectSchema } from "./effect";
import {
  AURA_TARGET_SIDES,
  AURA_TRIGGERS,
  AURA_TYPES,
  CLASSES,
  COUNTS_ACTIONS_OF,
  DAMAGE_DISTRIBUTIONS,
  DAMAGE_TYPES,
  DURATION_UNITS,
  EQUIPMENT_SLOTS,
  EQUIPMENT_TAGS,
  EVENT_NAMES,
  EXPIRES,
  GUARD_MODES,
  ID_PATTERN,
  MODIFIER_MODES,
  ON_REAPPLY,
  PP_POOLS,
  RANGES,
  ROWS,
  SKILL_CATEGORIES,
  SKILL_FALLBACKS,
  SKILL_TAGS,
  SKILL_TRIGGERS,
  SOLDIER_MODES,
  SOLDIER_PASSIVE_TARGETS,
  SOURCE_CATEGORIES,
  STATS,
  STATUS_CATEGORIES,
  STATUS_SOURCE,
  TARGET_SHAPES,
  TARGET_SIDES,
  TRIGGER_TIMING,
} from "./enums";

const id = z.string().regex(ID_PATTERN, "ids are lowercase letters, digits and underscores");
const text = z.string();
const name = z.string().min(1);
const meta = z.record(z.string(), z.unknown()).optional(); // converter notes; never read by the engine
const costOverride = z.number().min(0).nullable().optional(); // official content only; replaces the computed cost

/** One entry per stat, keys listed explicitly. A test asserts they match STATS. */
function statBlock<T extends z.ZodType>(v: T) {
  return z.strictObject({ HP: v, ATK: v, INT: v, DEF: v, MDEF: v, SPD: v, HIT: v, SKL: v, CRIT: v, GUARD: v, EVA: v });
}
export const baseStats = statBlock(z.number().min(0));
export const statModifiers = statBlock(z.number());
export const ppModifiers = z.strictObject({ active: z.number().int(), passive: z.number().int() });

// ---------------------------------------------------------------- status
export const statusSchema = z.strictObject({
  id,
  name,
  description: text.nullable(),
  category: z.enum(STATUS_CATEGORIES),
  source_category: z.enum(STATUS_SOURCE),
  modifiers: z.array(z.strictObject({ stat: z.enum(STATS), mode: z.enum(MODIFIER_MODES), value: z.number() })),
  flags: z.strictObject({
    blocks_debuffs: z.boolean(),
    intercepts_death: z.strictObject({ enabled: z.boolean(), revive_hp_percent: z.number().min(1).max(100) }),
    overrides_targeting: z.string().nullable(),
    ignores_tactics: z.boolean(),
    prevents_action: z.boolean(),
    delays_pending_action: z.boolean(), // true = pending action pushed back by rules.stun_pushback_counts
    removes_on_hit: z.boolean(),
    prevents_evasion: z.boolean(),
    heals_on_hit_percent_max_hp: z.number().min(0).max(100),
  }),
  duration: z.strictObject({
    unit: z.enum(DURATION_UNITS),
    count: z.number().int().positive().nullable(),
    counts_actions_of: z.enum(COUNTS_ACTIONS_OF),
    applying_action_counts: z.boolean(),
    expires: z.enum(EXPIRES),
  }),
  stacking: z.strictObject({
    stackable: z.boolean(),
    unique: z.boolean(),
    on_reapply: z.enum(ON_REAPPLY),
    max_stacks: z.number().int().positive().nullable(),
    suppress_weaker: z.boolean(),
  }),
  removal: z.strictObject({ removable_by_dispel: z.boolean(), removed_on_death: z.boolean() }),
  meta,
});
export type Status = z.infer<typeof statusSchema>;

// ---------------------------------------------------------------- skill
export const skillSchema = z.strictObject({
  id,
  name,
  description: text,
  category: z.enum(SKILL_CATEGORIES),
  tags: z.array(z.enum(SKILL_TAGS)),
  pp_pool: z.enum(PP_POOLS),
  pp_cost: z.number().int().min(1),
  pp_recovery: z.strictObject({ allowed: z.boolean().nullable() }),
  use_limit: z.number().int().positive().nullable(),
  trigger: z.enum(SKILL_TRIGGERS),
  trigger_event: z.enum(EVENT_NAMES).nullable(),
  trigger_timing: z.enum(TRIGGER_TIMING).nullable(),
  cooldown: z.number().int().positive().nullable(),
  eligible: z.strictObject({ classes: z.array(z.enum(CLASSES)), characters: z.array(id) }),
  default_activation: conditionNode.nullable(),
  effects: z.array(effectSchema).min(1),
  targeting: z.strictObject({
    side: z.enum(TARGET_SIDES),
    shape: z.enum(TARGET_SHAPES).nullable(),
    default_main: conditionNode.nullable(),
    default_sub: conditionNode.nullable(),
    valid_rows: z.array(z.enum(ROWS)),
    max_targets: z.number().int().positive().nullable(),
    damage_distribution: z.enum(DAMAGE_DISTRIBUTIONS).nullable(),
    fallback: z.enum(SKILL_FALLBACKS),
  }),
  interactions: z.strictObject({
    guard: z.enum(GUARD_MODES),
    soldiers: z.enum(SOLDIER_MODES),
  }),
  cost_override: costOverride,
  designer_notes: text,
  meta,
});
export type Skill = z.infer<typeof skillSchema>;

// ---------------------------------------------------------------- equipment
export const equipmentSchema = z.strictObject({
  id,
  name,
  description: text,
  slot: z.enum(EQUIPMENT_SLOTS),
  tags: z.array(z.enum(EQUIPMENT_TAGS)).min(1),
  stat_modifiers: statModifiers,
  pp_modifiers: ppModifiers,
  effects: z.array(effectSchema),
  eligible: z.strictObject({
    classes: z.array(z.enum(CLASSES)),
    characters: z.array(id),
    required_tags: z.array(z.enum(EQUIPMENT_TAGS)),
  }),
  rules: z.strictObject({ duplicate_allowed_in_both_accessory_slots: z.boolean() }),
  cost_override: costOverride,
  designer_notes: text,
  meta,
});
export type Equipment = z.infer<typeof equipmentSchema>;

// ---------------------------------------------------------------- soldier type
export const soldierSchema = z.strictObject({
  id,
  name,
  description: text,
  role: text,
  class: z.enum(CLASSES),
  default_soldier_row: z.enum(ROWS),
  allowed_soldier_rows: z.array(z.enum(ROWS)).min(1),
  count: z.number().int().min(1),
  mounted: z.boolean(),
  per_soldier_stats: baseStats,
  basic_attack: z.strictObject({
    damage_type: z.enum(DAMAGE_TYPES),
    range: z.enum(RANGES),
    scaling: z.array(z.strictObject({ stat: z.enum(STATS), coef: z.number() })).min(1),
    targeting: z.literal("nearest_front_first"),
  }),
  passive_effects: z.array(
    z.strictObject({ name: z.string().nullable(), target: z.enum(SOLDIER_PASSIVE_TARGETS), effects: z.array(effectSchema).min(1) }),
  ),
  eligible_heroes: z.array(id),
  eligible_classes: z.array(z.enum(CLASSES)),
  designer_notes: z.strictObject({ strengths: text, weaknesses: text, synergies: text }).partial(),
  meta,
});
export type SoldierType = z.infer<typeof soldierSchema>;

// ---------------------------------------------------------------- faction
export const factionSchema = z.strictObject({ id, name, lore: text.nullable(), effects: z.array(effectSchema), meta });
export type Faction = z.infer<typeof factionSchema>;

// ---------------------------------------------------------------- character
export const leaderAuraSchema = z.strictObject({
  name,
  type: z.enum(AURA_TYPES),
  faction_id: id.nullable(),
  trigger: z.enum(AURA_TRIGGERS),
  trigger_event: z.enum(EVENT_NAMES).nullable(),
  trigger_includes_idle_action: z.boolean().optional(),
  cost_adjustment: z.number().optional(), // official content only
  condition: conditionNode.nullable(),
  target: z.strictObject({ side: z.enum(AURA_TARGET_SIDES), filter: conditionNode.nullable(), include_soldiers: z.boolean() }),
  description: text,
  effects: z.array(effectSchema).min(1),
});

export const characterSchema = z.strictObject({
  id,
  name,
  class: z.enum(CLASSES),
  factions: z.array(id),
  role: text,
  lore: text,
  base_stats: baseStats,
  pp: z.strictObject({ active: z.number().int().min(0), passive: z.number().int().min(0) }),
  skills: z.array(id),
  restrictions: z.strictObject({
    equipment_tags: z.array(z.enum(EQUIPMENT_TAGS)),
    soldier: z.strictObject({
      mounted_only: z.boolean(),
      stat_penalties: z.array(z.strictObject({ when: conditionNode, stat: z.enum(STATS), mode: z.enum(MODIFIER_MODES), value: z.number() })),
    }),
  }),
  leader_aura: leaderAuraSchema,
  preferred_row: z.enum(ROWS),
  unique_effects: z.array(effectSchema),
  cost_override: costOverride,
  designer_notes: z.strictObject({ strengths: text, weaknesses: text, synergies: text, balance: text }).partial(),
  meta,
});
export type Character = z.infer<typeof characterSchema>;
