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

/** One hero entry: shared by rosters and battle sides. */
export const rosterHeroSchema = z.strictObject({
  char_id: id,
  squad_id: id,
  squad_row: z.enum(ROWS).optional(), // optional: falls back to the soldier type's default_soldier_row
  equipment: z.strictObject({
    weapon: id.nullable(),
    armor: id.nullable(),
    accessory_1: id.nullable(),
    accessory_2: id.nullable(),
  }),
  // Devotion (Section 9A): a god id per slot, chosen by the player. A sigil counts only while its slot holds an item (W_SIGIL_EMPTY_SLOT).
  sigils: z
    .strictObject({ weapon: id.nullable().optional(), armor: id.nullable().optional(), accessory_1: id.nullable().optional(), accessory_2: id.nullable().optional() })
    .optional(),
  tactic_sheet: z.array(tacticSchema),
  preferred_row: z.enum(ROWS).optional(), // optional: falls back to the character's preferred_row
  // Slot inside the hero row, 1..rules.board.columns (range checked by the validator, E_BATTLE_SLOT). Omitted = auto: fills the lowest free
  // column of its row in roster order. Two heroes on the same (row, column) are E_BATTLE_SLOT. Decision 129.
  column: z.number().int().min(1).optional(),
});
export type RosterHero = z.infer<typeof rosterHeroSchema>;

export const rosterSchema = z.strictObject({
  roster_id: z.string().min(1),
  version: z.string().min(1),
  heroes: z.array(rosterHeroSchema),
  leader_line: z.array(id),
  anchor: id.nullable(),
  ban_sheet: banSheetSchema.nullable(),
  battlefield: id.nullable().optional(), // terrain id; picked by a defender (Decision 111). E_BATTLE_TERRAIN if unknown, ignored (warning) on a challenger
});
export type Roster = z.infer<typeof rosterSchema>;
