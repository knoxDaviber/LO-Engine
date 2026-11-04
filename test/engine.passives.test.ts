// Hero passives (roadmap 3a, design Sections 4.4, 7, 14 and 17): triggers, Passive PP and "used" semantics, timing, per-hit-once, event
// leaves, state passives, pre-battle passives and cover (Decision 116).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyDamage, applyHeal, applySoldierDamage, applyStatus, beginPhase, checkStatePassives, createBattleState, evaluateCondition, executeSquadAction, runBattle, runEffect, scheduleInitial,
  type BattleEvent, type DamageBreakdown, type ExecCtx, type Unit,
} from "../src/engine";
import { loadPack } from "../src/load";
import { battleSchema, type Battle, type Skill } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, tactic } from "./engineHelpers";

const QUICK_GUARD = "skl_passive_001", HEGEMONY = "skl_passive_002", QUICK_HEAL = "skl_passive_003", PREV_CARE = "skl_passive_004";
const FOLLOW_UP = "skl_018", PURSUIT = "skl_019", COUNTER = "skl_020", FRENZY = "skl_021";
const ASSAULT = "skl_cav_active_001"; // single target, physical melee
const SQ_C = `squad_${LEON}`, SQ_D = `squad_${EMPEROR}`;

const counting = (): ExecCtx["rng"] => {
  let n = 0;
  return { next: () => (n++, 0.999999), int: (k) => (n++, Math.floor(0.999999 * k)), get draws() { return n; } };
};

/** Puts the skill on the hero's skill list (if missing) and enabled on its tactic sheet. */
function addPassive(pack: Pack, battle: Battle, hero: string, skillId: string): void {
  const ch = pack.byId.characters.get(hero)!;
  if (!ch.skills.includes(skillId)) ch.skills.push(skillId);
  const entry = [...battle.challenger.heroes, ...battle.defender.heroes].find((h) => h.char_id === hero)!;
  entry.tactic_sheet.push(tactic(skillId, { priority: 10 + entry.tactic_sheet.length }));
}

/** Real sample with real squads (switched off unless `squads`); every hit lands, nothing crits or guards. */
function setup(passives: [string, string][], opts: { squads?: boolean; over?: (pack: Pack, battle: Battle) => void } = {}) {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  opts.over?.(pack, battle);
  for (const [hero, sk] of passives) addPassive(pack, battle, hero, sk);
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: counting(), log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  if (!opts.squads) { u(SQ_C).alive = false; u(SQ_D).alive = false; }
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  /** One attacking action: `attacker` uses the first effect of `skillId` on `target` (shape override for area tests). */
  const strike = (attacker: Unit, target: Unit, skillId = ASSAULT, shape = "single") => {
    const sk = pack.byId.skills.get(skillId)!;
    state.bus.beginAction();
    runEffect(x, attacker, { id: sk.id, name: sk.name, shape, interactions: sk.interactions }, sk.effects[0]!, [target], new Set(), false);
  };
  return { pack, battle, state, log, x, u, ev, strike };
}

const amountOf = (n: number): DamageBreakdown => ({ landed: true, scaled: 0, matchup: 1, power: 0, defense: 0, base: n, crit: false, guard: false, guardFactor: 1, amount: n });

test("Quick Guard resolves before the hit: it spends 1 Passive PP and the same hit takes 50% less damage", () => {
  const plain = setup([]);
  plain.strike(plain.u(EMPEROR), plain.u(LEON));
  const full = plain.ev("damage")[0]!.amount;

  const { u, ev, log, strike } = setup([[LEON, QUICK_GUARD]]);
  const ppBefore = u(LEON).pp.passive.cur;
  strike(u(EMPEROR), u(LEON));
  const types = log.events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 4), ["trigger", "pp_spend", "damage_reduction", "roll"]); // before the hit roll
  assert.deepEqual(ev("trigger").map((t) => [t.source, t.event, t.handler]), [[LEON, "before_hit", "Quick Guard"]]);
  assert.equal(u(LEON).pp.passive.cur, ppBefore - 1);
  const d = ev("damage")[0]!;
  assert.deepEqual(d.reductions, [50]);
  assert.equal(d.amount, Math.max(1, Math.floor(full * 0.5)));
});

test("a passive without enough Passive PP does not fire and logs why", () => {
  const { u, ev, strike } = setup([[LEON, QUICK_GUARD]]);
  u(LEON).pp.passive.cur = 0;
  strike(u(EMPEROR), u(LEON));
  assert.deepEqual(ev("passive_blocked").map((e) => [e.unit, e.skill, e.reason]), [[LEON, QUICK_GUARD, "not enough Passive PP (0 < 1)"]]);
  assert.equal(ev("pp_spend").length, 0);
  assert.equal(ev("damage_reduction").length, 0);
  assert.equal(ev("damage")[0]!.reductions, undefined);
});

test("a passive that is not enabled on the tactic sheet never runs", () => {
  const { u, ev, strike } = setup([], { over: (_p, b) => b.challenger.heroes[0]!.tactic_sheet.push(tactic(QUICK_GUARD, { priority: 9, enabled: false })) });
  const ppBefore = u(LEON).pp.passive.cur;
  strike(u(EMPEROR), u(LEON)); // Leon owns Quick Guard, but it is disabled on his sheet
  assert.equal(ev("trigger").length, 0);
  assert.equal(u(LEON).pp.passive.cur, ppBefore);
});

test("Quick Heal resolves after a single-target hit on an ally, healing that ally; not after an area hit or a hit on an enemy", () => {
  const { u, ev, log, strike } = setup([[JASMINE, QUICK_HEAL]]);
  const ppBefore = u(JASMINE).pp.passive.cur;
  strike(u(LEON), u(EMPEROR));
  const types = log.events.map((e) => e.type);
  assert.ok(types.indexOf("damage") < types.indexOf("trigger"));
  assert.deepEqual(ev("trigger").map((t) => [t.source, t.event, t.subject]), [[JASMINE, "after_hit", EMPEROR]]);
  assert.deepEqual(ev("heal").map((h) => [h.unit, h.target, h.skill]), [[JASMINE, EMPEROR, QUICK_HEAL]]);
  assert.equal(u(EMPEROR).hp, u(EMPEROR).maxHp); // 1.5 x INT 100 = 150 covers the hit
  assert.equal(u(JASMINE).pp.passive.cur, ppBefore - 1);
  strike(u(LEON), u(EMPEROR), ASSAULT, "row"); // an area hit is not a single-target attack
  strike(u(EMPEROR), u(LEON)); // Leon is not Jasmine's ally
  assert.equal(ev("trigger").length, 1);
});

test("Follow-Up and Pursuit strike the unit hit by a landed single-target attack (owner first, then the ally), once each", () => {
  const { u, ev, strike } = setup([[LEON, FOLLOW_UP], [LIEF, PURSUIT]]);
  const before = [u(LEON).pp.passive.cur, u(LIEF).pp.passive.cur];
  strike(u(LEON), u(EMPEROR));
  assert.deepEqual(ev("damage").map((d) => [d.unit, d.skill, d.target]), [[LEON, ASSAULT, EMPEROR], [LEON, FOLLOW_UP, EMPEROR], [LIEF, PURSUIT, EMPEROR]]);
  assert.deepEqual([u(LEON).pp.passive.cur, u(LIEF).pp.passive.cur], before.map((n) => n - 1));
});

test("Counter fires once per squad attack (one combined hit) and strikes the attacking squad", () => {
  const { state, u, ev, x } = setup([[EMPEROR, COUNTER]], { squads: true });
  scheduleInitial(state);
  u(SQ_D).alive = false; // the Emperor is the squad's target
  u(EMPEROR).hp = 5000;
  const ppBefore = u(EMPEROR).pp.passive.cur;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, u(SQ_C));
  assert.equal(ev("damage").filter((d) => d.unit === SQ_C).length, 1); // the one combined hit lands
  assert.deepEqual(ev("trigger").map((t) => [t.source, t.handler, t.event]), [[EMPEROR, "Counter", "after_hit"]]);
  assert.deepEqual(ev("damage").filter((d) => d.skill === COUNTER).map((d) => d.target), [SQ_C]);
  assert.equal(u(EMPEROR).pp.passive.cur, ppBefore - 1);
});

test("Hegemony resolves before the attack: the attacker loses its buffs and gets Defense Down (passive category)", () => {
  const { pack, u, ev, log, strike, state } = setup([[EMPEROR, HEGEMONY]]);
  applyStatus(state, u(LEON), "buff_005", "active", LEON);
  const ppBefore = u(EMPEROR).pp.passive.cur;
  strike(u(LEON), u(EMPEROR));
  const types = log.events.map((e) => e.type);
  assert.ok(types.indexOf("status_applied") < types.indexOf("roll"));
  assert.deepEqual(ev("status_applied").map((e) => [e.unit, e.status, e.category]), [[LEON, "debuff_001", "passive"]]);
  assert.deepEqual(ev("status_expired").map((e) => [e.unit, e.status, e.reason]), [[LEON, "buff_005", "removed"]]);
  assert.equal(u(EMPEROR).pp.passive.cur, ppBefore - pack.byId.skills.get(HEGEMONY)!.pp_cost);
});

test("state passive (Frenzy): spends on activation, ends with its status when the condition ends, spends again when it returns", () => {
  const { u, ev, x } = setup([[LIEF, FRENZY]]);
  const lief = u(LIEF);
  lief.pp.passive.cur = 4;
  applyDamage(x, u(LEON), lief, { id: "s" }, amountOf(lief.maxHp - 420)); // 420 / 800 HP: still above 50%
  assert.equal(ev("trigger").length, 0);
  applyDamage(x, u(LEON), lief, { id: "s" }, amountOf(30)); // 390 / 800: below 50%
  assert.deepEqual(ev("trigger").map((t) => [t.source, t.event]), [[LIEF, "while_condition"]]);
  assert.equal(lief.pp.passive.cur, 2);
  assert.ok(lief.statuses.some((s) => s.statusId === "status_004" && s.category === "passive"));
  applyDamage(x, u(LEON), lief, { id: "s" }, amountOf(5)); // still below: no new spend
  assert.equal(lief.pp.passive.cur, 2);
  applyHeal(x, u(JASMINE), lief, { id: "h" }, 100); // back above 50%
  assert.deepEqual(ev("passive_ended").map((e) => [e.unit, e.skill]), [[LIEF, FRENZY]]);
  assert.deepEqual(ev("status_expired").map((e) => [e.status, e.reason]), [["status_004", "condition"]]);
  assert.ok(!lief.statuses.some((s) => s.statusId === "status_004"));
  applyDamage(x, u(LEON), lief, { id: "s" }, amountOf(lief.hp - 30)); // below again: spends again
  assert.equal(lief.pp.passive.cur, 0);
  assert.equal(ev("trigger").length, 2);
  applyHeal(x, u(JASMINE), lief, { id: "h" }, 500);
  applyDamage(x, u(LEON), lief, { id: "s" }, amountOf(lief.hp - 30)); // third time: no PP left, logged once
  checkStatePassives(x);
  assert.deepEqual(ev("passive_blocked").map((e) => e.reason), ["not enough Passive PP (0 < 2)"]);
});

test("pre_battle passive (Preventative Care) fires in the buff_grants step, spends PP, and its 1-turn statuses do not skip the wearer's first tick", () => {
  const { pack, battle } = loadReal();
  addPassive(pack, battle, JASMINE, PREV_CARE);
  const ppBefore = pack.byId.characters.get(JASMINE)!.pp.passive;
  const log = new EventLog();
  const { state } = beginPhase(pack, battle, 1, null, log);
  const jas = state.units.find((v) => v.id === JASMINE)!;
  assert.equal(jas.pp.passive.cur, ppBefore - pack.byId.skills.get(PREV_CARE)!.pp_cost);
  const trig = log.events.filter((e) => e.type === "trigger");
  assert.deepEqual(trig.map((t) => (t as any).event), ["pre_battle"]);
  const applied = log.events.filter((e): e is Extract<BattleEvent, { type: "status_applied" }> => e.type === "status_applied");
  assert.deepEqual(applied.map((e) => [e.unit, e.status, e.category]).sort(), [
    [EMPEROR, "buff_001", "passive"], [EMPEROR, "buff_002", "passive"], [JASMINE, "buff_001", "passive"], [JASMINE, "buff_002", "passive"],
  ]); // heroes only: an all-allies status skips the squad
  assert.ok(jas.statuses.every((s) => !s.skipNextTick));
});

test("event leaves are true in a matching event context, from the actor's point of view; outside an event they read the actor's window", () => {
  const { state, u } = setup([]);
  const payload = { attacker: u(LEON), defender: u(EMPEROR), skillId: "s", damageType: "physical" as const, range: "melee" as const, single: true };
  const event = { bus: "before_hit" as const, payload };
  const ev = (type: string, self: Unit) => evaluateCondition({ type }, { state, self, event }).value;
  assert.equal(ev("self_attacked", u(EMPEROR)), true);
  assert.equal(ev("self_attacked", u(JASMINE)), false);
  assert.equal(ev("ally_attacked", u(JASMINE)), true);
  assert.equal(ev("self_targeted_by_physical_attack", u(EMPEROR)), true);
  assert.equal(ev("self_hit_by_melee", u(EMPEROR)), true);
  assert.equal(ev("unit_hit_by_single_target_attack", u(LIEF)), true);
  assert.equal(ev("self_landed_single_target_hit", u(LEON)), false); // a before_hit has not landed
  const landed = { bus: "after_hit" as const, payload: { ...payload, amount: 1, killed: false } };
  assert.equal(evaluateCondition({ type: "self_landed_single_target_hit" }, { state, self: u(LEON), event: landed }).value, true);
  assert.equal(evaluateCondition({ type: "ally_landed_single_target_hit" }, { state, self: u(LIEF), event: landed }).value, true);
  assert.deepEqual(evaluateCondition({ type: "self_attacked" }, { state, self: u(EMPEROR) }), { value: false, reasons: [] }); // nothing happened yet
});

test("cover (Decision 116): a cover passive takes a single-target hit aimed at an ally; an area hit is not intercepted", () => {
  const coverSkill = (p: Pack): void => {
    const qg = p.byId.skills.get(QUICK_GUARD)!;
    const sk: Skill = { ...structuredClone(qg), id: "skl_test_cover", name: "Cover", trigger_event: "ally_attacked", default_activation: null, effects: [{ type: "cover" }] };
    p.byId.skills.set(sk.id, sk);
  };
  const { u, ev, strike } = setup([[LIEF, "skl_test_cover"]], { over: coverSkill });
  const leonHp = u(LEON).hp, ppBefore = u(LIEF).pp.passive.cur;
  strike(u(EMPEROR), u(LEON));
  assert.deepEqual(ev("cover").map((c) => [c.unit, c.ally, c.attacker]), [[LIEF, LEON, EMPEROR]]);
  assert.deepEqual(ev("damage").map((d) => d.target), [LIEF]);
  assert.equal(u(LEON).hp, leonHp);
  assert.equal(u(LIEF).pp.passive.cur, ppBefore - 1);
  strike(u(EMPEROR), u(LEON), ASSAULT, "row");
  assert.equal(ev("cover").length, 1);
  assert.deepEqual(ev("damage").map((d) => d.target), [LIEF, LEON]);
});

test("full4v4 with every hero's passives on its sheet runs to completion and is deterministic", () => {
  const run = () => {
    const { pack } = loadReal({ squads: true, auras: true });
    const raw = (loadPack("content").battles ?? []).find((b) => b.name === "full4v4.yaml")!.data;
    const battle = battleSchema.parse(raw);
    for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) {
      for (const id of pack.byId.characters.get(h.char_id)!.skills) if (pack.byId.skills.get(id)!.category === "passive") addPassive(pack, battle, h.char_id, id);
    }
    return runBattle(pack, battle);
  };
  const a = run();
  assert.ok(a.events.some((e) => e.type === "pp_spend" && e.pool === "passive"));
  assert.ok(!a.events.some((e) => e.type === "not_implemented" && e.what.startsWith("not implemented: passive ")));
  assert.equal(JSON.stringify(run().events), JSON.stringify(a.events));
});

test("damage to a squad re-checks while_condition statuses (applySoldierDamage calls checkStatePassives, like applyDamage)", () => {
  const { state, u, x, ev } = setup([], { squads: true });
  const sq = u(SQ_D);
  applyStatus(state, sq, "status_002", "active", sq.id);
  sq.statuses[0]!.whileCond = { cond: { type: "hp_percent", side: "self", op: "=", value: 100 }, owner: sq.id };
  applySoldierDamage(x, u(LEON), sq, sq.soldiers[0]!, { id: "s" }, amountOf(5));
  assert.equal(sq.statuses.length, 0);
  assert.deepEqual(ev("status_expired").map((e) => [e.unit, e.reason]), [[sq.id, "condition"]]);
});
