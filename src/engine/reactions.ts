// Event subscribers that ship with the engine: the until_next_hit status expiry and event-triggered soldier skills (roadmap 2.3).
// Their effects run through the normal effect executor (`runEffect` in damage.ts).
//
// Soldier skill triggers [DEFAULT] (effects carry `trigger` but no event name, so only these two are expressible):
//   on_hit     fires on after_hit when the OWNER squad landed a hit: once per attacking action per defender hit; effect targets = that defender
//   on_attack  fires on after_action when the owner squad attacked: once per attack; effect targets = every unit it hit
// `heal` has no target field: in a reaction it heals the owner squad (e.g. "recover 20% HP after attacking"). Reaction statuses and
// stat changes use the soldier category. Anything else (on_event, pre_battle, a condition, targets other than self_squad) is not implemented.
import type { Effect, SoldierType } from "../schema";
import type { ExecCtx } from "./damage";
import { runEffect } from "./damage";
import { at } from "./log";
import type { BattleState, Unit } from "./state";

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

/** Engine handlers every battle has. */
export function registerSystemHandlers(state: BattleState): void {
  state.bus.subscribe({
    event: "after_hit", id: "until_next_hit", owner: null, order: SYSTEM_ORDER, effect: "until_next_hit expiry",
    match: (p) => p.defender.alive && untilNextHit(state, p.defender).length > 0,
    run: (p, x) => consumeHitStatuses(x, p.defender),
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
