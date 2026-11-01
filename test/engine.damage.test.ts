import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyHeal, computeDamage, computeHeal, critChance, executeSkill, guardChance, hitChance, killUnit, nextAction, reductionFactor,
  rollOutcome, scheduleInitial, applyStatus, decideTactic, type DamageEffect, type ExecCtx, type HealEffect,
} from "../src/engine";
import type { Skill } from "../src/schema";
import { EMPEROR, JASMINE, LEON, LIEF, sampleState, scripted, unit } from "./engineHelpers";

const setup = () => {
  const s = sampleState();
  const skill = (id: string) => s.pack.byId.skills.get(id) as Skill;
  const eff = (id: string) => skill(id).effects.find((e) => e.type === "damage") as DamageEffect;
  const ctx = { pack: s.pack };
  return { s, skill, eff, ctx, leon: unit(s, LEON), emp: unit(s, EMPEROR), jas: unit(s, JASMINE), lief: unit(s, LIEF) };
};
const HIT = { hit: true, crit: false, guard: false };

test("worked examples: bare Leon vs bare Emperor, Charging Assault 55 and Thousand Azure Hooves 107", () => {
  const { eff, ctx, leon, emp } = setup();
  const ca = computeDamage(leon, emp, eff("skl_cav_active_001"), ctx, HIT);
  assert.equal(ca.power, 105); // 70 x 1.2 x 1.25
  assert.equal(ca.amount, 55);
  const th = computeDamage(leon, emp, eff("skl_cav_active_002"), ctx, HIT);
  assert.equal(th.power, 157.5);
  assert.equal(th.amount, 107);
});

test("no variance: same outcome, same damage; crit and guard apply after defense and floor", () => {
  const { eff, ctx, leon, emp } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(computeDamage(leon, emp, e, ctx, HIT).amount, computeDamage(leon, emp, e, ctx, HIT).amount);
  assert.equal(computeDamage(leon, emp, e, ctx, { hit: true, crit: true, guard: false }).amount, 82); // floor(55 x 1.5)
  const th = eff("skl_cav_active_002");
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: true, guard: false }).amount, 160); // floor(107 x 1.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: false, guard: true }).amount, 53); // floor(107 x 0.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: true, guard: true }).amount, 80); // floor(160 x 0.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: false, crit: true, guard: true }).amount, 0);
});

test("ignores_guard skills never guard, even when the outcome says so", () => {
  const { eff, ctx, leon, emp } = setup();
  assert.equal(computeDamage(leon, emp, eff("skl_cav_active_001"), ctx, { hit: true, crit: false, guard: true }).amount, 55);
});

test("minimum damage: a landed hit never deals less than 1", () => {
  const { eff, ctx, jas, emp } = setup();
  const d = computeDamage(jas, emp, eff("skl_cav_active_001"), ctx, HIT); // 20 x 1.2 = 24 vs DEF 50
  assert.equal(d.amount, 1);
  assert.equal(computeDamage(jas, emp, eff("skl_cav_active_001"), ctx, { hit: true, crit: false, guard: true }).amount, 1);
});

test("class advantage and disadvantage apply to power before defense", () => {
  const { eff, ctx, leon, lief } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(computeDamage(lief, leon, e, ctx, HIT).amount, 25); // lancer > cavalry: 50 x 1.2 x 1.25 = 75 - 50
  assert.equal(computeDamage(leon, lief, e, ctx, HIT).amount, 21); // cavalry vs lancer: 84 x 0.85 = 71.4 - 50
});

test("bonus_vs_class multiplies with the class matchup; hybrid defense is the average of DEF and MDEF", () => {
  const { ctx, leon, emp } = setup();
  const e: DamageEffect = {
    type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 1 }], multiplier: 1, ignores_guard: false,
    bonus_vs_class: [{ class: "infantry", modifier_percent: 20 }], bonus_on_terrain: [], hit_bonus_percent: 0,
  };
  assert.equal(computeDamage(leon, emp, e, ctx, HIT).power, 70 * 1.25 * 1.2);
  const hybrid = computeDamage(leon, emp, { ...e, bonus_vs_class: [], damage_type: "hybrid" }, ctx, HIT);
  assert.equal(hybrid.defense, 35); // (50 + 20) / 2
  assert.equal(computeDamage(leon, emp, { ...e, bonus_vs_class: [], damage_type: "magical" }, ctx, HIT).defense, 20);
});

test("hit, crit and guard chances use the rules constants and clamps", () => {
  const { eff, ctx, s, leon, emp, lief } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(hitChance(leon, emp, e, ctx), 100); // 100 + 10 - 10 + 3.75 clamps to hit_max
  assert.equal(hitChance(lief, leon, e, ctx), 76.25); // 100 + 10 - 30 - 3.75
  assert.equal(hitChance(leon, lief, e, ctx), 73.75); // disadvantaged (no hit penalty): 100 - 30 + 3.75
  emp.baseStats.EVA = 200;
  assert.equal(hitChance(leon, emp, e, ctx), 70); // hit_min
  assert.equal(critChance(leon, unit(s, EMPEROR), ctx), 0); // 30 - 45 + 3.75 clamps to 0
  assert.equal(critChance(emp, unit(s, JASMINE), ctx), 5); // 30 - 30 + 5
  assert.equal(guardChance(unit(s, EMPEROR), ctx), 65); // 45 + 80 / 4
  unit(s, EMPEROR).baseStats.GUARD = 500;
  assert.equal(guardChance(unit(s, EMPEROR), ctx), 75);
});

test("reductions are multiplicative with a total cap", () => {
  assert.equal(reductionFactor([50], 75), 0.5);
  assert.equal(reductionFactor([50, 50], 75), 0.25);
  assert.equal(reductionFactor([50, 50, 50], 75), 0.25); // capped at 75% reduction
});

test("roll order is hit, crit, guard; a miss stops after the hit roll; ignores_guard skips the guard draw", () => {
  const { s, skill, eff, leon, emp } = setup();
  const log = new EventLog();
  const run = (id: string, vals: number[]) => {
    const rng = scripted(vals);
    log.events.length = 0;
    const o = rollOutcome({ state: s, rng, log }, leon, emp, skill(id), eff(id));
    return { o, draws: rng.draws, kinds: log.events.map((e) => (e.type === "roll" ? e.kind : e.type)) };
  };
  assert.deepEqual(run("skl_cav_active_002", [0.5, 0.0, 0.1]), { o: { hit: true, crit: false, guard: true }, draws: 3, kinds: ["hit", "crit", "guard"] });
  assert.deepEqual(run("skl_cav_active_001", [0.5, 0.0]), { o: { hit: true, crit: false, guard: false }, draws: 2, kinds: ["hit", "crit"] });
  const miss = (() => { emp.baseStats.EVA = 200; return run("skl_cav_active_002", [0.9]); })();
  assert.deepEqual(miss, { o: { hit: false, crit: false, guard: false }, draws: 1, kinds: ["hit"] });
});

test("prevents_evasion makes the hit land without drawing", () => {
  const { s, skill, eff, leon, emp } = setup();
  emp.baseStats.EVA = 200;
  applyStatus(s, emp, "status_003", "active", leon.id);
  const rng = scripted([0.0, 0.99]);
  const o = rollOutcome({ state: s, rng, log: new EventLog() }, leon, emp, skill("skl_cav_active_001"), eff("skl_cav_active_001"));
  assert.equal(o.hit, true);
  assert.equal(rng.draws, 1); // only the crit draw
});

test("heal: percent of max HP or scaling x multiplier, floored, capped at max HP, dead units are not healed", () => {
  const { s, skill, jas, emp } = setup();
  const x: ExecCtx = { state: s, rng: scripted([]), log: new EventLog() };
  const pct: HealEffect = { type: "heal", percent_max_hp: 33 };
  assert.equal(computeHeal(emp, jas, pct, s.pack), 66); // floor(0.33 x 200)
  const sc: HealEffect = { type: "heal", scaling: [{ stat: "INT", coef: 1 }], multiplier: 1.5 };
  assert.equal(computeHeal(emp, jas, sc, s.pack), 90);
  emp.hp = 150;
  assert.equal(applyHeal(x, jas, emp, skill("skl_heal_active_001"), 90), 50); // capped
  assert.equal(emp.hp, 200);
  emp.hp = 0; emp.alive = false;
  assert.equal(applyHeal(x, jas, emp, skill("skl_heal_active_001"), 90), 0);
  assert.equal(emp.hp, 0);
});

test("death: alive false, unscheduled, statuses cleared when removed_on_death", () => {
  const { s, leon, emp } = setup();
  scheduleInitial(s);
  applyStatus(s, emp, "buff_007", "active", emp.id);
  assert.equal(emp.statuses.length, 1);
  const log = new EventLog();
  killUnit({ state: s, rng: scripted([]), log }, emp, leon);
  assert.equal(emp.alive, false);
  assert.equal(s.timeline.pending.has(EMPEROR), false);
  assert.deepEqual(emp.statuses, []);
  assert.ok(log.events.some((e) => e.type === "death"));
});

test("executing Thousand Azure Hooves: spends PP, damages, stuns (pushback), SPD UP schedules the next action sooner", () => {
  const { s, leon, emp } = setup();
  scheduleInitial(s);
  const a = nextAction(s)!;
  assert.equal(a.unit.id, LEON);
  const log = new EventLog();
  const rng = scripted([0.5, 0.9, 0.9]); // hit, no crit, no guard (65%)
  const decision = decideTactic(s, leon, rng);
  assert.equal(decision.skillId, "skl_cav_active_002");
  const x: ExecCtx = { state: s, rng, log };
  const empBefore = s.timeline.pending.get(EMPEROR)!.due;
  executeSkill(x, leon, decision);
  assert.equal(leon.pp.active.cur, 0);
  assert.equal(emp.hp, 200 - 107);
  assert.equal(s.timeline.pending.get(LEON)!.due, 20 + 17); // interval 17 with SPD UP (57.5), not 20
  const empDue = s.timeline.pending.get(EMPEROR)!.due;
  assert.equal(empDue, empBefore + 15); // rules.stun_pushback_counts; no PP lost
  assert.ok(log.events.some((e) => e.type === "action_delayed" && e.unit === EMPEROR && e.counts === 15 && e.due === empDue));
  assert.equal(leon.statuses.length, 1); // SPD UP, 1 turn
});

test("Dark Dragon's Ire ends after the hit it guarantees", () => {
  const { s, leon, emp } = setup();
  scheduleInitial(s);
  applyStatus(s, emp, "status_003", "active", leon.id);
  const log = new EventLog();
  const rng = scripted([0.5, 0.9, 0.9]);
  executeSkill({ state: s, rng, log }, leon, decideTactic(s, leon, scripted([])));
  assert.equal(emp.statuses.some((st) => st.statusId === "status_003"), false);
  assert.ok(log.events.some((e) => e.type === "status_expired" && e.reason === "hit"));
});
