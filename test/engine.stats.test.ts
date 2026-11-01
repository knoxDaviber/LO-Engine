import { test } from "node:test";
import assert from "node:assert/strict";
import type { Status } from "../src/schema";
import { applyStatus, completeAction, effectiveStat, statBreakdown, type StatusInstance } from "../src/engine";
import { LEON, sampleState, unit } from "./engineHelpers";

/** Lookup extended with test-only statuses. */
function lookup(state = sampleState(), extra: Record<string, Partial<Status> & { stat: any; value: number; unique?: boolean }> = {}) {
  const statuses = new Map(state.pack.byId.statuses);
  for (const [id, x] of Object.entries(extra)) {
    const base = structuredClone(state.pack.byId.statuses.get("buff_005")!);
    statuses.set(id, { ...base, id, modifiers: [{ stat: x.stat, mode: (x as any).mode ?? "percent", value: x.value }], stacking: { ...base.stacking, unique: !!x.unique } });
  }
  return { state, pack: { byId: { statuses } } as any };
}
let seq = 0;
const inst = (statusId: string, category: StatusInstance["category"]): StatusInstance => ({ statusId, category, sourceUnitId: "x", remaining: 1, skipNextTick: false, seq: seq++ });

test("base stat with equipment flat lines", () => {
  const { state, pack } = lookup();
  const leon = unit(state, LEON);
  assert.equal(effectiveStat(leon, "ATK", pack), 70);
  leon.equipFlat.ATK = 60;
  const b = statBreakdown(leon, "ATK", pack);
  assert.deepEqual([b.base, b.flat, b.multiplier, b.result], [70, 60, 1, 130]);
});

test("active 20% vs active 30% on the same stat = 30%; suppressed effect resumes", () => {
  const { state, pack } = lookup(undefined, { buff_x30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "active"), inst("buff_x30", "active"));
  const b = statBreakdown(leon, "ATK", pack);
  assert.equal(b.result, 70 * 1.3);
  assert.deepEqual(b.effects.map((e) => [e.status, e.outcome]), [["buff_005", "suppressed"], ["buff_x30", "winner"]]);
  leon.statuses = leon.statuses.filter((s) => s.statusId !== "buff_x30");
  assert.equal(effectiveStat(leon, "ATK", pack), 70 * 1.2);
});

test("a unique status multiplies with same-category effects", () => {
  const { state, pack } = lookup(undefined, { buff_x30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "active"), inst("buff_x30", "active"), inst("status_002", "active")); // Berserk: unique +50 ATK
  const b = statBreakdown(leon, "ATK", pack);
  assert.ok(Math.abs(b.result - 70 * 1.5 * 1.3) < 1e-9);
  assert.equal(b.effects.find((e) => e.status === "status_002")!.outcome, "winner");
  assert.equal(b.effects.find((e) => e.status === "buff_005")!.outcome, "suppressed");
});

test("passive x active = 1.44 (stats level)", () => {
  const { state, pack } = lookup();
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "passive"), inst("buff_005", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "ATK", pack) - 70 * 1.44) < 1e-9);
});

test("strongest wins is per stat", () => {
  const { state, pack } = lookup(undefined, { buff_atk30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  // Berserk-like: a status that buffs ATK and DEF is not cancelled as a whole by a bigger ATK-only buff.
  leon.statuses.push(inst("buff_004", "active"), inst("buff_atk30", "active"), inst("buff_005", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "DEF", pack) - 50 * 1.2) < 1e-9);
  assert.ok(Math.abs(effectiveStat(leon, "ATK", pack) - 70 * 1.3) < 1e-9);
});

test("debuffs mirror buffs and multiply with buffs; flat modifiers add", () => {
  const { state, pack } = lookup(undefined, { debuff_x30: { stat: "DEF", value: -30 }, flat10: { stat: "DEF", mode: "flat", value: 10 } as any });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("debuff_001", "active"), inst("debuff_x30", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "DEF", pack) - 50 * 0.7) < 1e-9); // strongest debuff in the category
  leon.statuses.push(inst("debuff_001", "passive"), inst("buff_004", "active"), inst("flat10", "active"));
  const b = statBreakdown(leon, "DEF", pack);
  assert.ok(Math.abs(b.result - (50 + 10) * 0.7 * 0.8 * 1.2) < 1e-9);
  assert.equal(b.flat, 10);
});

test("applyStatus resolves inherit, refreshes within a category, coexists across categories", () => {
  const state = sampleState();
  const leon = unit(state, LEON);
  applyStatus(state, leon, "buff_005", "active", LEON);
  applyStatus(state, leon, "buff_005", "active", LEON);
  assert.equal(leon.statuses.length, 1);
  assert.equal(leon.statuses[0]!.category, "active");
  applyStatus(state, leon, "buff_005", "passive", LEON);
  assert.equal(leon.statuses.length, 2);
  assert.ok(Math.abs(effectiveStat(leon, "ATK", state.pack) - 70 * 1.44) < 1e-9);
});

test("Stun is instant: applied, but nothing is stored on the unit (the caller runs the pushback)", () => {
  const state = sampleState();
  const r = applyStatus(state, unit(state, LEON), "status_001", "active", LEON);
  assert.equal(r.applied, true);
  assert.equal(r.instant, true);
  assert.deepEqual(unit(state, LEON).statuses, []);
});

test("1 turn ends only on an active skill use; idle does not count; applying action counts per status", () => {
  const state = sampleState();
  const leon = unit(state, LEON);
  applyStatus(state, leon, "buff_007", "active", LEON); // SPD UP: 1 turn, applying action does not count
  completeAction(state, leon, true); // the casting action
  assert.equal(leon.statuses.length, 1);
  completeAction(state, leon, false); // idle
  assert.equal(leon.statuses.length, 1);
  assert.deepEqual(completeAction(state, leon, true), ["buff_007"]);
  applyStatus(state, leon, "buff_004", "active", LEON); // DEF UP: 2 turns, applying action counts
  completeAction(state, leon, true);
  assert.equal(leon.statuses.length, 1);
  assert.deepEqual(completeAction(state, leon, true), ["buff_004"]);
});

test("battle state: rows, columns, formation order, PP", () => {
  const state = sampleState();
  const rows = state.units.map((u) => [u.id, u.side, u.row, u.column, u.formationIndex]);
  assert.deepEqual(rows, [
    ["char_001", "challenger", "front", 1, 0], ["char_004", "challenger", "front", 2, 1],
    ["char_002", "defender", "front", 1, 0], ["char_003", "defender", "back", 1, 1],
  ]);
  assert.equal(unit(state, LEON).maxHp, 150);
  assert.deepEqual(unit(state, LEON).pp.active, { cur: 2, max: 2 });
});

test("a status applied to another unit ticks on that unit's very next action (applying_action_counts false)", () => {
  const state = sampleState();
  const enemy = unit(state, "char_002");
  applyStatus(state, enemy, "debuff_001", "active", LEON); // count 2, applying_action_counts false, applied by an ally of Leon
  assert.equal(enemy.statuses[0]!.skipNextTick, false);
  completeAction(state, enemy, true); // enemy's 1st action
  assert.equal(enemy.statuses.length, 1);
  assert.deepEqual(completeAction(state, enemy, true), ["debuff_001"]); // expires after the 2nd, not the 3rd
  // reapplication by another unit does not re-arm the skip
  applyStatus(state, enemy, "debuff_001", "active", LEON);
  applyStatus(state, enemy, "debuff_001", "active", LEON);
  assert.equal(enemy.statuses[0]!.skipNextTick, false);
});
