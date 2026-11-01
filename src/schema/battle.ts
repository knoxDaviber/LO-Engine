import { z } from "zod/v4";
import { ID_PATTERN } from "./enums";
import { rosterHeroSchema } from "./roster";

const id = z.string().regex(ID_PATTERN);

/** A fielded hero: the roster hero entry plus which hero leads the side. Soldiers are carried but ignored by the vertical slice. */
export const battleSideSchema = z.strictObject({
  heroes: z.array(rosterHeroSchema),
  leader: id,
});
export type BattleSide = z.infer<typeof battleSideSchema>;

/** Battle input for the engine: two fielded sides plus one seed per phase. */
export const battleSchema = z.strictObject({
  battle_id: z.string().min(1),
  version: z.string().min(1),
  battlefield: id.nullable().optional(), // terrain id; absent/null = no terrain. E_BATTLE_TERRAIN if unknown
  seeds: z.array(z.number().int().min(0).max(2 ** 32 - 1)).length(3), // one per phase; E_BATTLE_SEEDS if wrong
  challenger: battleSideSchema,
  defender: battleSideSchema,
});
export type Battle = z.infer<typeof battleSchema>;
