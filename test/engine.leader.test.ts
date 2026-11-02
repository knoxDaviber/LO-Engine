// Leader rules (roadmap 2.4, design Sections 2 and 17): propagation to the squad, soft leader rule, succession, pairing penalty, leader/party soldier skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyDamage, applyStatus, beginPhase, createBattleState, decideTactic, effectiveStat, executeSkill, runPhase, scheduleInitial, statBreakdown,
  type BattleEvent, type DamageBreakdown, type ExecCtx,
} from "../src/engine";
import type { Battle } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, scripted, tactic } from "./engineHelpers";

const SQ_C = `squad_${LEON}`;
const SQ_D = `squad_${EMPEROR}`;
const KILL: DamageBreakdown = { landed: true, scaled: 0, matchup: 1, power: 0, defense: 0, base: 1e9, crit: false, guard: false, guardFactor: 1, amount: 1e9 };

/** Jasmine survives whatever the phase throws at her, so the party can fight on after the Emperor falls. */
const tough = (p: Pack) => { (p.byId.characters.get(JASMINE) as any).base_stats.HP = 99999; };

function setup(over?: (pack: Pack, battle: Battle) => void) {
  const { pack, battle } = loadReal({ squads: true });
  over?.(pack, battle);
  const log = new EventLog();
  const p1 = beginPhase(pack, battle, 1, null, log);
  const x: ExecCtx = { state: p1.state, rng: p1.rng, log };
  const u = (id: string) => p1.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  return { pack, battle, log, state: p1.state, rng: p1.rng, x, u, ev };
}
const kill = (x: ExecCtx, killer: string, victim: string) =>
  applyDamage(x, x.state.units.find((v) => v.id === killer)!, x.state.units.find((v) => v.id === victim)!, { id: "s" }, KILL);

// ------------------------------------------------------------------ soft leader rule and succession

test("leader dies mid-phase: squad removed, aura flag off, the battle continues", () => {
  const { state, rng, log, x, u, ev } = setup();
  assert.deepEqual([state.leaders.defender.leaderId, state.leaders.defender.auraActive], [EMPEROR, true]);
  assert.ok(state.timeline.pending.has(SQ_D));
  kill(x, LEON, EMPEROR);
  const sq = u(SQ_D);
  assert.equal(sq.alive, false);
  assert.ok(sq.soldiers.every((s) => !s.alive && s.hp === 0));
  assert.equal(state.timeline.pending.has(SQ_D), false);
  assert.equal(state.leaders.defender.auraActive, false);
  assert.equal(state.leaders.challenger.auraActive, true); // the other side is untouched
  assert.deepEqual(ev("leader_down").map((e) => [e.unit, e.side, e.squad_removed, e.aura_active]), [[EMPEROR, "defender", true, false]]);
  kill(x, LEON, JASMINE); // a non-leader's death does nothing of the kind
  assert.equal(ev("leader_down").length, 1);
});

test("soldiers are never a victory condition: the phase goes on after the leader and squad are gone", () => {
  const { state, rng, log, x, u, ev } = setup(tough);
  kill(x, LEON, EMPEROR);
  assert.equal(u(JASMINE).alive, true);
  const res = runPhase(state, rng, log);
  assert.notEqual(res.reason, "wipe");
  assert.equal(res.survivors.defender, 1);
  const downAt = log.events.findIndex((e) => e.type === "leader_down");
  assert.ok(downAt >= 0);
  assert.equal(log.events.slice(downAt).filter((e) => e.type === "squad_attack" && e.unit === SQ_D).length, 0);
  assert.ok(ev("squad_attack").some((e) => e.unit === SQ_C)); // the challenger squad kept attacking
});

test("next phase: the successor restores the aura flag, the squad stays dead", () => {
  const { pack, battle, state, rng, log, x, u, ev } = setup(tough);
  kill(x, LEON, EMPEROR);
  runPhase(state, rng, log);
  const p2 = beginPhase(pack, battle, 2, state, log);
  assert.deepEqual(p2.state.leaders.defender, { leaderId: JASMINE, auraActive: true }); // first living hero of the leader line (roster order)
  assert.equal(p2.state.units.find((v) => v.id === JASMINE)!.isLeader, true);
  assert.equal(p2.state.units.find((v) => v.id === EMPEROR)!.isLeader, false);
  const sq = p2.state.units.find((v) => v.id === SQ_D)!;
  assert.equal(sq.alive, false); // aura only: no respawn
  assert.equal(p2.state.timeline.pending.has(SQ_D), false);
  assert.equal(p2.state.units.find((v) => v.id === EMPEROR)!.alive, false);
  assert.deepEqual(ev("leader_succession").map((e) => [e.side, e.previous, e.leader, e.aura_active, e.squad]), [["defender", EMPEROR, JASMINE, true, false]]);
  assert.equal(p2.state.leaders.challenger.leaderId, LEON); // a living leader just keeps leading
  assert.equal(ev("leader_succession").length, 1);
  // the successor keeps its row (no re-placement)
  assert.equal(p2.state.units.find((v) => v.id === JASMINE)!.row, u(JASMINE).row);
  // and it carries on into phase 3 without a second succession while the successor lives
  const p3 = beginPhase(pack, battle, 3, p2.state, log);
  assert.deepEqual(p3.state.leaders.defender, { leaderId: JASMINE, auraActive: true });
  assert.equal(p3.state.units.find((v) => v.id === JASMINE)!.isLeader, true);
  assert.equal(ev("leader_succession").length, 1);
});

test("if the successor dies too, the next living hero of the line takes over; none left means the flag stays off", () => {
  const { pack, battle, state, rng, log, x } = setup(tough);
  kill(x, LEON, EMPEROR);
  runPhase(state, rng, log);
  const p2 = beginPhase(pack, battle, 2, state, log);
  const x2: ExecCtx = { state: p2.state, rng: p2.rng, log };
  kill(x2, LEON, JASMINE);
  assert.equal(p2.state.leaders.defender.auraActive, false);
  const p3 = beginPhase(pack, battle, 3, p2.state, log);
  assert.deepEqual(p3.state.leaders.defender, { leaderId: JASMINE, auraActive: false }); // nobody left (the battle would have ended)
});

// ------------------------------------------------------------------ Leon's SPD -20

test("Leon's SPD -20 applies with non-mounted soldiers, not with mounted ones, and goes through the stat pipeline", () => {
  const foot = setup();
  const leon = foot.u(LEON);
  assert.equal(effectiveStat(leon, "SPD", foot.pack), 30);
  const bd = statBreakdown(leon, "SPD", foot.pack);
  assert.equal(bd.flat, -20);
  assert.deepEqual(bd.effects.map((e) => [e.mode, e.value]), [["flat", -20]]);
  assert.equal(foot.state.timeline.pending.get(LEON)!.interval, Math.round(1000 / 30)); // scheduling sees it
  const horse = setup((_p, b) => { b.challenger.heroes.find((h) => h.char_id === LEON)!.squad_id = "soldier_002"; });
  assert.equal(effectiveStat(horse.u(LEON), "SPD", horse.pack), 50);
  assert.equal(horse.u(LEON).innate.length, 0);
  // only the leader has a deployed squad, so a non-leader Leon is not penalised
  const notLeader = setup((_p, b) => { b.challenger.leader = LIEF; });
  assert.equal(effectiveStat(notLeader.u(LEON), "SPD", notLeader.pack), 50);
});

test("a pairing condition the engine cannot evaluate is logged and does not apply", () => {
  const { ev } = setup((p) => {
    (p.byId.characters.get(LEON) as any).restrictions.soldier.stat_penalties.push({ when: { type: "hero_is", side: "ally", value: LEON }, stat: "ATK", mode: "flat", value: -5 });
  });
  assert.ok(ev("not_implemented").some((e) => e.what === "not implemented: pairing condition hero_is"));
});

// ------------------------------------------------------------------ propagation to the squad

test("leader statuses (stat modifiers) apply to the squad too; non-leader statuses do not; no double counting", () => {
  const { state, pack, u } = setup();
  const sq = u(SQ_C);
  assert.ok(Math.abs(effectiveStat(sq, "DEF", pack) - 14 * 1.3) < 1e-9);
  applyStatus(state, u(LEON), "buff_004", "active", LEON); // DEF UP +20%, active
  assert.ok(Math.abs(effectiveStat(sq, "DEF", pack) - 14 * 1.3 * 1.2) < 1e-9);
  assert.ok(Math.abs(effectiveStat(u(LEON), "DEF", pack) - 70 * 1.2) < 1e-9);
  applyStatus(state, u(LIEF), "buff_004", "active", LIEF);
  assert.ok(Math.abs(effectiveStat(sq, "DEF", pack) - 14 * 1.3 * 1.2) < 1e-9); // Lief is not the leader
  applyStatus(state, sq, "buff_004", "active", LEON); // the same status already on the squad is not counted twice
  assert.equal(statBreakdown(sq, "DEF", pack).effects.filter((e) => e.status === "buff_004").length, 1);
  // flat equipment and the leader's own pairing penalty are not statuses: they stay on the hero
  assert.equal(effectiveStat(sq, "SPD", pack), 30);
});

test("a leader's SPD UP speeds up the squad's schedule as well", () => {
  const { state, x, u, ev } = setup((_p, b) => { b.challenger.heroes.find((h) => h.char_id === LEON)!.tactic_sheet = [tactic("skl_cav_active_002")]; });
  state.timeline.now = 10;
  const before = state.timeline.pending.get(SQ_C)!.interval;
  const leon = u(LEON);
  state.timeline.pending.delete(LEON);
  const d = decideTactic(state, leon, scripted([0, 0, 0, 0, 0, 0, 0, 0]));
  executeSkill(x, leon, d); // Thousand Azure Hooves: SPD UP on Leon (and, shared, on his squad)
  assert.ok(state.timeline.pending.get(SQ_C)!.interval < before);
  assert.ok(ev("schedule").some((e) => e.unit === SQ_C && e.reason === "spd_change"));
});

test("a squad's own statuses and the leader's follow the same-category strongest-wins rule", () => {
  const { state, pack, u } = setup();
  applyStatus(state, u(LEON), "buff_004", "active", LEON); // +20% active DEF
  applyStatus(state, u(SQ_C), "buff_001", "active", LEON);
  const bd = statBreakdown(u(SQ_C), "DEF", pack);
  const act = bd.effects.filter((e) => e.category === "active");
  assert.ok(act.length >= 1);
  assert.equal(act.filter((e) => e.outcome === "winner").length, 1); // one winner per stat and category
});

// ------------------------------------------------------------------ soldier skills aimed at the leader / party

test("soldier skills targeting the leader or the party become modifiers on those heroes and end with the squad", () => {
  const { state, pack, u } = setup((p) => {
    const st = p.byId.soldiers.get("soldier_001")!;
    st.passive_effects.push({ name: "l", target: "leader", effects: [{ type: "modify_stat", stat: "ATK", mode: "percent", value: 10, source_category: "soldier" }] });
    st.passive_effects.push({ name: "p", target: "party", effects: [{ type: "modify_stat", stat: "DEF", mode: "flat", value: 7 }] });
  });
  assert.ok(Math.abs(effectiveStat(u(LEON), "ATK", pack) - 126.5) < 1e-9); // leader only
  assert.ok(Math.abs(effectiveStat(u(LEON), "INT", pack) - 33) < 1e-9); // paired with the ATK line (Decision 132)
  assert.equal(effectiveStat(u(LIEF), "ATK", pack), 90);
  assert.equal(effectiveStat(u(LEON), "DEF", pack), 77); // party: all heroes of the side
  assert.equal(effectiveStat(u(LEON), "MDEF", pack), 53); // a flat DEF line pairs too
  assert.equal(effectiveStat(u(LIEF), "DEF", pack), 77);
  assert.equal(effectiveStat(u(EMPEROR), "DEF", pack), 70 + 7); // the Emperor's own squad has the same skills
  assert.ok(Math.abs(effectiveStat(u(SQ_C), "DEF", pack) - 14 * 1.3) < 1e-9); // the squad itself is not a "party" member here
  // the Emperor's squad dies: its party skill ends for Jasmine, Leon's keeps going
  const emp = state.units.find((v) => v.id === EMPEROR)!;
  const x: ExecCtx = { state, rng: scripted([]), log: new EventLog() };
  applyDamage(x, u(LEON), emp, { id: "s" }, KILL);
  assert.equal(effectiveStat(u(JASMINE), "DEF", pack), 40); // no party skill left on the defender side
  assert.equal(effectiveStat(u(LIEF), "DEF", pack), 77);
  scheduleInitial(state);
});
