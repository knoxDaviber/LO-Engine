import { test } from "node:test";
import assert from "node:assert/strict";
import { battleSchema, type Battle, type Tactic } from "../src/schema";
import { beginPhase, EventLog, isExhausted, runBattle, runPhase, timeoutWinner, type BattleEvent } from "../src/engine";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, sampleState, tactic } from "./engineHelpers";

/** Real pack and sample battle; `tank` gives everyone huge HP so nobody dies. */
function setup(tank = true): { pack: Pack; battle: Battle } {
  const { pack, battle } = loadReal();
  if (tank) for (const id of [LEON, LIEF, EMPEROR, JASMINE]) (pack.byId.characters.get(id) as any).base_stats.HP = 100000;
  return { pack, battle: structuredClone(battle) };
}
const sheetOf = (b: Battle, id: string) => [...b.challenger.heroes, ...b.defender.heroes].find((h) => h.char_id === id)!;
const evals = (events: BattleEvent[], unit: string, phase: number) =>
  events.filter((e): e is Extract<BattleEvent, { type: "tactic_evaluation" }> => e.type === "tactic_evaluation" && e.unit === unit && e.phase === phase);

const spentSkills = (events: BattleEvent[]) => events.filter((e) => e.type === "pp_spend" && e.pool === "active").length;

test("phase ends by exhaustion when every living hero is out of PP for its skills", () => {
  const { pack, battle } = setup();
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "exhausted");
  assert.equal(res.skills, spentSkills(log.events)); // every skill cast paid Active PP
  assert.ok(state.units.every((u) => isExhausted(state, u)));
  for (const id of [LEON, JASMINE]) { // left over PP buys none of the active skills on the hero's sheet
    const left = state.units.find((u) => u.id === id)!.pp.active.cur;
    const costs = sheetOf(battle, id).tactic_sheet.filter((t) => t.enabled).map((t) => pack.byId.skills.get(t.skill_id)!).filter((k) => k.pp_pool === "active").map((k) => k.pp_cost);
    assert.ok(costs.length > 0, `${id} has no active skill on its sheet`);
    const cheapest = Math.min(...costs);
    assert.ok(left < cheapest, `${id} has ${left} PP left, cheapest skill costs ${cheapest}`);
  }
});

test("a hero with no usable active skill is exhausted", () => {
  const { pack, battle } = setup();
  sheetOf(battle, LEON).tactic_sheet = [];
  const { state } = beginPhase(pack, battle, 1, null, new EventLog());
  assert.equal(isExhausted(state, state.units.find((u) => u.id === LEON)!), true);
  assert.equal(isExhausted(state, state.units.find((u) => u.id === LIEF)!), false);
});

const never: Tactic["main"] = { type: "phase", op: "=", value: 9 };

test("idle safety ends a stalled phase after one full cycle without a skill", () => {
  const { pack, battle } = setup();
  for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) for (const t of h.tactic_sheet) t.main = never;
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "idle_cycle");
  assert.equal(res.skills, 0);
  assert.equal(res.actions, 4); // each of the 4 units acted once, all idle
  assert.ok(state.units.every((u) => u.pp.active.cur === u.pp.active.max));
});

test("idle cycle restarts when a skill is executed", () => {
  const { pack, battle } = setup();
  // Leon can act exactly once (PP set to one Hooves below); everyone else stalls. Leon acts at 20, 37, 54...
  for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) if (h.char_id !== LEON) for (const t of h.tactic_sheet) t.main = never;
  sheetOf(battle, LEON).tactic_sheet = [tactic("skl_cav_active_002")];
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  state.units.find((u) => u.id === LEON)!.pp.active.cur = pack.byId.skills.get("skl_cav_active_002")!.pp_cost;
  const res = runPhase(state, rng, log);
  assert.equal(res.skills, 1);
  assert.equal(res.reason, "idle_cycle"); // the skill at t=20 restarts the cycle; it completes when all four have idled since
  assert.equal(res.actions, 5);
});

test("hard action cap is the last resort", () => {
  const { pack, battle } = setup();
  pack.rules.phase.max_actions_per_phase = 2;
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "action_cap");
  assert.equal(res.actions, 2);
});

test("only hero actions count toward the action cap: a very fast squad cannot end the phase while heroes still have PP", () => {
  const { pack, battle } = loadReal({ squads: true });
  for (const id of [LEON, LIEF, EMPEROR, JASMINE]) (pack.byId.characters.get(id) as any).base_stats.HP = 1e7;
  pack.byId.soldiers.get("soldier_001")!.per_soldier_stats.SPD = 500; // interval 2: dozens of squad actions before a hero acts
  pack.byId.soldiers.get("soldier_001")!.per_soldier_stats.ATK = 0;
  const cap = 4 * pack.rules.pp.max; // room for all four heroes at full PP, so only squad actions could reach it
  pack.rules.phase.max_actions_per_phase = cap;
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.ok(res.squadActions > cap, `squad acted ${res.squadActions} times, more than the cap`);
  assert.notEqual(res.reason, "action_cap");
  assert.equal(res.reason, "exhausted");
  assert.equal(res.skills, spentSkills(log.events)); // every hero still got to spend its PP
});

test("squad actions have their own safety bound (10x the cap) so an endless squad cannot loop forever", () => {
  const { pack, battle } = loadReal({ squads: true });
  for (const id of [LEON, LIEF, EMPEROR, JASMINE]) (pack.byId.characters.get(id) as any).base_stats.HP = 1e7;
  pack.byId.soldiers.get("soldier_001")!.per_soldier_stats.SPD = 1000;
  pack.rules.phase.max_actions_per_phase = 2;
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "action_cap");
  assert.ok(res.squadActions >= 20 && res.actions <= 2);
});

test("phase 3 ending with both sides alive is a timeout decided by HP%; every phase runs", () => {
  const { pack, battle } = setup();
  const r = runBattle(pack, battle);
  assert.equal(r.reason, "phase3_timeout");
  const pct = (side: string) => { const us = [...r.units, ...r.squads].filter((u) => u.side === side); return us.reduce((n, u) => n + u.hp, 0) / us.reduce((n, u) => n + u.max_hp, 0); };
  assert.equal(r.winner, pct("challenger") > pct("defender") ? "challenger" : "defender");
  assert.equal(r.phases.length, 3);
  assert.ok(r.phases.every((p) => p.reason === "exhausted"));
  assert.ok(r.units.every((u) => u.alive));
});

test("timeoutWinner: higher pooled HP% wins, exact tie goes to the defender, soldier HP counts", () => {
  const s = sampleState(3, { squads: true });
  const side = (x: "challenger" | "defender") => s.units.filter((u) => u.side === x);
  const setPct = (x: "challenger" | "defender", pct: number) => side(x).forEach((u) => (u.hp = (u.maxHp * pct) / 100));
  setPct("challenger", 100); setPct("defender", 100);
  assert.equal(timeoutWinner(s), "defender"); // exact tie
  setPct("challenger", 60); setPct("defender", 50);
  assert.equal(timeoutWinner(s), "challenger");
  setPct("challenger", 50); setPct("defender", 60);
  assert.equal(timeoutWinner(s), "defender");
  setPct("challenger", 100); setPct("defender", 100);
  side("challenger").filter((u) => u.kind === "squad").forEach((u) => (u.hp = 0)); // healthy heroes, wiped squad
  assert.equal(timeoutWinner(s), "defender");
  side("defender").filter((u) => u.kind === "squad").forEach((u) => (u.hp = 0));
  side("defender").forEach((u) => u.kind === "hero" && (u.hp = u.maxHp / 2));
  assert.equal(timeoutWinner(s), "challenger");
});

test("a wipe ends the battle at once and the other side wins", () => {
  const { pack, battle } = setup(false);
  sheetOf(battle, JASMINE).tactic_sheet = []; // no Fairy's Grace (Last Chance), so somebody dies
  for (const id of [EMPEROR, JASMINE]) (pack.byId.characters.get(id) as any).base_stats.HP = 150; // frail enough to die within 3 phases
  const r = runBattle(pack, battle);
  assert.equal(r.reason, "wipe");
  assert.equal(r.phases.at(-1)!.reason, "wipe");
  const dead = r.units.filter((u) => !u.alive).map((u) => u.side);
  assert.ok(dead.length > 0 && new Set(dead).size === 1);
  assert.equal(r.winner, dead[0] === "defender" ? "challenger" : "defender");
});

test("HP and deaths persist into the next phase; PP refreshes, statuses clear, timeline resets", () => {
  const { pack, battle } = setup();
  const log = new EventLog();
  const p1 = beginPhase(pack, battle, 1, null, log);
  runPhase(p1.state, p1.rng, log);
  const lief = p1.state.units.find((u) => u.id === LIEF)!;
  const jas = p1.state.units.find((u) => u.id === JASMINE)!;
  assert.ok(lief.hp < lief.maxHp || p1.state.units.some((u) => u.hp < u.maxHp));
  assert.ok(lief.pp.active.cur < lief.pp.active.max);
  assert.ok(p1.state.units.some((u) => u.statuses.length > 0));
  jas.alive = false; jas.hp = 0;
  const p2 = beginPhase(pack, battle, 2, p1.state, log);
  for (const u of p2.state.units) {
    const before = p1.state.units.find((x) => x.id === u.id)!;
    assert.equal(u.hp, before.hp);
    assert.equal(u.alive, before.alive);
    assert.equal(u.pp.active.cur, u.pp.active.max);
    assert.deepEqual(u.statuses, []);
  }
  assert.equal(p2.state.timeline.now, 0);
  assert.equal(p2.state.timeline.pending.size, 3); // the dead stay unscheduled
  assert.equal(p2.state.timeline.pending.has(JASMINE), false);
});

test("`phase` condition in main: an only-if check", () => {
  const { pack, battle } = setup();
  sheetOf(battle, LEON).tactic_sheet = [tactic("skl_cav_active_001", { main: { type: "phase", op: ">=", value: 2 } })];
  const r = runBattle(pack, battle);
  const first = (p: number) => evals(r.events, LEON, p)[0]!;
  assert.equal(first(1).chosen, null);
  assert.match(first(1).evaluations[0]!.reason, /condition false: main phase >= 2/);
  assert.equal(first(2).chosen, "skl_cav_active_001");
  assert.equal(first(3).chosen, "skl_cav_active_001");
});

test("`phase` condition works in targeting", () => {
  const { pack, battle } = setup();
  sheetOf(battle, LEON).tactic_sheet = [tactic("skl_cav_active_001", { main: { type: "phase", op: "=", value: 2 }, sub: null })];
  const r = runBattle(pack, battle);
  const first = (p: number) => evals(r.events, LEON, p)[0]!;
  assert.equal(first(1).chosen, null);
  assert.match(first(1).evaluations[0]!.reason, /condition false: main phase = 2/);
  assert.equal(first(2).chosen, "skl_cav_active_001");
  assert.equal(first(3).chosen, null);
});

test("kill race: a unit killed before it acts never spends its PP", () => {
  const { pack, battle } = setup(false);
  (pack.byId.characters.get(EMPEROR) as any).base_stats.HP = 1;
  const r = runBattle(pack, battle);
  const p1 = (e: BattleEvent) => "phase" in e && e.phase === 1;
  assert.ok(!r.events.some((e) => p1(e) && e.type === "tactic_evaluation" && e.unit === EMPEROR));
  assert.ok(!r.events.some((e) => p1(e) && e.type === "pp_spend" && e.unit === EMPEROR));
  const death = r.events.find((e) => p1(e) && e.type === "death" && e.unit === EMPEROR);
  assert.ok(death, "Emperor dies in phase 1");
  const p2 = r.events.find((e) => e.type === "phase_start" && e.phase === 2) as Extract<BattleEvent, { type: "phase_start" }> | undefined;
  if (p2) assert.equal(p2.units.find((u) => u.id === EMPEROR)!.alive, false); // stays dead
});

test("same seed reproduces the same battle", () => {
  const a = setup(false), b = setup(false);
  assert.equal(JSON.stringify(runBattle(a.pack, a.battle)), JSON.stringify(runBattle(b.pack, b.battle)));
});

test("start_hp_percent sets the opening HP only: phase 2 carries the real HP", () => {
  const { pack, battle } = setup(false);
  sheetOf(battle, LEON).start_hp_percent = 40;
  const { state } = beginPhase(pack, battle, 1, null, new EventLog());
  const leon = state.units.find((u) => u.id === LEON)!;
  assert.equal(leon.hp, Math.max(1, Math.floor((leon.maxHp * 40) / 100)));
  assert.ok(state.units.filter((u) => u.id !== LEON && u.kind === "hero").every((u) => u.hp === u.maxHp));
  leon.hp = 1;
  assert.equal(beginPhase(pack, battle, 2, state, new EventLog()).state.units.find((u) => u.id === LEON)!.hp, 1);
});
