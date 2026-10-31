import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng, phaseRng } from "../src/engine";

const seq = (seed: number, n = 20) => { const r = createRng(seed); return Array.from({ length: n }, () => r.next()); };

test("same seed gives the same sequence", () => {
  assert.deepEqual(seq(101), seq(101));
});

test("different seeds give different sequences", () => {
  assert.notDeepEqual(seq(101), seq(102));
});

test("values are in [0, 1) and int() stays in range", () => {
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) { const v = r.next(); assert.ok(v >= 0 && v < 1); }
  for (let i = 0; i < 1000; i++) { const v = r.int(3); assert.ok(Number.isInteger(v) && v >= 0 && v < 3); }
  assert.equal(r.draws, 2000);
});

test("one stream per phase from battle.seeds[phase - 1]", () => {
  const battle = { seeds: [1, 2, 3] };
  const a = phaseRng(battle, 2), b = createRng(2);
  assert.equal(a.next(), b.next());
  assert.notEqual(phaseRng(battle, 1).next(), phaseRng(battle, 3).next());
  assert.throws(() => phaseRng(battle, 4));
});
