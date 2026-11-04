// The tutorial and rogue battles as data (rogue waves 15+ are designed teams of named heroes), and how an authored enemy party becomes real heroes. Enemies are picked from the heroes outside the pool, so
// they never collide with a fielded char_id (E_BATTLE_DUP) and stay the same while the player changes picks. Pure: no DOM.
import type { BattleSide, Row, Tactic, UnitClass } from "../../src/schema";
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
  /** A designed team of named heroes, leader first; replaces `enemies`. */
  team?: TeamHero[];
}

/** One hero of a designed team. Fielded as its `_c1` copy, so the player can own the same hero. */
export interface TeamHero {
  hero: string;
  row: Row;
  /** A gear tier, or weapon, armor and two accessories by equip number. */
  gear: GearTier | [string, string, string | null, string | null];
  /** Skills moved to the top of the default sheet, in this order. */
  first?: string[];
  /** Target order for every attack on the sheet. */
  sub?: Tactic["sub"];
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

const BACK = { select: "prefer", filter: { type: "row_is", side: "target", value: "back" } } as const;
const DEBUFFED = { select: "prefer", filter: { type: "has_any_debuff", side: "target" } } as const;
const WEAK = { select: "lowest", metric: "hp_percent" } as const;

// Designed teams, leader first. Plain "armed" gear keeps them beatable 6 against 4; each team's named pieces serve its plan. Tuned with `tools/rogue-balance.ts --late`.
/** Wave 15. A wall that hits back: Thornhide and Counter on three front-liners, Vigil Charms for the passive PP to keep answering; Sylwen finishes the wounded. */
const QUAY: TeamHero[] = [
  { hero: "char_019", row: "front", gear: ["016", "017", "031", null], first: ["skl_020", "skl_031"] },
  { hero: "char_020", row: "front", gear: ["015", "018", "031", null], first: ["skl_031", "skl_033"] },
  { hero: "char_004", row: "front", gear: "armed", first: ["skl_031"] },
  { hero: "char_016", row: "back", gear: "armed", first: ["skl_033"] },
  { hero: "char_015", row: "back", gear: "armed", sub: WEAK },
  { hero: "char_017", row: "back", gear: "armed" },
];
/** Wave 16. Bodyguard only covers its own row, so Brunna stands in the back beside Jasmine; the Acolytes and Aurael's Purify keep the skirmish line up. */
const IRONBELL: TeamHero[] = [
  { hero: "char_004", row: "front", gear: "armed", first: ["skl_031"] },
  { hero: "char_015", row: "front", gear: "armed" },
  { hero: "char_018", row: "front", gear: "armed" },
  { hero: "char_003", row: "back", gear: "armed" },
  { hero: "char_019", row: "back", gear: "armed", first: ["skl_030"] },
  { hero: "char_016", row: "back", gear: "armed" },
];
/** Wave 17. Evil on debuffs: Dirge, Rend and Hex open with Defense Down and everyone piles on the debuffed; the Sworn Banner lifts the four Evil heroes. */
const BONEFEN: TeamHero[] = [
  { hero: "char_002", row: "front", gear: "armed", first: ["skl_029"], sub: DEBUFFED },
  { hero: "char_020", row: "front", gear: ["015", "018", "028", null], first: ["skl_016"], sub: DEBUFFED },
  { hero: "char_017", row: "front", gear: "armed", sub: DEBUFFED },
  { hero: "char_016", row: "back", gear: ["014", "019", "029", null], first: ["skl_011"], sub: DEBUFFED },
  { hero: "char_015", row: "back", gear: "armed", sub: DEBUFFED },
  { hero: "char_018", row: "back", gear: "armed", sub: DEBUFFED },
];
/** Wave 18. The Strikers dive: Vexis, Rikka and Sylwen go straight for the back row, Pursuit and Follow-Up stacking on the same target, while Leon and Ashkarn hold the player's front. */
const HIGHMOOR: TeamHero[] = [
  { hero: "char_017", row: "front", gear: ["010", "017", "006", null], first: ["skl_024"], sub: BACK },
  { hero: "char_001", row: "front", gear: "armed" },
  { hero: "char_020", row: "front", gear: "armed" },
  { hero: "char_018", row: "back", gear: "armed", first: ["skl_009"], sub: BACK },
  { hero: "char_015", row: "back", gear: "armed", sub: BACK },
  { hero: "char_016", row: "back", gear: "armed" },
];
/** Wave 19. Attrition: Jasmine leads, so every action of hers heals the whole side 30%. Brunna covers her in the back, Leon covers the front, the Queen's Scepter feeds the heals. */
const EMBERFALL: TeamHero[] = [
  { hero: "char_003", row: "back", gear: ["003", "019", null, null] },
  { hero: "char_019", row: "back", gear: "armed", first: ["skl_030"] },
  { hero: "char_016", row: "back", gear: "armed" },
  { hero: "char_001", row: "front", gear: "armed", first: ["skl_030"] },
  { hero: "char_017", row: "front", gear: "armed" },
  { hero: "char_004", row: "front", gear: "armed" },
];
/** Wave 20, the boss. Leon's aura gives him and the Emperor +30% ATK, DEF and SPD, the Sworn Banner lifts the Empire and Evil line, Jasmine mends it; both wear the legendary gear. */
const CROWN: TeamHero[] = [
  { hero: "char_001", row: "front", gear: ["004", "018", null, null], first: ["skl_030"], sub: WEAK },
  { hero: "char_002", row: "front", gear: ["001", "002", null, null], first: ["skl_029"] },
  { hero: "char_019", row: "front", gear: "armed", sub: WEAK },
  { hero: "char_003", row: "back", gear: "armed" },
  { hero: "char_015", row: "back", gear: "armed", sub: WEAK },
  { hero: "char_017", row: "back", gear: "armed", sub: WEAK },
];

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
  { name: "The Sunken Quay", party: "The Saltreach Breakers", flavour: "Salt-hardened veterans who let you swing first. Every blow you land on them comes back with interest.", time: "night", scene: "lake", squad: "soldier_011", enemies: [], team: QUAY },
  { name: "Ironbell Square", party: "The Dawn Vigil", flavour: "Lief holds the square and Jasmine holds Lief together. Nobody has reached her yet; the bell still tolls for those who tried.", time: "day", scene: "city", squad: "soldier_009", enemies: [], team: IRONBELL },
  { name: "Bonefen Wallow", party: "The Dragon's Ire", flavour: "The Emperor's darker court meets in the mire. They do not kill you; they take your armor apart, and the fen does the rest.", time: "night", scene: "swamp", squad: "soldier_010", enemies: [], team: BONEFEN },
  { name: "Highmoor Watch", party: "The Red Strikers", flavour: "They ignore your shield wall. By the time you have turned around, your healer is already dead.", time: "day", scene: "plains", squad: "soldier_007", enemies: [], team: HIGHMOOR },
  { name: "The Emberfall Keep", party: "Keepers of the Last Flame", flavour: "While Jasmine prays, every wound in the keep closes. End her, or stay here until you drop.", time: "night", scene: "mountains", squad: "soldier_009", enemies: [], team: EMBERFALL },
  { name: "The Crown of Ash", party: "The Emperor's Own", flavour: "At the end of the road a throne of cinders, the Emperor upon it, and his knight at his right hand. Nobody else was ever the Hollow King.", time: "night", scene: "city", squad: "soldier_002", enemies: [], team: CROWN },
];

/** The stages a run plays. */
export const stagesOf = (s: { mode: Mode }): Stage[] => (s.mode === "rogue" ? ROGUE_STAGES : STAGES);

function teamHero(pack: Pack, t: TeamHero, squad: string): RosterHero {
  const ch = pack.byId.characters.get(`${t.hero}_c1`)!;
  const isAttack = (r: Tactic) => { const s = pack.byId.skills.get(r.skill_id)!; return s.category === "active" && s.targeting.side === "enemy"; };
  const sheet = defaultSheet(pack, ch).map((r) => (t.sub && isAttack(r) ? { ...r, sub: t.sub } : r));
  const rank = (r: Tactic) => { const i = t.first?.indexOf(r.skill_id) ?? -1; return i < 0 ? Infinity : i; };
  const [w, a, x, y] = typeof t.gear === "string" ? [] : t.gear;
  return {
    char_id: ch.id, squad_id: squad, preferred_row: t.row,
    equipment: typeof t.gear === "string" ? kitOf(ch.class, t.gear) : { weapon: `equip_${w}`, armor: `equip_${a}`, accessory_1: x ? `equip_${x}` : null, accessory_2: y ? `equip_${y}` : null },
    tactic_sheet: [...sheet].sort((p, q) => rank(p) - rank(q) || p.priority - q.priority).map((r, i) => ({ ...r, priority: i + 1 })),
  };
}

/** The stage's enemy side. `pool` is every hero the player holds; same seed, stage and pool give the same enemies. Rogue foes are generics, until the stages with a designed `team`. */
export function resolveEnemies(pack: Pack, seed: number, stage: number, pool: readonly string[], mode: Mode = "tutorial"): BattleSide {
  const def = stagesOf({ mode })[stage]!;
  if (def.team) {
    const heroes = def.team.map((t) => teamHero(pack, t, def.squad));
    return { leader: heroes[0]!.char_id, heroes: placeTeam(pack, heroes) };
  }
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
