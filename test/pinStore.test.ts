import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIN_DEFAULT_HEIGHT, PIN_MAX_HEIGHT, PIN_MIN_HEIGHT, addPin, clampHeight, movePin, parsePins, parseState, removePin, serializeState, shiftPin, togglePin, type Pin,
} from "../editor/src/pinStore";
import { loadJson, parseRoute, saveJson } from "../editor/src/store";

const pin = (id: string): Pin => ({ id, kind: "panel", ref: id, title: id });
const ids = (ps: Pin[]) => ps.map((p) => p.id);

test("pins: add dedupes by id, remove and toggle", () => {
  let ps = addPin([], pin("a"));
  ps = addPin(ps, pin("b"));
  assert.equal(addPin(ps, pin("a")), ps, "duplicate leaves the list as it was");
  assert.deepEqual(ids(removePin(ps, "a")), ["b"]);
  assert.equal(removePin(ps, "zzz"), ps);
  assert.deepEqual(ids(togglePin(ps, pin("a"))), ["b"]);
  assert.deepEqual(ids(togglePin(ps, pin("c"))), ["a", "b", "c"]);
});

test("pins: move and shift clamp to the list and ignore unknown ids", () => {
  const ps = ["a", "b", "c", "d"].map(pin);
  assert.deepEqual(ids(movePin(ps, "a", 2)), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(movePin(ps, "d", 0)), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(movePin(ps, "a", 99)), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(movePin(ps, "c", -5)), ["c", "a", "b", "d"]);
  assert.equal(movePin(ps, "nope", 1), ps);
  assert.deepEqual(ids(shiftPin(ps, "b", -1)), ["b", "a", "c", "d"]);
  assert.equal(shiftPin(ps, "a", -1), ps, "already first");
  assert.equal(shiftPin(ps, "d", 1), ps, "already last");
  assert.deepEqual(ids(ps), ["a", "b", "c", "d"], "input not mutated");
});

test("pins: height is clamped", () => {
  assert.equal(clampHeight(5), PIN_MIN_HEIGHT);
  assert.equal(clampHeight(99999), PIN_MAX_HEIGHT);
  assert.equal(clampHeight(300.4), 300);
  assert.equal(clampHeight(NaN), PIN_DEFAULT_HEIGHT);
});

test("pins: parse ignores junk, drops duplicates, tolerates bad JSON and old shapes", () => {
  const good = { id: "page:units", kind: "page" as const, ref: "units", title: "Units" };
  assert.deepEqual(parsePins([good, { id: 1 }, null, "x", { ...good, kind: "weird" }, good]), [good]);
  assert.deepEqual(parsePins("{not json"), []);
  assert.deepEqual(parsePins(undefined), []);
  assert.deepEqual(parsePins(JSON.stringify([good])), [good]);
  const s = parseState({ pins: [good], height: 5000, collapsed: "yes" });
  assert.deepEqual(s, { pins: [good], height: PIN_MAX_HEIGHT, collapsed: false });
  assert.deepEqual(parseState([good]).pins, [good]);
  assert.deepEqual(parseState(null), { pins: [], height: PIN_DEFAULT_HEIGHT, collapsed: false });
  const round = parseState(JSON.parse(serializeState({ pins: [good], height: 300, collapsed: true })));
  assert.deepEqual(round, { pins: [good], height: 300, collapsed: true });
});

test("store: loadJson/saveJson survive a missing localStorage; routes parse with a fallback", () => {
  assert.equal(loadJson("k", 7), 7);
  assert.doesNotThrow(() => saveJson("k", { a: 1 }));
  assert.equal(parseRoute("#/units"), "units");
  assert.equal(parseRoute("#/log"), "log");
  assert.equal(parseRoute(""), "battle");
  assert.equal(parseRoute("#/nope"), "battle");
  assert.equal(parseRoute("#main"), "battle");
});

test("store: round trip through a working localStorage, and a throwing one", () => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  try {
    saveJson("k", { a: [1] });
    assert.deepEqual(loadJson("k", null), { a: [1] });
    mem.set("bad", "{oops");
    assert.equal(loadJson("bad", "fb"), "fb");
    (globalThis as any).localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    assert.equal(loadJson("k", "fb"), "fb");
    assert.doesNotThrow(() => saveJson("k", 1));
  } finally {
    delete (globalThis as any).localStorage;
  }
});
