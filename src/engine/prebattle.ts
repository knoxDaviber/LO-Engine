// Pre-battle resolution (design Section 9 priority list, roadmap 2.5). Runs at the start of every phase, after leader succession and before the
// initial scheduling, as an ordered list of named steps:
//   1 equipment         item modify_stat effects (equipment category; conditional ones on while their condition holds) and pre_battle item
//                       effects that are not debuffs (equipment.ts); flat lines and PP bonuses are already in the unit (state.ts)
//   2 terrain           the battlefield's modifiers on every living hero and squad of the listed classes, both sides (`terrain` stacking category)
//   3 buff_grants       buff-granting pre_battle hero passives (spend PP, passives.ts), then ally / faction / field-ally leader auras (positive
//                       modifiers), then the first check of while_condition passives (HP carries over between phases, so Frenzy can start on)
//   4 immunity          pre_battle passives that grant a blocks_debuffs status (Preventative Care: Immunity + Regen), after the grants and before
//                       the debuffs so Immunity can block enemy-debuff auras
//   5 buff_removal      pre_battle passives (then items) with remove_buffs; may strip Immunity before step 6
//   6 debuffs           enemy-debuff auras (and negative modifiers of any aura; a unit with Immunity resists them, `status_blocked`), then
//                       debuff pre_battle passives (debuff statuses or enemy targets), then debuff pre_battle item effects (Strange Box: field
//                       Confusion), which Immunity blocks the same way
// Which step a pre_battle passive takes: passives.ts preBattleStepOf.
//   7 event_auras       subscribes event-triggered auras (Jasmine) on the bus; they do nothing until their event fires
//   8 spd_finalization  marker: the initial scheduling (`scheduleInitial`) reads the final SPD right after the steps
//
// Leader auras [DECIDED, Section 2]: only the side's current leader's aura counts, and only while `leaders[side].auraActive`. No PP, no "used" state.
// Always-on aura modifiers are put on units as status instances in the `passive` stacking category (`StatusInstance.inline`, statusId `aura:<leader>:<n>`),
// so the normal stacking rules and the squad's sharing of its leader's statuses apply. They are never ticked or cleared mid-phase except by the leader's
// death (`removeAuras`); the next phase builds fresh units and applies the aura again for the (possibly new) leader.
// Terrain: like aura modifiers, inline status instances (statusId `terrain:<id>:<n>`, category `terrain`) that last the whole phase and are never
// ticked; a unit's class decides (a squad's class is its soldier type's). Terrain is not an aura, so a leader's death never removes it.
// Aquatic trait (3d, Decision 126): on a `water` terrain every aquatic hero and squad (by its own class) also gets SPD +aquatic_water_spd_bonus%
// (rules.class_traits; null = off) the same way, statusId `terrain:<id>:water`, terrain category.
// [DEFAULT] An aura's `condition` is checked at phase start (always auras) or when its event fires (event auras). [DEFAULT] "Fielded" in
// party_has_hero means a living hero of the side at that moment.
// Not implemented (logged, never dropped): aura effects other than modify_stat on always auras, anything but heal on event auras, trigger events
// other than self_action_completed, a faction_buff without faction_id, effects carrying their own trigger/condition on always auras.
import type { Character, Effect } from "../schema";
import { evaluateCondition } from "./conditions";
import type { ExecCtx } from "./damage";
import { runEffect } from "./damage";
import type { EventSink } from "./log";
import { at } from "./log";
import { checkStatePassives, runPreBattlePassives } from "./passives";
import { checkEquipment, runPreBattleEquipment } from "./equipment";
import type { Rng } from "./rng";
import { createRng } from "./rng";
import { immunityOf } from "./stats";
import type { BattleState, Side, StatusInstance, Unit } from "./state";
import { otherSide, targetsOf } from "./state";

export const AURA_ORDER = 50; // bus order: after engine handlers (0), before soldier skills (100)
export const AURA_PREFIX = "aura:";
export const TERRAIN_PREFIX = "terrain:";

type Aura = Character["leader_aura"];
type LeaderAura = { side: Side; leader: Unit; aura: Aura };

export interface PreBattleCtx {
  state: BattleState;
  log: EventSink;
  /** The phase rng (pre-battle passives may roll); a fixed stream when none is given. */
  rng?: Rng;
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

const fmt = (e: { stat: string; mode: "flat" | "percent"; value: number }): string => `${e.stat} ${e.value >= 0 ? "+" : ""}${e.value}${e.mode === "percent" ? "%" : ""}`;

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
        const imm = e.value < 0 ? immunityOf(state, t) : undefined;
        if (imm) { // Immunity blocks a negative aura modifier
          log.emit({ type: "status_blocked", ...at(state), unit: t.id, status: `${AURA_PREFIX}${leader.id}:${i}`, source: leader.id, by: imm.statusId });
          continue;
        }
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

/** Puts the battlefield's modifiers on every living hero and squad (both sides) whose class is listed. */
function applyTerrain(c: PreBattleCtx): void {
  const { state, log } = c;
  const terrain = state.battlefield ? state.pack.byId.terrains.get(state.battlefield) : undefined;
  if (!terrain) return;
  terrain.modifiers.forEach((m, i) => {
    for (const side of ["challenger", "defender"] as const) {
      for (const u of targetsOf(state, side)) {
        if (!m.classes.includes(u.class)) continue;
        const inst: StatusInstance = {
          statusId: `${TERRAIN_PREFIX}${terrain.id}:${i}`, category: "terrain", sourceUnitId: u.id, remaining: null, skipNextTick: false, seq: state.statusSeq++,
          inline: { name: terrain.name, modifiers: [{ stat: m.stat, mode: m.mode, value: m.value }] },
        };
        u.statuses.push(inst);
        log.emit({ type: "terrain_applied", ...at(state), terrain: terrain.id, name: terrain.name, unit: u.id, status: inst.statusId, category: "terrain", effect: fmt(m) });
      }
    }
  });
  const bonus = state.pack.rules.class_traits.aquatic_water_spd_bonus;
  if (terrain.water !== true || bonus === null) return;
  const m = { stat: "SPD" as const, mode: "percent" as const, value: bonus };
  for (const side of ["challenger", "defender"] as const) {
    for (const u of targetsOf(state, side)) {
      if (u.class !== "aquatic") continue;
      const inst: StatusInstance = {
        statusId: `${TERRAIN_PREFIX}${terrain.id}:water`, category: "terrain", sourceUnitId: u.id, remaining: null, skipNextTick: false, seq: state.statusSeq++,
        inline: { name: `${terrain.name} (water)`, modifiers: [m] },
      };
      u.statuses.push(inst);
      log.emit({ type: "terrain_applied", ...at(state), terrain: terrain.id, name: `${terrain.name} (water)`, unit: u.id, status: inst.statusId, category: "terrain", effect: fmt(m) });
    }
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
  { name: "equipment", run: (c) => { checkEquipment(execCtx(c)); runPreBattleEquipment(execCtx(c), "equipment"); } },
  { name: "terrain", run: applyTerrain },
  { name: "buff_grants", run: (c) => { runPreBattlePassives(execCtx(c), "buff_grants"); grantAlways(c, false); checkStatePassives(execCtx(c)); } },
  { name: "immunity", run: (c) => runPreBattlePassives(execCtx(c), "immunity") },
  { name: "buff_removal", run: (c) => { runPreBattlePassives(execCtx(c), "buff_removal"); runPreBattleEquipment(execCtx(c), "buff_removal"); } },
  { name: "debuffs", run: (c) => { grantAlways(c, true); runPreBattlePassives(execCtx(c), "debuffs"); runPreBattleEquipment(execCtx(c), "debuffs"); } },
  { name: "event_auras", run: subscribeEventAuras },
  { name: "spd_finalization", run: () => {} },
];

const execCtx = (c: PreBattleCtx): ExecCtx => ({ state: c.state, log: c.log, rng: c.rng ?? (c.rng = createRng(0)) });

/** Runs the pre-battle steps in order for a freshly built phase state. */
export function runPreBattle(state: BattleState, log: EventSink, rng?: Rng): void {
  const c: PreBattleCtx = { state, log, ...(rng ? { rng } : {}) };
  for (const step of PREBATTLE_STEPS) step.run(c);
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
