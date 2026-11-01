// Challenger edits between phases (design 5.5), shared by the battle validator and the engine (like formation.ts).
// [DEFAULT] An edit made before phase N applies from phase N on (edits accumulate in phase order). Only EDITABLE_HERO_FIELDS change;
// the leader stays front (formation.ts heroRow); `leader` is applied by succession (engine/leader.ts) only when the current leader is dead.
import { EDITABLE_HERO_FIELDS, type Battle, type BattleSide, type RosterHero } from "./schema";

/** The side's hero entries as they stand in `phase`: every edit with edit.phase <= phase applied in phase order. */
export function sideAtPhase(side: BattleSide, phase: number): BattleSide {
  const edits = (side.edits ?? []).filter((e) => e.phase <= phase).sort((a, b) => a.phase - b.phase);
  if (edits.length === 0) return side;
  const heroes = side.heroes.map((h) => {
    let out: RosterHero = h;
    for (const e of edits) for (const eh of e.heroes ?? []) {
      if (eh.char_id !== h.char_id) continue;
      out = { ...out };
      for (const f of EDITABLE_HERO_FIELDS) if (eh[f] !== undefined) (out as Record<string, unknown>)[f] = eh[f];
    }
    return out;
  });
  return { ...side, heroes };
}

/** The battle as it stands in `phase`. Only the challenger edits (defenders are frozen snapshots): defender edits are ignored here even
 * when the input was never validated (the validator rejects them with E_EDIT_LOCKED). */
export const battleAtPhase = (battle: Battle, phase: number): Battle => ({ ...battle, challenger: sideAtPhase(battle.challenger, phase) });

/** The edited fields per hero for exactly `phase` (for the log). */
export function editsFor(side: BattleSide, phase: number): { hero: string; fields: string[] }[] {
  return (side.edits ?? []).filter((e) => e.phase === phase).flatMap((e) =>
    (e.heroes ?? []).map((eh) => ({ hero: eh.char_id, fields: EDITABLE_HERO_FIELDS.filter((f) => eh[f] !== undefined) })));
}
