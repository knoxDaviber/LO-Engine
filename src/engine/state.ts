// Battle state types and construction. Plain data; functions elsewhere take the state and mutate it explicitly.
import type { Battle, Character, Effect, Row, SoldierType, SourceCategory, Stat, Status, Tactic, UnitClass } from "../schema";
import { STATS } from "../schema";
import { resolvePlacements, resolveSquadPlacement, rowOverflows } from "../formation";
import type { Pack } from "../validate/pack";
import { statBreakdown } from "./stats";
import { EventBus } from "./events";
import type { SideLeader } from "./leader";
import { pairingPenalties } from "./leader";
import { isReactiveTrigger, registerSoldierSkill, registerSystemHandlers } from "./reactions";

export type Side = "challenger" | "defender";

/** One applied status. `category` is the resolved source category (never "inherit"). */
export interface StatusInstance {
  statusId: string;
  category: SourceCategory;
  sourceUnitId: string;
  /** Remaining turns/hits for counted durations; null for uncounted ones. */
  remaining: number | null;
  /** True right after application when the applying action must not count as a turn (applying_action_counts false). */
  skipNextTick: boolean;
  /** Application order; earlier wins ties inside a stacking group. */
  seq: number;
  /** Leader auras (2.5): modifiers carried by the instance itself, since an aura is not a pack status. `statusId` is then `aura:<leader>:<n>`. */
  inline?: { name: string; modifiers: { stat: Stat; mode: "flat" | "percent"; value: number }[] };
}

export interface PpPool {
  cur: number;
  max: number;
}

export type UnitKind = "hero" | "squad";

/** One soldier of a squad. Index is stable (0-based); ties between soldiers go to the lowest index. */
export interface Soldier {
  index: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

/** An always-on stat modifier that is not a status (soldier skills). Goes through the same stacking function as statuses. */
export interface InnateModifier {
  id: string; // shown in stat breakdowns
  stat: Stat;
  mode: "flat" | "percent";
  value: number;
  category: SourceCategory;
  /** Soldier skills that target the leader or the party: the squad that put this modifier here. Dropped when that squad is removed or wiped. */
  from?: string;
}

export interface Unit {
  id: string; // heroes: char_id (unique across a battle, enforced by the validator); squads: squad_<leader char_id>
  /** "squad" is the leader's squad as ONE target/actor. Its hp/maxHp are the sums over its soldiers (kept in sync by the engine). */
  kind: UnitKind;
  /** Squads only: the individual soldiers (empty for heroes). */
  soldiers: Soldier[];
  /** Always-on stat modifiers outside the status list (soldier skills). Empty for heroes. */
  innate: InnateModifier[];
  /** Squads only: the leader hero and the soldier type. */
  leaderId: string | null;
  soldierTypeId: string | null;
  /** Squads only: the leader hero unit. Its statuses' stat modifiers count for the squad too (design 2.1; stat modifiers only). */
  leaderUnit?: Unit | null;
  side: Side;
  charId: string;
  name: string;
  class: UnitClass;
  factions: string[];
  isLeader: boolean;
  /** Heroes: hero row. Squads: the squad_row, i.e. the soldier row in front of (front) or behind (back) the hero rows. */
  row: Row;
  column: number; // 1-based, within the hero row, by formation order. Squads span every column: 0.
  formationIndex: number; // front-left to back-right across the side; a front squad is -1, a back squad is the hero count
  baseStats: Record<Stat, number>;
  equipFlat: Record<Stat, number>; // flat equipment lines, added to base before anything else
  hp: number;
  maxHp: number;
  pp: { active: PpPool; passive: PpPool };
  statuses: StatusInstance[];
  alive: boolean;
  tactics: Tactic[]; // sorted by priority, lowest first
  skills: string[];
}

export interface TimelineEntry {
  unitId: string;
  due: number;
  interval: number;
  /** Monotonic sequence number, new on every schedule or reschedule (tl.seqCounter). */
  seq: number;
  /** True when the entry was moved by an SPD change; those ties are FILO by seq. */
  changed: boolean;
}

export interface Timeline {
  now: number;
  pending: Map<string, TimelineEntry>;
  seqCounter: number;
}

export interface BattleState {
  pack: Pack;
  battleId: string;
  /** Terrain id of the battle (`battle.battlefield`), or null for none. Read by the terrain pre-battle step and bonus_on_terrain. */
  battlefield: string | null;
  phase: number; // 1-based
  units: Unit[]; // challenger heroes then defender heroes, each in formation order
  timeline: Timeline;
  actionCount: number;
  statusSeq: number;
  /** "not implemented" notes found while building units (soldier skills the engine cannot run yet); logged at phase start. */
  buildNotes: { unit: string; what: string }[];
  /** Event bus (events.ts). Built with the state, so every phase starts with fresh subscriptions. */
  bus: EventBus;
  /** Per side: the current leader and the `aura active` flag (leader.ts). Aura content is 2.5. */
  leaders: Record<Side, SideLeader>;
}

const zeroStats = (): Record<Stat, number> => Object.fromEntries(STATS.map((s) => [s, 0])) as Record<Stat, number>;

function buildUnits(pack: Pack, side: Side, battle: Battle, notes: BattleState["buildNotes"]): Unit[] {
  const s = battle[side];
  const overflow = rowOverflows(pack, s);
  if (overflow.length > 0) {
    throw new Error(`${side} row ${overflow.join(", ")} holds more than ${pack.rules.board.columns} heroes (E_BATTLE_ROW_FULL)`);
  }
  const placed = resolvePlacements(pack, s);
  const units = placed.map((pl) => {
    const h = s.heroes[pl.order]!;
    const ch = pack.byId.characters.get(h.char_id) as Character;
    const equipFlat = zeroStats();
    let ppA = ch.pp.active;
    let ppP = ch.pp.passive;
    for (const eqId of [h.equipment.weapon, h.equipment.armor, h.equipment.accessory_1, h.equipment.accessory_2]) {
      const eq = eqId ? pack.byId.equipment.get(eqId) : undefined;
      if (!eq) continue;
      for (const st of STATS) equipFlat[st] += eq.stat_modifiers[st];
      ppA += eq.pp_modifiers.active;
      ppP += eq.pp_modifiers.passive;
    }
    const maxHp = Math.max(1, ch.base_stats.HP + equipFlat.HP);
    // The leader's squad is the only deployed one, so only the leader carries pairing penalties (Leon's SPD -20 with non-mounted soldiers).
    const pairedType = h.char_id === s.leader ? pack.byId.soldiers.get(h.squad_id) : undefined;
    const innate = pairedType ? pairingPenalties(ch, pairedType, notes) : [];
    // Hero passive skills do not run yet (roadmap 3a); note each one so it is never silently dropped.
    for (const skId of ch.skills) {
      const sk = pack.byId.skills.get(skId);
      if (sk?.category === "passive") notes.push({ unit: ch.id, what: `not implemented: passive ${sk.name}` });
    }
    const unit: Unit = {
      id: ch.id, kind: "hero", soldiers: [], innate, leaderId: null, soldierTypeId: null, side, charId: ch.id, name: ch.name, class: ch.class, factions: [...ch.factions], isLeader: h.char_id === s.leader,
      row: pl.row, column: pl.column, formationIndex: pl.formationIndex,
      baseStats: { ...ch.base_stats }, equipFlat, hp: maxHp, maxHp,
      pp: {
        active: { cur: Math.min(ppA, pack.rules.pp.max), max: Math.min(ppA, pack.rules.pp.max) },
        passive: { cur: Math.min(ppP, pack.rules.pp.max), max: Math.min(ppP, pack.rules.pp.max) },
      },
      statuses: [], alive: true,
      tactics: [...h.tactic_sheet].sort((a, b) => a.priority - b.priority),
      skills: [...ch.skills],
    };
    return unit;
  });
  return units; // already in formation order
}

/** True for a soldier skill effect the engine runs as an always-on modifier of the squad itself. */
const isAlwaysOn = (e: Effect): boolean => (!e.trigger || e.trigger === "always") && !e.condition;

interface SquadSkills {
  reactive: { label: string; effect: Effect }[];
  /** Always-on modify_stat effects aimed at the leader or the whole party (heroes of the side). */
  targeted: { label: string; target: "leader" | "party"; mod: Omit<InnateModifier, "from"> }[];
}

/**
 * Builds the leader's squad (one per side) as a single Unit: its stats are the soldier type's per-soldier stats, its soldier skills
 * become innate modifiers in the `soldier` stacking category. Event-triggered soldier skills and leader/party-targeted ones
 * are collected in `skills` and wired up by createBattleState. Returns null when the side has no squad (no leader entry).
 */
function buildSquad(pack: Pack, side: Side, battle: Battle, heroes: Unit[], notes: BattleState["buildNotes"], skills: SquadSkills): Unit | null {
  const sp = resolveSquadPlacement(pack, battle[side]);
  if (!sp) return null;
  const st = pack.byId.soldiers.get(sp.squadId) as SoldierType;
  if (!st.allowed_soldier_rows.includes(sp.row)) {
    throw new Error(`${side} squad row '${sp.row}' is not allowed for '${st.id}' (E_SQUAD_ROW)`);
  }
  const leader = pack.byId.characters.get(sp.leaderCharId) as Character;
  const id = `squad_${sp.leaderCharId}`;
  const innate: InnateModifier[] = [];
  st.passive_effects.forEach((p, pi) =>
    p.effects.forEach((e, ei) => {
      const label = `${st.id} skill ${pi + 1}.${ei + 1}`;
      if (isReactiveTrigger(e) && p.target === "self_squad") {
        skills.reactive.push({ label, effect: e });
      } else if (!isAlwaysOn(e)) {
        notes.push({ unit: id, what: "not implemented: event soldier skill" });
      } else if (e.type !== "modify_stat") {
        notes.push({ unit: id, what: `not implemented: soldier skill effect ${e.type}` });
      } else {
        const mod = { id: label, stat: e.stat, mode: e.mode, value: e.value, category: e.source_category ?? "soldier" } as const;
        if (p.target === "self_squad") innate.push({ ...mod });
        else skills.targeted.push({ label, target: p.target, mod });
      }
    }),
  );
  const stats = { ...st.per_soldier_stats } as Record<Stat, number>;
  const squad: Unit = {
    id, kind: "squad", soldiers: [], innate, leaderId: sp.leaderCharId, soldierTypeId: st.id, side, charId: sp.leaderCharId,
    name: `${leader.name}'s ${st.name}`, class: st.class, factions: [], isLeader: false,
    row: sp.row, column: 0, formationIndex: sp.row === "front" ? -1 : heroes.length,
    baseStats: stats, equipFlat: zeroStats(), hp: 0, maxHp: 0,
    pp: { active: { cur: 0, max: 0 }, passive: { cur: 0, max: 0 } },
    statuses: [], alive: true, tactics: [], skills: [],
  };
  // Soldier max HP is the effective HP stat (base plus always-on soldier modifiers).
  const perSoldier = Math.max(1, Math.floor(statBreakdown(squad, "HP", pack).result));
  squad.soldiers = Array.from({ length: st.count }, (_, index) => ({ index, hp: perSoldier, maxHp: perSoldier, alive: true }));
  syncSquad(squad);
  return squad;
}

/** Recomputes a squad's aggregate hp / maxHp / alive from its soldiers. */
export function syncSquad(squad: Unit): void {
  squad.hp = squad.soldiers.reduce((n, s) => n + s.hp, 0);
  squad.maxHp = squad.soldiers.reduce((n, s) => n + s.maxHp, 0);
  squad.alive = squad.soldiers.some((s) => s.alive);
}

/** Builds the state for a validated battle at the start of `phase` (full HP/PP; later phases are restored by the phase controller). */
export function createBattleState(pack: Pack, battle: Battle, phase = 1): BattleState {
  const buildNotes: BattleState["buildNotes"] = [];
  const units: Unit[] = [];
  const squadSkills: { squad: Unit; skills: SquadSkills }[] = [];
  for (const side of ["challenger", "defender"] as const) {
    const heroes = buildUnits(pack, side, battle, buildNotes);
    units.push(...heroes);
    const own: SquadSkills = { reactive: [], targeted: [] };
    const squad = buildSquad(pack, side, battle, heroes, buildNotes, own);
    if (squad) {
      squad.leaderUnit = heroes.find((h) => h.id === squad.leaderId) ?? null;
      units.push(squad);
      squadSkills.push({ squad, skills: own });
    }
  }
  const state: BattleState = {
    pack, battleId: battle.battle_id, battlefield: battle.battlefield ?? null, phase, units,
    timeline: { now: 0, pending: new Map(), seqCounter: 0 },
    actionCount: 0, statusSeq: 0, buildNotes,
    bus: new EventBus(),
    leaders: {
      challenger: { leaderId: battle.challenger.leader, auraActive: true },
      defender: { leaderId: battle.defender.leader, auraActive: true },
    },
  };
  registerSystemHandlers(state);
  for (const { squad, skills: sk } of squadSkills) {
    const st = pack.byId.soldiers.get(squad.soldierTypeId!) as SoldierType;
    for (const r of sk.reactive) registerSoldierSkill(state, squad, st, r.label, r.effect);
    for (const t of sk.targeted) {
      for (const u of units) {
        if (u.side !== squad.side || u.kind !== "hero") continue;
        if (t.target === "party" || u.id === squad.leaderId) u.innate.push({ ...t.mod, from: squad.id });
      }
    }
  }
  return state;
}

export const getUnit = (state: BattleState, id: string): Unit => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
};
export const otherSide = (s: Side): Side => (s === "challenger" ? "defender" : "challenger");
export const isSquad = (u: Unit): boolean => u.kind === "squad";
/** Board order, front to back: soldier row in front (0), hero front (1), hero back (2), soldier row behind (3). */
export const boardRank = (u: Unit): number => (u.kind === "squad" ? (u.row === "front" ? 0 : 3) : u.row === "front" ? 1 : 2);
/** Living HEROES of a side. Wipe checks, exhaustion, idle cycles and average SKL only ever look at heroes. */
export const livingOf = (state: BattleState, side: Side): Unit[] => state.units.filter((u) => u.side === side && u.alive && u.kind === "hero");
/** Living heroes plus the living squad: everything on a side that can be selected as a target. */
export const targetsOf = (state: BattleState, side: Side): Unit[] => state.units.filter((u) => u.side === side && u.alive);
export const squadOf = (state: BattleState, side: Side): Unit | undefined => state.units.find((u) => u.side === side && u.kind === "squad");
export const alliesOf = (state: BattleState, u: Unit): Unit[] => livingOf(state, u.side);
export const enemiesOf = (state: BattleState, u: Unit): Unit[] => livingOf(state, otherSide(u.side));

export type StatusLookup = Map<string, Status>;
