// Squad actions (design Section 2.1, Decision 130: "soldiers attack as one and defend as one"). A squad has no tactic sheet and no PP: on every
// scheduled count of its own SPD it makes ONE basic attack whose power is the sum of its living soldiers' effective scaling stat (damage.ts
// computeDamage, stats.ts summedStat) x the basic attack multiplier (1: soldier basic attacks have no multiplier field) x matchup. One hit roll, one crit
// roll, one guard roll, with the soldier type's rate stats (never summed).
//
// Decisions:
//  - The target is the nearest living enemy, front board row first (the enemy's soldier row counts as a row), ties by column then unit id.
//  - A hit on an enemy squad is resolved once against its summed defense, applied from its lowest-HP living soldier with overflow; a hit on a
//    hero is an ordinary hit.
//  - No attack when the enemy has no living hero: the battle is over at that point (soldiers are never a victory condition).
//  - Squad attacks never keep a phase alive; the phase controller ignores squads in its exhaustion and idle checks.
//  - [DEFAULT] A confused squad (ignores_tactics status of its own) attacks a random living unit drawn from the rng (any side but the squad
//    itself with random_any, else an enemy). Its attack counts as its first active attack, so the confusion ends after it.
import type { DamageEffect, ExecCtx, SkillRef } from "./damage";
import { actionBlocker, executePrevented, finishAction, hitHero, hitSquad } from "./damage";
import { at } from "./log";
import type { Unit } from "./state";
import { boardRank, livingOf, otherSide, targetsOf } from "./state";

/** Stand-in skill for soldier basic attacks (they are not content skills): standard guard handling. */
export const SOLDIER_ATTACK: SkillRef = { id: "soldier_basic_attack", interactions: { guard: "standard", soldiers: "standard" }, shape: "single" };

/** The squad's basic attack as a damage effect: no multiplier (1), no bonuses, no guard bypass. The soldier sum is applied by computeDamage. */
export function soldierEffect(x: ExecCtx, squad: Unit): DamageEffect {
  const st = x.state.pack.byId.soldiers.get(squad.soldierTypeId!)!;
  const b = st.basic_attack;
  return { type: "damage", damage_type: b.damage_type, range: b.range, scaling: b.scaling, multiplier: 1, ignores_guard: false, bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0 };
}

/** Nearest living enemy, front board row first, then column, then id. */
export function pickSquadTarget(x: ExecCtx, squad: Unit): Unit | null {
  const pool = targetsOf(x.state, otherSide(squad.side));
  pool.sort((a, b) => boardRank(a) - boardRank(b) || a.column - b.column || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0] ?? null;
}

export function executeSquadAction(x: ExecCtx, squad: Unit): void {
  const { state, log } = x;
  const blocked = actionBlocker(state, squad);
  if (blocked) return executePrevented(x, squad, blocked); // a prevents_action status of its own (design 9)
  state.bus.beginAction(squad);
  const attackers = squad.soldiers.filter((s) => s.alive);
  log.emit({ type: "squad_attack", ...at(state), unit: squad.id, attackers: attackers.length });
  const effect = soldierEffect(x, squad);
  const touched = new Set<Unit>([squad]);
  const confused = squad.statuses.filter((i) => state.pack.byId.statuses.get(i.statusId)?.flags.ignores_tactics);
  const anySide = confused.some((i) => state.pack.byId.statuses.get(i.statusId)!.flags.overrides_targeting === "random_any");
  const randomTarget = (): Unit | null => {
    const pool = state.units.filter((u) => u.alive && u !== squad && (anySide || u.side !== squad.side));
    return pool.length ? pool[x.rng.int(pool.length)]! : null;
  };
  const target = livingOf(state, otherSide(squad.side)).length === 0 ? null : confused.length ? randomTarget() : pickSquadTarget(x, squad);
  if (target) {
    touched.add(target);
    if (target.kind === "squad") hitSquad(x, squad, target, SOLDIER_ATTACK, effect, false);
    else hitHero(x, squad, target, SOLDIER_ATTACK, effect);
  }
  for (const inst of confused) {
    if (!squad.statuses.includes(inst)) continue;
    squad.statuses = squad.statuses.filter((i) => i !== inst);
    log.emit({ type: "status_expired", ...at(state), unit: squad.id, status: inst.statusId, reason: "duration" });
  }
  state.bus.emit(x, "after_action", { actor: squad, skillId: null, idle: false, hit: [...state.bus.hitUnits] });
  finishAction(x, squad, touched);
}

