// Damage, heal and action execution (design Section 8).
//
// Pipeline for one hit (all constants from rules.yaml), formula = rules.damage.formula (a BattleOptions.formula override replaces it, state.ts):
// pool [DEFAULT] (designer: "ATK (all sources) - DEF (all sources) x (DMG bonus - DMG reduction)"):
//   power   = ATK_total = sum(coef * effective stat of attacker) * skill multiplier (every stat modifier is in the effective stat; a squad sums its soldiers)
//   defense = DEF_total = DEF (physical), MDEF (magical), average of both (hybrid); a squad sums its living soldiers
//   core    = max(min_damage, power - defense)
//   bonus % (added up) = class advantage percent (rules.matchup.advantage_damage_percent, or the class_advantage pair's own damage_percent)
//                        or the disadvantage percent (negative), + every bonus_vs_class modifier_percent for the defender's class,
//                        + every bonus_on_terrain modifier_percent for the battle's battlefield. (No effect type grants a damage bonus yet.)
//   reduction % (added up) = rules.guard.damage_reduction_percent when the guard activates, + every reduce_damage percent of the defender in
//                        force for this hit (Plate, Quick Guard, any duration; reductionsOn)
//   pool    = max(1 - total_reduction_cap_percent/100, 1 + bonus/100 - reduction/100)
//   amount  = max(min_damage, floor(core * pool * crit))    crit = rules.damage.crit_multiplier on a crit, else 1 (a separate multiplier)
//   The class advantage HIT bonus is unchanged (hitChance).
// subtract / ratio / scaled_subtract (older, selectable):
//   power   = sum(coef * effective stat) * skill multiplier * matchup
//   matchup = class factor (1 + advantage/disadvantage percent) * product of the skill's bonus_vs_class factors for the defender's class
//             * product of its bonus_on_terrain factors for the battle's battlefield. A class_advantage pair's own damage_percent, when set,
//             replaces advantage_damage_percent for that pair (the disadvantage side keeps the global percent).
//   base    = floor(max(min_damage, formula(power, defense)))  (baseDamage): subtract power - defense; ratio power * K / (K + defense);
//             scaled_subtract max(power * floor_pct/100, power - defense * def_weight)
//   crit    = floor(base * crit_multiplier)                 applied after defense, to the already floored damage
//   guard   = floor(crit_result * factor)                   factor = max(1 - cap/100, product of (1 - reduction/100)) over the guard (when it
//                                                           activates) and the defender's reduce_damage effects for this attack (Quick Guard)
//   amount  = max(min_damage, guard_result)                 any landed hit deals at least min_damage
// Hero hits (every formula) [DEFAULT]: when the attacker is a hero (actives, passives, reactions, item effects), amount = max(min_damage,
//   floor(amount * rules.damage.hero_hits)) as the very last step. Squads are unaffected (their power already sums the soldiers); heals are
//   unaffected; Mirror's reflect uses the HP lost, so it follows. A BattleOptions.heroHits override replaces it.
// Roll order (fixed, always from the phase rng): hit, then crit, then guard. A miss stops the sequence (no crit/guard draw).
// prevents_evasion makes the hit land without drawing. `ignores_guard` / interactions.guard "ignores" skips the guard draw;
// "guaranteed" guards without drawing. A roll succeeds when rng.next() * 100 < chance.
// Squads (design Sections 2.1 and 8, Decision 130: "soldiers attack as one and defend as one"): a squad is ONE target but each soldier has its
// own HP. Attacking, its power scales with the SUM of its living soldiers' effective stat (stats.ts summedStat; flat lines shared from the leader count once);
// defending, its defense is the sum of its living soldiers' DEF / MDEF (hybrid: the average of the two sums). Rate stats (HIT, SKL, CRIT, EVA,
// GUARD) are the soldier type's per-soldier values, never summed. Any hit on a squad (single or area) is rolled and computed ONCE; the damage
// lands on the lowest-HP living soldier (ties lowest index) and the raw leftover overflows to the next lowest-HP soldier, and so on until used
// up or the squad is wiped, never onto the hero (Decision 128). Heals on a squad are always split evenly over all soldiers, dead ones included.
// Cover (Decision 116): a before_hit handler may set `redirect` on a single-target hit aimed at a hero; rollOutcome then logs `cover` and
// resolves the hit against the covering unit (one more before_hit is emitted for it, which cannot redirect again).
// Status flags run here (roadmap 3a; design Section 9):
//   intercepts_death     a lethal hit leaves the unit at revive_hp_percent of max HP instead (min 1); it stays alive and keeps its pending
//                        action. A squad's own status saves the last soldier (at that percent of its max HP). Logged `death_intercepted`.
//   delays_pending_action  Stun: the target's pending action moves back rules.stun_pushback_counts counts (timeline.ts delayPending).
//   prevents_evasion     the hit lands without a hit roll (rollOutcome).
//   blocks_debuffs       Immunity: stats.ts applyStatus refuses debuffs; logged `status_blocked` here.
//   until_used           a status with this duration ends when one of its flags is used (intercept, Immunity block, prevents_evasion hit,
//                        heals_on_hit heal, a confused action): `useStatus`, status_expired "used".
//   prevents_action      the unit loses its action (`executePrevented`, logged `action_prevented`): no tactic, no PP. [DEFAULT] The lost action
//                        counts as a turn for the preventing statuses only (so a 1-turn Sleep ends), an until_used one is used up; it is an
//                        idle for the bus (after_action idle) and the phase checks.
// remove_buffs strips statuses of category `buff` that are removable_by_dispel ([DEFAULT]: leader-aura and terrain modifiers are not statuses
// and stay). while_condition statuses carry the applying skill's activation (`whileCond`) and end when it turns false (passives.ts).
// Effects (runEffect), roadmap 3a [DEFAULT where the design is silent]:
//   trigger / condition  an effect's own `condition` keeps the targets it holds for (the target in context, the event too); for effects
//                        whose recipients do not come from the targets (self, field, ...) it must hold for at least one target. An effect
//                        `trigger` on a hero active skill: on_hit runs after the skill's other effects once per unit the action landed a hit on
//                        (targets = that unit), on_attack once with every such unit (per-hit-once, design 7). A trigger equal to the running
//                        skill's own trigger (pre_battle in a pre_battle passive) is plain. Anything else is logged not implemented.
//                        The actor's on_hit / on_attack equipment effects run right after, the same way (equipment.ts).
//   modify_pp            adds `amount` to the pool of each recipient hero, clamped to [0, max] (squads have no PP); once_per_attack applies it at
//                        most once per attacking action per unit (Longinus). Logged `pp_change`.
//   reduce_damage        duration this_attack = the current attacking action; next_hit = until the unit takes a landed hit (that whole attacking
//                        action's hits); until_next_action = until the unit's next own action ends; phase / battle = the rest of the phase; null =
//                        this_attack inside a hit event, else until_next_action. Other strings: not implemented.
//   delay_action / advance_action  move each target's pending action later / earlier by `counts` (never before now), logged `action_moved`.
// Class traits (roadmap 3d, Decision 126): a flyer defender (hero, or squad of flyer soldiers) of a melee hit multiplies its EVA for that hit chance
// by 1 + rules.class_traits.flyer_melee_eva_bonus/100, [DEFAULT] one more multiplier after the 9.1 stacking (ranged hits: no bonus; null: off).
// Devotion (roadmap 3c): an active blessing ignore_guard of the attacker makes its hits ignore GUARD (equipment.ts ignoresGuard). executeSkill
// sets `bus.singleAttack` for a single-target damage skill (action_is_single_target) and re-checks the conditional item/blessing modifiers
// right away, so they count for that attack's rolls.
import type { Effect, Skill, SourceCategory, ConditionNode, Rules } from "../schema";
import type { Pack } from "../validate/pack";
import type { BusPayloads, EventCtx, HitMeta, Reduction } from "./events";
import { eventAttacker, eventUnit } from "./events";
import type { EventSink, SoldierRef } from "./log";
import { at, r4 } from "./log";
import type { Rng } from "./rng";
import { evaluateCondition } from "./conditions";
import { applyStatus, completeAction, effectiveStat, summedStat } from "./stats";
import type { StatusInstance } from "./state";
import type { TacticDecision } from "./tactics";
import { recordSkillUse, tacticCondition } from "./tactics";
import { advancePending, delayPending, rescheduleOnSpdChange, scheduleNext, unschedule } from "./timeline";
import type { BattleState, Soldier, Unit } from "./state";
import { alliesOf, otherSide, squadOf, syncSquad, targetsOf } from "./state";
import { endSquadSkills, onLeaderDeath } from "./leader";
import { checkStatePassives } from "./passives";
import { checkEquipment, ignoresGuard } from "./equipment";

export type DamageEffect = Extract<Effect, { type: "damage" }>;
export type HealEffect = Extract<Effect, { type: "heal" }>;
export type GuardMode = "standard" | "ignores" | "guaranteed";

export interface HitOutcome {
  hit: boolean;
  crit: boolean;
  guard: boolean;
  /** Set only when cover redirected the hit: the unit it lands on. */
  defender?: Unit;
}

export interface DamageCtx {
  pack: Pick<Pack, "rules" | "byId">;
  guardMode?: GuardMode;
  battlefield?: string | null; // terrain id, for bonus_on_terrain
  reductions?: number[]; // the defender's reduce_damage percents for this attack
}

export interface DamageBreakdown {
  landed: boolean;
  scaled: number; // sum of coef * stat
  matchup: number; // pool: 1 + the summed bonus % (additive); older formulas: class factor * bonus_vs_class factors * bonus_on_terrain factors (product)
  power: number;
  defense: number;
  base: number; // after defense, floored, min damage
  crit: boolean;
  guard: boolean;
  guardFactor: number; // pool: the applied (capped) pool factor; older formulas: the guard/reduction factor (1 when none)
  amount: number; // final damage (0 on a miss)
  reductions?: number[]; // reduce_damage percents that applied (absent when none)
  /** pool formula only: the summed bonus %, the summed reduction % (guard + reduce_damage) and the resulting (capped) pool factor. */
  pool?: { bonus: number; reduction: number; factor: number };
  /** The hero_hits multiplier applied last (absent when 1 or the attacker is a squad). */
  heroHits?: number;
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

/** Damage bonus percents for the attacker's hit on `defender`: class advantage / disadvantage, bonus_vs_class, bonus_on_terrain (see the header). */
export function bonusPercents(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx): number[] {
  const { matchup } = ctx.pack.rules;
  const m = classMatchup(ctx.pack, attacker, defender);
  const pair = m === 1 ? ctx.pack.rules.class_advantage.find((p) => p.attacker === attacker.class && p.defender === defender.class) : undefined;
  const out: number[] = [];
  if (m === 1) out.push(pair?.damage_percent ?? matchup.advantage_damage_percent);
  else if (m === -1) out.push(matchup.disadvantage_damage_percent);
  for (const b of effect.bonus_vs_class) if (b.class === defender.class) out.push(b.modifier_percent);
  for (const b of effect.bonus_on_terrain ?? []) if (ctx.battlefield != null && b.terrain === ctx.battlefield) out.push(b.modifier_percent);
  return out;
}

/** Multiplicative matchup factor of the older formulas: product of (1 + percent/100) over bonusPercents. */
export function matchupFactor(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx): number {
  return bonusPercents(attacker, defender, effect, ctx).reduce((f, p) => f * (1 + p / 100), 1);
}

export function hitChance(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx): number {
  const { rules } = ctx.pack;
  const bonus = effect.hit_bonus_percent + (classMatchup(ctx.pack, attacker, defender) === 1 ? rules.matchup.advantage_hit : 0);
  const flyer = rules.class_traits.flyer_melee_eva_bonus;
  const eva = effectiveStat(defender, "EVA", ctx.pack) * (flyer !== null && defender.class === "flyer" && effect.range === "melee" ? 1 + flyer / 100 : 1);
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

/** The defender's first status with prevents_evasion (the hit lands without a roll), if any. */
export function evasionBlocker(defender: Unit, pack: Pick<Pack, "byId">): StatusInstance | undefined {
  return defender.statuses.find((s) => pack.byId.statuses.get(s.statusId)?.flags.prevents_evasion);
}
export const cannotEvade = (defender: Unit, pack: Pick<Pack, "byId">): boolean => evasionBlocker(defender, pack) !== undefined;

/** Defense value for a damage type. Hybrid = average of DEF and MDEF. A squad defends with the sums over its living soldiers. */
export function defenseFor(defender: Unit, type: DamageEffect["damage_type"], pack: Pick<Pack, "byId">): number {
  const def = summedStat(defender, "DEF", pack);
  const mdef = summedStat(defender, "MDEF", pack);
  return type === "physical" ? def : type === "magical" ? mdef : (def + mdef) / 2;
}

/** Combined damage reduction factor from a list of reduction percents: multiplicative, total reduction capped. */
export function reductionFactor(percents: number[], capPercent: number): number {
  return Math.max(1 - capPercent / 100, percents.reduce((f, p) => f * (1 - p / 100), 1));
}

/** Base damage (after defense, floored, at least min_damage) under the older formulas (subtract / ratio / scaled_subtract). */
export function baseDamage(power: number, defense: number, d: Rules["damage"]): number {
  const raw = d.formula === "ratio" ? (power * d.ratio_k) / (d.ratio_k + Math.max(0, defense))
    : d.formula === "scaled_subtract" ? Math.max((power * d.floor_pct) / 100, power - defense * d.def_weight)
    : power - defense;
  return fl(Math.max(d.min_damage, raw));
}

/** pool formula factor: 1 + bonus% - reduction%, never below 1 - capPercent/100. */
export function poolFactor(bonus: number, reduction: number, capPercent: number): number {
  return Math.max(1 - capPercent / 100, 1 + bonus / 100 - reduction / 100);
}

const sum = (xs: number[]): number => xs.reduce((n, x) => n + x, 0);

/** Deterministic: the same attacker, defender, effect and outcome always give the same damage. No variance. */
export function computeDamage(attacker: Unit, defender: Unit, effect: DamageEffect, ctx: DamageCtx, outcome: HitOutcome): DamageBreakdown {
  const { rules } = ctx.pack;
  const isPool = rules.damage.formula === "pool";
  const scaled = effect.scaling.reduce((n, t) => n + t.coef * summedStat(attacker, t.stat, ctx.pack), 0); // a squad attacks as one
  const bonuses = bonusPercents(attacker, defender, effect, ctx);
  // pool: the bonuses are additive and live in the pool, so `matchup` reports 1 + their sum and power leaves them out
  const matchup = isPool ? 1 + sum(bonuses) / 100 : bonuses.reduce((f, p) => f * (1 + p / 100), 1);
  const power = scaled * effect.multiplier * (isPool ? 1 : matchup);
  const defense = defenseFor(defender, effect.damage_type, ctx.pack);
  const mode: GuardMode = effect.ignores_guard ? "ignores" : (ctx.guardMode ?? "standard");
  const guard = mode === "ignores" ? false : mode === "guaranteed" ? true : outcome.guard;
  const miss: DamageBreakdown = { landed: false, scaled, matchup, power, defense, base: 0, crit: false, guard: false, guardFactor: 1, amount: 0 };
  if (!outcome.hit) return miss;
  const min = rules.damage.min_damage;
  const reductions = ctx.reductions ?? [];
  const percents = [...(guard ? [rules.guard.damage_reduction_percent] : []), ...reductions];
  const cap = rules.guard.total_reduction_cap_percent;
  let base: number, amount: number, guardFactor: number, pool: DamageBreakdown["pool"];
  if (isPool) {
    const core = Math.max(min, power - defense);
    const bonus = sum(bonuses), reduction = sum(percents);
    const factor = poolFactor(bonus, reduction, cap);
    base = fl(core);
    guardFactor = factor;
    pool = { bonus, reduction, factor };
    amount = Math.max(min, fl(core * factor * (outcome.crit ? rules.damage.crit_multiplier : 1)));
  } else {
    base = baseDamage(power, defense, rules.damage);
    amount = outcome.crit ? fl(base * rules.damage.crit_multiplier) : base;
    guardFactor = percents.length > 0 ? reductionFactor(percents, cap) : 1;
    if (percents.length > 0) amount = fl(amount * guardFactor);
    amount = Math.max(min, amount);
  }
  const hh = attacker.kind === "hero" ? rules.damage.hero_hits : 1;
  if (hh !== 1) amount = Math.max(min, fl(amount * hh));
  return {
    landed: true, scaled, matchup, power, defense, base, crit: outcome.crit, guard, guardFactor, amount,
    ...(reductions.length ? { reductions } : {}), ...(pool ? { pool } : {}), ...(hh !== 1 ? { heroHits: hh } : {}),
  };
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

/** What the roll and damage code needs of a skill. Soldier basic attacks are not skills, so they pass a stand-in. No shape = single. */
export type SkillRef = Pick<Skill, "id" | "interactions"> & { shape?: string };

/** Shapes that strike one unit: single, and a passive's event_unit / attacker. */
export const isSingleShape = (shape: string | undefined): boolean => shape === undefined || shape === "single" || shape === "event_unit" || shape === "attacker";

export const hitMeta = (skill: SkillRef, effect: DamageEffect): HitMeta => ({ damageType: effect.damage_type, range: effect.range, single: isSingleShape(skill.shape), shape: skill.shape });

/** The defender's reduce_damage effects in force that cover the damage type (hybrid: any). */
const reductionsOn = (state: BattleState, defender: Unit, effect: DamageEffect): Reduction[] =>
  state.bus.reductions.filter((r) => r.unit === defender && (r.appliesTo === "all" || r.appliesTo === effect.damage_type || effect.damage_type === "hybrid"));

/** A landed hit used up the defender's next_hit reductions (they still cover the rest of this attacking action). */
const markReductionsHit = (state: BattleState, defender: Unit, effect: DamageEffect): void => {
  for (const r of reductionsOn(state, defender, effect)) if (r.until === "hit") r.hit = true;
};

/** The guard mode of `attacker`'s hit: the skill's, or "ignores" while a blessing ignore_guard of the attacker is active. */
const guardModeOf = (state: BattleState, attacker: Unit | undefined, skill: SkillRef): GuardMode =>
  attacker && ignoresGuard(state, attacker) ? "ignores" : skill.interactions.guard;

/** DamageCtx for one hit on `defender`, with its reduce_damage effects that cover the damage type. */
export function hitCtx(state: BattleState, skill: SkillRef, defender: Unit, effect: DamageEffect, attacker?: Unit): DamageCtx {
  const reductions = reductionsOn(state, defender, effect).map((r) => r.percent);
  return { pack: state.pack, guardMode: guardModeOf(state, attacker, skill), battlefield: state.battlefield, ...(reductions.length ? { reductions } : {}) };
}

const refs = (who: SoldierRef): SoldierRef => ({ ...(who.soldier !== undefined ? { soldier: who.soldier } : {}), ...(who.by !== undefined ? { by: who.by } : {}) });

/** Emits before_hit, follows a cover redirect, then rolls hit, crit, guard in that order and logs each. */
export function rollOutcome(x: ExecCtx, attacker: Unit, defender: Unit, skill: SkillRef, effect: DamageEffect, who: SoldierRef = {}): HitOutcome {
  const { state, rng, log } = x;
  const ctx: DamageCtx = { pack: state.pack, guardMode: guardModeOf(state, attacker, skill), battlefield: state.battlefield };
  const pre: BusPayloads["before_hit"] = { attacker, defender, skillId: skill.id, ...hitMeta(skill, effect), ...refs(who) };
  state.bus.emit(x, "before_hit", pre);
  let covered: Unit | null = null;
  if (pre.redirect && pre.redirect !== defender && pre.redirect.alive) {
    covered = pre.redirect;
    log.emit({ type: "cover", ...at(state), unit: covered.id, ally: defender.id, attacker: attacker.id, skill: skill.id });
    defender = covered;
    state.bus.emit(x, "before_hit", { attacker, defender, skillId: skill.id, ...hitMeta(skill, effect), ...refs(who), covered: true });
  }
  const cov = covered ? { defender: covered } : {};
  const base = { unit: attacker.id, target: defender.id, skill: skill.id };
  const emit = (kind: "hit" | "crit" | "guard", chance: number, roll: number | null, result: boolean, note?: string) =>
    log.emit({ type: "roll", ...at(state), ...base, kind, chance: r4(chance), roll: roll === null ? null : r4(roll), result, ...(note ? { note } : {}), ...refs(who) });

  let hit: boolean;
  const pinned = evasionBlocker(defender, state.pack);
  if (pinned) {
    hit = true;
    emit("hit", 100, null, true, "target cannot evade");
    useStatus(x, defender, pinned);
  } else {
    const chance = hitChance(attacker, defender, effect, ctx);
    const r = roll100(rng);
    hit = r < chance;
    emit("hit", chance, r, hit);
  }
  if (!hit) return { hit: false, crit: false, guard: false, ...cov };

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
  return { hit, crit, guard, ...cov };
}

/** A flag of `inst` was used: an until_used status ends (status_expired "used"); any other duration is untouched. */
export function useStatus(x: ExecCtx, unit: Unit, inst: StatusInstance): void {
  if (x.state.pack.byId.statuses.get(inst.statusId)?.duration.unit !== "until_used" || !unit.statuses.includes(inst)) return;
  unit.statuses = unit.statuses.filter((s) => s !== inst);
  x.log.emit({ type: "status_expired", ...at(x.state), unit: unit.id, status: inst.statusId, reason: "used" });
}

/** Fairy's Grace: the unit's first intercepts_death status, if any, and its revive percent. */
function deathGuard(state: BattleState, unit: Unit): { inst: StatusInstance; percent: number } | null {
  for (const inst of unit.statuses) {
    const f = state.pack.byId.statuses.get(inst.statusId)?.flags.intercepts_death;
    if (f?.enabled) return { inst, percent: f.revive_hp_percent };
  }
  return null;
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

/** Reduction percents, the pool parts and the hero_hits multiplier for the damage log (each absent when it did not apply). */
const reduced = (d: DamageBreakdown) => ({
  ...(d.reductions ? { reductions: d.reductions } : {}),
  ...(d.pool ? { bonus: r4(d.pool.bonus), reduction: r4(d.pool.reduction), pool: r4(d.pool.factor) } : {}),
  ...(d.heroHits !== undefined ? { hero_hits: d.heroHits } : {}),
});

/** `meta.noEvent`: fixed damage that is not a hit (devotion reflect_damage): no after_hit is emitted. */
export type DamageMeta = HitMeta & { noEvent?: boolean };

export function applyDamage(x: ExecCtx, attacker: Unit, defender: Unit, skill: Pick<Skill, "id">, d: DamageBreakdown, by?: number, meta: DamageMeta = { single: true }): void {
  const before = defender.hp;
  defender.hp = Math.max(0, defender.hp - d.amount);
  x.log.emit({
    type: "damage", ...at(x.state), unit: attacker.id, target: defender.id, skill: skill.id, power: r4(d.power), defense: r4(d.defense), base: d.base,
    crit: d.crit, guard: d.guard, amount: d.amount, hp_before: before, hp_after: defender.hp, ...refs({ by }), ...reduced(d),
  });
  const guard = defender.hp === 0 ? deathGuard(x.state, defender) : null;
  if (guard) { // the unit stays on the timeline: its pending action is preserved
    defender.hp = Math.max(1, fl((guard.percent / 100) * defender.maxHp));
    x.log.emit({ type: "death_intercepted", ...at(x.state), unit: defender.id, status: guard.inst.statusId, hp: defender.hp });
    useStatus(x, defender, guard.inst);
  }
  if (defender.hp === 0) killUnit(x, defender, attacker);
  const { noEvent, ...hm } = meta;
  if (!noEvent) x.state.bus.emit(x, "after_hit", { attacker, defender, skillId: skill.id, ...hm, amount: d.amount, killed: defender.hp === 0, lost: Math.min(before, d.amount), ...refs({ by }) });
  checkStatePassives(x);
}

/** Lowest-HP living soldier; ties go to the lowest index. Null when the squad is wiped. */
export function lowestHpSoldier(squad: Unit): Soldier | null {
  let best: Soldier | null = null;
  for (const s of squad.soldiers) if (s.alive && (best === null || s.hp < best.hp)) best = s;
  return best;
}

/**
 * Applies landed damage to a squad, starting at `soldier`. Every hit OVERFLOWS (Decision 128; area hits too since Decision 130): when the soldier
 * dies with damage left over, the raw leftover (d.amount minus the HP it had; no new rolls) carries to the next lowest-HP living soldier (ties
 * lowest index), and so on until it is used up or the squad is wiped. Nothing ever reaches the leader or the heroes. Each soldier hit gets its own
 * `damage` event (amount = what was applied to it, `spill: true` on carried ones) and deaths are logged per soldier; the bus `after_hit` is
 * emitted ONCE with amount = the raw damage of the hit (d.amount, as for a hero hit) and lost = the total HP removed from soldiers (a killed
 * soldier counts only the HP it had; soldier = the first one hit). `meta.single` only describes the hit's shape for the event. A last soldier
 * saved by intercepts_death (Fairy's Grace) ends the overflow. A squad with no living soldier is defeated and leaves the timeline.
 */
export function applySoldierDamage(x: ExecCtx, attacker: Unit, squad: Unit, soldier: Soldier, skill: Pick<Skill, "id">, d: DamageBreakdown, by?: number, meta: DamageMeta = { single: true }): void {
  let cur: Soldier | null = soldier;
  let remaining = d.amount;
  let removed = 0;
  let spill = false;
  do {
    const before: number = cur.hp;
    const applied = Math.min(before, remaining);
    cur.hp = Math.max(0, before - applied);
    x.log.emit({
      type: "damage", ...at(x.state), unit: attacker.id, target: squad.id, skill: skill.id, power: r4(d.power), defense: r4(d.defense), base: d.base,
      crit: d.crit, guard: d.guard, amount: applied, hp_before: before, hp_after: cur.hp, ...refs({ soldier: cur.index, by }), ...reduced(d), ...(spill ? { spill: true } : {}),
    });
    removed += Math.min(before, applied);
    const guard = cur.hp === 0 && !squad.soldiers.some((s) => s !== cur && s.alive) ? deathGuard(x.state, squad) : null;
    if (guard) { // the squad's last soldier is saved
      cur.hp = Math.max(1, fl((guard.percent / 100) * cur.maxHp));
      x.log.emit({ type: "death_intercepted", ...at(x.state), unit: squad.id, status: guard.inst.statusId, hp: cur.hp, soldier: cur.index });
      useStatus(x, squad, guard.inst);
    }
    let died = false;
    if (cur.hp > 0) syncSquad(squad);
    else {
      died = true;
      cur.alive = false;
      syncSquad(squad);
      if (squad.alive) x.log.emit({ type: "death", ...at(x.state), unit: squad.id, killer: attacker.id, soldier: cur.index });
      else { // the last soldier's death is the squad's wipe: one event, without a soldier index
        unschedule(x.state, squad);
        x.log.emit({ type: "death", ...at(x.state), unit: squad.id, killer: attacker.id });
        endSquadSkills(x.state, squad); // its leader/party soldier skills end with it
        x.state.bus.emit(x, "on_death", { unit: squad, killer: attacker });
      }
    }
    remaining -= applied;
    cur = died && remaining > 0 ? lowestHpSoldier(squad) : null;
    spill = true;
  } while (cur);
  const { noEvent, ...hm } = meta;
  if (!noEvent) x.state.bus.emit(x, "after_hit", { attacker, defender: squad, skillId: skill.id, ...hm, amount: d.amount, killed: !squad.alive, lost: removed, ...refs({ soldier: soldier.index, by }) });
  checkStatePassives(x); // as applyDamage: while_condition passives and statuses re-check after damage
}

/**
 * One damage effect against a squad (Decision 130: it defends as one). Single or area (`area`: any shape but single), the hit is rolled and
 * computed once against the squad's summed defense, then applied from the lowest-HP living soldier with overflow (applySoldierDamage).
 */
export function hitSquad(x: ExecCtx, attacker: Unit, squad: Unit, skill: SkillRef, effect: DamageEffect, area: boolean): void {
  if (!squad.alive) return;
  const outcome = rollOutcome(x, attacker, squad, { ...skill, shape: area ? "all" : "single" }, effect); // cover never redirects a hit on a squad
  const d = computeDamage(attacker, squad, effect, hitCtx(x.state, skill, squad, effect, attacker), outcome);
  if (!d.landed) return;
  const first = lowestHpSoldier(squad);
  if (!first) return;
  markReductionsHit(x.state, squad, effect);
  applySoldierDamage(x, attacker, squad, first, skill, d, undefined, { ...hitMeta(skill, effect), single: !area });
}

/** One damage hit on a hero (single or area), following a cover redirect. */
export function hitHero(x: ExecCtx, attacker: Unit, target: Unit, skill: SkillRef, effect: DamageEffect, by?: number): void {
  const outcome = rollOutcome(x, attacker, target, skill, effect, by === undefined ? {} : { by });
  const def = outcome.defender ?? target;
  const d = computeDamage(attacker, def, effect, hitCtx(x.state, skill, def, effect, attacker), outcome);
  if (!d.landed) return;
  markReductionsHit(x.state, def, effect);
  applyDamage(x, attacker, def, skill, d, by, hitMeta(skill, effect));
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
  } else {
    target.hp = Math.min(target.maxHp, target.hp + amount);
    x.log.emit({ type: "heal", ...at(x.state), unit: caster.id, target: target.id, skill: skill.id, amount, applied: target.hp - before, hp_before: before, hp_after: target.hp });
  }
  const applied = target.hp - before;
  if (applied > 0) {
    x.state.bus.emit(x, "after_heal", { caster, target, skillId: skill.id, amount: applied });
    checkStatePassives(x);
  }
  return applied;
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
  state.bus.beginAction(actor);

  const before = actor.pp.active.cur;
  actor.pp.active.cur -= skill.pp_cost;
  log.emit({ type: "pp_spend", ...at(state), unit: actor.id, skill: skill.id, pool: "active", cost: skill.pp_cost, before, after: actor.pp.active.cur });
  recordSkillUse(actor, skill, true);
  // action_is_single_target (3c): on for this whole attack; conditional item / blessing modifiers are re-checked now so they count for its rolls.
  state.bus.singleAttack = isSingleShape(skill.targeting.shape ?? "single") && skill.effects.some((e) => e.type === "damage");
  if (state.bus.singleAttack) checkEquipment(x);

  const activation = tacticCondition(decision.tactic, skill);
  const ctxSkill: EffectSkill = { id: skill.id, name: skill.name, shape: skill.targeting.shape ?? "single", interactions: skill.interactions, activation, trigger: skill.trigger };
  const onHits = (e: Effect) => e.trigger === "on_hit" || e.trigger === "on_attack";
  for (const effect of skill.effects) if (!onHits(effect)) runEffect(x, actor, ctxSkill, effect, decision.targets, touched, false);
  // on_hit / on_attack effects: after the others, on the units the skill's own hits landed on (per-hit-once: each unit once). They are
  // reactions: their events are not dispatched and their hits do not join hitUnits.
  const hitRun: PassiveRun = { applier: "active", inAction: true, hitTargets: true };
  const ownHits = [...state.bus.hitUnits];
  for (const effect of skill.effects) {
    const hit = ownHits.filter((u) => u.alive);
    if (!onHits(effect) || !actor.alive || hit.length === 0) continue;
    state.bus.reacting(() => {
      if (effect.trigger === "on_attack") runEffect(x, actor, ctxSkill, effect, hit, touched, false, hitRun);
      else for (const u of hit) runEffect(x, actor, ctxSkill, effect, [u], touched, false, hitRun);
    });
  }
  // The actor's on_hit / on_attack item effects (equipment.ts, roadmap 3b; Longinus), the same way, in the equipment category.
  const equipRun: PassiveRun = { ...hitRun, applier: "equipment" };
  for (const ee of state.equipment.onHit) {
    const hit = ownHits.filter((u) => u.alive);
    if (ee.owner !== actor || !actor.alive || hit.length === 0) continue;
    const itemSkill: EffectSkill = { id: ee.item.id, name: ee.item.name, shape: ctxSkill.shape, interactions: skill.interactions };
    state.bus.reacting(() => {
      if (ee.effect.trigger === "on_attack") runEffect(x, actor, itemSkill, ee.effect, hit, touched, false, equipRun);
      else for (const u of hit) runEffect(x, actor, itemSkill, ee.effect, [u], touched, false, equipRun);
    });
  }

  state.bus.singleAttack = false; // the attack is over: finishAction's re-check takes its single-target modifiers off
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
  /** The skill's effective activation (tactic over default); a while_condition status it applies lasts while this holds. */
  activation?: ConditionNode | null;
  /** The skill's own trigger (own_turn, pre_battle, ...): an effect trigger equal to it is plain. */
  trigger?: string;
}

/** Extra context for effects run by a hero passive or an on_hit / on_attack skill effect (roadmap 3a): stacking category, triggering event. */
export interface PassiveRun {
  applier: SourceCategory;
  event?: EventCtx;
  /** False for pre-battle passives: there is no applying action. */
  inAction: boolean;
  /** An on_hit / on_attack effect of a hero skill: `targets` are the units hit (hit_unit names them). */
  hitTargets?: boolean;
}

/**
 * The units an effect's `target` names. Area statuses (any shape but single, and caster_row) skip soldiers unless `includeSoldiers`.
 * field = every living unit on both sides (squads only with `includeSoldiers`). attacker / hit_unit come from the triggering event.
 * Null for a target the engine cannot resolve here.
 */
function effectRecipients(x: ExecCtx, actor: Unit, skill: EffectSkill, target: string, targets: Unit[], includeSoldiers: boolean, reaction: boolean, ev?: EventCtx): Unit[] | null {
  const { state } = x;
  const area = skill.shape !== "single";
  const ownSquad = squadOf(state, actor.side);
  const fromEvent = (u: Unit | null) => (u ? [u] : []);
  switch (target) {
    case "self": return [actor];
    case "targets": return targets.filter((u) => u.kind === "hero" || !area || includeSoldiers);
    case "caster_row": return [...alliesOf(state, actor).filter((u) => u.row === actor.row), ...(includeSoldiers && ownSquad ? [ownSquad] : [])];
    case "field": return state.units.filter((u) => u.alive && (u.kind === "hero" || includeSoldiers));
    case "hit_unit": return reaction ? targets.filter((u) => u.kind === "hero" || !area || includeSoldiers) : ev ? fromEvent(eventUnit(ev)) : null; // reaction: the units hit
    case "attacker": return ev ? fromEvent(eventAttacker(ev)) : null;
    default: return null;
  }
}

const isHitEvent = (ev?: EventCtx): boolean => ev?.bus === "before_hit" || ev?.bus === "after_hit";

/** reduce_damage duration -> how long the reduction lasts (see the header); null for a duration the engine does not know. */
function reductionSpan(duration: string | null, ev?: EventCtx): { until: Reduction["until"]; label: string } | null {
  switch (duration) {
    case "this_attack": return { until: "action", label: "this_attack" };
    case null: return isHitEvent(ev) ? { until: "action", label: "this_attack" } : { until: "own_action", label: "until_next_action" };
    case "next_hit": return { until: "hit", label: "next_hit" };
    case "until_next_action": return { until: "own_action", label: "until_next_action" };
    case "phase":
    case "battle": return { until: "phase", label: duration };
    default: return null;
  }
}

/** Stun pushback on `t` (design Section 6), logged `action_delayed`. */
function stun(x: ExecCtx, t: Unit, name: string): void {
  const counts = x.state.pack.rules.stun_pushback_counts;
  if (counts === null) {
    x.log.emit({ type: "not_implemented", ...at(x.state), unit: t.id, what: `not implemented: ${name} pushback (rules.stun_pushback_counts is null)` });
    return;
  }
  const due = delayPending(x.state, t, counts);
  x.log.emit({ type: "action_delayed", ...at(x.state), unit: t.id, counts, due });
}

/**
 * Runs one effect of a skill (or, with `reaction`, of an event-triggered soldier skill) for `actor` against `targets`.
 * In a reaction the effect's own trigger is what fired it, `heal` heals the actor, `hit_unit` means the given targets, and applied
 * statuses use the soldier category. With `passive` (hero passives), `attacker` / `hit_unit` come from the triggering event, applied statuses
 * use the passive category, and reduce_damage / cover act on the current attack.
 */
export function runEffect(x: ExecCtx, actor: Unit, skill: EffectSkill, effect: Effect, targets: Unit[], touched: Set<Unit>, reaction: boolean, passive?: PassiveRun): void {
  const { state, rng, log } = x;
  const ni = (what: string) => log.emit({ type: "not_implemented", ...at(state), unit: actor.id, what });
  const trig = effect.trigger;
  const onHit = reaction || passive?.hitTargets === true;
  if (trig && trig !== "always" && !(onHit ? trig === "on_hit" || trig === "on_attack" : trig === skill.trigger)) {
    return ni(`not implemented: effect ${effect.type} with trigger ${trig} in ${skill.name}`);
  }
  const ev = passive?.event;
  if (effect.condition) {
    const holds = (t: Unit | null): boolean => {
      const r = evaluateCondition(effect.condition, { state, self: actor, target: t, ...(ev ? { event: ev } : {}) });
      for (const m of new Set(r.reasons)) if (m.startsWith("not implemented")) ni(`${m} (effect condition in ${skill.name})`);
      return r.value;
    };
    if (targets.length === 0 ? !holds(null) : (targets = targets.filter(holds)).length === 0) return;
  }
  switch (effect.type) {
    case "damage":
      for (const t of targets) {
        if (!t.alive) continue;
        if (t.kind === "squad") hitSquad(x, actor, t, skill, effect, !isSingleShape(skill.shape));
        else hitHero(x, actor, t, skill, effect);
      }
      break;
    case "heal":
      for (const t of reaction ? [actor] : targets) applyHeal(x, actor, t, skill, computeHeal(t, actor, effect, state.pack));
      break;
    case "apply_status": {
      const recipients = effectRecipients(x, actor, skill, effect.target, targets, effect.include_soldiers, onHit, ev);
      if (!recipients) { ni(`not implemented: apply_status target ${effect.target}`); break; }
      const applier: SourceCategory = passive ? passive.applier : reaction ? "soldier" : "active";
      const st = state.pack.byId.statuses.get(effect.status_id);
      for (const t of recipients) {
        if (!t.alive) continue;
        if (effect.chance_percent < 100) {
          const r = roll100(rng);
          const ok = r < effect.chance_percent;
          log.emit({ type: "roll", ...at(state), unit: actor.id, target: t.id, skill: skill.id, kind: "status", chance: effect.chance_percent, roll: r4(r), result: ok });
          if (!ok) continue;
        }
        const res = applyStatus(state, t, effect.status_id, applier, actor.id, passive?.inAction ?? true);
        for (const n of res.notes) if (n.startsWith("not implemented")) ni(n);
        const notes = res.notes.filter((n) => !n.startsWith("not implemented"));
        if (res.blockedBy) {
          log.emit({ type: "status_blocked", ...at(state), unit: t.id, status: effect.status_id, source: actor.id, by: res.blockedBy.statusId });
          useStatus(x, t, res.blockedBy);
          continue;
        }
        if (!res.applied || !st) continue;
        const cat = st.source_category === "inherit" ? applier : st.source_category;
        const inst = res.instant ? undefined : t.statuses.find((s) => s.statusId === effect.status_id && s.category === cat)!;
        if (inst && st.duration.unit === "while_condition" && skill.activation) inst.whileCond = { cond: skill.activation, owner: actor.id };
        log.emit({ type: "status_applied", ...at(state), unit: t.id, status: effect.status_id, category: cat, source: actor.id, remaining: inst ? inst.remaining : null, notes: res.instant ? [...notes, "instant"] : notes });
        if (st.flags.delays_pending_action) stun(x, t, st.name);
        touched.add(t);
      }
      break;
    }
    case "remove_buffs": {
      const recipients = effect.side
        ? targetsOf(state, effect.side === "ally" ? actor.side : otherSide(actor.side))
        : effectRecipients(x, actor, skill, effect.target!, targets, true, onHit, ev);
      if (!recipients) { ni(`not implemented: remove_buffs target ${effect.target}`); break; }
      for (const t of recipients) {
        if (!t.alive) continue;
        for (const inst of [...t.statuses]) {
          const st = state.pack.byId.statuses.get(inst.statusId);
          if (!st || st.category !== "buff" || !st.removal.removable_by_dispel) continue;
          t.statuses = t.statuses.filter((s) => s !== inst);
          log.emit({ type: "status_expired", ...at(state), unit: t.id, status: inst.statusId, reason: "removed" });
          touched.add(t);
        }
      }
      break;
    }
    case "reduce_damage": {
      const span = reductionSpan(effect.duration, ev);
      if (!span) { ni(`not implemented: reduce_damage with duration ${effect.duration} in ${skill.name}`); break; }
      for (const t of targets) {
        if (!t.alive) continue;
        state.bus.reductions.push({ unit: t, percent: effect.percent, appliesTo: effect.applies_to, until: span.until, actionId: state.bus.actionId });
        log.emit({ type: "damage_reduction", ...at(state), unit: t.id, source: actor.id, skill: skill.id, percent: effect.percent, applies_to: effect.applies_to, duration: span.label });
      }
      break;
    }
    case "modify_pp": {
      const recipients = effectRecipients(x, actor, skill, effect.target, targets, true, onHit, ev);
      if (!recipients) { ni(`not implemented: modify_pp target ${effect.target}`); break; }
      for (const t of recipients) {
        if (!t.alive || t.kind !== "hero") continue; // a squad has no PP
        const key = `${skill.id}|${t.id}`;
        if (effect.once_per_attack) {
          if (state.bus.ppOnce.has(key)) continue;
          state.bus.ppOnce.add(key);
        }
        const pool = t.pp[effect.pool];
        const before = pool.cur;
        pool.cur = clamp(pool.cur + effect.amount, 0, pool.max);
        log.emit({ type: "pp_change", ...at(state), unit: t.id, source: actor.id, skill: skill.id, pool: effect.pool, amount: effect.amount, before, after: pool.cur });
      }
      break;
    }
    case "delay_action":
    case "advance_action":
      for (const t of targets) {
        if (!t.alive) continue;
        const counts = effect.type === "delay_action" ? effect.counts : -effect.counts;
        const due = counts > 0 ? delayPending(state, t, counts) : advancePending(state, t, -counts);
        log.emit({ type: "action_moved", ...at(state), unit: t.id, source: actor.id, skill: skill.id, counts, due });
        touched.add(t);
      }
      break;
    case "cover": {
      // The actor takes the triggering single-target hit aimed at an ally hero (rollOutcome follows the redirect).
      const p = ev?.bus === "before_hit" ? (ev.payload as BusPayloads["before_hit"]) : null;
      if (!p) { ni(`not implemented: cover outside a before_hit event in ${skill.name}`); break; }
      if (p.covered || p.redirect || p.single !== true || p.defender === actor || p.defender.kind !== "hero" || p.defender.side !== actor.side) break;
      p.redirect = actor;
      break;
    }
    default:
      ni(`not implemented: effect ${effect.type} in ${skill.name}`);
  }
}

/** An idle action: no PP, no skill, statuses do not tick. */
export function executeIdle(x: ExecCtx, actor: Unit): void {
  x.state.bus.beginAction(actor);
  x.log.emit({ type: "idle", ...at(x.state), unit: actor.id });
  completeAction(x.state, actor, false);
  x.state.bus.emit(x, "after_action", { actor, skillId: null, idle: true, hit: [] });
  finishAction(x, actor, new Set([actor]));
}

/** The unit's first prevents_action status, if any. */
export function actionBlocker(state: BattleState, u: Unit): StatusInstance | undefined {
  return u.statuses.find((s) => state.pack.byId.statuses.get(s.statusId)?.flags.prevents_action);
}

/** A prevented action (see the header): no tactic, no PP; only the preventing statuses tick (or are used up). */
export function executePrevented(x: ExecCtx, actor: Unit, inst: StatusInstance): void {
  const { state, log } = x;
  state.bus.beginAction(actor);
  log.emit({ type: "action_prevented", ...at(state), unit: actor.id, status: inst.statusId });
  for (const id of completeAction(state, actor, true, (st) => st.flags.prevents_action)) {
    log.emit({ type: "status_expired", ...at(state), unit: actor.id, status: id, reason: "duration" });
  }
  for (const i of [...actor.statuses]) if (state.pack.byId.statuses.get(i.statusId)?.flags.prevents_action) useStatus(x, actor, i);
  state.bus.emit(x, "after_action", { actor, skillId: null, idle: true, hit: [] });
  finishAction(x, actor, new Set([actor]));
}

/**
 * Reschedules every living unit whose SPD changed (the actor, units it buffed or debuffed, and squads whose leader's statuses changed),
 * then schedules the actor's next action. `_touched` is kept for callers; all units are checked because a squad shares its leader's modifiers.
 */
export function finishAction(x: ExecCtx, actor: Unit, _touched?: Set<Unit>): void {
  const { state, log } = x;
  checkStatePassives(x);
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
  // until_next_action reductions on the actor end with this action, unless this very action set them.
  state.bus.reductions = state.bus.reductions.filter((r) => !(r.until === "own_action" && r.unit === actor && r.actionId !== state.bus.actionId));
  actor.actions++;
}
