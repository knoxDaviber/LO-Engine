// Status flags and the pre-battle order (roadmap 3a part 2; design Sections 6, 7, 9 and 17): Stun pushback, Confusion, Regen, Fairy's Grace,
// Immunity, buff removal, removes_on_hit and while_condition removal.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyDamage, applyHeal, applyStatus, beginPhase, checkStatePassives, createBattleState, delayPending, executeSquadAction, preBattleStepOf,
  runEffect, runPhase, scheduleInitial, scheduleNext, rescheduleOnSpdChange,
  type BattleEvent, type DamageBreakdown, type ExecCtx, type Unit,
} from "../src/engine";
import type { Battle, Skill } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, tactic } from "./engineHelpers";

const PREV_CARE = "skl_passive_004"; // pre_battle: Immunity + Regen on all allies
const SQ_C = `squad_${LEON}`, SQ_D = `squad_${EMPEROR}`;
const amountOf = (n: number): DamageBreakdown => ({ landed: true, scaled: 0, matchup: 1, power: 0, defense: 0, base: n, crit: false, guard: false, guardFactor: 1, amount: n });

/** Puts the skill on the hero's skill list (if missing) and enabled on its tactic sheet. */
function addPassive(pack: Pack, battle: Battle, hero: string, skillId: string): void {
  const ch = pack.byId.characters.get(hero)!;
  if (!ch.skills.includes(skillId)) ch.skills.push(skillId);
  const entry = [...battle.challenger.heroes, ...battle.defender.heroes].find((h) => h.char_id === hero)!;
  entry.tactic_sheet.push(tactic(skillId, { priority: 10 + entry.tactic_sheet.length }));
}

/** A test-only pre_battle passive (cloned from Preventative Care) with the given effects and targeting. */
function prePassive(pack: Pack, id: string, effects: unknown[], targeting: Partial<Skill["targeting"]> = { side: "self", shape: "self" }): string {
  const sk = structuredClone(pack.byId.skills.get(PREV_CARE)!);
  pack.byId.skills.set(id, { ...sk, id, name: id, pp_cost: 0, effects: effects as Skill["effects"], targeting: { ...sk.targeting, ...targeting } });
  return id;
}

function phase1(pack: Pack, battle: Battle) {
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  const u = (id: string) => p.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  return { ...p, log, u, ev };
}

/** Sample state with real squads (off unless `squads`); every hit lands, nothing crits or guards. */
function fight(opts: { squads?: boolean } = {}) {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: { next: () => 0.999999, int: (k) => Math.floor(0.999999 * k), draws: 0 }, log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  if (!opts.squads) { u(SQ_C).alive = false; u(SQ_D).alive = false; }
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const strike = (attacker: Unit, target: Unit, skillId = "skl_cav_active_001") => {
    const sk = pack.byId.skills.get(skillId)!;
    state.bus.beginAction();
    runEffect(x, attacker, { id: sk.id, name: sk.name, shape: "single", interactions: sk.interactions }, sk.effects[0]!, [target], new Set(), false);
  };
  return { pack, state, log, x, u, ev, strike };
}

const STUN = { type: "apply_status", status_id: "status_001", chance_percent: 100, target: "targets", include_soldiers: false } as const;

// ------------------------------------------------------------------ Stun

test("Stun pushes the pending action back by stun_pushback_counts whatever the SPD; no action or PP is lost", () => {
  const { state, x, u, ev } = fight();
  const leon = u(LEON), emp = u(EMPEROR);
  leon.baseStats.SPD += 30;
  scheduleInitial(state);
  assert.notEqual(state.timeline.pending.get(LEON)!.interval, state.timeline.pending.get(EMPEROR)!.interval); // different SPD
  const before = { leon: state.timeline.pending.get(LEON)!.due, emp: state.timeline.pending.get(EMPEROR)!.due, pp: emp.pp.active.cur };
  const sk = { id: "s", name: "s", shape: "single", interactions: { guard: "standard" as const, soldiers: "standard" as const } };
  runEffect(x, emp, sk, STUN, [leon], new Set(), false);
  runEffect(x, leon, sk, STUN, [emp], new Set(), false);
  assert.equal(state.timeline.pending.get(LEON)!.due, before.leon + 15);
  assert.equal(state.timeline.pending.get(EMPEROR)!.due, before.emp + 15);
  assert.equal(emp.pp.active.cur, before.pp);
  assert.deepEqual(ev("action_delayed").map((e) => [e.unit, e.counts]), [[LEON, 15], [EMPEROR, 15]]);
  assert.deepEqual(leon.statuses, []); // instant: nothing stays on the unit
});

test("a stun without a pending action waits for the next schedule; an SPD change keeps the pushback unscaled", () => {
  const { state, u } = fight();
  const leon = u(LEON);
  assert.equal(delayPending(state, leon, 15), null);
  const e = scheduleNext(state, leon);
  assert.equal(e.due, e.interval + 15);
  applyStatus(state, leon, "buff_007", "active", EMPEROR); // SPD UP: shorter interval
  assert.ok(rescheduleOnSpdChange(state, leon));
  const moved = state.timeline.pending.get(LEON)!;
  assert.equal(moved.due, moved.interval + 15); // nothing elapsed: the new interval plus the same 15 counts
});

// ------------------------------------------------------------------ Confusion

test("Confusion (field, pre-battle) hits every hero including the wearer; each ignores its tactics until its first active attack", () => {
  const { pack, battle } = loadReal();
  addPassive(pack, battle, JASMINE, prePassive(pack, "test_box", [{ type: "apply_status", status_id: "debuff_002", chance_percent: 100, target: "field", include_soldiers: false }]));
  const { state, rng, log, ev } = phase1(pack, battle);
  assert.deepEqual(ev("status_applied").filter((e) => e.status === "debuff_002").map((e) => e.unit).sort(), [EMPEROR, JASMINE, LEON, LIEF].sort());
  runPhase(state, rng, log);
  for (const id of [LEON, LIEF, EMPEROR]) {
    const evals = ev("tactic_evaluation").filter((e) => e.unit === id);
    assert.match(evals[0]!.evaluations[0]!.reason, /^confused \(Confusion\): ignores tactics, random target/);
    assert.ok(evals.slice(1).every((e) => e.evaluations.every((v) => !v.reason.startsWith("confused"))), id);
    assert.ok(ev("status_expired").some((e) => e.unit === id && e.status === "debuff_002" && e.reason === "duration"), id);
  }
  // Jasmine (the wearer) has no damage skill: she idles while confused, and her confusion only ends with an active attack.
  const jas = ev("tactic_evaluation").filter((e) => e.unit === JASMINE);
  assert.match(jas[0]!.evaluations[0]!.reason, /no usable damage skill, idles/);
  assert.equal(jas[0]!.chosen, null);
});

test("pre-battle step of a pre_battle passive follows design 9: grants, Immunity, buff removal, debuffs", () => {
  const { pack } = loadReal();
  const step = (effects: unknown[], targeting?: Partial<Skill["targeting"]>) => preBattleStepOf({ pack } as any, pack.byId.skills.get(prePassive(pack, "t", effects, targeting))!);
  assert.equal(preBattleStepOf({ pack } as any, pack.byId.skills.get(PREV_CARE)!), "immunity");
  assert.equal(step([{ type: "apply_status", status_id: "buff_005", chance_percent: 100, target: "self" }]), "buff_grants");
  assert.equal(step([{ type: "remove_buffs", side: "enemy" }]), "buff_removal");
  assert.equal(step([{ type: "apply_status", status_id: "debuff_002", chance_percent: 100, target: "field" }]), "debuffs");
  assert.equal(step([{ type: "heal", percent_max_hp: 10 }], { side: "enemy", shape: "all" }), "debuffs");
});

// ------------------------------------------------------------------ Regen, removes_on_hit

test("Regen heals once per attacking action that hits (a squad attack is one hit); reapplying extends it", () => {
  const { state, x, u, ev } = fight({ squads: true });
  scheduleInitial(state);
  u(SQ_D).alive = false; // the Emperor is the squad's target
  const emp = u(EMPEROR);
  emp.maxHp = 5000;
  emp.hp = 2000;
  applyStatus(state, emp, "buff_001", "active", JASMINE);
  applyStatus(state, emp, "buff_001", "active", JASMINE);
  assert.equal(emp.statuses[0]!.remaining, 2); // on_reapply: extend
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, u(SQ_C));
  assert.equal(ev("damage").filter((d) => d.unit === SQ_C).length, 1);
  assert.deepEqual(ev("heal").map((h) => [h.target, h.amount, h.skill]), [[EMPEROR, 1500, "buff_001"]]);
  assert.deepEqual(ev("trigger").map((t) => [t.handler, t.subject]), [["heals_on_hit", EMPEROR]]);
});

test("removes_on_hit: the status ends on the first landed hit", () => {
  const { pack, state, u, ev, strike } = fight();
  pack.byId.statuses.get("buff_005")!.flags.removes_on_hit = true;
  applyStatus(state, u(EMPEROR), "buff_005", "active", EMPEROR);
  strike(u(LEON), u(EMPEROR));
  assert.deepEqual(ev("status_expired").map((e) => [e.unit, e.status, e.reason]), [[EMPEROR, "buff_005", "hit"]]);
});

// ------------------------------------------------------------------ Fairy's Grace

test("Fairy's Grace intercepts death once: revive at 20% HP, pending action preserved, then it is used up", () => {
  const { state, x, u, ev } = fight();
  scheduleInitial(state);
  const emp = u(EMPEROR);
  const due = state.timeline.pending.get(EMPEROR)!.due;
  applyStatus(state, emp, "buff_003", "active", JASMINE);
  applyDamage(x, u(LEON), emp, { id: "s" }, amountOf(10000));
  assert.equal(emp.alive, true);
  assert.equal(emp.hp, Math.floor(0.2 * emp.maxHp));
  assert.equal(state.timeline.pending.get(EMPEROR)!.due, due);
  assert.deepEqual(ev("death_intercepted").map((e) => [e.unit, e.status, e.hp]), [[EMPEROR, "buff_003", emp.hp]]);
  assert.deepEqual(ev("status_expired").map((e) => [e.status, e.reason]), [["buff_003", "used"]]);
  applyDamage(x, u(LEON), emp, { id: "s" }, amountOf(10000));
  assert.equal(emp.alive, false);
});

// ------------------------------------------------------------------ Immunity and buff removal in the pre-battle order

const DEBUFF_AURA = { type: "enemy_debuff", faction_id: null, condition: null, target: { side: "enemy", filter: null, include_soldiers: false }, effects: [{ type: "modify_stat", stat: "DEF", mode: "percent", value: -20 }] };

test("Immunity (pre-battle, immunity step) resolves before enemy-debuff auras and blocks them", () => {
  const { pack, battle } = loadReal({ auras: true });
  Object.assign(pack.byId.characters.get(EMPEROR)!.leader_aura, DEBUFF_AURA);
  addPassive(pack, battle, LIEF, PREV_CARE); // challenger: Immunity + Regen on Leon and Lief
  const { ev } = phase1(pack, battle);
  assert.deepEqual(ev("status_applied").filter((e) => e.status === "buff_002").map((e) => e.unit).sort(), [LEON, LIEF]);
  assert.deepEqual(ev("status_blocked").map((e) => [e.unit, e.by]).sort(), [[LEON, "buff_002"], [LIEF, "buff_002"]]);
  assert.equal(ev("aura_applied").filter((e) => e.leader === EMPEROR).length, 0);
});

test("buff removal (buff_removal step) strips Immunity before the debuff step, so the debuff aura lands", () => {
  const { pack, battle } = loadReal({ auras: true });
  Object.assign(pack.byId.characters.get(EMPEROR)!.leader_aura, DEBUFF_AURA);
  addPassive(pack, battle, LIEF, PREV_CARE);
  addPassive(pack, battle, JASMINE, prePassive(pack, "test_strip", [{ type: "remove_buffs", side: "enemy" }]));
  const { log, ev } = phase1(pack, battle);
  const idx = (f: (e: BattleEvent) => boolean) => log.events.findIndex(f);
  const granted = idx((e) => e.type === "status_applied" && e.status === "buff_002");
  const stripped = idx((e) => e.type === "status_expired" && e.status === "buff_002" && e.reason === "removed");
  const debuffed = idx((e) => e.type === "aura_applied" && e.leader === EMPEROR);
  assert.ok(granted >= 0 && granted < stripped && stripped < debuffed, `${granted} ${stripped} ${debuffed}`);
  assert.equal(ev("status_blocked").length, 0);
  assert.deepEqual(ev("status_expired").filter((e) => e.reason === "removed").map((e) => [e.unit, e.status]).sort(), [
    [LEON, "buff_001"], [LEON, "buff_002"], [LIEF, "buff_001"], [LIEF, "buff_002"],
  ]); // Regen is a buff too
});

test("Immunity blocks a debuff status applied in battle", () => {
  const { state, x, u, ev } = fight();
  applyStatus(state, u(EMPEROR), "buff_002", "passive", JASMINE, false);
  const sk = { id: "s", name: "s", shape: "single", interactions: { guard: "standard" as const, soldiers: "standard" as const } };
  runEffect(x, u(LEON), sk, { type: "apply_status", status_id: "debuff_001", chance_percent: 100, target: "targets", include_soldiers: false }, [u(EMPEROR)], new Set(), false);
  assert.deepEqual(ev("status_blocked").map((e) => [e.unit, e.status, e.by]), [[EMPEROR, "debuff_001", "buff_002"]]);
  assert.ok(!u(EMPEROR).statuses.some((s) => s.statusId === "debuff_001"));
});

// ------------------------------------------------------------------ while_condition removal

test("a while_condition status from an active skill ends when the skill's activation stops holding", () => {
  const { state, x, u, ev } = fight();
  const lief = u(LIEF);
  lief.hp = 50; // below 50%
  const sk = { id: "s", name: "s", shape: "self", interactions: { guard: "standard" as const, soldiers: "standard" as const }, activation: { type: "hp_percent", side: "self", op: "<", value: 50 } };
  runEffect(x, lief, sk, { type: "apply_status", status_id: "status_002", chance_percent: 100, target: "self", include_soldiers: false }, [lief], new Set(), false);
  assert.ok(lief.statuses.some((s) => s.statusId === "status_002"));
  checkStatePassives(x);
  assert.ok(lief.statuses.some((s) => s.statusId === "status_002")); // still below 50%
  applyHeal(x, u(JASMINE), lief, { id: "h" }, 400); // 450 / 800: above 50%
  assert.ok(!lief.statuses.some((s) => s.statusId === "status_002"));
  assert.deepEqual(ev("status_expired").map((e) => [e.status, e.reason]), [["status_002", "condition"]]);
});
