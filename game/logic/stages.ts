// The three tutorial battles as data, and how an authored enemy party becomes real heroes. Enemies are picked from the heroes outside the pool, so
// they never collide with a fielded char_id (E_BATTLE_DUP) and stay the same while the player changes picks. Pure: no DOM.
import type { BattleSide, UnitClass } from "../../src/schema";
import type { RosterHero } from "../../src/schema/roster";
import type { Pack } from "../../src/validate/pack";
import { defaultSheet, isCopy, isGeneric, kitOf, mix, mulberry, placeTeam, shuffled, type GearTier } from "./party";

export type Mode = "tutorial" | "rogue";

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

/** Rogue enemy heroes per wave (`stage` is zero-based): waves 1-2 two, 3-4 three, 5-7 four, 8-10 five, 11+ six. */
export const rogueEnemyCount = (stage: number): number => (stage < 2 ? 2 : stage < 4 ? 3 : stage < 7 ? 4 : stage < 10 ? 5 : 6);

const foes = (gear: GearTier, ...wishes: UnitClass[][]): EnemySlot[] => wishes.map((wish) => ({ wish, gear }));

export const ROGUE_STAGES: Stage[] = [
  { name: "The Burnt Mill", party: "Millyard Cutpurses", flavour: "Two thieves and a pack of hired hands are stripping the old mill for anything that rings.", time: "day", scene: "plains", squad: "soldier_001", enemies: foes("armed", ["infantry"], ["archer"]) },
  { name: "Drowned Causeway", party: "Causeway Reavers", flavour: "A raised road through the marsh, and men who charge a price to cross it.", time: "day", scene: "swamp", squad: "soldier_011", enemies: foes("armed", ["aquatic", "lancer"], ["assassin"]) },
  { name: "Thornwood Ambush", party: "The Bramble Wolves", flavour: "They wait in the undergrowth, and the first you know of them is an arrow.", time: "day", scene: "forest", squad: "soldier_006", enemies: foes("armed", ["archer"], ["assassin"], ["infantry"]) },
  { name: "Ashen Pass", party: "Pass-Hold Veterans", flavour: "Grey-bearded soldiers hold the narrow way and have buried better companies than yours.", time: "night", scene: "mountains", squad: "soldier_004", enemies: foes("armed", ["lancer"], ["infantry"], ["mage"]) },
  { name: "The Lantern Docks", party: "Dockside Enforcers", flavour: "The harbour guild keeps its own law at the water's edge, and its law is blunt.", time: "night", scene: "lake", squad: "soldier_011", enemies: foes("full", ["aquatic"], ["lancer"], ["archer"], ["assassin"]) },
  { name: "Hollow Market", party: "The Grey Syndicate", flavour: "Stall-keepers who never sell, and knives for anyone who asks the price.", time: "day", scene: "city", squad: "soldier_010", enemies: foes("full", ["assassin"], ["archer"], ["infantry"], ["mage"]) },
  { name: "Redfen Bog", party: "Mire Hags and Hounds", flavour: "The mist hides the path and the fen hides worse. Something is walking beside you.", time: "night", scene: "swamp", squad: "soldier_012", enemies: foes("full", ["monster"], ["mage"], ["aquatic"], ["assassin"]) },
  { name: "Longshade Orchard", party: "Orchard Wardens", flavour: "Overgrown trees, and riders who have claimed every fruit for their lord.", time: "day", scene: "forest", squad: "soldier_002", enemies: foes("full", ["cavalry"], ["archer"], ["lancer"], ["mage"]) },
  { name: "The Split Crag", party: "Crag Reavers", flavour: "A rock-fort split by lightning. Its chieftain scorns anyone who climbs it on foot.", time: "day", scene: "mountains", squad: "soldier_012", enemies: foes("full", ["monster"], ["infantry"], ["archer"], ["mage"]) },
  { name: "Mirrormere Shore", party: "Mere-Sisters", flavour: "The lake is still, and the women at its edge are stiller. Do not drink.", time: "night", scene: "lake", squad: "soldier_011", enemies: foes("full", ["aquatic"], ["mage"], ["holy"], ["archer"]) },
  { name: "Brasswind Gate", party: "Gatehouse Watch", flavour: "A city that locks its gate at dusk, and a watch that has never opened it for a stranger.", time: "night", scene: "city", squad: "soldier_001", enemies: foes("full", ["infantry"], ["lancer"], ["holy"], ["archer"]) },
  { name: "Rookfall Heath", party: "Black Rook Riders", flavour: "Horse-lords of the open heath. They ride you down before you have set your line.", time: "day", scene: "plains", squad: "soldier_002", enemies: foes("full", ["cavalry"], ["flyer"], ["lancer"], ["archer"]) },
  { name: "Gloamwood Hollow", party: "The Hollow Court", flavour: "A court of masked hunters, who answer to a king nobody has seen.", time: "night", scene: "forest", squad: "soldier_010", enemies: foes("full", ["assassin"], ["mage"], ["archer"], ["holy"]) },
  { name: "Stormspire Stair", party: "Skyguard of the Stair", flavour: "Winged scouts bar the highest road, and nothing climbs it unseen.", time: "day", scene: "mountains", squad: "soldier_007", enemies: foes("full", ["flyer"], ["lancer"], ["archer"], ["holy"]) },
  { name: "The Sunken Quay", party: "Drowned Legion", flavour: "Soldiers who refused to leave their posts when the water rose.", time: "night", scene: "lake", squad: "soldier_011", enemies: foes("full", ["aquatic"], ["infantry"], ["mage"], ["holy"]) },
  { name: "Ironbell Square", party: "Ironbell Guard", flavour: "The city's best, drilled daily, polished weekly, and answering to nobody you know.", time: "day", scene: "city", squad: "soldier_009", enemies: foes("full", ["infantry"], ["holy"], ["lancer"], ["archer"]) },
  { name: "Bonefen Wallow", party: "The Bonefen Brood", flavour: "Things the marsh made, and fed, and now sends against anyone who wades in.", time: "night", scene: "swamp", squad: "soldier_012", enemies: foes("full", ["monster"], ["monster", "assassin"], ["mage"], ["aquatic"]) },
  { name: "Highmoor Watch", party: "Moor-Lord's Spears", flavour: "Long spears on a long ridge, and a lord who has not lost a hill in twenty years.", time: "day", scene: "plains", squad: "soldier_004", enemies: foes("full", ["lancer"], ["cavalry"], ["infantry"], ["mage"]) },
  { name: "The Emberfall Keep", party: "Keepers of the Last Flame", flavour: "Old soldiers and their temple acolytes hold the keep, and they will not move for you.", time: "night", scene: "mountains", squad: "soldier_009", enemies: foes("full", ["holy"], ["infantry"], ["mage"], ["lancer"]) },
  { name: "The Crown of Ash", party: "The Hollow King's Host", flavour: "At the end of the road a throne of cinders, and everyone he ever broke standing behind it.", time: "night", scene: "city", squad: "soldier_012", enemies: foes("full", ["monster"], ["cavalry"], ["mage"], ["holy"]) },
];

/** The stages a run plays. */
export const stagesOf = (s: { mode: Mode }): Stage[] => (s.mode === "rogue" ? ROGUE_STAGES : STAGES);

/** The stage's enemy side. `pool` is every hero the player holds; same seed, stage and pool give the same enemies. Rogue foes are generics only. */
export function resolveEnemies(pack: Pack, seed: number, stage: number, pool: readonly string[], mode: Mode = "tutorial"): BattleSide {
  const def = stagesOf({ mode })[stage]!;
  const free = shuffled(pack.characters.filter((c) => (mode === "rogue" ? isGeneric(c) : !isCopy(c) && !pool.includes(c.id))), mulberry(mix(seed, stage, 0xe)));
  // Rogue: the stage's slots first, then extras of the stage's own classes; a class may repeat (copies of each generic from `bootPack` keep ids unique).
  const extra = mulberry(mix(seed, stage, 0xf)), theme = def.enemies.flatMap((e) => e.wish);
  const slots = mode === "rogue" ? Array.from({ length: rogueEnemyCount(stage) }, (_, i): EnemySlot => def.enemies[i] ?? { wish: [theme[Math.floor(extra() * theme.length)]!], gear: def.enemies[0]!.gear }) : def.enemies;
  const heroes: RosterHero[] = slots.map((slot) => {
    const ch = slot.wish.flatMap((cls) => free.filter((c) => c.class === cls))[0] ?? free[0]!;
    free.splice(free.indexOf(ch), 1);
    return { char_id: ch.id, squad_id: def.squad, equipment: kitOf(ch.class, slot.gear), tactic_sheet: defaultSheet(pack, ch) };
  });
  return { leader: heroes[0]!.char_id, heroes: placeTeam(pack, heroes) };
}
