import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStatus, compareEntries, nextAction, pendingOrder, rescheduleOnSpdChange, scheduleInitial, scheduleNext, spdInterval } from "../src/engine";
import { EMPEROR, JASMINE, LEON, LIEF, sampleState, unit } from "./engineHelpers";

const order = (s: ReturnType<typeof sampleState>) => pendingOrder(s).map((e) => e.unitId);

test("interval = round(1000 / max(SPD, 5))", () => {
  const { pack } = sampleState();
  assert.equal(spdInterval(pack, 50), 20);
  assert.equal(spdInterval(pack, 30), 33);
  assert.equal(spdInterval(pack, 1), 200);
  assert.equal(spdInterval(pack, 0), 200);
});

test("initial order, nobody at 0, clock jumps to the earliest action", () => {
  const s = sampleState();
  scheduleInitial(s);
  assert.equal(s.timeline.pending.size, 4);
  assert.deepEqual(order(s), [LEON, LIEF, EMPEROR, JASMINE]); // 20, 25, 33, 33 (formation order breaks the last tie)
  assert.ok([...s.timeline.pending.values()].every((e) => e.due > 0));
  const a = nextAction(s)!;
  assert.equal(a.unit.id, LEON);
  assert.equal(s.timeline.now, 20);
  assert.equal(s.timeline.pending.has(LEON), false); // one entry per actor: popped until rescheduled
  scheduleNext(s, a.unit);
  assert.equal(s.timeline.pending.size, 4);
  assert.equal(s.timeline.pending.get(LEON)!.due, 40);
});

test("tie: same side goes by formation order, then unit id", () => {
  const s = sampleState();
  unit(s, LIEF).baseStats.SPD = 50; // ties with Leon at 20
  scheduleInitial(s);
  assert.deepEqual(order(s).slice(0, 2), [LEON, LIEF]);
  unit(s, LIEF).formationIndex = 0; // same formation slot: unit id decides
  unit(s, LEON).formationIndex = 0;
  assert.deepEqual(order(s).slice(0, 2), [LEON, LIEF]);
  unit(s, LEON).formationIndex = 1;
  assert.deepEqual(order(s).slice(0, 2), [LIEF, LEON]);
});

test("tie: simultaneous actions go to the higher average SKL, then the challenger", () => {
  const s = sampleState();
  unit(s, EMPEROR).baseStats.SPD = 50; // ties with Leon at 20
  scheduleInitial(s);
  assert.equal(order(s)[0], LEON); // challenger avg SKL 87.5 > defender 70
  unit(s, LEON).baseStats.SKL = 10; // 45 < 70
  assert.equal(order(s)[0], EMPEROR);
  unit(s, LEON).baseStats.SKL = 60; // 70 = 70: challenger
  assert.equal(order(s)[0], LEON);
});

test("tie: speed-change ties are FILO", () => {
  const mk = (first: string, second: string) => {
    const s = sampleState();
    scheduleInitial(s);
    for (const id of [first, second]) {
      applyStatus(s, unit(s, id), "buff_007", "active", id);
      rescheduleOnSpdChange(s, unit(s, id));
    }
    return s;
  };
  const a = mk(EMPEROR, JASMINE); // both SPD 30 -> 34.5 -> interval 29, due 29
  assert.equal(a.timeline.pending.get(EMPEROR)!.due, 29);
  assert.deepEqual(order(a).filter((id) => id === EMPEROR || id === JASMINE), [JASMINE, EMPEROR]); // last changed acts first
  const b = mk(JASMINE, EMPEROR);
  assert.deepEqual(order(b).filter((id) => id === EMPEROR || id === JASMINE), [EMPEROR, JASMINE]);
});

test("SPD change preserves the elapsed fraction of the interval", () => {
  const s = sampleState();
  scheduleInitial(s);
  nextAction(s); // Leon at 20
  const emp = unit(s, EMPEROR);
  assert.equal(s.timeline.pending.get(EMPEROR)!.due, 33);
  applyStatus(s, emp, "buff_007", "active", EMPEROR);
  assert.equal(rescheduleOnSpdChange(s, emp), true);
  // elapsed 20/33, remaining 13/33 of the new interval 29 -> 20 + 11.4 -> 31
  assert.equal(s.timeline.pending.get(EMPEROR)!.due, 31);
  assert.equal(rescheduleOnSpdChange(s, emp), false); // nothing changed
});

test("SPD UP after Thousand Azure Hooves schedules Leon's next action sooner", () => {
  const plain = sampleState();
  scheduleInitial(plain);
  const a = nextAction(plain)!;
  scheduleNext(plain, a.unit);
  const without = plain.timeline.pending.get(LEON)!.due;

  const s = sampleState();
  scheduleInitial(s);
  const b = nextAction(s)!;
  applyStatus(s, b.unit, "buff_007", "active", LEON); // the skill's self-buff, applied after the action
  scheduleNext(s, b.unit);
  const withBuff = s.timeline.pending.get(LEON)!.due;
  assert.equal(without, 40);
  assert.equal(withBuff, 37); // SPD 57.5 -> interval 17
  assert.ok(withBuff < without);
});

test("tie order is a total order: changed entries first (FILO), then SKL/side/formation; independent of insertion order", () => {
  const { pack } = sampleState();
  const mk = () => {
    const s = sampleState();
    // three challenger units due at 1000; A (formation 2, changed seq 5), B (formation 1, unchanged), C (formation 0, changed seq 3)
    const [c, b, a] = [unit(s, LEON), unit(s, LIEF), unit(s, JASMINE)];
    a.side = b.side = c.side = "challenger";
    c.formationIndex = 0; b.formationIndex = 1; a.formationIndex = 2;
    const e = (u: typeof a, seq: number, changed: boolean) => ({ unitId: u.id, due: 1000, interval: 20, seq, changed });
    return { s, entries: [e(a, 5, true), e(b, 4, false), e(c, 3, true)], ids: { a: a.id, b: b.id, c: c.id } };
  };
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const { s, entries, ids } = mk();
  void pack;
  const results = new Set<string>();
  for (const p of perms(entries)) {
    s.timeline.pending.clear();
    for (const en of p) s.timeline.pending.set(en.unitId, en);
    results.add(order(s).join(","));
  }
  assert.deepEqual([...results], [[ids.a, ids.c, ids.b].join(",")]);
  // transitivity: every triple agrees with the sorted order
  const cmp = (x: any, y: any) => compareEntries(s, x, y);
  for (const [x, y, z] of perms(entries).map((p) => p as [any, any, any])) {
    if (cmp(x, y) < 0 && cmp(y, z) < 0) assert.ok(cmp(x, z) < 0);
  }
});
