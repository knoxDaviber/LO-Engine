// Hero passives (design Sections 4.4 and 7, roadmap 3a).
//
// Which passives run: a passive skill of the hero that sits enabled on its tactic sheet [DECIDED, Section 4: a skill not on the sheet and
// enabled never executes]. Its condition is the skill's `default_activation` ANDed with the tactic's main / sub leaves (tactics.ts tacticCondition; selectors
// do not apply to passives); it is checked when the
// trigger fires, with the event in context (event leaves) and the event's unit as `target`.
// Triggers:
//   on_event         subscribes on the bus (order PASSIVE_ORDER) for the bus event of its trigger_event (events.ts EVENT_SPECS; hit events use
//                    trigger_timing before_hit / after_hit). Per-hit-once and "reactions never trigger reactions" are the bus's rules.
//   while_condition  a state passive: `checkStatePassives` re-checks it after every damage, heal and action and in the pre-battle step. It spends
//                    on activation and stays on while the condition holds; when the condition ends, the statuses it applied are removed
//                    (`passive_ended`, status_expired "condition"); if the condition returns, it spends again. Conditional equipment
//                    modifiers (equipment.ts checkEquipment) are re-checked at the same moments.
//   pre_battle       runs once per phase in a pre-battle step (prebattle.ts), spending PP. The step follows design 9's order, by what the passive
//                    does (`preBattleStepOf`): remove_buffs -> buff_removal; a debuff status (stats.ts DEBUFF_CATEGORIES) or an enemy-side
//                    target -> debuffs; a blocks_debuffs status (Immunity) -> immunity; anything else -> buff_grants.
// PP and "used" (design 7): each trigger spends pp_cost once from the skill's pool; not enough PP -> it does not fire (`passive_blocked`). A state
// passive that is blocked logs once and waits until its condition ends. [DEFAULT] Several passives on one event resolve in the hero's skill order
// (registration order; across heroes, unit order).
// Targets by targeting.shape: self -> the owner; event_unit -> the event's unit (hit defender, healed unit, actor); attacker -> the attacker (or
// caster); any other shape -> the normal target resolution of the tactic (tactics.ts resolveTargets). An on_event passive aimed at event_unit /
// attacker only fires when that unit is alive and on its targeting side. Statuses it applies use the `passive` stacking category.
// use_limit / cooldown (tactics.ts skillReady): checked when the trigger fires, before PP; a passive that is not ready does not fire
// (`passive_blocked`). Each fire is one use.
// Not implemented (logged): own_turn passives, conditions with leaves outside the registry.
import type { Skill, Tactic } from "../schema";
import type { CondResult } from "./conditions";
import { evaluateCondition } from "./conditions";
import type { EffectSkill, ExecCtx } from "./damage";
import { canCover, runEffect } from "./damage";
import type { BusPayloads, EventCtx } from "./events";
import { EVENT_SPECS, busEventFor, eventAttacker, eventUnit } from "./events";
import { at } from "./log";
import type { BattleState, Unit } from "./state";
import { isDebuffStatus } from "./stats";
import { checkEquipment } from "./equipment";
import { recordSkillUse, resolveTargets, skillReady, tacticCondition } from "./tactics";

export const PASSIVE_ORDER = 30; // bus order: after engine handlers (0), before auras (50) and soldier skills (100)

/** A while_condition passive of one hero, for this phase. */
export interface StatePassive {
  owner: Unit;
  skill: Skill;
  tactic: Tactic;
  on: boolean;
  /** Condition holds but the passive could not fire (PP, no target, unknown leaf): already logged, wait until the condition ends. */
  blocked: boolean;
}

/** The passives a hero runs: enabled on its sheet, in the hero's skill order. */
export function sheetPassives(state: BattleState, u: Unit): { skill: Skill; tactic: Tactic }[] {
  const out: { skill: Skill; tactic: Tactic }[] = [];
  for (const id of u.skills) {
    const skill = state.pack.byId.skills.get(id);
    if (!skill || skill.category !== "passive") continue;
    const tactic = u.tactics.find((t) => t.skill_id === id && t.enabled); // tactics are sorted by priority
    if (tactic) out.push({ skill, tactic });
  }
  return out;
}

const effectsLabel = (skill: Skill): string => skill.effects.map((e) => e.type).join("+");

function activation(state: BattleState, owner: Unit, skill: Skill, tactic: Tactic, ev?: EventCtx, target?: Unit | null): CondResult {
  return evaluateCondition(tacticCondition(tactic, skill), { state, self: owner, target: target ?? (ev ? eventUnit(ev) : null), ...(ev ? { event: ev } : {}) });
}
const unimplemented = (r: CondResult): string[] => r.reasons.filter((m) => m.startsWith("not implemented"));

/** The event unit an event_unit / attacker passive aims at (null for other shapes). */
function focusOf(skill: Skill, ev: EventCtx): Unit | null | undefined {
  const shape = skill.targeting.shape;
  return shape === "event_unit" ? eventUnit(ev) : shape === "attacker" ? eventAttacker(ev) : undefined;
}

/** The unit is on the skill's targeting side (seen from the owner) and passes its soldier mode. */
function onSide(skill: Skill, owner: Unit, u: Unit): boolean {
  const side = skill.targeting.side;
  if (side === "self" && u !== owner) return false;
  if (side === "ally" && u.side !== owner.side) return false;
  if (side === "enemy" && u.side === owner.side) return false;
  if (skill.interactions.soldiers === "skip_soldiers" && u.kind !== "hero") return false;
  if (skill.interactions.soldiers === "soldiers_only" && u.kind !== "squad") return false;
  return true;
}

function targetsOfPassive(x: ExecCtx, owner: Unit, skill: Skill, tactic: Tactic, ev?: EventCtx): Unit[] {
  const shape = skill.targeting.shape ?? "single";
  if (shape === "self" || skill.targeting.side === "self") return [owner];
  if (shape === "event_unit" || shape === "attacker") {
    const u = ev ? focusOf(skill, ev) : null;
    return u && u.alive ? [u] : [];
  }
  return resolveTargets(skill, tactic, owner, x.state, x.rng).targets;
}

/** Spends PP and runs the passive's effects. Returns false (logged) when PP is short or there is no target. Activation is the caller's. */
function fire(x: ExecCtx, owner: Unit, skill: Skill, tactic: Tactic, ev: EventCtx | undefined, inAction: boolean): boolean {
  const { state, log } = x;
  const pool = owner.pp[skill.pp_pool];
  const poolName = skill.pp_pool === "passive" ? "Passive" : "Active";
  const notReady = skillReady(owner, skill);
  if (notReady) {
    log.emit({ type: "passive_blocked", ...at(state), unit: owner.id, skill: skill.id, reason: notReady });
    return false;
  }
  if (pool.cur < skill.pp_cost) {
    log.emit({ type: "passive_blocked", ...at(state), unit: owner.id, skill: skill.id, reason: `not enough ${poolName} PP (${pool.cur} < ${skill.pp_cost})` });
    return false;
  }
  const targets = targetsOfPassive(x, owner, skill, tactic, ev);
  if (targets.length === 0) {
    log.emit({ type: "passive_blocked", ...at(state), unit: owner.id, skill: skill.id, reason: "no valid target" });
    return false;
  }
  const before = pool.cur;
  pool.cur -= skill.pp_cost;
  log.emit({ type: "pp_spend", ...at(state), unit: owner.id, skill: skill.id, pool: skill.pp_pool, cost: skill.pp_cost, before, after: pool.cur });
  recordSkillUse(owner, skill, state.bus.actor === owner);
  const shape = skill.targeting.shape ?? "single";
  const effSkill: EffectSkill = { id: skill.id, name: skill.name, shape, interactions: skill.interactions, activation: tacticCondition(tactic, skill), trigger: skill.trigger };
  const touched = new Set<Unit>([owner]);
  for (const e of skill.effects) runEffect(x, owner, effSkill, e, targets, touched, false, { applier: "passive", inAction, ...(ev ? { event: ev } : {}) });
  return true;
}

function note(x: ExecCtx, owner: Unit, skill: Skill, reasons: string[]): void {
  x.log.emit({ type: "not_implemented", ...at(x.state), unit: owner.id, what: `not implemented: ${skill.name} activation (${[...new Set(reasons)].join("; ")})` });
}

function subscribeEventPassive(state: BattleState, owner: Unit, skill: Skill, tactic: Tactic): void {
  const busEvent = skill.trigger_event ? busEventFor(skill.trigger_event, skill.trigger_timing) : null;
  if (!busEvent) {
    state.buildNotes.push({ unit: owner.id, what: `not implemented: passive ${skill.name} trigger event ${skill.trigger_event}` });
    return;
  }
  const spec = EVENT_SPECS[skill.trigger_event!]!;
  const cover = skill.effects.find((e) => e.type === "cover");
  state.bus.subscribe({
    event: busEvent, id: skill.name, owner, order: PASSIVE_ORDER, effect: effectsLabel(skill),
    match: (payload) => {
      const ev: EventCtx = { bus: busEvent, payload };
      if (!spec.match(owner, ev)) return false;
      if (cover?.type === "cover" && (busEvent !== "before_hit" || !canCover(owner, payload as BusPayloads["before_hit"], cover))) return false; // cover only takes a hit it may
      const focus = focusOf(skill, ev);
      if (focus !== undefined && (!focus || !focus.alive || !onSide(skill, owner, focus))) return false;
      const act = activation(state, owner, skill, tactic, ev, focus);
      return act.value || unimplemented(act).length > 0; // an unknown leaf is reported by run, never dropped
    },
    run: (payload, x) => {
      const ev: EventCtx = { bus: busEvent, payload };
      const act = activation(state, owner, skill, tactic, ev, focusOf(skill, ev));
      if (!act.value) return note(x, owner, skill, unimplemented(act));
      fire(x, owner, skill, tactic, ev, true);
    },
  });
}

/** Wires up the sheet passives of every hero for a fresh phase state: event passives on the bus, state passives in `state.statePassives`. */
export function registerPassives(state: BattleState): void {
  for (const u of state.units) {
    if (u.kind !== "hero") continue;
    for (const { skill, tactic } of sheetPassives(state, u)) {
      if (skill.trigger === "on_event") subscribeEventPassive(state, u, skill, tactic);
      else if (skill.trigger === "while_condition") state.statePassives.push({ owner: u, skill, tactic, on: false, blocked: false });
      else if (skill.trigger !== "pre_battle") state.buildNotes.push({ unit: u.id, what: `not implemented: passive ${skill.name} with trigger ${skill.trigger}` });
    }
  }
}

export type PreBattlePassiveStep = "buff_grants" | "immunity" | "buff_removal" | "debuffs";

/** The pre-battle step a pre_battle passive runs in (design 9 order; see the header). */
export function preBattleStepOf(state: BattleState, skill: Skill): PreBattlePassiveStep {
  const statuses = skill.effects.flatMap((e) => (e.type === "apply_status" ? [state.pack.byId.statuses.get(e.status_id)] : [])).filter((st) => st !== undefined);
  if (skill.effects.some((e) => e.type === "remove_buffs")) return "buff_removal";
  if (skill.targeting.side === "enemy" || statuses.some(isDebuffStatus)) return "debuffs";
  if (statuses.some((st) => st.flags.blocks_debuffs)) return "immunity";
  return "buff_grants";
}

/** Pre-battle `step`: every living hero's pre_battle passives that belong to it fire once, spending PP. */
export function runPreBattlePassives(x: ExecCtx, step: PreBattlePassiveStep): void {
  const { state, log } = x;
  for (const u of state.units) {
    if (u.kind !== "hero" || !u.alive) continue;
    for (const { skill, tactic } of sheetPassives(state, u)) {
      if (skill.trigger !== "pre_battle" || preBattleStepOf(state, skill) !== step) continue;
      const act = activation(state, u, skill, tactic);
      if (!act.value) {
        if (unimplemented(act).length) note(x, u, skill, unimplemented(act));
        continue;
      }
      log.emit({ type: "trigger", ...at(state), source: u.id, handler: skill.name, event: "pre_battle", subject: u.id, effect: effectsLabel(skill) });
      fire(x, u, skill, tactic, undefined, false);
    }
  }
}

/** The statuses a state passive put on units end with it. */
function endStatePassive(x: ExecCtx, sp: StatePassive): void {
  const { state, log } = x;
  sp.on = false;
  log.emit({ type: "passive_ended", ...at(state), unit: sp.owner.id, skill: sp.skill.id });
  const ids = new Set(sp.skill.effects.flatMap((e) => (e.type === "apply_status" ? [e.status_id] : [])));
  for (const u of state.units) {
    for (const inst of [...u.statuses]) {
      if (!ids.has(inst.statusId) || inst.sourceUnitId !== sp.owner.id) continue;
      const st = state.pack.byId.statuses.get(inst.statusId);
      if ((st?.source_category === "inherit" ? "passive" : st?.source_category) !== inst.category) continue;
      u.statuses = u.statuses.filter((s) => s !== inst);
      log.emit({ type: "status_expired", ...at(state), unit: u.id, status: inst.statusId, reason: "condition" });
    }
  }
}

/** while_condition statuses whose applying skill's activation (`whileCond`) no longer holds end (status_expired "condition"). An unknown leaf keeps them. */
function checkWhileStatuses(x: ExecCtx): void {
  const { state, log } = x;
  for (const u of state.units) {
    for (const inst of [...u.statuses]) {
      if (!inst.whileCond) continue;
      const owner = state.units.find((v) => v.id === inst.whileCond!.owner) ?? u;
      if (!owner.alive) continue; // nobody left to judge the condition from: the status stays (a state passive's end with its owner)
      const r = evaluateCondition(inst.whileCond.cond, { state, self: owner, target: u });
      if (r.value || unimplemented(r).length) continue;
      u.statuses = u.statuses.filter((s) => s !== inst);
      log.emit({ type: "status_expired", ...at(state), unit: u.id, status: inst.statusId, reason: "condition" });
    }
  }
}

/**
 * Re-checks every while_condition passive: activates (spending PP) the ones whose condition now holds, ends the ones whose condition ended.
 * Then ends while_condition statuses whose own condition ended (statuses applied outside a state passive).
 */
export function checkStatePassives(x: ExecCtx): void {
  const { state, log } = x;
  if (state.checkingPassives) return;
  state.checkingPassives = true; // a passive's own effects (a heal) must not re-enter
  try {
    for (const sp of state.statePassives) {
      if (!sp.owner.alive) { // the passive ends with its owner, and so do the statuses it applied
        if (sp.on) endStatePassive(x, sp);
        continue;
      }
      const act = activation(state, sp.owner, sp.skill, sp.tactic);
      if (!act.value) {
        if (unimplemented(act).length && !sp.blocked) { note(x, sp.owner, sp.skill, unimplemented(act)); sp.blocked = true; }
        else if (!unimplemented(act).length) sp.blocked = false;
        if (sp.on) endStatePassive(x, sp);
        continue;
      }
      if (sp.on || sp.blocked) continue;
      log.emit({ type: "trigger", ...at(state), source: sp.owner.id, handler: sp.skill.name, event: "while_condition", subject: sp.owner.id, effect: effectsLabel(sp.skill) });
      // A state passive is a reaction to the state change: its events are not dispatched.
      if (state.bus.reacting(() => fire(x, sp.owner, sp.skill, sp.tactic, undefined, false))) sp.on = true;
      else sp.blocked = true;
    }
    checkWhileStatuses(x);
    checkEquipment(x); // conditional item modifiers (3b)
  } finally {
    state.checkingPassives = false;
  }
}
