import { z } from "zod/v4";
import { conditionNode } from "./condition";
import { BAN_SELECTS, ID_PATTERN, ROWS, SELECTOR_METRICS, SELECTORS, SIGIL_SIDES, STATS } from "./enums";

const id = z.string().regex(ID_PATTERN);

/**
 * Selector: orders the candidates, never removes one. lowest / highest by `metric` (default hp_percent; a SELECTOR_METRICS name or a stat),
 * nearest / farthest by board order, random_seeded from the phase rng, prefer = candidates satisfying the `filter` leaf first.
 */
export const selectorSchema = z
  .strictObject({
    select: z.enum(SELECTORS),
    metric: z.enum([...SELECTOR_METRICS, ...STATS]).optional(),
    filter: conditionNode.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.select === "prefer") !== (v.filter !== undefined)) ctx.addIssue({ code: "custom", message: "[E_TACTIC_SHAPE] `filter` is required on select: prefer and only allowed there", path: ["filter"] });
    if (v.metric !== undefined && v.select !== "lowest" && v.select !== "highest") ctx.addIssue({ code: "custom", message: "[E_TACTIC_SHAPE] `metric` is only allowed on lowest / highest", path: ["metric"] });
  });
export type Selector = z.infer<typeof selectorSchema>;

/** A player condition slot: one condition leaf (shape checked by the validator, E_TACTIC_SHAPE) or a selector. */
const slot = z.union([selectorSchema, conditionNode]).nullable();
export const isSelector = (c: unknown): c is Selector => !!c && typeof c === "object" && "select" in c;

/** A player tactic (Decision 136): a skill plus two condition slots, Main and Sub. */
export const tacticSchema = z.strictObject({
  priority: z.number().int().min(1),
  skill_id: id,
  enabled: z.boolean(),
  main: slot,
  sub: slot,
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
  // Which 4-piece enchantment 4 same-god sigils unlock (Decision 141). Required then (E_SIGIL_SIDE_MISSING); otherwise it does nothing (W_SIGIL_SIDE_UNUSED).
  sigil_side: z.enum(SIGIL_SIDES).optional(),
  tactic_sheet: z.array(tacticSchema),
  preferred_row: z.enum(ROWS).optional(), // optional: falls back to the character's preferred_row
  // Slot inside the hero row, 1..rules.board.columns (range checked by the validator, E_BATTLE_SLOT). Omitted = auto: fills the lowest free
  // column of its row in roster order. Two heroes on the same (row, column) are E_BATTLE_SLOT. Decision 129.
  column: z.number().int().min(1).optional(),
  // Battle start only: share of max HP the hero begins with (Rogue Mode wounds). Later phases carry real HP. Omitted = full.
  start_hp_percent: z.number().int().min(1).max(100).optional(),
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
