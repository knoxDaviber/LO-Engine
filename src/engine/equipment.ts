// Equipment in the engine (design Sections 7, 9, 9.1 and 12; roadmap 3b).
//
//   flat lines      the item type's base (rules.equipment_bases, src/equipmentBase.ts; Decision 133), summed into `Unit.equipFlat` when the unit
//                   is built (state.ts) and added to base before any stacking. Duplicate accessories (allowed by
//                   `duplicate_allowed_in_both_accessory_slots`, checked by the roster validator) add their lines: two Spiky Gloves = ATK +24.
//   pp_modifiers    added to the character's PP pools when the unit is built, capped at rules.pp.max (Dragon Scale: Active +1).
//   effects         by trigger:
//     none / always modify_stat   an `equipment`-category modifier (or the effect's own source_category) carried by an inline status instance
//                                 (statusId `equip:<item>:<slot>:<n>`) on the wearer. Put on in the `equipment` pre-battle step (first, design 9);
//                                 one with a `condition` (Queen's Scepter: HP > 80%) is re-checked with the state passives after every damage,
//                                 heal and action (`checkEquipment`) and is on exactly while the condition holds (judged from the wearer).
//                                 Same category, so equipment vs equipment never stacks: two identical accessory effects -> the strongest wins.
//                                 Exception (Decision 147): lines flagged `stacks` (PP gear: Reckless Gauntlets, Dragon Scale, ...) add up per
//                                 stat / mode / sign (stats.ts), also for Max HP (state.ts).
//                                 [DEFAULT] The wearer's own equipment modifiers are not shared with its squad (stats.ts), like its flat lines.
//     on_hit / on_attack          run after the wearer's own active skill's effects through the hero on-hit path (damage.ts executeSkill), as
//                                 reactions, once per attacking action: on_hit per unit hit, on_attack once with every unit hit (Longinus:
//                                 -1 Passive PP to each hit unit, once_per_attack). Statuses they apply use the `equipment` category.
//                                 [DEFAULT] Only the wearer's active skills trigger them (not passive/reaction damage, not its squad's attacks).
//     pre_battle                  run once per phase in a pre-battle step through runEffect (applier `equipment`, no applying action): an
//                                 apply_status of a debuff status (Strange Box: field Confusion) or a remove_buffs in the debuffs / buff_removal
//                                 step, which Immunity can block; anything else in the equipment step.
//   A modify_stat with an on_hit / on_attack / pre_battle trigger is rejected by the validator (E_EFFECT_TRIGGER). A dead wearer's modifiers
//   come off (equipment_removed "death").
//   Not implemented (logged at phase start, never dropped): any other effect type without a trigger (an always modify_pp, apply_status, ...),
//   trigger on_event, conditions with leaves outside the registry (logged when checked).
//
// Devotion blessings (design Section 9A, roadmap 3c; which tiers a hero unlocks: src/devotion.ts) reuse this machinery, per blessing effect:
//   modify_stat (always)        a `prayer`-category inline instance (statusId `prayer:<god>:<tier>:<n>`), on while its condition holds, re-checked
//                               like item modifiers (logged `blessing_applied` / `blessing_removed`). [DEFAULT] Not shared with the wearer's squad.
//                               Same category, but one god's 2-piece and 4-piece lines on one stat add (stats.ts, Decision 125: Full Moon DEF
//                               +30% while on); two gods' identical lines follow 9.1 (strongest wins).
//                               action_is_single_target: damage.ts executeSkill sets `bus.singleAttack` and re-checks right after
//                               spending PP, so these lines are on for every roll of that attack; it clears the flag before the status ticks and
//                               the recheck in finishAction takes them off.
//   ignore_guard                judged when the wearer rolls a hit (`ignoresGuard`, condition from the wearer): its attacks ignore GUARD, like a
//                               damage effect's ignores_guard ([DEFAULT] also over a skill's guard "guaranteed").
//   reflect_damage / on_event   a reaction after each non-idle action of another unit (bus after_action, order DEVOTION_ORDER, once per action):
//                               the action's hit events by that actor on the wearer for which the effect's condition holds (each judged in its own
//                               event context, so unit_hit_by_single_target_attack reads that hit) decide it. reflect_damage deals
//                               floor(percent% of the HP the wearer lost to those hits (after_hit `lost` = total HP removed: overkill and Fairy's Grace saves
//                               count only the HP it had), summed over the whole action: a multi-hit action counts every hit) to the actor:
//                               no rolls, no DEF, not a hit (no events), can kill (Fairy's Grace still intercepts); on a squad it lands on the
//                               lowest-HP living soldier and overflows to the next ones like a single hit. It still fires when that action killed the wearer (`evenIfOwnerDead`).
//                               Any other on_event effect (Gift DEF's heal) runs once on the wearer if any such hit event (a dodge counts:
//                               targeted, landed or not) exists. [DEFAULT] A dead wearer heals no more; reflected damage below 1 is dropped.
//                               on_event damage (Rush DEF): one rolled counter per matching event (self_dodged) at the actor, a single-target
//                               reaction hit: a dead actor or wearer gets none, and its own events are not dispatched, so counters never chain.
//                               on_event damage_bonus (Retaliate): sets the wearer's `attackCharge` to percent (one charge, no stacking; a dodged
//                               attack counts), which damage.ts adds to its next attacking action's hits and spends after it, landed or not.
//                               An effect whose top-level condition is an on_death leaf (self_killed_enemy, Gift ATK) subscribes to on_death instead:
//                               once per dead unit, right at the kill. [DEFAULT] Kills by reactions fire nothing (reactions never trigger reactions).
//   ignore_defense, damage_bonus,  judged at each hit (`hitMods`, condition from the wearer; damage.ts hitCtx). crit_damage on: dealt reads the
//   crit_damage (always)        attacker's, on: taken the defender's.
//   reduce_damage phase/battle/ a standing reduction, set in the equipment pre-battle step every phase (Plate: damage taken -10%; Sidestep:
//   first_single_hit            first_single_hit, so one fresh charge per phase).
//   Anything else is a build note `not implemented: blessing ...`, as is a 4-piece with no side (the validator rejects it, E_SIGIL_SIDE_MISSING).
import type { Effect, Equipment, SourceCategory } from "../schema";
import { blessingKind } from "../devotion";
import { evaluateCondition } from "./conditions";
import type { DamageBreakdown, EffectSkill, ExecCtx } from "./damage";
import { applyDamage, applySoldierDamage, lowestHpSoldier, runEffect } from "./damage";
import type { BusPayloads, EventCtx } from "./events";
import { EVENT_SPECS } from "./events";
import { at } from "./log";
import type { BattleState, StatusInstance, Unit } from "./state";
import { isDebuffStatus } from "./stats";

export const EQUIP_PREFIX = "equip:";
export const PRAYER_PREFIX = "prayer:";
export const DEVOTION_ORDER = 40; // bus order: after engine handlers (0) and passives (30), before auras (50) and soldier skills (100)

type ModifyStat = Extract<Effect, { type: "modify_stat" }>;

/**
 * One item effect of one worn item, or one effect of an unlocked blessing tier. Items: `slot` is the slot index on the wearer (weapon 0, armor 1,
 * accessory 2 / 3), prefix `equip:`, category `equipment`. Blessings: `item` is the god's id under the blessing's name, `slot` the tier (2 or 4),
 * prefix `prayer:`, category `prayer`.
 */
export interface EquipEffect {
  owner: Unit;
  item: Pick<Equipment, "id" | "name">;
  slot: number;
  index: number;
  effect: Effect;
  prefix: string;
  category: SourceCategory;
}

/** A modify_stat item effect and whether its instance is on. */
export interface EquipMod extends EquipEffect {
  effect: ModifyStat;
  inst: StatusInstance | null;
  /** The condition has a leaf the engine cannot evaluate: already logged, stays off. */
  blocked: boolean;
}

export interface EquipmentState {
  mods: EquipMod[];
  /** on_hit / on_attack effects, run by damage.ts executeSkill for their owner's active skills. */
  onHit: EquipEffect[];
  preBattle: EquipEffect[];
  /** Blessing ignore_guard effects, judged when their owner attacks (`ignoresGuard`). */
  ignoreGuard: EquipEffect[];
  /** Blessing ignore_defense / damage_bonus / crit_damage effects, judged at each hit (`hitMods`). */
  hitMods: EquipEffect[];
}

export const emptyEquipment = (): EquipmentState => ({ mods: [], onHit: [], preBattle: [], ignoreGuard: [], hitMods: [] });

/** Sorts every worn item effect and unlocked blessing effect of every hero into the state's lists; unsupported ones become build notes. */
export function registerEquipment(state: BattleState): void {
  for (const u of state.units) {
    if (u.kind !== "hero") continue;
    u.equipment.forEach((id, slot) => {
      const item = id ? state.pack.byId.equipment.get(id) : undefined;
      if (!item) return;
      item.effects.forEach((effect, index) => {
        const ee: EquipEffect = { owner: u, item, slot, index, effect, prefix: EQUIP_PREFIX, category: "equipment" };
        const trig = effect.trigger ?? "always";
        if (trig === "always" && effect.type === "modify_stat") state.equipment.mods.push({ ...ee, effect, inst: null, blocked: false });
        else if (trig === "on_hit" || trig === "on_attack") state.equipment.onHit.push(ee);
        else if (trig === "pre_battle") state.equipment.preBattle.push(ee);
        else state.buildNotes.push({ unit: u.id, what: `not implemented: equipment ${item.name} effect ${effect.type}${trig === "always" ? "" : ` with trigger ${trig}`}` });
      });
    });
    for (const b of u.blessings ?? []) {
      const src = { id: b.god.id, name: `${b.name} (${b.god.name} ${b.tier}-piece)` };
      if (b.tier === 4 && !b.side) state.buildNotes.push({ unit: u.id, what: `not implemented: blessing ${src.name} without a sigil_side` });
      b.effects.forEach((effect, index) => {
        const ee: EquipEffect = { owner: u, item: src, slot: b.tier, index, effect, prefix: PRAYER_PREFIX, category: "prayer" };
        const trig = effect.trigger ?? "always";
        const kind = blessingKind(effect); // the validator rejects null (E_EFFECT_TRIGGER)
        if (kind === "mod" && effect.type === "modify_stat") state.equipment.mods.push({ ...ee, effect, inst: null, blocked: false });
        else if (kind === "ignore_guard") state.equipment.ignoreGuard.push(ee);
        else if (kind === "hit") state.equipment.hitMods.push(ee);
        else if (kind === "reaction") subscribeBlessing(state, ee);
        else if (kind === "standing") state.equipment.preBattle.push(ee);
        else state.buildNotes.push({ unit: u.id, what: `not implemented: blessing ${src.name} effect ${effect.type}${trig === "always" ? "" : ` with trigger ${trig}`}` });
      });
    }
  }
}

const fmt = (e: ModifyStat): string => `${e.stat} ${e.value >= 0 ? "+" : ""}${e.value}${e.mode === "percent" ? "%" : ""}`;

function logOn(x: ExecCtx, m: EquipMod, inst: StatusInstance): void {
  const { state, log } = x;
  const base = { ...at(state), unit: m.owner.id, name: m.item.name, status: inst.statusId, category: inst.category, effect: fmt(m.effect) };
  if (m.prefix === PRAYER_PREFIX) log.emit({ type: "blessing_applied", ...base, god: m.item.id });
  else log.emit({ type: "equipment_applied", ...base, item: m.item.id });
}

function logOff(x: ExecCtx, m: EquipMod, inst: StatusInstance, reason: "condition" | "death"): void {
  const { state, log } = x;
  const base = { ...at(state), unit: m.owner.id, name: m.item.name, status: inst.statusId, reason };
  if (m.prefix === PRAYER_PREFIX) log.emit({ type: "blessing_removed", ...base, god: m.item.id });
  else log.emit({ type: "equipment_removed", ...base, item: m.item.id });
}

/** Puts on the modify_stat item and blessing effects whose condition holds and takes off the ones whose condition ended. */
export function checkEquipment(x: ExecCtx): void {
  const { state, log } = x;
  for (const m of state.equipment.mods) {
    const { owner, item, effect } = m;
    if (!owner.alive) { // a dead wearer's item modifiers come off
      if (m.inst) {
        const inst = m.inst;
        owner.statuses = owner.statuses.filter((s) => s !== inst);
        m.inst = null;
        logOff(x, m, inst, "death");
      }
      continue;
    }
    let holds = true;
    if (effect.condition) {
      const r = evaluateCondition(effect.condition, { state, self: owner });
      const unknown = [...new Set(r.reasons.filter((s) => s.startsWith("not implemented")))];
      if (!r.value && unknown.length) {
        if (!m.blocked) log.emit({ type: "not_implemented", ...at(state), unit: owner.id, what: `not implemented: ${m.prefix === PRAYER_PREFIX ? "blessing" : "equipment"} ${item.name} condition (${unknown.join("; ")})` });
        m.blocked = true;
      } else m.blocked = false;
      holds = r.value;
    }
    if (holds && !m.inst) {
      const inst: StatusInstance = {
        statusId: `${m.prefix}${item.id}:${m.slot}:${m.index}`, category: effect.source_category ?? m.category, sourceUnitId: owner.id, remaining: null, skipNextTick: false,
        seq: state.statusSeq++, inline: { name: item.name, modifiers: [{ stat: effect.stat, mode: effect.mode, value: effect.value, ...(effect.stacks ? { stacks: true as const } : {}) }] },
      };
      owner.statuses.push(inst);
      m.inst = inst;
      logOn(x, m, inst);
    } else if (!holds && m.inst) {
      const inst = m.inst;
      owner.statuses = owner.statuses.filter((s) => s !== inst);
      m.inst = null;
      logOff(x, m, inst, "condition");
    }
  }
}

/** True when a blessing ignore_guard of `attacker` is active right now (its condition judged from the attacker). */
export function ignoresGuard(state: BattleState, attacker: Unit): boolean {
  return state.equipment.ignoreGuard.some((ee) => ee.owner === attacker && attacker.alive && evaluateCondition(ee.effect.condition, { state, self: attacker }).value);
}

/** The blessing hit modifiers of `type` on `unit` active right now (each condition judged from the unit). */
export function hitMods<T extends "ignore_defense" | "damage_bonus" | "crit_damage">(state: BattleState, unit: Unit, type: T): Extract<Effect, { type: T }>[] {
  return state.equipment.hitMods.flatMap((ee) => (ee.owner === unit && ee.effect.type === type && evaluateCondition(ee.effect.condition, { state, self: unit }).value ? [ee.effect as Extract<Effect, { type: T }>] : []));
}

/** The current action's hit events by `actor` on the blessing's wearer for which the effect's condition holds (each in its own event context). */
function actionHits(state: BattleState, ee: EquipEffect, actor: Unit): EventCtx[] {
  return state.bus.history.slice(state.bus.actionStart).filter((e) => {
    if (e.bus !== "before_hit" && e.bus !== "after_hit" && e.bus !== "dodge") return false;
    const h = e.payload as BusPayloads["before_hit"];
    return h.attacker === actor && h.defender === ee.owner && evaluateCondition(ee.effect.condition, { state, self: ee.owner, event: e }).value;
  });
}

/** reflect_damage: floor(percent% of the HP lost to the matching hits). */
function reflected(state: BattleState, ee: EquipEffect, actor: Unit): number {
  if (ee.effect.type !== "reflect_damage") return 0;
  const taken = actionHits(state, ee, actor).filter((e) => e.bus === "after_hit").reduce((n, e) => { const h = e.payload as BusPayloads["after_hit"]; return n + (h.lost ?? h.amount); }, 0);
  return Math.floor((ee.effect.percent / 100) * taken + 1e-9);
}

/** A blessing reaction (see the header): after each non-idle action of another unit that hit (or, for on_event effects, targeted) the wearer. */
function subscribeBlessing(state: BattleState, ee: EquipEffect): void {
  const { owner, item, effect } = ee;
  const skill: EffectSkill = { id: item.id, name: item.name, shape: effect.type === "damage" ? "attacker" : "self", interactions: { guard: "standard", soldiers: "standard" }, trigger: effect.trigger ?? "on_event" };
  const plain = { ...effect, condition: null };
  const run = { applier: ee.category, inAction: false };
  // shortcut: only a top-level on_death leaf is seen here (nested in all / any it never fires); fine while Gift ATK is the only one.
  const leaf = EVENT_SPECS[(effect.condition as { type?: string } | null | undefined)?.type ?? ""];
  if (leaf?.bus === "on_death") {
    return void state.bus.subscribe({
      event: "on_death", id: item.name, owner, order: DEVOTION_ORDER, effect: effect.type,
      match: (p) => leaf.match(owner, { bus: "on_death", payload: p }),
      run: (_p, x) => runEffect(x, owner, skill, plain, [owner], new Set([owner]), false, run),
    });
  }
  state.bus.subscribe({
    event: "after_action", id: item.name, owner, order: DEVOTION_ORDER, effect: effect.type, evenIfOwnerDead: effect.type === "reflect_damage",
    match: (p) =>
      !p.idle && p.actor !== owner && (effect.type === "reflect_damage" ? p.actor.alive && reflected(state, ee, p.actor) > 0 : (effect.type !== "damage" || p.actor.alive) && actionHits(state, ee, p.actor).length > 0),
    run: (p, x) => {
      if (effect.type === "damage_bonus") return void (owner.attackCharge = effect.percent);
      if (effect.type === "damage") {
        for (const _ of actionHits(state, ee, p.actor)) if (p.actor.alive && owner.alive) runEffect(x, owner, skill, plain, [p.actor], new Set([owner]), false, run);
        return;
      }
      if (effect.type !== "reflect_damage") return void runEffect(x, owner, skill, plain, [owner], new Set([owner]), false, run);
      const amount = reflected(state, ee, p.actor);
      const d: DamageBreakdown = { landed: true, scaled: 0, matchup: 1, power: amount, defense: 0, base: amount, crit: false, guard: false, guardFactor: 1, amount };
      const meta = { single: true, noEvent: true };
      if (p.actor.kind === "squad") {
        const s = lowestHpSoldier(p.actor);
        if (s) applySoldierDamage(x, owner, p.actor, s, { id: item.name }, d, undefined, meta);
      } else applyDamage(x, owner, p.actor, { id: item.name }, d, undefined, meta);
    },
  });
}

export type EquipPreBattleStep = "equipment" | "buff_removal" | "debuffs";

/** The pre-battle step a pre_battle item effect runs in (see the header). */
export function equipStepOf(state: BattleState, e: Effect): EquipPreBattleStep {
  if (e.type === "remove_buffs") return "buff_removal";
  if (e.type === "apply_status") {
    const st = state.pack.byId.statuses.get(e.status_id);
    if (st && isDebuffStatus(st)) return "debuffs";
  }
  return "equipment";
}

/** Pre-battle `step`: the pre_battle item effects (and standing blessing reductions) of living heroes that belong to it run once. */
export function runPreBattleEquipment(x: ExecCtx, step: EquipPreBattleStep): void {
  const { state, log } = x;
  for (const ee of state.equipment.preBattle) {
    if (!ee.owner.alive || equipStepOf(state, ee.effect) !== step) continue;
    log.emit({ type: "trigger", ...at(state), source: ee.owner.id, handler: ee.item.name, event: "pre_battle", subject: ee.owner.id, effect: ee.effect.type });
    const skill = { id: ee.item.id, name: ee.item.name, shape: "self", interactions: { guard: "standard" as const, soldiers: "standard" as const }, trigger: "pre_battle" };
    runEffect(x, ee.owner, skill, ee.effect, [ee.owner], new Set([ee.owner]), false, { applier: ee.category, inAction: false });
  }
}
