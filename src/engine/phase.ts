// Phase controller (design Sections 5 and 17) and battle runner.
//
// Phase: pre-battle state (full PP, no statuses, timeline 0) with HP and deaths carried over; loop nextAction -> decideTactic ->
// execute or idle; after every action the end conditions are checked in this order:
//   1. wipe        all heroes of one side dead: the battle ends at once
//   2. exhausted   every living hero is exhausted: Active PP below pp_cost of every enabled active skill on its sheet.
//                  Slice decision: a tactic only counts if the slice can run its skill (skillSupport), skills it can never run
//                  must not keep a phase alive. A hero with no such tactic is exhausted.
//   3. idle_cycle  every living unit has had an action since the last skill was executed, and none executed one
//   4. action_cap  rules.phase.max_actions_per_phase (200 when null), last resort
// The same checks run once before the first action. Squads (design 5.2: soldier attacks never keep a phase alive) take part in none of
// the exhaustion and idle checks: only living heroes count there. A squad acts on its own SPD schedule and is reported as `squad_actions`,
// apart from the heroes' `actions`. Only HERO actions count toward the cap ([DEFAULT], decision log 93): a very fast squad must not end a
// phase while heroes still have PP. Squad actions have their own generous safety bound (SQUAD_BOUND_FACTOR x the cap) against endless loops. A unit killed before it acts keeps its unspent PP
// (it is simply never spent); dead units stay dead and unscheduled in later phases.
import type { Battle } from "../schema";
import { STATS } from "../schema";
import type { Pack } from "../validate/pack";
import { executeIdle, executeSkill, type ExecCtx } from "./damage";
import { applySuccession, endSquadSkills } from "./leader";
import { runPreBattle } from "./prebattle";
import type { BattleEvent, EventSink } from "./log";
import { EventLog, at, nullSink, r4 } from "./log";
import type { Rng } from "./rng";
import { phaseRng } from "./rng";
import { allBreakdowns } from "./stats";
import type { BattleState, Side, Unit } from "./state";
import { createBattleState, livingOf, syncSquad } from "./state";
import { executeSquadAction } from "./squad";
import { decideTactic, skillSupport } from "./tactics";
import { nextAction, scheduleInitial } from "./timeline";

export const MAX_PHASES = 3;
export const DEFAULT_ACTION_CAP = 200;
export const SQUAD_BOUND_FACTOR = 10;

export type PhaseEndReason = "wipe" | "exhausted" | "idle_cycle" | "action_cap" | "no_actions";

export interface PhaseResult {
  phase: number;
  reason: PhaseEndReason;
  actions: number; // hero actions (skills and idles)
  skills: number;
  squadActions: number;
  endCount: number;
  survivors: { challenger: number; defender: number };
}

export interface BattleResult {
  winner: Side;
  reason: "wipe" | "phase3_timeout";
  phases: PhaseResult[];
  units: { id: string; side: Side; hp: number; max_hp: number; alive: boolean }[]; // heroes
  leaders: Record<Side, { leader: string; aura_active: boolean }>; // at the end of the battle
  squads: { id: string; side: Side; hp: number; max_hp: number; alive: boolean; soldiers: number[] }[]; // soldier HP, 0 = dead
  events: BattleEvent[];
}

/** Active PP is below the cost of every usable enabled active skill on the unit's sheet (or there is none). */
export function isExhausted(state: BattleState, unit: Unit): boolean {
  for (const t of unit.tactics) {
    if (!t.enabled || !unit.skills.includes(t.skill_id)) continue;
    const skill = state.pack.byId.skills.get(t.skill_id);
    if (!skill || skillSupport(skill, state.pack) !== null) continue;
    if (unit.pp.active.cur >= skill.pp_cost) return false;
  }
  return true;
}

const squadsOf = (s: BattleState) => s.units.filter((u) => u.kind === "squad");
const survivors = (s: BattleState) => ({ challenger: livingOf(s, "challenger").length, defender: livingOf(s, "defender").length });

/** Builds the state for `phase`: fresh PP and statuses, timeline 0; HP and deaths come from the previous phase's state. */
export function beginPhase(pack: Pack, battle: Battle, phase: number, prev: BattleState | null, log: EventSink): { state: BattleState; rng: Rng } {
  const state = createBattleState(pack, battle, phase);
  if (prev) {
    for (const u of state.units) {
      const p = prev.units.find((x) => x.id === u.id)!;
      u.hp = p.hp;
      u.alive = p.alive;
      for (const sd of u.soldiers) { // soldiers never respawn: HP and deaths persist
        const ps = p.soldiers[sd.index]!;
        sd.hp = ps.hp;
        sd.alive = ps.alive;
      }
      if (u.kind === "squad") syncSquad(u);
    }
  }
  const rng = phaseRng(battle, phase);
  const later: BattleEvent[] = []; // succession is logged right after the phase header
  if (prev) {
    applySuccession(state, prev, battle, { emit: (e) => void later.push(e) });
    for (const q of squadsOf(state)) if (!q.alive) endSquadSkills(state, q); // a removed or wiped squad never comes back, nor do its skills
  }
  runPreBattle(state, { emit: (e) => void later.push(e) }); // priority-ordered pre-battle steps (auras); SPD is final before the initial scheduling
  scheduleInitial(state);
  log.emit({
    type: "phase_start", ...at(state), seed: battle.seeds[phase - 1]!,
    units: state.units.filter((u) => u.kind === "hero").map((u) => ({ id: u.id, hp: u.hp, max_hp: u.maxHp, alive: u.alive, pp_active: u.pp.active.cur })),
    squads: squadsOf(state).map((u) => ({ id: u.id, alive: u.alive, soldiers: u.soldiers.map((sd) => (sd.alive ? sd.hp : 0)) })),
  });
  for (const e of later) log.emit(e);
  for (const n of state.buildNotes) log.emit({ type: "not_implemented", ...at(state), unit: n.unit, what: n.what });
  for (const e of [...state.timeline.pending.values()].sort((a, b) => a.due - b.due || (a.unitId < b.unitId ? -1 : 1))) {
    log.emit({ type: "schedule", ...at(state), unit: e.unitId, due: e.due, interval: e.interval, reason: "initial" });
  }
  state.bus.emit({ state, rng, log }, "phase_start", { phase });
  return { state, rng };
}

/** One unit's action: evaluate tactics, then execute the chosen skill or idle. Returns true when a skill was executed. */
export function performAction(x: ExecCtx, actor: Unit): boolean {
  const { state, rng, log } = x;
  const decision = decideTactic(state, actor, rng);
  log.emit({
    type: "tactic_evaluation", ...at(state), unit: actor.id, chosen: decision.skillId,
    evaluations: decision.evaluations.map((e) => ({ priority: e.priority, skill: e.skillId, outcome: e.outcome, reason: e.reason })),
  });
  if (!decision.tactic) {
    executeIdle(x, actor);
    return false;
  }
  const chosen = decision.evaluations.find((e) => e.outcome === "chosen");
  log.emit({ type: "target_selection", ...at(state), unit: actor.id, skill: decision.skillId!, targets: decision.targets.map((u) => u.id), reason: chosen?.reason ?? "" });
  executeSkill(x, actor, decision);
  return true;
}

export function runPhase(state: BattleState, rng: Rng, log: EventSink): PhaseResult {
  const cap = state.pack.rules.phase.max_actions_per_phase ?? DEFAULT_ACTION_CAP;
  const x: ExecCtx = { state, rng, log };
  const acted = new Set<string>(); // units that had an action since the last executed skill
  let actions = 0;
  let skills = 0;
  let squadActions = 0;
  let reason: PhaseEndReason;

  const check = (): PhaseEndReason | null => {
    const living = state.units.filter((u) => u.alive && u.kind === "hero");
    if (livingOf(state, "challenger").length === 0 || livingOf(state, "defender").length === 0) return "wipe";
    if (living.every((u) => isExhausted(state, u))) return "exhausted";
    if (living.every((u) => acted.has(u.id))) return "idle_cycle";
    if (actions >= cap || squadActions >= cap * SQUAD_BOUND_FACTOR) return "action_cap";
    return null;
  };

  for (;;) {
    const end = check();
    if (end) { reason = end; break; }
    const next = nextAction(state);
    if (!next) { reason = "no_actions"; break; }
    if (!next.unit.alive) continue;
    if (next.unit.kind === "squad") {
      squadActions++;
      state.actionCount++;
      executeSquadAction(x, next.unit);
      continue;
    }
    actions++;
    state.actionCount++;
    if (performAction(x, next.unit)) { skills++; acted.clear(); }
    else acted.add(next.unit.id);
  }
  const result: PhaseResult = { phase: state.phase, reason, actions, skills, squadActions, endCount: state.timeline.now, survivors: survivors(state) };
  log.emit({ type: "phase_end", ...at(state), reason, actions, skills, squad_actions: squadActions, survivors: result.survivors });
  return result;
}

export function setupEvent(pack: Pack, battle: Battle, state: BattleState): BattleEvent {
  const skillIds = [...new Set(state.units.flatMap((u) => u.skills))].sort();
  return {
    type: "battle_setup", battle_id: battle.battle_id, seeds: [...battle.seeds],
    units: state.units.filter((u) => u.kind === "hero").map((u) => {
      const bd = allBreakdowns(u, pack);
      return {
        id: u.id, name: u.name, side: u.side, class: u.class, row: u.row, column: u.column, leader: u.isLeader, hp: u.hp, max_hp: u.maxHp,
        pp_active: u.pp.active.max, pp_passive: u.pp.passive.max,
        stats: Object.fromEntries(STATS.map((s) => [s, { base: bd[s].base, flat: r4(bd[s].flat), multiplier: r4(bd[s].multiplier), result: r4(bd[s].result) }])) as any,
        breakdowns: Object.fromEntries(STATS.map((s) => [s, bd[s]])),
      };
    }),
    squads: state.units.filter((u) => u.kind === "squad").map((u) => {
      const bd = allBreakdowns(u, pack);
      return {
        id: u.id, name: u.name, side: u.side, leader: u.leaderId!, soldier_type: u.soldierTypeId!, class: u.class, row: `soldier_${u.row}`,
        soldiers: u.soldiers.length, soldier_hp: u.soldiers[0]?.maxHp ?? 0,
        stats: Object.fromEntries(STATS.map((s) => [s, { base: bd[s].base, flat: r4(bd[s].flat), multiplier: r4(bd[s].multiplier), result: r4(bd[s].result) }])) as any,
        breakdowns: Object.fromEntries(STATS.map((s) => [s, bd[s]])),
      };
    }),
    skills: skillIds.map((id) => ({ id, name: pack.byId.skills.get(id)?.name ?? id })),
    statuses: [...pack.byId.statuses.values()].map((s) => ({ id: s.id, name: s.name })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/** Runs up to 3 phases. Survivors on both sides after phase 3 means the defender wins (challenger loss). */
export function runBattle(pack: Pack, battle: Battle): BattleResult {
  const log = new EventLog();
  const phases: PhaseResult[] = [];
  let prev: BattleState | null = null;
  let winner: Side | null = null;
  let reason: BattleResult["reason"] = "phase3_timeout";
  for (let phase = 1; phase <= MAX_PHASES; phase++) {
    if (phase === 1) {
      const setup = createBattleState(pack, battle, 1);
      runPreBattle(setup, nullSink); // the setup stats include the leader auras
      log.emit(setupEvent(pack, battle, setup));
    }
    const { state, rng } = beginPhase(pack, battle, phase, prev, log);
    const res = runPhase(state, rng, log);
    phases.push(res);
    prev = state;
    if (res.reason === "wipe") {
      winner = livingOf(state, "challenger").length === 0 ? "defender" : "challenger";
      reason = "wipe";
      break;
    }
  }
  winner ??= "defender";
  log.emit({ type: "battle_end", winner, reason, phases: phases.length });
  return {
    winner, reason, phases, events: log.events,
    leaders: {
      challenger: { leader: prev!.leaders.challenger.leaderId, aura_active: prev!.leaders.challenger.auraActive },
      defender: { leader: prev!.leaders.defender.leaderId, aura_active: prev!.leaders.defender.auraActive },
    },
    units: prev!.units.filter((u) => u.kind === "hero").map((u) => ({ id: u.id, side: u.side, hp: u.hp, max_hp: u.maxHp, alive: u.alive })),
    squads: prev!.units.filter((u) => u.kind === "squad").map((u) => ({
      id: u.id, side: u.side, hp: u.hp, max_hp: u.maxHp, alive: u.alive, soldiers: u.soldiers.map((sd) => (sd.alive ? sd.hp : 0)),
    })),
  };
}
