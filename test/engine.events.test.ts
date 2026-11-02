// Event system (roadmap 2.3, design Sections 7 and 14): the bus, ordering, per-hit-once, soldier skills through the bus, until_next_hit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventBus, EventLog, applyDamage, applyStatus, createBattleState, executeSkill, decideTactic, executeSquadAction, hitSquad, runBattle, scheduleInitial,
  type BattleEvent, type DamageEffect, type ExecCtx, type Unit,
} from "../src/engine";
import type { Battle, Skill } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, loadReal, tactic } from "./engineHelpers";

const counting = (): ExecCtx["rng"] => {
  let n = 0;
  return { next: () => (n++, 0.999999), int: (k) => (n++, Math.floor(0.999999 * k)), get draws() { return n; } };
};
const SQ_C = `squad_${LEON}`;
const SQ_D = `squad_${EMPEROR}`;

/** Real sample with real squads; every hit lands, nothing crits or guards. */
function setup(over?: (pack: Pack, battle: Battle) => void) {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  over?.(pack, battle);
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: counting(), log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  return { pack, battle, state, log, x, u, ev };
}
const withSoldierSkill = (effect: any, target = "self_squad") => (p: Pack) => {
  p.byId.soldiers.get("soldier_001")!.passive_effects.push({ name: "reactive", target: target as any, effects: [effect] });
};
const SKILL_ID = "soldier_001 skill 2.1";

test("an on_hit soldier skill fires once per squad attack (one combined hit, Decision 130)", () => {
  const { state, x, u, ev } = setup(withSoldierSkill({ type: "heal", percent_max_hp: 10, trigger: "on_hit" }));
  scheduleInitial(state);
  u(SQ_D).alive = false; // heroes are the targets
  const sq = u(SQ_C);
  sq.soldiers[0]!.hp = 10;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, sq);
  assert.equal(ev("damage").length, 1); // one combined hit on the Emperor
  assert.ok(ev("damage").every((e) => e.target === EMPEROR));
  const trig = ev("trigger");
  assert.deepEqual(trig.map((t) => [t.source, t.event, t.subject, t.effect]), [[SQ_C, "after_hit", EMPEROR, "heal"]]);
  assert.equal(ev("heal").length, 1); // and its effect ran through the effect executor once
  assert.equal(ev("heal")[0]!.unit, SQ_C);
  assert.equal(sq.soldiers[0]!.hp, 25); // 10% of 1530 = 153, split 15 each
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, sq); // the next attack is a new action: one more trigger
  assert.equal(ev("trigger").length, 2);
});

test("a squad attack has one target: when it kills it, the attack does not move on to the next enemy", () => {
  const { state, x, u, ev } = setup(withSoldierSkill({ type: "heal", percent_max_hp: 10, trigger: "on_hit" }));
  scheduleInitial(state);
  u(SQ_D).alive = false;
  u(EMPEROR).hp = 1;
  executeSquadAction(x, u(SQ_C));
  assert.deepEqual(ev("damage").map((e) => e.target), [EMPEROR]);
  assert.equal(u(EMPEROR).alive, false);
  assert.deepEqual(ev("trigger").map((t) => t.subject), [EMPEROR]);
});

test("an on_attack soldier skill fires once after the squad's attack, on every unit it hit", () => {
  const { state, x, u, ev } = setup(withSoldierSkill({ type: "apply_status", status_id: "debuff_002", chance_percent: 100, target: "targets", include_soldiers: false, trigger: "on_attack" }));
  scheduleInitial(state);
  u(SQ_D).alive = false;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, u(SQ_C));
  assert.deepEqual(ev("trigger").map((t) => [t.event, t.subject]), [["after_action", SQ_C]]);
  assert.deepEqual(ev("status_applied").map((e) => [e.unit, e.category]), [[EMPEROR, "soldier"]]);
});

test("reactions do not trigger reactions: an on_hit damage effect does not loop", () => {
  const dmg = { type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 1 }], multiplier: 1, ignores_guard: false, bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0, trigger: "on_hit" };
  const { state, x, u, ev } = setup(withSoldierSkill(dmg));
  scheduleInitial(state);
  u(SQ_D).alive = false;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, u(SQ_C));
  assert.equal(ev("trigger").length, 1);
  assert.equal(ev("damage").length, 2); // the squad's hit plus the one reaction hit
});

test("handlers run by order then registration, deterministically; a dead owner and a failing match do not fire", () => {
  const { state, x, u, ev } = setup();
  const calls: string[] = [];
  const bus = state.bus;
  const emp = u(EMPEROR);
  const mk = (id: string, order: number, over: object = {}) => bus.subscribe({ event: "after_action", id, owner: null, order, effect: "test", run: () => void calls.push(id), ...over });
  mk("c", 5); mk("a", 1); mk("b", 1); mk("dead", 0, { owner: u(JASMINE) }); mk("nomatch", 0, { match: () => false });
  u(JASMINE).alive = false;
  bus.beginAction();
  bus.emit(x, "after_action", { actor: emp, skillId: null, idle: true, hit: [] });
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.deepEqual(ev("trigger").map((t) => t.handler), ["a", "b", "c"]);
});

test("the bus enforces once per action per subject centrally, for any handler", () => {
  const { state, x, u } = setup();
  const bus: EventBus = state.bus;
  let n = 0;
  bus.subscribe({ event: "before_hit", id: "h", owner: null, order: 1, effect: "count", run: () => void n++ });
  const hit = (d: Unit) => ({ attacker: u(LEON), defender: d, skillId: "s" });
  bus.beginAction();
  for (let i = 0; i < 5; i++) bus.emit(x, "before_hit", hit(u(EMPEROR)));
  assert.equal(n, 1);
  bus.emit(x, "before_hit", hit(u(JASMINE))); // another defender in the same action
  assert.equal(n, 2);
  bus.beginAction();
  bus.emit(x, "before_hit", hit(u(EMPEROR)));
  assert.equal(n, 3);
});

test("on_death fires for a hero's death, with the killer", () => {
  const { state, x, u } = setup();
  const seen: string[] = [];
  state.bus.subscribe({ event: "on_death", id: "d", owner: null, order: 1, effect: "note", run: (p) => void seen.push(`${p.unit.id}<-${p.killer?.id}`) });
  const emp = u(EMPEROR);
  applyDamage(x, u(LEON), emp, { id: "s" }, { landed: true, scaled: 0, matchup: 1, power: 0, defense: 0, base: 999, crit: false, guard: false, guardFactor: 1, amount: 999 });
  assert.deepEqual(seen, [`${EMPEROR}<-${LEON}`]);
});

test("until_next_hit statuses tick once per attacking action on a squad, through the bus", () => {
  const { state, x, u, ev } = setup();
  const sq = u(SQ_D);
  applyStatus(state, sq, "status_003", "active", EMPEROR); // until_next_hit
  sq.statuses[0]!.remaining = 3;
  const skill = { id: "s", interactions: { guard: "standard", soldiers: "standard" } } as Pick<Skill, "id" | "interactions">;
  const eff: DamageEffect = { type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 0.01 }], multiplier: 1, ignores_guard: false, bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0 };
  state.bus.beginAction();
  hitSquad(x, u(LEON), sq, skill, eff, true); // area: one combined hit
  assert.equal(ev("damage").length, 1);
  assert.equal(sq.statuses[0]!.remaining, 2);
  assert.deepEqual(ev("trigger").map((t) => t.handler), ["until_next_hit"]);
  state.bus.beginAction();
  hitSquad(x, u(LEON), sq, skill, eff, false);
  assert.equal(sq.statuses[0]!.remaining, 1);
  state.bus.beginAction();
  state.bus.beginAction();
  hitSquad(x, u(LEON), sq, skill, eff, false);
  hitSquad(x, u(LEON), sq, skill, eff, false); // same action again: no second tick
  assert.equal(ev("status_expired").length, 1);
  assert.equal(sq.statuses.length, 0);
});

test("a hero skill still consumes until_next_hit on a hero (Dirge's Ire ends after the hit it guarantees)", () => {
  const { state, x, u, ev } = setup((_p, b) => { b.challenger.heroes.find((h) => h.char_id === LEON)!.tactic_sheet = [tactic("skl_cav_active_001", { targeting: { main: { type: "unit_kind", is: "hero" }, sub: null } })]; });
  applyStatus(state, u(EMPEROR), "status_003", "active", EMPEROR);
  const leon = u(LEON);
  executeSkill(x, leon, decideTactic(state, leon, x.rng));
  assert.equal(u(EMPEROR).statuses.length, 0);
  assert.deepEqual(ev("status_expired").map((e) => e.reason), ["hit"]);
});

test("the whole sample battle is deterministic with triggers in the log", () => {
  const run = () => {
    const { pack, battle } = loadReal({ squads: true });
    withSoldierSkill({ type: "heal", percent_max_hp: 5, trigger: "on_hit" })(pack);
    return runBattle(pack, battle);
  };
  const a = run();
  assert.equal(JSON.stringify(a), JSON.stringify(run()));
  const trig = a.events.filter((e) => e.type === "trigger");
  assert.ok(trig.length > 0);
  const attacks = a.events.filter((e) => e.type === "squad_attack").length;
  assert.ok(trig.filter((e) => (e as any).event === "after_hit" && (e as any).handler === SKILL_ID).length <= attacks * 4); // a few defenders per attack at most, never one per hit
});
