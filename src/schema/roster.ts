import { z } from "zod/v4";
import { conditionNode } from "./condition";
import { BAN_SELECTS, ID_PATTERN, ROWS, SELECTORS, STATS, TACTIC_FALLBACKS } from "./enums";

const id = z.string().regex(ID_PATTERN);

/** `sub` picks among the candidates `main` kept: either a selector ({ select: lowest, metric: hp_percent }) or a condition. */
const selector = z.strictObject({
  select: z.enum(SELECTORS),
  type: z.string().optional(),
  metric: z.string().optional(),
  stat: z.enum(STATS).optional(),
  side: z.enum(["self", "ally", "enemy", "target"]).optional(),
});

export const tacticSchema = z.strictObject({
  priority: z.number().int().min(1),
  skill_id: id,
  enabled: z.boolean(),
  activation: conditionNode.nullable(),
  targeting: z.strictObject({ main: conditionNode.nullable(), sub: z.union([selector, conditionNode]).nullable() }),
  fallback: z.enum(TACTIC_FALLBACKS),
});
export type Tactic = z.infer<typeof tacticSchema>;

export const banSheetSchema = z.strictObject({
  rules: z.array(
    z.strictObject({
      priority: z.number().int().min(1),
      filter: conditionNode,
      select: z.enum(BAN_SELECTS),
      metric: z.string().min(1),
    }),
  ),
});
export type BanSheet = z.infer<typeof banSheetSchema>;

export const rosterSchema = z.strictObject({
  roster_id: z.string().min(1),
  version: z.string().min(1),
  heroes: z.array(
    z.strictObject({
      char_id: id,
      squad_id: id,
      squad_row: z.enum(ROWS).optional(), // optional: falls back to the soldier type's default_soldier_row
      equipment: z.strictObject({
        weapon: id.nullable(),
        armor: id.nullable(),
        accessory_1: id.nullable(),
        accessory_2: id.nullable(),
      }),
      tactic_sheet: z.array(tacticSchema),
      preferred_row: z.enum(ROWS).optional(), // optional: falls back to the character's preferred_row
    }),
  ),
  leader_line: z.array(id),
  anchor: id.nullable(),
  ban_sheet: banSheetSchema.nullable(),
});
export type Roster = z.infer<typeof rosterSchema>;
