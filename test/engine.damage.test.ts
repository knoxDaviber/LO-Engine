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

test("worked examples: bare Leon vs bare Emperor, Charging Assault 102 and Thousand Azure Hooves 188", () => {
  const { eff, ctx, leon, emp } = setup();
  const ca = computeDamage(leon, emp, eff("skl_cav_active_001"), ctx, HIT);
  assert.equal(ca.power, 172.5); // 115 x 1.2 x 1.25
  assert.equal(ca.amount, 102); // - DEF 70
  const th = computeDamage(leon, emp, eff("skl_cav_active_002"), ctx, HIT);
  assert.equal(th.power, 258.75);
  assert.equal(th.amount, 188);
});

test("no variance: same outcome, same damage; crit and guard apply after defense and floor", () => {
  const { eff, ctx, leon, emp } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(computeDamage(leon, emp, e, ctx, HIT).amount, computeDamage(leon, emp, e, ctx, HIT).amount);
  assert.equal(computeDamage(leon, emp, e, ctx, { hit: true, crit: true, guard: false }).amount, 153); // floor(102 x 1.5)
  const th = eff("skl_cav_active_002");
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: true, guard: false }).amount, 282); // floor(188 x 1.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: false, guard: true }).amount, 94); // floor(188 x 0.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: true, crit: true, guard: true }).amount, 141); // floor(282 x 0.5)
  assert.equal(computeDamage(leon, emp, th, ctx, { hit: false, crit: true, guard: true }).amount, 0);
});

test("ignores_guard skills never guard, even when the outcome says so", () => {
  const { eff, ctx, leon, emp } = setup();
  assert.equal(computeDamage(leon, emp, eff("skl_cav_active_001"), ctx, { hit: true, crit: false, guard: true }).amount, 102);
});

test("minimum damage: a landed hit never deals less than 1", () => {
  const { eff, ctx, jas, emp } = setup();
  const d = computeDamage(jas, emp, eff("skl_cav_active_001"), ctx, HIT); // 20 x 1.2 = 24 vs DEF 70
  assert.equal(d.amount, 1);
  assert.equal(computeDamage(jas, emp, eff("skl_cav_active_001"), ctx, { hit: true, crit: false, guard: true }).amount, 1);
});

test("class advantage and disadvantage apply to power before defense", () => {
  const { eff, ctx, leon, lief } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(computeDamage(lief, leon, e, ctx, HIT).amount, 65); // lancer > cavalry: 90 x 1.2 x 1.25 = 135 - 70
  assert.equal(computeDamage(leon, lief, e, ctx, HIT).amount, 47); // cavalry vs lancer: 138 x 0.85 = 117.3 - 70
});

test("bonus_vs_class multiplies with the class matchup; hybrid defense is the average of DEF and MDEF", () => {
  const { ctx, leon, emp } = setup();
  const e: DamageEffect = {
    type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 1 }], multiplier: 1, ignores_guard: false,
    bonus_vs_class: [{ class: "infantry", modifier_percent: 20 }], bonus_on_terrain: [], hit_bonus_percent: 0,
  };
  assert.equal(computeDamage(leon, emp, e, ctx, HIT).power, 115 * 1.25 * 1.2);
  const hybrid = computeDamage(leon, emp, { ...e, bonus_vs_class: [], damage_type: "hybrid" }, ctx, HIT);
  assert.equal(hybrid.defense, 55); // (70 + 40) / 2
  assert.equal(computeDamage(leon, emp, { ...e, bonus_vs_class: [], damage_type: "magical" }, ctx, HIT).defense, 40);
});

test("hit, crit and guard chances use the rules constants and clamps", () => {
  const { eff, ctx, s, leon, emp, lief } = setup();
  const e = eff("skl_cav_active_001");
  assert.equal(hitChance(leon, emp, e, ctx), 100); // 100 + 10 - 10 + 3.25 clamps to hit_max
  assert.equal(hitChance(lief, leon, e, ctx), 76.75); // 100 + 10 - 30 - 3.25
  assert.equal(hitChance(leon, lief, e, ctx), 73.25); // disadvantaged (no hit penalty): 100 - 30 + 3.25
  emp.baseStats.EVA = 200;
  assert.equal(hitChance(leon, emp, e, ctx), 70); // hit_min
  assert.equal(critChance(leon, unit(s, EMPEROR), ctx), 0); // 30 - 45 + 3.25 clamps to 0
  assert.equal(critChance(emp, unit(s, JASMINE), ctx), 1.75); // 30 - 30 + 7 / 4
  assert.equal(guardChance(unit(s, EMPEROR), ctx), 50.5); // 45 + 22 / 4
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
  assert.equal(computeHeal(emp, jas, pct, s.pack), 313); // floor(0.33 x 950)
  const sc: HealEffect = { type: "heal", scaling: [{ stat: "INT", coef: 1 }], multiplier: 1.5 };
  assert.equal(computeHeal(emp, jas, sc, s.pack), 150);
  emp.hp = 900;
  assert.equal(applyHeal(x, jas, emp, skill("skl_heal_active_001"), 90), 50); // capped
  assert.equal(emp.hp, 950);
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
  const rng = scripted([0.5, 0.9, 0.9]); // hit, no crit, no guard (50.5%)
  const decision = decideTactic(s, leon, rng);
  assert.equal(decision.skillId, "skl_cav_active_002");
  const x: ExecCtx = { state: s, rng, log };
  const empBefore = s.timeline.pending.get(EMPEROR)!.due;
  const ppBefore = leon.pp.active.cur;
  executeSkill(x, leon, decision);
  assert.equal(leon.pp.active.cur, ppBefore - s.pack.byId.skills.get("skl_cav_active_002")!.pp_cost);
  assert.equal(emp.hp, 950 - 188);
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

test("damage formulas: subtract (pinned by loadReal), ratio and scaled_subtract change only the base step; withOptions overrides rules.damage", async () => {
  const { withOptions, runBattle } = await import("../src/engine");
  const { eff, s, leon, emp, jas } = setup();
  const opt = (formula: any) => ({ pack: withOptions(s.pack as any, { formula }) });
  assert.equal(s.pack.rules.damage.formula, "subtract");
  const ca = eff("skl_cav_active_001"); // Leon power 172.5 vs DEF 70; Jasmine power 24 vs DEF 70
  assert.equal(computeDamage(leon, emp, ca, opt({ formula: "subtract" }), HIT).base, 102);
  assert.equal(computeDamage(leon, emp, ca, opt({ formula: "ratio" }), HIT).base, 101); // 172.5 x 100 / 170 = 101.47
  assert.equal(computeDamage(leon, emp, ca, opt({ formula: "ratio", ratio_k: 200 }), HIT).base, 127); // 172.5 x 200 / 270 = 127.8
  assert.equal(computeDamage(jas, emp, ca, opt({ formula: "ratio" }), HIT).base, 14); // 24 x 100 / 170
  assert.equal(computeDamage(leon, emp, ca, opt({ formula: "scaled_subtract" }), HIT).base, 102); // max(34.5, 102.5)
  assert.equal(computeDamage(jas, emp, ca, opt({ formula: "scaled_subtract" }), HIT).base, 4); // max(4.8, -46)
  assert.equal(computeDamage(jas, emp, ca, opt({ formula: "scaled_subtract", floor_pct: 35, def_weight: 0.5 }), HIT).base, 8); // max(8.4, -11)
  // crit still applies after the base step
  assert.equal(computeDamage(leon, emp, ca, opt({ formula: "ratio" }), { hit: true, crit: true, guard: false }).amount, 151); // floor(101 x 1.5)
  // the override leaves the original pack untouched; no override returns the same pack
  assert.equal(s.pack.rules.damage.formula, "subtract");
  assert.equal(withOptions(s.pack as any, {}), s.pack);
  // a run with the default formula named explicitly is identical to a run without the option
  const { loadReal } = await import("./engineHelpers");
  const { pack, battle } = loadReal({ squads: true, auras: true, damage: true });
  assert.equal(pack.rules.damage.formula, "pool");
  assert.deepEqual(runBattle(pack, battle, { formula: { formula: "pool" } }).events, runBattle(pack, battle).events);
  assert.notDeepEqual(runBattle(pack, battle, { formula: { formula: "subtract" } }).events, runBattle(pack, battle).events);
});

test("pool formula: (ATK - DEF) x (1 + bonus% - reduction%), crit after, capped at 75% net reduction; hero_hits multiplies hero damage last", async () => {
  const { withOptions, runBattle } = await import("../src/engine");
  const s = sampleState(1, { damage: true });
  const ca = { ...((s.pack.byId.skills.get("skl_cav_active_001") as Skill).effects.find((e) => e.type === "damage") as DamageEffect), ignores_guard: false };
  const leon = unit(s, LEON), emp = unit(s, EMPEROR), jas = unit(s, JASMINE), lief = unit(s, LIEF);
  assert.equal(s.pack.rules.damage.formula, "pool");
  assert.equal(s.pack.rules.damage.hero_hits, 4);
  const one = { pack: withOptions(s.pack, { heroHits: 1 }) };
  // Leon 115 x 1.2 = 138 vs DEF 70: core 68, cavalry > infantry +25
  const d = computeDamage(leon, emp, ca, one, HIT);
  assert.equal(d.power, 138);
  assert.equal(d.amount, 85); // 68 x 1.25
  assert.deepEqual(d.pool, { bonus: 25, reduction: 0, factor: 1.25 });
  assert.equal(computeDamage(leon, emp, ca, one, { hit: true, crit: false, guard: true }).amount, 51); // 68 x (1.25 - 0.5)
  assert.equal(computeDamage(leon, emp, ca, one, { hit: true, crit: true, guard: false }).amount, 127); // 68 x 1.25 x 1.5 = 127.5
  assert.equal(computeDamage(leon, emp, ca, one, { hit: true, crit: true, guard: true }).amount, 76); // 68 x 0.75 x 1.5 = 76.5
  const capped = computeDamage(leon, emp, ca, { ...one, reductions: [50, 50] }, { hit: true, crit: false, guard: true });
  assert.equal(capped.amount, 17); // 1.25 - 1.5 < 0.25: capped at 0.25
  assert.deepEqual(capped.pool, { bonus: 25, reduction: 150, factor: 0.25 });
  assert.equal(computeDamage(leon, lief, ca, one, HIT).amount, 57); // cavalry vs lancer -15: 68 x 0.85 = 57.8
  assert.equal(computeDamage(leon, emp, { ...ca, bonus_vs_class: [{ class: "infantry", modifier_percent: 25 }] }, one, HIT).amount, 102); // 68 x 1.5 (additive)
  assert.equal(computeDamage(jas, emp, ca, one, HIT).amount, 1); // core min 1 x 1.25, floored
  // hero_hits (content value 4) multiplies the final amount; a squad's damage is untouched
  assert.equal(computeDamage(leon, emp, ca, { pack: s.pack }, HIT).amount, 340);
  assert.equal(computeDamage(leon, emp, ca, { pack: s.pack }, HIT).heroHits, 4);
  assert.equal(computeDamage(jas, emp, ca, { pack: s.pack }, HIT).amount, 4);
  assert.equal(computeDamage(leon, emp, ca, { pack: withOptions(s.pack, { heroHits: 2.5 }) }, HIT).amount, 212); // floor(85 x 2.5)
  const sq = sampleState(1, { squads: true, damage: true });
  const squad = sq.units.find((u) => u.kind === "squad" && u.alive)!;
  const target = sq.units.find((u) => u.kind === "hero" && u.side !== squad.side)!;
  const { soldierEffect } = await import("../src/engine/squad");
  const se = soldierEffect({ state: sq } as ExecCtx, squad);
  const sd = computeDamage(squad, target, se, { pack: sq.pack }, HIT);
  assert.equal(sd.amount, computeDamage(squad, target, se, { pack: withOptions(sq.pack, { heroHits: 1 }) }, HIT).amount);
  assert.equal(sd.heroHits, undefined);
  // the override reaches a run; the damage log carries the pool parts
  const { pack, battle } = (await import("./engineHelpers")).loadReal({ squads: true, auras: true, damage: true });
  const ev = runBattle(pack, battle).events;
  assert.deepEqual(runBattle(pack, battle, { heroHits: 4 }).events, ev);
  assert.notDeepEqual(runBattle(pack, battle, { heroHits: 1 }).events, ev);
  const hit = ev.find((e) => e.type === "damage" && (e as any).hero_hits === 4) as any;
  assert.ok(hit && typeof hit.pool === "number" && typeof hit.bonus === "number" && typeof hit.reduction === "number");
});
