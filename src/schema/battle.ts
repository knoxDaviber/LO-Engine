import { z } from "zod/v4";
import { ID_PATTERN, ROWS } from "./enums";
import { rosterHeroSchema, rosterSchema, tacticSchema } from "./roster";

const id = z.string().regex(ID_PATTERN);
const seeds = z.array(z.number().int().min(0).max(2 ** 32 - 1)).length(3); // one per phase; E_BATTLE_SEEDS if wrong

/** Fields a challenger may change between phases (design 5.5). Everything else on a hero entry (squad, equipment, ...) is locked. */
export const EDITABLE_HERO_FIELDS = ["tactic_sheet", "preferred_row", "column", "squad_row"] as const;
const EDIT_HERO_KEYS = ["char_id", ...EDITABLE_HERO_FIELDS];
const EDIT_KEYS = ["phase", "leader", "heroes"];

/** Unknown keys are kept by looseObject and reported as locked fields (E_EDIT_LOCKED) rather than as generic schema errors. */
const lockedKeys = (allowed: readonly string[]) => (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) ctx.addIssue({ code: "custom", message: `[E_EDIT_LOCKED] '${k}' is locked between phases (editable: ${allowed.join(", ")})`, path: [k] });
  }
};

/** One hero's between-phase changes: only the editable fields. `column`: 1..rules.board.columns (upper bound checked by the validator,
 * E_BATTLE_SLOT), or null = back to auto (the lowest free column of its row). */
export const editHeroSchema = z
  .looseObject({
    char_id: id, tactic_sheet: z.array(tacticSchema).optional(), preferred_row: z.enum(ROWS).optional(), column: z.number().int().min(1).nullable().optional(),
    squad_row: z.enum(ROWS).optional(),
  })
  .superRefine(lockedKeys(EDIT_HERO_KEYS));

/** Changes made before `phase` (2 or 3). They carry over to later phases. `leader` names a new leader when the current one died (else ignored). */
export const battleEditSchema = z
  .looseObject({ phase: z.number().int(), leader: id.optional(), heroes: z.array(editHeroSchema).optional() })
  .superRefine(lockedKeys(EDIT_KEYS));
export type BattleEdit = z.infer<typeof battleEditSchema>;

/** A fielded hero: the roster hero entry plus which hero leads the side. Soldiers are carried but ignored by the vertical slice. */
export const battleSideSchema = z.strictObject({
  heroes: z.array(rosterHeroSchema),
  leader: id,
  edits: z.array(battleEditSchema).optional(), // challenger only (E_EDIT_LOCKED on the defender)
});
export type BattleSide = z.infer<typeof battleSideSchema>;

/** Battle input for the engine: two fielded sides plus one seed per phase. */
export const battleSchema = z.strictObject({
  battle_id: z.string().min(1),
  version: z.string().min(1),
  battlefield: id.nullable().optional(), // terrain id; absent/null = no terrain. E_BATTLE_TERRAIN if unknown
  seeds,
  challenger: battleSideSchema,
  defender: battleSideSchema,
});
export type Battle = z.infer<typeof battleSchema>;

/** Human draft picks, consumed in order by the actor's `source: human` steps of rules.draft.steps. Bans name enemy heroes, protects own heroes. */
export const draftPicksSchema = z.strictObject({ bans: z.array(id).optional(), protects: z.array(id).optional() });

/** A side of the roster form: a full 6-hero roster (validated by the roster layer), its human draft picks and between-phase edits. */
export const rosterSideSchema = z.strictObject({
  roster: rosterSchema,
  draft: draftPicksSchema.optional(),
  edits: z.array(battleEditSchema).optional(),
});
export type RosterSide = z.infer<typeof rosterSideSchema>;

/** Roster form of the battle input: two rosters drafted down to rules.draft.fielded heroes. The battlefield comes from the defender's roster. */
export const rosterBattleSchema = z.strictObject({
  battle_id: z.string().min(1),
  version: z.string().min(1),
  seeds,
  challenger: rosterSideSchema,
  defender: rosterSideSchema,
});
export type RosterBattle = z.infer<typeof rosterBattleSchema>;

/** Either form. Validators and parsers pick the branch with isRosterForm, so schema errors name the right form. */
export const battleInputSchema = z.union([battleSchema, rosterBattleSchema]);
export type BattleInput = Battle | RosterBattle;

/** The roster form is recognised by a `roster` key on the challenger side. */
export const isRosterForm = (raw: unknown): boolean => {
  const ch = (raw as { challenger?: unknown } | null)?.challenger;
  return !!ch && typeof ch === "object" && "roster" in ch;
};
export const isRosterBattle = (b: BattleInput): b is RosterBattle => isRosterForm(b);
/** Parses (throws on invalid) either form. */
export const parseBattleInput = (raw: unknown): BattleInput => (isRosterForm(raw) ? rosterBattleSchema.parse(raw) : battleSchema.parse(raw));
