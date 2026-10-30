import { z } from "zod/v4";
import { conditionNode } from "./condition";
import {
  APPLIES_TO,
  CLASSES,
  DAMAGE_TYPES,
  EFFECT_TARGETS,
  EFFECT_TRIGGERS,
  ID_PATTERN,
  MODIFIER_MODES,
  PP_POOLS,
  RANGES,
  SOURCE_CATEGORIES,
  STATS,
} from "./enums";

const idRef = z.string().regex(ID_PATTERN, "ids are lowercase letters, digits and underscores");
const scalingTerm = z.strictObject({ stat: z.enum(STATS), coef: z.number() });
const pct = z.number().min(0).max(100);

/** Fields any effect may carry. */
const common = {
  trigger: z.enum(EFFECT_TRIGGERS).optional(),
  condition: conditionNode.nullable().optional(),
};

const damage = z.strictObject({
  type: z.literal("damage"),
  damage_type: z.enum(DAMAGE_TYPES),
  range: z.enum(RANGES),
  scaling: z.array(scalingTerm).min(1),
  multiplier: z.number().positive(),
  ignores_guard: z.boolean(),
  bonus_vs_class: z.array(z.strictObject({ class: z.enum(CLASSES), modifier_percent: z.number() })),
  hit_bonus_percent: z.number(),
  ...common,
});

const heal = z
  .strictObject({
    type: z.literal("heal"),
    scaling: z.array(scalingTerm).min(1).optional(),
    multiplier: z.number().positive().optional(),
    percent_max_hp: pct.optional(),
    ...common,
  })
  .refine((v) => (v.scaling !== undefined && v.multiplier !== undefined) !== (v.percent_max_hp !== undefined), {
    message: "a heal needs either scaling + multiplier, or percent_max_hp (not both, not neither)",
  });

const applyStatus = z.strictObject({
  type: z.literal("apply_status"),
  status_id: idRef,
  chance_percent: pct,
  target: z.enum(EFFECT_TARGETS),
  include_soldiers: z.boolean().default(false),
  ...common,
});

const removeBuffs = z
  .strictObject({
    type: z.literal("remove_buffs"),
    target: z.enum(EFFECT_TARGETS).optional(),
    side: z.enum(["enemy", "ally"]).optional(),
    ...common,
  })
  .refine((v) => (v.target !== undefined) !== (v.side !== undefined), { message: "give exactly one of 'target' or 'side'" });

const modifyStat = z.strictObject({
  type: z.literal("modify_stat"),
  stat: z.enum(STATS),
  mode: z.enum(MODIFIER_MODES),
  value: z.number(),
  source_category: z.enum(SOURCE_CATEGORIES).optional(),
  ...common,
});

const modifyPp = z.strictObject({
  type: z.literal("modify_pp"),
  pool: z.enum(PP_POOLS),
  amount: z.number().int(),
  target: z.enum(EFFECT_TARGETS),
  once_per_attack: z.boolean().optional(),
  ...common,
});

const reduceDamage = z.strictObject({
  type: z.literal("reduce_damage"),
  percent: pct,
  applies_to: z.enum(APPLIES_TO),
  duration: z.string().nullable(),
  ...common,
});

const delayAction = z.strictObject({ type: z.literal("delay_action"), counts: z.number().positive(), ...common });
const advanceAction = z.strictObject({ type: z.literal("advance_action"), counts: z.number().positive(), ...common });

export const effectSchema = z.discriminatedUnion("type", [damage, heal, applyStatus, removeBuffs, modifyStat, modifyPp, reduceDamage, delayAction, advanceAction]);
export type Effect = z.infer<typeof effectSchema>;
