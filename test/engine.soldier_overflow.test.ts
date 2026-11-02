// Soldier damage overflow (Decision 128, overturns 43): a hit that kills a soldier carries its raw leftover to the next lowest-HP living
// soldier until used up or the squad is wiped; never onto the hero. Area hits too since the squad defends as one (Decision 130).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyStatus, applySoldierDamage, createBattleState, hitSquad, renderLog, syncSquad, type BattleEvent, type DamageBreakdown, type DamageEffect, type ExecCtx, type Unit,
} from "../src/engine";
import type { Skill } from "../src/schema";
import { EMPEROR, JASMINE, LEON, loadReal } from "./engineHelpers";

const SQ_D = `squad_${EMPEROR}`;

function setup() {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: { next: () => 0.999999, int: (k) => Math.floor(0.999999 * k), draws: 0 }, log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const hit = (amount: number, single = true, target?: Unit) => {
    const sq = u(SQ_D);
    const d: DamageBreakdown = { landed: true, scaled: 0, matchup: 1, power: amount, defense: 0, base: amount, crit: false, guard: false, guardFactor: 1, amount };
    const s = target ? target.soldiers.find((v) => v.alive)! : sq.soldiers.reduce((b, v) => (v.alive && (!b || v.hp < b.hp) ? v : b), null as any);
    state.bus.beginAction();
    applySoldierDamage(x, u(LEON), sq, s, { id: "t" }, d, undefined, { single });
  };
  return { pack, state, log, x, u, ev, hit };
}
const hps = (sq: Unit) => sq.soldiers.map((s) => (s.alive ? s.hp : 0));

test("overflow kills the soldier, then damages the next one by the remainder", () => {
  const { u, ev, hit, log } = setup();
  const sq = u(SQ_D);
  sq.soldiers[3]!.hp = 20;
  syncSquad(sq);
  hit(35); // 20 kills soldier 3, 15 carry to soldier 0 (all others equal at 153)
  assert.deepEqual(hps(sq), [138, 153, 153, 0, 153, 153, 153, 153, 153, 153]);
  const dmg = ev("damage");
  assert.deepEqual(dmg.map((e) => [e.soldier, e.amount, e.hp_before, e.hp_after, e.spill ?? false]), [[3, 20, 20, 0, false], [0, 15, 153, 138, true]]);
  assert.deepEqual(ev("death").map((e) => e.soldier), [3]);
  assert.match(renderLog(log.events), /\(overflow\)/);
});

test("overflow chains across several soldiers, one after_hit with the total removed", () => {
  const { state, u, ev, hit } = setup();
  const sq = u(SQ_D);
  const seen: any[] = [];
  state.bus.subscribe({ event: "after_hit", id: "probe", owner: null, order: 99, match: () => true, run: (p: any) => void seen.push(p) } as any);
  hit(336); // 153 + 153 + 30
  assert.deepEqual(hps(sq), [0, 0, 123, 153, 153, 153, 153, 153, 153, 153]);
  assert.deepEqual(ev("damage").map((e) => [e.soldier, e.amount]), [[0, 153], [1, 153], [2, 30]]);
  assert.deepEqual(ev("death").map((e) => e.soldier), [0, 1]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].amount, 336);
  assert.equal(seen[0].lost, 336);
  assert.equal(seen[0].soldier, 0);
  assert.equal(seen[0].killed, false);
});

test("a hit that wipes the squad stops there; the leader and heroes are untouched", () => {
  const { state, u, ev, hit } = setup();
  const sq = u(SQ_D);
  const seen: any[] = [];
  state.bus.subscribe({ event: "after_hit", id: "probe", owner: null, order: 99, match: () => true, run: (p: any) => void seen.push(p) } as any);
  const emp = u(EMPEROR), jas = u(JASMINE);
  const [e0, j0] = [emp.hp, jas.hp];
  hit(10000);
  assert.equal(sq.alive, false);
  assert.equal(ev("damage").length, 10);
  assert.equal(ev("damage").reduce((n, e) => n + e.amount, 0), 1530);
  assert.equal(ev("death").filter((e) => e.unit === SQ_D && e.soldier === undefined).length, 1); // one wipe event
  assert.deepEqual([emp.hp, jas.hp], [e0, j0]);
  assert.equal(ev("damage").some((e) => e.target !== SQ_D), false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].amount, 10000); // raw damage of the hit, as for a hero
  assert.equal(seen[0].lost, 1530); // HP actually removed
  assert.equal(seen[0].killed, true);
});

test("area hits resolve once against the squad and overflow like single-target ones (Decision 130)", () => {
  const { pack, x, u, ev } = setup();
  const sq = u(SQ_D);
  sq.soldiers[2]!.hp = 10;
  syncSquad(sq);
  const seen: any[] = [];
  x.state.bus.subscribe({ event: "after_hit", id: "probe", owner: null, order: 99, match: () => true, run: (p: any) => void seen.push(p) } as any);
  const sk = pack.byId.skills.get("skl_cav_active_001") as Skill;
  const eff = { ...(sk.effects.find((e) => e.type === "damage") as DamageEffect), multiplier: 3 } as DamageEffect;
  x.state.bus.beginAction();
  hitSquad(x, u(LEON), sq, sk, eff, true); // 115 x 3 x 1.25 = 431.25 vs summed DEF 182: 249
  const dmg = ev("damage").filter((e) => e.target === SQ_D);
  assert.deepEqual(dmg.map((e) => [e.soldier, e.amount, e.spill ?? false]), [[2, 10, false], [0, 153, true], [1, 86, true]]);
  assert.equal(ev("roll").filter((e) => e.kind === "hit").length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].single, false); // the event still says it was an area hit
  assert.equal(seen[0].amount, 249);
});

test("a Fairy's Grace-guarded last soldier stops the overflow", () => {
  const { state, u, ev, hit } = setup();
  const sq = u(SQ_D);
  for (const s of sq.soldiers.slice(1)) { s.alive = false; s.hp = 0; }
  syncSquad(sq);
  applyStatus(state, sq, "buff_003", "active", JASMINE);
  hit(500);
  assert.equal(sq.alive, true);
  assert.equal(ev("damage").length, 1); // no carry: nobody else to carry to, and the soldier was saved
  assert.equal(ev("death_intercepted").length, 1);
  assert.equal(sq.soldiers[0]!.hp, Math.max(1, Math.floor(0.2 * 153)));
});

test("overflow reaching the last soldier through the guard: earlier soldiers die, the last is saved", () => {
  const { state, u, ev, hit } = setup();
  const sq = u(SQ_D);
  for (const s of sq.soldiers.slice(2)) { s.alive = false; s.hp = 0; }
  syncSquad(sq);
  applyStatus(state, sq, "buff_003", "active", JASMINE);
  hit(1000);
  assert.equal(sq.alive, true);
  assert.deepEqual(ev("damage").map((e) => e.soldier), [0, 1]);
  assert.deepEqual(ev("death").map((e) => e.soldier), [0]);
  assert.equal(sq.soldiers[1]!.hp, 30); // 20% of 153
});

test("Fairy's Grace saving the last soldier mid-chain ends the chain; after_hit lost counts only the HP the soldiers had", () => {
  const { state, u, ev, hit } = setup();
  const sq = u(SQ_D);
  for (const s of sq.soldiers.slice(3)) { s.alive = false; s.hp = 0; }
  sq.soldiers[0]!.hp = 30;
  syncSquad(sq);
  applyStatus(state, sq, "buff_003", "active", JASMINE);
  const seen: any[] = [];
  state.bus.subscribe({ event: "after_hit", id: "probe", owner: null, order: 99, match: () => true, run: (p: any) => void seen.push(p) } as any);
  hit(1000); // 30 kills soldier 0, 153 kills soldier 1, soldier 2 (the last) is saved with 153 HP removed; 664 left over goes nowhere
  assert.equal(sq.alive, true);
  assert.deepEqual(ev("damage").map((e) => [e.soldier, e.amount]), [[0, 30], [1, 153], [2, 153]]);
  assert.equal(ev("death_intercepted").length, 1);
  assert.equal(sq.soldiers[2]!.hp, Math.max(1, Math.floor(0.2 * 153)));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].amount, 1000);
  assert.equal(seen[0].lost, 336);
  assert.equal(seen[0].killed, false);
});
