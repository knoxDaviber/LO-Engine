// Pre-battle resolution (design Section 9 priority list, roadmap 2.5). Runs at the start of every phase, after leader succession and before the
// initial scheduling, as an ordered list of named steps:
//   1 equipment         (no-op until 3b)
//   2 buff_grants       ally / faction / field-ally leader auras (positive modifiers); pre-battle passives come in 3a
//   3 immunity          (no-op until 3a; it belongs after the grants and before the debuffs so Immunity can block enemy-debuff auras)
//   4 buff_removal      (no-op until 3a; may strip Immunity before step 5)
//   5 debuffs           enemy-debuff auras (and negative modifiers of any aura)
//   6 event_auras       subscribes event-triggered auras (Jasmine) on the bus; they do nothing until their event fires
//   7 spd_finalization  marker: the initial scheduling (`scheduleInitial`) reads the final SPD right after the steps
//
// Leader auras [DECIDED, Section 2]: only the side's current leader's aura counts, and only while `leaders[side].auraActive`. No PP, no "used" state.
// Always-on aura modifiers are put on units as status instances in the `passive` stacking category (`StatusInstance.inline`, statusId `aura:<leader>:<n>`),
// so the normal stacking rules and the squad's sharing of its leader's statuses apply. They are never ticked or cleared mid-phase except by the leader's
// death (`removeAuras`); the next phase builds fresh units and applies the aura again for the (possibly new) leader.
// [DEFAULT] An aura's `condition` is checked at phase start (always auras) or when its event fires (event auras). [DEFAULT] "Fielded" in
// party_has_hero means a living hero of the side at that moment.
// Not implemented (logged, never dropped): aura effects other than modify_stat on always auras, anything but heal on event auras, trigger events
// other than self_action_completed, a faction_buff without faction_id, effects carrying their own trigger/condition on always auras.
import type { Character, Effect } from "../schema";
import { evaluateCondition } from "./conditions";
import { runEffect } from "./damage";
import type { EventSink } from "./log";
import { at } from "./log";
import type { BattleState, Side, StatusInstance, Unit } from "./state";
import { otherSide, targetsOf } from "./state";

export const AURA_ORDER = 50; // bus order: after engine handlers (0), before soldier skills (100)
export const AURA_PREFIX = "aura:";

type Aura = Character["leader_aura"];
type LeaderAura = { side: Side; leader: Unit; aura: Aura };

export interface PreBattleCtx {
  state: BattleState;
  log: EventSink;
}
export interface PreBattleStep {
  name: string;
  run(c: PreBattleCtx): void;
}

/** Each side's leader whose aura is on: alive, current leader, `auraActive`. */
export function activeAuras(state: BattleState): LeaderAura[] {
  const out: LeaderAura[] = [];
  for (const side of ["challenger", "defender"] as const) {
    const lead = state.leaders[side];
    if (!lead.auraActive) continue;
    const leader = state.units.find((u) => u.id === lead.leaderId && u.kind === "hero");
    if (!leader || !leader.alive) continue;
    const ch = state.pack.byId.characters.get(leader.charId) as Character | undefined;
    if (ch) out.push({ side, leader, aura: ch.leader_aura });
  }
  return out;
}

const auraHolds = (state: BattleState, la: LeaderAura): boolean => evaluateCondition(la.aura.condition, { state, self: la.leader }).value;

/** Units an aura reaches: living heroes of the aura's side(s) passing the faction and filter checks, plus the living squad when include_soldiers. */
export function auraTargets(state: BattleState, la: LeaderAura): Unit[] {
  const { aura, leader } = la;
  const sides: Side[] = aura.target.side === "ally" ? [leader.side] : aura.target.side === "enemy" ? [otherSide(leader.side)] : [leader.side, otherSide(leader.side)];
  const out: Unit[] = [];
  for (const side of sides) {
    for (const u of targetsOf(state, side)) {
      if (u.kind === "squad" && !aura.target.include_soldiers) continue;
      if (aura.type === "faction_buff" && !(u.kind === "hero" && aura.faction_id !== null && u.factions.includes(aura.faction_id))) continue;
      if (!evaluateCondition(aura.target.filter, { state, self: leader, target: u }).value) continue;
      out.push(u);
    }
  }
  return out;
}

/** True when a modify_stat effect of the aura belongs to the debuff step. */
const isDebuff = (aura: Aura, e: Extract<Effect, { type: "modify_stat" }>): boolean => aura.type === "enemy_debuff" || e.value < 0;

const fmt = (e: Extract<Effect, { type: "modify_stat" }>): string => `${e.stat} ${e.value >= 0 ? "+" : ""}${e.value}${e.mode === "percent" ? "%" : ""}`;

function notImplemented(c: PreBattleCtx, leader: Unit, what: string): void {
  c.log.emit({ type: "not_implemented", ...at(c.state), unit: leader.id, what });
}

/** Puts the always-on modifiers of every active aura on its targets. `debuffs` picks the step. Unsupported effects are reported in the buff step only. */
function grantAlways(c: PreBattleCtx, debuffs: boolean): void {
  const { state, log } = c;
  for (const la of activeAuras(state)) {
    const { aura, leader } = la;
    if (aura.trigger !== "always" || !auraHolds(state, la)) continue;
    aura.effects.forEach((e, i) => {
      if (e.type !== "modify_stat" || e.trigger || e.condition) {
        if (!debuffs) notImplemented(c, leader, `not implemented: aura ${aura.name} effect ${e.type}${e.trigger || e.condition ? " with trigger/condition" : ""}`);
        return;
      }
      if (isDebuff(aura, e) !== debuffs) return;
      if (aura.type === "faction_buff" && aura.faction_id === null) {
        if (!debuffs) notImplemented(c, leader, `not implemented: aura ${aura.name} is a faction_buff without faction_id`);
        return;
      }
      for (const t of auraTargets(state, la)) {
        const inst: StatusInstance = {
          statusId: `${AURA_PREFIX}${leader.id}:${i}`, category: "passive", sourceUnitId: leader.id, remaining: null, skipNextTick: false, seq: state.statusSeq++,
          inline: { name: aura.name, modifiers: [{ stat: e.stat, mode: e.mode, value: e.value }] },
        };
        t.statuses.push(inst);
        log.emit({ type: "aura_applied", ...at(state), leader: leader.id, aura: aura.name, unit: t.id, status: inst.statusId, category: "passive", effect: fmt(e) });
      }
    });
  }
}

/** Event-triggered auras subscribe on the bus. Jasmine: self_action_completed (an idle action counts when trigger_includes_idle_action). */
function subscribeEventAuras(c: PreBattleCtx): void {
  const { state } = c;
  for (const la of activeAuras(state)) {
    const { aura, leader, side } = la;
    if (aura.trigger !== "on_event") continue;
    if (aura.trigger_event !== "self_action_completed") {
      notImplemented(c, leader, `not implemented: aura ${aura.name} trigger event ${aura.trigger_event}`);
      continue;
    }
    const skill = { id: `${AURA_PREFIX}${leader.id}`, name: aura.name, shape: "all", interactions: { guard: "standard" as const, soldiers: "standard" as const } };
    state.bus.subscribe({
      event: "after_action", id: `${AURA_PREFIX}${aura.name}`, owner: leader, order: AURA_ORDER, effect: aura.effects.map((e) => e.type).join("+"),
      match: (p) =>
        p.actor === leader && (aura.trigger_includes_idle_action === true || !p.idle) &&
        state.leaders[side].auraActive && state.leaders[side].leaderId === leader.id && auraHolds(state, la),
      run: (_p, x) => {
        const targets = auraTargets(state, la);
        for (const e of aura.effects) runEffect(x, leader, skill, e, targets, new Set([leader]), false);
      },
    });
  }
}

export const PREBATTLE_STEPS: PreBattleStep[] = [
  { name: "equipment", run: () => {} },
  { name: "buff_grants", run: (c) => grantAlways(c, false) },
  { name: "immunity", run: () => {} },
  { name: "buff_removal", run: () => {} },
  { name: "debuffs", run: (c) => grantAlways(c, true) },
  { name: "event_auras", run: subscribeEventAuras },
  { name: "spd_finalization", run: () => {} },
];

/** Runs the pre-battle steps in order for a freshly built phase state. */
export function runPreBattle(state: BattleState, log: EventSink): void {
  for (const step of PREBATTLE_STEPS) step.run({ state, log });
}

/** The leader is down: every aura status it put on any unit ends. */
export function removeAuras(state: BattleState, log: EventSink, leaderId: string): void {
  for (const u of state.units) {
    for (const inst of [...u.statuses]) {
      if (inst.sourceUnitId !== leaderId || !inst.statusId.startsWith(AURA_PREFIX)) continue;
      u.statuses = u.statuses.filter((s) => s !== inst);
      log.emit({ type: "aura_removed", ...at(state), leader: leaderId, aura: inst.inline?.name ?? inst.statusId, unit: u.id, status: inst.statusId, reason: "leader_down" });
    }
  }
}
