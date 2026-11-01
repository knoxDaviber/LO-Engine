import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStatus, evaluateCondition, type CondContext } from "../src/engine";
import { EMPEROR, JASMINE, LEON, LIEF, sampleState, unit } from "./engineHelpers";

const ev = (node: any, ctx: Partial<CondContext> & { state: any; self: any }) => evaluateCondition(node, ctx as CondContext);

test("null condition is true", () => {
  const s = sampleState();
  assert.deepEqual(ev(null, { state: s, self: unit(s, LEON) }), { value: true, reasons: [] });
});

test("hp_percent, hp_current, hp_missing on self and target", () => {
  const s = sampleState();
  const leon = unit(s, LEON), emp = unit(s, EMPEROR);
  emp.hp = 50; // 25% of 200
  assert.equal(ev({ type: "hp_percent", side: "self", op: "=", value: 100 }, { state: s, self: leon }).value, true);
  assert.equal(ev({ type: "hp_percent", side: "target", op: "<", value: 30 }, { state: s, self: leon, target: emp }).value, true);
  assert.equal(ev({ type: "hp_current", side: "target", op: ">=", value: 51 }, { state: s, self: leon, target: emp }).value, false);
  assert.equal(ev({ type: "hp_missing", side: "target", op: "=", value: 150 }, { state: s, self: leon, target: emp }).value, true);
});

test("side target without a target in context is false with a reason", () => {
  const s = sampleState();
  const r = ev({ type: "hp_percent", side: "target", op: "<", value: 100 }, { state: s, self: unit(s, LEON) });
  assert.equal(r.value, false);
  assert.equal(r.reasons.length, 1);
});

test("side ally/enemy: existential without a candidate, membership with one", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  unit(s, JASMINE).hp = 10;
  assert.equal(ev({ type: "hp_percent", side: "enemy", op: "<", value: 20 }, { state: s, self: leon }).value, true);
  assert.equal(ev({ type: "hp_percent", side: "ally", op: "<", value: 20 }, { state: s, self: leon }).value, false);
  assert.equal(ev({ type: "hp_percent", side: "enemy", op: "<", value: 20 }, { state: s, self: leon, target: unit(s, JASMINE) }).value, true);
  assert.equal(ev({ type: "hp_percent", side: "ally", op: "<", value: 20 }, { state: s, self: leon, target: unit(s, JASMINE) }).value, false); // candidate not an ally
});

test("unit_kind, row_is, class_is", () => {
  const s = sampleState();
  const leon = unit(s, LEON), jas = unit(s, JASMINE);
  assert.equal(ev({ type: "unit_kind", is: "hero" }, { state: s, self: leon }).value, true);
  assert.equal(ev({ type: "unit_kind", is: "soldier" }, { state: s, self: leon }).value, false);
  assert.equal(ev({ type: "unit_kind", ignore: "soldier" }, { state: s, self: leon }).value, true);
  assert.equal(ev({ type: "row_is", value: "back" }, { state: s, self: leon, target: jas }).value, true);
  assert.equal(ev({ type: "row_is", value: "front" }, { state: s, self: leon, target: jas }).value, false);
  assert.equal(ev({ type: "row_is", value: "soldier_front" }, { state: s, self: leon, target: leon }).value, false);
  assert.equal(ev({ type: "class_is", side: "target", value: "holy" }, { state: s, self: leon, target: jas }).value, true);
  assert.equal(ev({ type: "class_is", side: "self", value: "holy" }, { state: s, self: leon }).value, false);
});

test("has_status / lacks_status", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  const c = (type: string) => ev({ type, side: "self", status_id: "buff_005" }, { state: s, self: leon }).value;
  assert.deepEqual([c("has_status"), c("lacks_status")], [false, true]);
  applyStatus(s, leon, "buff_005", "active", LEON);
  assert.deepEqual([c("has_status"), c("lacks_status")], [true, false]);
});

test("phase works in a condition", () => {
  const s1 = sampleState(1), s2 = sampleState(2);
  const node = { type: "phase", op: ">=", value: 2 };
  assert.equal(ev(node, { state: s1, self: unit(s1, LEON) }).value, false);
  assert.equal(ev(node, { state: s2, self: unit(s2, LEON) }).value, true);
});

test("all / any / not", () => {
  const s = sampleState();
  const T = { type: "phase", op: "=", value: 1 }, F = { type: "phase", op: "=", value: 2 };
  const c = { state: s, self: unit(s, LEON) };
  assert.equal(ev({ all: [T, F] }, c).value, false);
  assert.equal(ev({ all: [T, T] }, c).value, true);
  assert.equal(ev({ any: [F, T] }, c).value, true);
  assert.equal(ev({ any: [F, F] }, c).value, false);
  assert.equal(ev({ not: F }, c).value, true);
  assert.equal(ev({ not: T }, c).value, false);
});

test("a leaf outside the registry is false with 'not implemented: <type>', also under all/any/not", () => {
  const s = sampleState();
  const c = { state: s, self: unit(s, LEON) };
  const leaf = { type: "made_up_leaf", side: "self", op: ">", value: 0 };
  assert.deepEqual(ev(leaf, c), { value: false, reasons: ["not implemented: made_up_leaf"] });
  assert.deepEqual(ev({ all: [leaf, { type: "phase", op: "=", value: 1 }] }, c), { value: false, reasons: ["not implemented: made_up_leaf"] });
  const n = ev({ not: leaf }, c);
  assert.equal(n.value, false); // an unknown leaf never turns true by negation
  assert.deepEqual(n.reasons, ["not implemented: made_up_leaf"]);
  assert.equal(ev({ any: [leaf, { type: "phase", op: "=", value: 1 }] }, c).value, true);
});
