// The hero pool: kits, squads, default tactic sheets, the seeded roll, and who stands where. Pure: no DOM.
import { heroRow, resolvePlacements } from "../../src/formation";
import type { BattleSide, Character, Row, Skill, Tactic, UnitClass } from "../../src/schema";
import type { RosterHero } from "../../src/schema/roster";
import type { Pack } from "../../src/validate/pack";

/** Small seeded generator for game-side rolls (the party, enemy picks). The engine keeps its own phase rng. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** A uint32 from a list of integers, for run seed + stage + attempt + phase. */
export const mix = (...xs: number[]): number => {
  let h = 2166136261;
  for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619); h ^= h >>> 13; }
  return h >>> 0;
};

export function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** One kit per class (weapon, armor, 2 plain-shop accessories), the idea of KIT in tools/balance-series.ts. No shields: not every hero of a class may carry one. */
const KIT: Record<UnitClass, [string, string, string, string]> = {
  infantry: ["009", "018", "024", "021"], lancer: ["010", "017", "021", "021"], cavalry: ["010", "018", "024", "027"], archer: ["012", "017", "025", "022"],
  flyer: ["010", "017", "025", "022"], mage: ["014", "019", "025", "026"], holy: ["011", "019", "025", "021"], assassin: ["013", "017", "022", "022"],
  aquatic: ["016", "017", "024", "027"], monster: ["015", "018", "021", "021"],
};

/** One fitting soldier type per class. Cavalry and flyers ride, so Leon and the Cavalry hero pay no unmounted SPD penalty. */
const SQUAD: Record<UnitClass, string> = {
  infantry: "soldier_001", cavalry: "soldier_002", lancer: "soldier_004", archer: "soldier_006", flyer: "soldier_007",
  mage: "soldier_008", holy: "soldier_009", assassin: "soldier_010", aquatic: "soldier_011", monster: "soldier_012",
};

export type GearTier = "full" | "armed"; // armed: weapon and armor, no accessories

export function kitOf(cls: UnitClass, gear: GearTier = "full"): RosterHero["equipment"] {
  const [w, a, x, y] = KIT[cls];
  return { weapon: `equip_${w}`, armor: `equip_${a}`, accessory_1: gear === "full" ? `equip_${x}` : null, accessory_2: gear === "full" ? `equip_${y}` : null };
}

const hasEffect = (s: Skill, type: string) => s.effects.some((e) => e.type === type);
const power = (s: Skill) => Math.max(0, ...s.effects.map((e) => (e.type === "damage" ? e.multiplier : 0)));
const below = (value: number) => ({ type: "hp_percent" as const, side: "target" as const, op: "<" as const, value });
const WEAKEST = { select: "lowest", metric: "hp_percent" } as const;
const HEAL_BELOW = 75, SAVE_BELOW = 50, TEAM_HEAL_BELOW = 75;

/**
 * Default orders: ally skills first but only when someone needs them (a heal at full HP wastes PP), then attacks by PP cost and power, then self
 * buffs; passives follow, since a passive only runs from an enabled sheet entry. Attacks and self buffs keep the skill's default Main (main: null).
 */
export function defaultSheet(pack: Pack, ch: Character): Tactic[] {
  const skills = ch.skills.map((id) => pack.byId.skills.get(id)!);
  const actives = skills.filter((s) => s.category === "active");
  const ally = actives.filter((s) => s.targeting.side === "ally");
  const attacks = actives.filter((s) => hasEffect(s, "damage")).sort((a, b) => b.pp_cost - a.pp_cost || power(b) - power(a));
  const rest = actives.filter((s) => !ally.includes(s) && !attacks.includes(s));
  const allyTactic = (s: Skill): Pick<Tactic, "main" | "sub"> => {
    if (s.targeting.shape === "all") return { main: { type: "average_hp_percent", side: "target", op: "<", value: TEAM_HEAL_BELOW }, sub: null };
    return { main: below(hasEffect(s, "heal") ? HEAL_BELOW : SAVE_BELOW), sub: WEAKEST };
  };
  const rows: Pick<Tactic, "skill_id" | "main" | "sub">[] = [
    ...[...ally].sort((a, b) => b.pp_cost - a.pp_cost).map((s) => ({ skill_id: s.id, ...allyTactic(s) })),
    ...[...attacks, ...rest, ...skills.filter((s) => s.category === "passive")].map((s) => ({ skill_id: s.id, main: null, sub: null })),
  ];
  return rows.map((r, i) => ({ priority: i + 1, enabled: true, ...r }));
}

export interface Slot { row: Row; column: number }
/** A hero of the pool. `slot` null = on the bench. */
export interface PoolHero { entry: RosterHero; slot: Slot | null }

export function poolHero(pack: Pack, id: string): PoolHero {
  const ch = pack.byId.characters.get(id)!;
  return { entry: { char_id: id, squad_id: SQUAD[ch.class], equipment: kitOf(ch.class), tactic_sheet: defaultSheet(pack, ch) }, slot: null };
}

/** A generic hero is named after its class; generics are enemy-only (rogue mode fields only them). */
export const isGeneric = (c: Character): boolean => c.name.toLowerCase() === c.class;

/** A random order of every named hero: the first ones are the starting pool, the next ones the recruits. */
export const rollOrder = (pack: Pack, seed: number): string[] => shuffled(pack.characters.filter((c) => !isGeneric(c)).map((c) => c.id), mulberry(seed));

const sideOf = (heroes: RosterHero[], leader: string): BattleSide => ({ leader, heroes });

/** Pins a team to slots with the shared placement: each hero's own row, row overflow goes to the other row. */
export function placeTeam(pack: Pack, heroes: RosterHero[]): RosterHero[] {
  const cols = pack.rules.board.columns;
  const count: Record<Row, number> = { front: 0, back: 0 };
  const rowed = heroes.map((h) => {
    const want = h.preferred_row ?? heroRow(pack, sideOf(heroes, h.char_id), h);
    const row: Row = count[want] < cols ? want : want === "front" ? "back" : "front";
    count[row]++;
    return { ...h, preferred_row: row };
  });
  const placed = resolvePlacements(pack, sideOf(rowed, rowed[0]!.char_id));
  return rowed.map((h, i) => ({ ...h, column: placed.find((p) => p.order === i)!.column }));
}

/** Front-liners first, then the rest, so an automatic line-up is a mix and not all one row. */
export function autoPick(pack: Pack, pool: PoolHero[]): PoolHero[] {
  const n = pack.rules.draft.fielded, front = Math.ceil(n / 2);
  const isFront = (h: PoolHero) => heroRow(pack, sideOf([h.entry], h.entry.char_id), h.entry) === "front";
  const fronts = pool.filter(isFront).slice(0, front), backs = pool.filter((h) => !isFront(h)).slice(0, n - fronts.length);
  const picked = [...fronts, ...backs];
  return [...picked, ...pool.filter((h) => !picked.includes(h))].slice(0, n);
}

/** The pool with a sensible line-up fielded and everyone else benched. */
export function autoField(pack: Pack, pool: PoolHero[]): PoolHero[] {
  const team = placeTeam(pack, autoPick(pack, pool).map((h) => h.entry));
  return pool.map((h) => {
    const t = team.find((x) => x.char_id === h.entry.char_id);
    return { ...h, slot: t ? { row: t.preferred_row!, column: t.column! } : null };
  });
}

/** First fielded front-liner, else the first fielded hero, else nobody. */
export function pickLeader(pool: PoolHero[]): string | null {
  const fielded = pool.filter((h) => h.slot);
  return (fielded.find((h) => h.slot!.row === "front") ?? fielded[0])?.entry.char_id ?? null;
}

const sameSlot = (a: Slot | null, b: Slot | null) => !!a && !!b && a.row === b.row && a.column === b.column;

/**
 * Moves a hero to a slot, or to the bench with `to` null. A slot that is taken swaps the two heroes (a benched mover sends the occupant to the
 * bench). A benched hero cannot join a full team on an empty slot: the pool comes back unchanged.
 */
export function moveHero(pack: Pack, pool: PoolHero[], id: string, to: Slot | null): PoolHero[] {
  const mover = pool.find((h) => h.entry.char_id === id);
  if (!mover) return pool;
  const occupant = to ? pool.find((h) => sameSlot(h.slot, to)) : undefined;
  if (occupant === mover) return pool;
  if (to && !mover.slot && !occupant && pool.filter((h) => h.slot).length >= pack.rules.draft.fielded) return pool;
  return pool.map((h) => (h === mover ? { ...h, slot: to } : h === occupant ? { ...h, slot: mover.slot } : h));
}

/** The first empty slot of a hero's own row, else of the other row, for "field this hero" without aiming. */
export function freeSlot(pack: Pack, pool: PoolHero[], id: string): Slot | null {
  const h = pool.find((x) => x.entry.char_id === id);
  if (!h) return null;
  const own = heroRow(pack, sideOf([h.entry], id), h.entry);
  for (const row of [own, own === "front" ? "back" : "front"] as Row[]) {
    for (let column = 1; column <= pack.rules.board.columns; column++) {
      if (!pool.some((x) => sameSlot(x.slot, { row, column }))) return { row, column };
    }
  }
  return null;
}

/** The fielded heroes as battle entries, pinned to their slots. */
export const fieldedEntries = (pool: PoolHero[]): RosterHero[] =>
  pool.filter((h) => h.slot).map((h) => ({ ...h.entry, preferred_row: h.slot!.row, column: h.slot!.column }));

// ------------------------------------------------------------------ tactic sheet edits
const renumber = (sheet: Tactic[]): Tactic[] => sheet.map((t, i) => ({ ...t, priority: i + 1 }));

export function moveTactic(sheet: Tactic[], index: number, by: -1 | 1): Tactic[] {
  const to = index + by;
  if (to < 0 || to >= sheet.length) return sheet;
  const a = [...sheet];
  [a[index], a[to]] = [a[to]!, a[index]!];
  return renumber(a);
}

export const toggleTactic = (sheet: Tactic[], index: number): Tactic[] => sheet.map((t, i) => (i === index ? { ...t, enabled: !t.enabled } : t));

export const setSlot = (sheet: Tactic[], index: number, slot: "main" | "sub", value: Tactic["main"]): Tactic[] =>
  sheet.map((t, i) => (i === index ? { ...t, [slot]: value } : t));

/** Damage percent change for `mine` hitting `theirs`, from rules.yaml: positive on advantage, negative on the losing side, 0 when neutral. */
export function matchupPct(pack: Pack, mine: UnitClass, theirs: UnitClass): number {
  const { class_advantage: pairs, matchup } = pack.rules;
  const win = pairs.find((p) => p.attacker === mine && p.defender === theirs);
  if (win) return win.damage_percent ?? matchup.advantage_damage_percent;
  return pairs.some((p) => p.attacker === theirs && p.defender === mine) ? matchup.disadvantage_damage_percent : 0;
}
