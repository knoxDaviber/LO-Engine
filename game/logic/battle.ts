// Builds the fielded Battle for a stage and checks it with the shared validator. Pure: no DOM.
import { MAX_PHASES } from "../../src/engine";
import type { Battle, BattleSide } from "../../src/schema";
import { Collector } from "../../src/types";
import { validateBattle } from "../../src/validate/battle";
import type { Pack } from "../../src/validate/pack";
import { fieldedEntries, mix, type PoolHero } from "./party";
import { stagesOf, type Mode } from "./stages";

export const battleSeeds = (seed: number, stage: number, attempt: number): number[] =>
  Array.from({ length: MAX_PHASES }, (_, p) => mix(seed, stage, attempt, p + 1));

/** Throws when the battle does not validate: the game only ever hands the engine a valid battle. */
export function buildBattle(pack: Pack, o: { seed: number; stage: number; attempt: number; pool: PoolHero[]; leader: string; enemy: BattleSide; mode?: Mode }): Battle {
  const mode = o.mode ?? "tutorial";
  const battle: Battle = {
    battle_id: `${mode}_${o.stage + 1}`, version: "1", time: stagesOf({ mode })[o.stage]!.time, seeds: battleSeeds(o.seed, o.stage, o.attempt),
    challenger: { leader: o.leader, heroes: fieldedEntries(o.pool) }, defender: o.enemy,
  };
  const c = new Collector();
  validateBattle(battle, pack, c, { file: "game", tier: "official", defenderMax: 6 });
  const errors = c.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) throw new Error(`battle does not validate: ${errors.map((e) => `${e.code} ${e.path ?? ""} ${e.message}`).join("; ")}`);
  return battle;
}
