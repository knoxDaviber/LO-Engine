// The three tutorial battles as data, and how an authored enemy party becomes real heroes. Enemies are picked from the heroes outside the pool, so
// they never collide with a fielded char_id (E_BATTLE_DUP) and stay the same while the player changes picks. Pure: no DOM.
import type { BattleSide, UnitClass } from "../../src/schema";
import type { RosterHero } from "../../src/schema/roster";
import type { Pack } from "../../src/validate/pack";
import { defaultSheet, kitOf, mix, mulberry, placeTeam, shuffled, type GearTier } from "./party";

export interface EnemySlot {
  /** Classes wanted, best first; the first with a hero outside the pool is used, any free hero otherwise. */
  wish: UnitClass[];
  gear: GearTier;
}

export interface Stage {
  name: string;
  /** The enemy party's name and a line of flavour for the prep screen. */
  party: string;
  flavour: string;
  time: "day" | "night";
  /** Backdrop key, read by the renderer. */
  scene: "plains" | "swamp" | "city" | "forest" | "mountains" | "lake" | "title";
  /** The first enemy leads; its squad is this soldier type. */
  squad: string;
  enemies: EnemySlot[];
}

export const STAGES: Stage[] = [
  {
    name: "The Toll Road", party: "Hollow Crown Toll-men", flavour: "Two bored deserters and a handful of hired spears, charging coin for passage on a road they do not own.",
    time: "day", scene: "plains", squad: "soldier_003",
    enemies: [{ wish: ["infantry", "lancer"], gear: "armed" }, { wish: ["archer", "assassin"], gear: "armed" }],
  },
  {
    name: "Saltmarsh Crossing", party: "The Reedwater Band", flavour: "They know every ford in the marsh, and they have seen you coming since noon.",
    time: "day", scene: "swamp", squad: "soldier_011",
    enemies: [{ wish: ["aquatic", "lancer"], gear: "full" }, { wish: ["mage", "archer"], gear: "full" }, { wish: ["cavalry", "flyer"], gear: "armed" }],
  },
  {
    name: "The Ember Gate", party: "Wardens of the Ember Gate", flavour: "Old soldiers and their temple acolytes have held this pass through three wars. They will not move for you.",
    time: "night", scene: "city", squad: "soldier_009",
    enemies: [{ wish: ["monster", "infantry"], gear: "armed" }, { wish: ["lancer", "cavalry"], gear: "armed" }, { wish: ["mage", "archer"], gear: "armed" }, { wish: ["assassin", "archer"], gear: "armed" }],
  },
];

/** The stage's enemy side. `pool` is every hero the player holds; same seed, stage and pool give the same enemies. */
export function resolveEnemies(pack: Pack, seed: number, stage: number, pool: readonly string[]): BattleSide {
  const def = STAGES[stage]!;
  const free = shuffled(pack.characters.filter((c) => !pool.includes(c.id)), mulberry(mix(seed, stage, 0xe)));
  const heroes: RosterHero[] = def.enemies.map((slot) => {
    const ch = slot.wish.flatMap((cls) => free.filter((c) => c.class === cls))[0] ?? free[0]!;
    free.splice(free.indexOf(ch), 1);
    return { char_id: ch.id, squad_id: def.squad, equipment: kitOf(ch.class, slot.gear), tactic_sheet: defaultSheet(pack, ch) };
  });
  return { leader: heroes[0]!.char_id, heroes: placeTeam(pack, heroes) };
}
