// Event subscribers that ship with the engine: the until_next_hit status expiry, the on-hit status flags and event-triggered soldier skills
// (roadmap 2.3, 3a). Their effects run through the normal effect executor (`runEffect` in damage.ts).
// On-hit status flags (after_hit, so once per attacking action per defender by the bus, design Section 7):
//   heals_on_hit_percent_max_hp  Regen: the wearer heals that percent of its max HP. [DEFAULT] Several such statuses: the biggest percent heals, once.
//   removes_on_hit               the status ends (status_expired "hit"), after the heal.
// Like every reaction they do not fire on hits dealt by a reaction (a passive's or soldier skill's damage).
//
// Soldier skill triggers [DEFAULT] (effects carry `trigger` but no event name, so only these two are expressible):
//   on_hit     fires on after_hit when the OWNER squad landed a hit: once per attacking action per defender hit; effect targets = that defender
//   on_attack  fires on after_action when the owner squad attacked: once per attack; effect targets = every unit it hit
// `heal` has no target field: in a reaction it heals the owner squad (e.g. "recover 20% HP after attacking"). Reaction statuses and
// stat changes use the soldier category. Anything else (on_event, pre_battle, a condition, targets other than self_squad) is not implemented.
import type { Effect, SoldierType, Status } from "../schema";
import type { ExecCtx } from "./damage";
import { applyHeal, runEffect, useStatus } from "./damage";
import { at } from "./log";
import type { BattleState, StatusInstance, Unit } from "./state";

export const SOLDIER_SKILL_ORDER = 100;
export const SYSTEM_ORDER = 0;

const untilNextHit = (state: BattleState, u: Unit) =>
  u.statuses.filter((s) => state.pack.byId.statuses.get(s.statusId)?.duration.unit === "until_next_hit" && s.remaining !== null);

/** Ticks down the defender's until_next_hit statuses (once per attacking action, by the bus); the expired ones are removed and logged. */
export function consumeHitStatuses(x: ExecCtx, defender: Unit): void {
  for (const inst of untilNextHit(x.state, defender)) {
    inst.remaining! -= 1;
    if (inst.remaining! <= 0) {
      defender.statuses = defender.statuses.filter((s) => s !== inst);
      x.log.emit({ type: "status_expired", ...at(x.state), unit: defender.id, status: inst.statusId, reason: "hit" });
    }
  }
}

const flagged = (state: BattleState, u: Unit, f: (st: Status) => boolean): StatusInstance[] =>
  u.statuses.filter((s) => { const st = state.pack.byId.statuses.get(s.statusId); return st !== undefined && f(st); });

/** Regen: the wearer's biggest heals_on_hit status heals it once. */
function healOnHit(x: ExecCtx, u: Unit): void {
  const insts = flagged(x.state, u, (st) => st.flags.heals_on_hit_percent_max_hp > 0);
  const pct = (i: StatusInstance) => x.state.pack.byId.statuses.get(i.statusId)!.flags.heals_on_hit_percent_max_hp;
  const best = insts.reduce((a, b) => (pct(b) > pct(a) ? b : a));
  applyHeal(x, u, u, { id: best.statusId }, Math.floor((pct(best) / 100) * u.maxHp + 1e-9));
  useStatus(x, u, best);
}

/** Engine handlers every battle has. */
export function registerSystemHandlers(state: BattleState): void {
  state.bus.subscribe({
    event: "after_hit", id: "until_next_hit", owner: null, order: SYSTEM_ORDER, effect: "until_next_hit expiry",
    match: (p) => p.defender.alive && untilNextHit(state, p.defender).length > 0,
    run: (p, x) => consumeHitStatuses(x, p.defender),
  });
  state.bus.subscribe({
    event: "after_hit", id: "heals_on_hit", owner: null, order: SYSTEM_ORDER, effect: "heal",
    match: (p) => p.defender.alive && flagged(state, p.defender, (st) => st.flags.heals_on_hit_percent_max_hp > 0).length > 0,
    run: (p, x) => healOnHit(x, p.defender),
  });
  state.bus.subscribe({
    event: "after_hit", id: "removes_on_hit", owner: null, order: SYSTEM_ORDER, effect: "status removal",
    match: (p) => p.defender.alive && flagged(state, p.defender, (st) => st.flags.removes_on_hit).length > 0,
    run: (p, x) => {
      for (const inst of flagged(x.state, p.defender, (st) => st.flags.removes_on_hit)) {
        p.defender.statuses = p.defender.statuses.filter((s) => s !== inst);
        x.log.emit({ type: "status_expired", ...at(x.state), unit: p.defender.id, status: inst.statusId, reason: "hit" });
      }
    },
  });
}

/** True when the effect is an event-triggered soldier skill effect the bus can run. */
export const isReactiveTrigger = (e: Effect): boolean => !e.condition && (e.trigger === "on_hit" || e.trigger === "on_attack");

/** Subscribes one event-triggered soldier skill effect of `squad`'s soldier type. */
export function registerSoldierSkill(state: BattleState, squad: Unit, st: SoldierType, label: string, effect: Effect): void {
  const skill = { id: label, name: `${st.name} skill`, shape: "single", interactions: { guard: "standard" as const, soldiers: "standard" as const } };
  const base = { id: label, owner: squad, order: SOLDIER_SKILL_ORDER, effect: effect.type };
  if (effect.trigger === "on_hit") {
    state.bus.subscribe({
      ...base, event: "after_hit",
      match: (p) => p.attacker === squad,
      run: (p, x) => runEffect(x, squad, skill, effect, [p.defender], new Set([squad]), true),
    });
  } else {
    state.bus.subscribe({
      ...base, event: "after_action",
      match: (p) => p.actor === squad && !p.idle,
      run: (p, x) => runEffect(x, squad, skill, effect, p.hit.filter((u) => u.alive), new Set([squad]), true),
    });
  }
}
