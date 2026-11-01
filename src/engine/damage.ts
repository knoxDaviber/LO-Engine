// Damage, heal and action execution (design Section 8).
//
// Pipeline for one hit (all constants from rules.yaml):
//   power   = sum(coef * effective stat of attacker) * skill multiplier * matchup
//   matchup = class factor (1 + advantage/disadvantage percent) * product of the skill's bonus_vs_class factors for the defender's class
//             * product of its bonus_on_terrain factors for the battle's battlefield. A class_advantage pair's own damage_percent, when set,
//             replaces advantage_damage_percent for that pair (the disadvantage side keeps the global percent).
//   base    = floor(max(min_damage, power - defense))       defense = DEF (physical), MDEF (magical), average of both (hybrid)
//   crit    = floor(base * crit_multiplier)                 applied after defense, to the already floored damage
//   guard   = floor(crit_result * factor)                   factor = max(1 - cap/100, product of (1 - reduction/100)); only guard in the slice
//   amount  = max(min_damage, guard_result)                 any landed hit deals at least min_damage
// Roll order (fixed, always from the phase rng): hit, then crit, then guard. A miss stops the sequence (no crit/guard draw).
// prevents_evasion makes the hit land without drawing. `ignores_guard` / interactions.guard "ignores" skips the guard draw;
// "guaranteed" guards without drawing. A roll succeeds when rng.next() * 100 < chance.
// Squads (design Section 2.1): a squad is ONE target but each soldier has its own HP. A single-target hit lands on the lowest-HP living
// soldier (ties lowest index, excess damage discarded); row/column/all hits (any shape but single) hit every living soldier separately, in
// index order, each with its own hit/crit/guard rolls. Heals on a squad are always split evenly over all soldiers, dead ones included.
// Not in the slice: flyer EVA bonus (rules constant is null), death interception (Fairy's Grace).
import type { Effect, Skill } from "../schema";
import type { Pack } from "../validate/pack";
import type { EventSink, SoldierRef } from "./log";
import { at, r4 } from "./log";
import type { Rng } from "./rng";
import { applyStatus, completeAction, effectiveStat } from "./stats";
import type { TacticDecision } from "./tactics";
import { rescheduleOnSpdChange, scheduleNext, unschedule } from "./timeline";
import type { BattleState, Soldier, Unit } from "./state";
import { alliesOf, squadOf, syncSquad } from "./state";
import { endSquadSkills, onLeaderDeath } from "./leader";

export type DamageEffect = Extract<Effect, { type: "damage" }>;
export type HealEffect = Extract<Effect, { type: "heal" }>;
export type GuardMode = "standard" | "ignores" | "guaranteed";

export interface HitOutcome {
  hit: boolean;
  crit: boolean;
  guard: boolean;
}

export interface DamageCtx {
  pack: Pick<Pack, "rules" | "byId">;
  guardMode?: GuardMode;
  battlefield?: string | null; // terrain id, for bonus_on_terrain
}

export interface DamageBreakdown {
  landed: boolean;
  scaled: number; // sum of coef * stat
  matchup: number; // class factor * bonus_vs_class factors * bonus_on_terrain factors
  power: number;
  defense: number;
  base: number; // after defense, floored, min damage
  crit: boolean;
  guard: boolean;
  guardFactor: number; // 1 when no guard
  amount: number; // final damage (0 on a miss)
}

/** Floor that ignores float noise like 125.99999999999999. */
const fl = (x: number): number => Math.floor(x + 1e-9);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** +1 attacker has the class advantage, -1 the defender has it (attacker at a disadvantage), 0 neutral. */
export function classMatchup(pack: Pick<Pack, "rules">, a: Unit, d: Unit): 1 | 0 | -1 {
  const table = pack.rules.class_advantage;
  if (table.some((p) => p.attacker === a.class && p.defender === d.class)) return 1;
  if (table.some((p) => p.attacker === d.class && p.defender === a.class)) return -1;
  return 0;
}

export function matchupFactor(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx): number {
  const { matchup } = ctx.pack.rules;
  const m = classMatchup(ctx.pack, attacker, defender);
  const pair = m === 1 ? ctx.pack.rules.class_advantage.find((p) => p.attacker === attacker.class && p.defender === defender.class) : undefined;
  let f = m === 1 ? 1 + (pair?.damage_percent ?? matchup.advantage_damage_percent) / 100 : m === -1 ? 1 + matchup.disadvantage_damage_percent / 100 : 1;
  for (const b of effect.bonus_vs_class) if (b.class === defender.class) f *= 1 + b.modifier_percent / 100;
  for (const b of effect.bonus_on_terrain ?? []) if (ctx.battlefield != null && b.terrain === ctx.battlefield) f *= 1 + b.modifier_percent / 100;
  return f;
}

export function hitChance(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx): number {
  const { rules } = ctx.pack;
  const bonus = effect.hit_bonus_percent + (classMatchup(ctx.pack, attacker, defender) === 1 ? rules.matchup.advantage_hit : 0);
  const eva = effectiveStat(defender, "EVA", ctx.pack); // flyer melee EVA bonus: not implemented (constant is null)
  const skl = (effectiveStat(attacker, "SKL", ctx.pack) - effectiveStat(defender, "SKL", ctx.pack)) / rules.rolls.skl_divisor;
  return clamp(effectiveStat(attacker, "HIT", ctx.pack) + bonus - eva + skl, rules.rolls.hit_min, rules.rolls.hit_max);
}

export function critChance(attacker: Unit, defender: Unit, ctx: DamageCtx): number {
  const { rules } = ctx.pack;
  const skl = (effectiveStat(attacker, "SKL", ctx.pack) - effectiveStat(defender, "SKL", ctx.pack)) / rules.rolls.skl_divisor;
  return clamp(effectiveStat(attacker, "CRIT", ctx.pack) - effectiveStat(defender, "GUARD", ctx.pack) + skl, rules.rolls.crit_min, rules.rolls.crit_max);
}

export function guardChance(defender: Unit, ctx: DamageCtx): number {
  const { rules } = ctx.pack;
  return clamp(effectiveStat(defender, "GUARD", ctx.pack) + effectiveStat(defender, "SKL", ctx.pack) / rules.rolls.skl_divisor, rules.rolls.guard_min, rules.rolls.guard_max);
}

/** True when the defender carries a status with prevents_evasion (the hit lands without a roll). */
export function cannotEvade(defender: Unit, pack: Pick<Pack, "byId">): boolean {
  return defender.statuses.some((s) => pack.byId.statuses.get(s.statusId)?.flags.prevents_evasion);
}

/** Defense value for a damage type. Hybrid = average of DEF and MDEF. */
export function defenseFor(defender: Unit, type: DamageEffect["damage_type"], pack: Pick<Pack, "byId">): number {
  const def = effectiveStat(defender, "DEF", pack);
  const mdef = effectiveStat(defender, "MDEF", pack);
  return type === "physical" ? def : type === "magical" ? mdef : (def + mdef) / 2;
}

/** Combined damage reduction factor from a list of reduction percents: multiplicative, total reduction capped. */
export function reductionFactor(percents: number[], capPercent: number): number {
  return Math.max(1 - capPercent / 100, percents.reduce((f, p) => f * (1 - p / 100), 1));
}

/** Deterministic: the same attacker, defender, effect and outcome always give the same damage. No variance. */
export function computeDamage(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx, outcome: HitOutcome): DamageBreakdown {
  const { rules } = ctx.pack;
  const scaled = effect.scaling.reduce((n, t) => n + t.coef * effectiveStat(attacker, t.stat, ctx.pack), 0);
  const matchup = matchupFactor(attacker, defender, effect, ctx);
  const power = scaled * effect.multiplier * matchup;
  const defense = defenseFor(defender, effect.damage_type, ctx.pack);
  const mode: GuardMode = effect.ignores_guard ? "ignores" : (ctx.guardMode ?? "standard");
  const guard = mode === "ignores" ? false : mode === "guaranteed" ? true : outcome.guard;
  const miss: DamageBreakdown = { landed: false, scaled, matchup, power, defense, base: 0, crit: false, guard: false, guardFactor: 1, amount: 0 };
  if (!outcome.hit) return miss;
  const min = rules.damage.min_damage;
  const base = fl(Math.max(min, power - defense));
  let amount = outcome.crit ? fl(base * rules.damage.crit_multiplier) : base;
  const guardFactor = guard ? reductionFactor([rules.guard.damage_reduction_percent], rules.guard.total_reduction_cap_percent) : 1;
  if (guard) amount = fl(amount * guardFactor);
  amount = Math.max(min, amount);
  return { landed: true, scaled, matchup, power, defense, base, crit: outcome.crit, guard, guardFactor, amount };
}

export function computeHeal(target: Unit, caster: Unit, effect: HealEffect, pack: Pick<Pack, "byId">): number {
  if (effect.percent_max_hp !== undefined) return fl((effect.percent_max_hp / 100) * target.maxHp);
  const scaled = (effect.scaling ?? []).reduce((n, t) => n + t.coef * effectiveStat(caster, t.stat, pack), 0);
  return fl(scaled * (effect.multiplier ?? 1));
}

// ------------------------------------------------------------------ state-changing parts

export interface ExecCtx {
  state: BattleState;
  rng: Rng;
  log: EventSink;
}

const roll100 = (rng: Rng): number => rng.next() * 100;

/** What the roll and damage code needs of a skill. Soldier basic attacks are not skills, so they pass a stand-in. */
export type SkillRef = Pick<Skill, "id" | "interactions">;

const refs = (who: SoldierRef): SoldierRef => ({ ...(who.soldier !== undefined ? { soldier: who.soldier } : {}), ...(who.by !== undefined ? { by: who.by } : {}) });

/** Rolls hit, crit, guard in that order and logs each. */
export function rollOutcome(x: ExecCtx, attacker: Unit, defender: Unit, skill: SkillRef, effect: DamageEffect, who: SoldierRef = {}): HitOutcome {
  const { state, rng, log } = x;
  const ctx: DamageCtx = { pack: state.pack, guardMode: skill.interactions.guard, battlefield: state.battlefield };
  state.bus.emit(x, "before_hit", { attacker, defender, skillId: skill.id, ...refs(who) });
  const base = { unit: attacker.id, target: defender.id, skill: skill.id };
  const emit = (kind: "hit" | "crit" | "guard", chance: number, roll: number | null, result: boolean, note?: string) =>
    log.emit({ type: "roll", ...at(state), ...base, kind, chance: r4(chance), roll: roll === null ? null : r4(roll), result, ...(note ? { note } : {}), ...refs(who) });

  let hit: boolean;
  if (cannotEvade(defender, state.pack)) {
    hit = true;
    emit("hit", 100, null, true, "target cannot evade");
  } else {
    const chance = hitChance(attacker, defender, effect, ctx);
    const r = roll100(rng);
    hit = r < chance;
    emit("hit", chance, r, hit);
  }
  if (!hit) return { hit: false, crit: false, guard: false };

  const cc = critChance(attacker, defender, ctx);
  const cr = roll100(rng);
  const crit = cr < cc;
  emit("crit", cc, cr, crit);

  let guard = false;
  if (effect.ignores_guard || ctx.guardMode === "ignores") {
    /* no guard draw */
  } else if (ctx.guardMode === "guaranteed") guard = true;
  else {
    const gc = guardChance(defender, ctx);
    const gr = roll100(rng);
    guard = gr < gc;
    emit("guard", gc, gr, guard);
  }
  return { hit, crit, guard };
}

/** Removes a dead unit's statuses (those flagged removed_on_death), takes it off the timeline and logs the death. */
export function killUnit(x: ExecCtx, unit: Unit, killer: Unit | null): void {
  const { state, log } = x;
  unit.hp = 0;
  unit.alive = false;
  unschedule(state, unit);
  log.emit({ type: "death", ...at(state), unit: unit.id, killer: killer?.id ?? null });
  onLeaderDeath(x, unit); // soft leader rule: the leader's squad and aura end, the battle goes on
  for (const inst of [...unit.statuses]) {
    if (state.pack.byId.statuses.get(inst.statusId)?.removal.removed_on_death) {
      unit.statuses = unit.statuses.filter((s) => s !== inst);
      log.emit({ type: "status_expired", ...at(state), unit: unit.id, status: inst.statusId, reason: "death" });
    }
  }
  state.bus.emit(x, "on_death", { unit, killer });
}

export function applyDamage(x: ExecCtx, attacker: Unit, defender: Unit, skill: Pick<Skill, "id">, d: DamageBreakdown, by?: number): void {
  const before = defender.hp;
  defender.hp = Math.max(0, defender.hp - d.amount);
  x.log.emit({
    type: "damage", ...at(x.state), unit: attacker.id, target: defender.id, skill: skill.id, power: r4(d.power), defense: r4(d.defense), base: d.base,
    crit: d.crit, guard: d.guard, amount: d.amount, hp_before: before, hp_after: defender.hp, ...refs({ by }),
  });
  if (defender.hp === 0) killUnit(x, defender, attacker);
  x.state.bus.emit(x, "after_hit", { attacker, defender, skillId: skill.id, amount: d.amount, killed: defender.hp === 0, ...refs({ by }) });
}

/** Lowest-HP living soldier; ties go to the lowest index. Null when the squad is wiped. */
export function lowestHpSoldier(squad: Unit): Soldier | null {
  let best: Soldier | null = null;
  for (const s of squad.soldiers) if (s.alive && (best === null || s.hp < best.hp)) best = s;
  return best;
}

/** Applies landed damage to one soldier. Damage beyond its HP is discarded (no spill). A squad with no living soldier is defeated and leaves the timeline. */
export function applySoldierDamage(x: ExecCtx, attacker: Unit, squad: Unit, soldier: Soldier, skill: Pick<Skill, "id">, d: DamageBreakdown, by?: number): void {
  const before = soldier.hp;
  soldier.hp = Math.max(0, soldier.hp - d.amount);
  x.log.emit({
    type: "damage", ...at(x.state), unit: attacker.id, target: squad.id, skill: skill.id, power: r4(d.power), defense: r4(d.defense), base: d.base,
    crit: d.crit, guard: d.guard, amount: d.amount, hp_before: before, hp_after: soldier.hp, ...refs({ soldier: soldier.index, by }),
  });
  if (soldier.hp > 0) syncSquad(squad);
  else {
    soldier.alive = false;
    syncSquad(squad);
    x.log.emit({ type: "death", ...at(x.state), unit: squad.id, killer: attacker.id, soldier: soldier.index });
    if (!squad.alive) {
      unschedule(x.state, squad);
      x.log.emit({ type: "death", ...at(x.state), unit: squad.id, killer: attacker.id });
      endSquadSkills(x.state, squad); // its leader/party soldier skills end with it
      x.state.bus.emit(x, "on_death", { unit: squad, killer: attacker });
    }
  }
  x.state.bus.emit(x, "after_hit", { attacker, defender: squad, skillId: skill.id, amount: d.amount, killed: !squad.alive, ...refs({ soldier: soldier.index, by }) });
}

/**
 * One damage effect against a squad. `area` (any shape but single): every living soldier is hit separately in index order, each with its own
 * rolls. Otherwise one hit on the lowest-HP living soldier. `by` is the attacking soldier's index when the attacker is a squad.
 */
export function hitSquad(x: ExecCtx, attacker: Unit, squad: Unit, skill: SkillRef, effect: DamageEffect, area: boolean, by?: number): void {
  const ctx: DamageCtx = { pack: x.state.pack, guardMode: skill.interactions.guard, battlefield: x.state.battlefield };
  const victims = area ? squad.soldiers.filter((s) => s.alive) : [lowestHpSoldier(squad)];
  for (const s of victims) {
    if (!s || !s.alive) continue;
    const outcome = rollOutcome(x, attacker, squad, skill, effect, { soldier: s.index, by });
    const d = computeDamage(attacker, squad, effect, ctx, outcome);
    if (d.landed) applySoldierDamage(x, attacker, squad, s, skill, d, by);
  }
}

/**
 * Heals up to max HP. Dead heroes are not healed. Returns the HP actually restored.
 * A squad heal is always AoE: `amount` is split evenly over ALL soldiers, dead ones included (floor, the remainder is lost), each share is
 * added to that soldier's own HP capped at its max, and a dead soldier revives at its share (a share of 0 revives nobody).
 * A wiped squad (no living soldier) is gone for good and takes no heal.
 */
export function applyHeal(x: ExecCtx, caster: Unit, target: Unit, skill: Pick<Skill, "id">, amount: number): number {
  if (!target.alive) return 0;
  const before = target.hp;
  if (target.kind === "squad") {
    const share = fl(amount / target.soldiers.length);
    let revived = 0;
    for (const s of target.soldiers) {
      if (share <= 0) break;
      if (!s.alive) { s.alive = true; revived++; }
      s.hp = Math.min(s.maxHp, s.hp + share);
    }
    syncSquad(target);
    x.log.emit({ type: "heal", ...at(x.state), unit: caster.id, target: target.id, skill: skill.id, amount, applied: target.hp - before, hp_before: before, hp_after: target.hp, share, revived });
    return target.hp - before;
  }
  target.hp = Math.min(target.maxHp, target.hp + amount);
  x.log.emit({ type: "heal", ...at(x.state), unit: caster.id, target: target.id, skill: skill.id, amount, applied: target.hp - before, hp_before: before, hp_after: target.hp });
  return target.hp - before;
}

export interface ActionResult {
  skillId: string;
}

/**
 * Executes the skill a tactic decision chose: spends PP, applies effects in order for each target, finishes the action
 * (status ticks), reschedules units whose SPD may have changed, and schedules the actor's next action.
 * `until_next_hit` statuses tick down on every landed hit against their holder (so Dark Dragon's Ire ends after the hit it guarantees).
 */
export function executeSkill(x: ExecCtx, actor: Unit, decision: TacticDecision): ActionResult {
  const { state, log } = x;
  const skill = state.pack.byId.skills.get(decision.skillId!) as Skill;
  const touched = new Set<Unit>([actor]);
  state.bus.beginAction();

  const before = actor.pp.active.cur;
  actor.pp.active.cur -= skill.pp_cost;
  log.emit({ type: "pp_spend", ...at(state), unit: actor.id, skill: skill.id, pool: "active", cost: skill.pp_cost, before, after: actor.pp.active.cur });

  const ctxSkill: EffectSkill = { id: skill.id, name: skill.name, shape: skill.targeting.shape ?? "single", interactions: skill.interactions };
  for (const effect of skill.effects) runEffect(x, actor, ctxSkill, effect, decision.targets, touched, false);

  for (const id of completeAction(state, actor, true)) {
    log.emit({ type: "status_expired", ...at(state), unit: actor.id, status: id, reason: "duration" });
  }
  state.bus.emit(x, "after_action", { actor, skillId: skill.id, idle: false, hit: [...state.bus.hitUnits] });
  finishAction(x, actor, touched);
  return { skillId: skill.id };
}

/** What the effect executor needs of the thing that runs effects: a skill, or a soldier skill acting as one. */
export interface EffectSkill {
  id: string;
  name: string;
  shape: string;
  interactions: Skill["interactions"];
}

/**
 * Runs one effect of a skill (or, with `reaction`, of an event-triggered soldier skill) for `actor` against `targets`.
 * In a reaction the effect's own trigger is what fired it, `heal` heals the actor, `hit_unit` means the given targets, and applied
 * statuses use the soldier category.
 */
export function runEffect(x: ExecCtx, actor: Unit, skill: EffectSkill, effect: Effect, targets: Unit[], touched: Set<Unit>, reaction: boolean): void {
  const { state, rng, log } = x;
  const ni = (what: string) => log.emit({ type: "not_implemented", ...at(state), unit: actor.id, what });
  if (!reaction && ((effect.trigger && effect.trigger !== "always") || effect.condition)) {
    return ni(`not implemented: effect ${effect.type} with trigger/condition in ${skill.name}`);
  }
  switch (effect.type) {
    case "damage":
      for (const t of targets) {
        if (!t.alive) continue;
        if (t.kind === "squad") { hitSquad(x, actor, t, skill, effect, skill.shape !== "single"); continue; }
        const outcome = rollOutcome(x, actor, t, skill, effect);
        const d = computeDamage(actor, t, effect, { pack: state.pack, guardMode: skill.interactions.guard, battlefield: state.battlefield }, outcome);
        if (!d.landed) continue;
        applyDamage(x, actor, t, skill, d);
      }
      break;
    case "heal":
      for (const t of reaction ? [actor] : targets) applyHeal(x, actor, t, skill, computeHeal(t, actor, effect, state.pack));
      break;
    case "apply_status": {
      // Area statuses (any shape but single, and caster_row) skip soldiers unless the effect sets include_soldiers.
      const area = skill.shape !== "single";
      const ownSquad = squadOf(state, actor.side);
      const recipients =
        effect.target === "self" ? [actor]
        : effect.target === "targets" || (reaction && effect.target === "hit_unit") ? targets.filter((u) => u.kind === "hero" || !area || effect.include_soldiers)
        : effect.target === "caster_row" ? [...alliesOf(state, actor).filter((u) => u.row === actor.row), ...(effect.include_soldiers && ownSquad ? [ownSquad] : [])]
        : null;
      if (!recipients) { ni(`not implemented: apply_status target ${effect.target}`); break; }
      const applier = reaction ? "soldier" : "active";
      for (const t of recipients) {
        if (!t.alive) continue;
        if (effect.chance_percent < 100) {
          const r = roll100(rng);
          const ok = r < effect.chance_percent;
          log.emit({ type: "roll", ...at(state), unit: actor.id, target: t.id, skill: skill.id, kind: "status", chance: effect.chance_percent, roll: r4(r), result: ok });
          if (!ok) continue;
        }
        const res = applyStatus(state, t, effect.status_id, applier, actor.id);
        if (!res.applied) { ni(res.notes.join("; ")); continue; }
        const stSrc = state.pack.byId.statuses.get(effect.status_id)!;
        const cat = stSrc.source_category === "inherit" ? applier : stSrc.source_category;
        const inst = t.statuses.find((s) => s.statusId === effect.status_id && s.category === cat)!;
        log.emit({ type: "status_applied", ...at(state), unit: t.id, status: effect.status_id, category: cat, source: actor.id, remaining: inst.remaining, notes: res.notes });
        touched.add(t);
      }
      break;
    }
    default:
      ni(`not implemented: effect ${effect.type} in ${skill.name}`);
  }
}

/** An idle action: no PP, no skill, statuses do not tick. */
export function executeIdle(x: ExecCtx, actor: Unit): void {
  x.state.bus.beginAction();
  x.log.emit({ type: "idle", ...at(x.state), unit: actor.id });
  completeAction(x.state, actor, false);
  x.state.bus.emit(x, "after_action", { actor, skillId: null, idle: true, hit: [] });
  finishAction(x, actor, new Set([actor]));
}

/**
 * Reschedules every living unit whose SPD changed (the actor, units it buffed or debuffed, and squads whose leader's statuses changed),
 * then schedules the actor's next action. `_touched` is kept for callers; all units are checked because a squad shares its leader's modifiers.
 */
export function finishAction(x: ExecCtx, actor: Unit, _touched?: Set<Unit>): void {
  const { state, log } = x;
  for (const u of state.units) {
    if (!u.alive) continue;
    if (rescheduleOnSpdChange(state, u)) {
      const e = state.timeline.pending.get(u.id)!;
      log.emit({ type: "schedule", ...at(state), unit: u.id, due: e.due, interval: e.interval, reason: "spd_change" });
    }
  }
  if (actor.alive) {
    const e = scheduleNext(state, actor);
    log.emit({ type: "schedule", ...at(state), unit: actor.id, due: e.due, interval: e.interval, reason: "next_action" });
  }
}
