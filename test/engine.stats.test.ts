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
  assert.equal(effectiveStat(leon, "ATK", pack), 115);
  leon.equipFlat.ATK = 60;
  const b = statBreakdown(leon, "ATK", pack);
  assert.deepEqual([b.base, b.flat, b.multiplier, b.result], [115, 60, 1, 175]);
});

test("active 20% vs active 30% on the same stat = 30%; suppressed effect resumes", () => {
  const { state, pack } = lookup(undefined, { buff_x30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "active"), inst("buff_x30", "active"));
  const b = statBreakdown(leon, "ATK", pack);
  assert.equal(b.result, 115 * 1.3);
  assert.deepEqual(b.effects.map((e) => [e.status, e.outcome]), [["buff_005", "suppressed"], ["buff_x30", "winner"]]);
  leon.statuses = leon.statuses.filter((s) => s.statusId !== "buff_x30");
  assert.equal(effectiveStat(leon, "ATK", pack), 115 * 1.2);
});

test("a unique status multiplies with same-category effects", () => {
  const { state, pack } = lookup(undefined, { buff_x30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "active"), inst("buff_x30", "active"), inst("status_002", "active")); // Berserk: unique +50 ATK
  const b = statBreakdown(leon, "ATK", pack);
  assert.ok(Math.abs(b.result - 115 * 1.5 * 1.3) < 1e-9);
  assert.equal(b.effects.find((e) => e.status === "status_002")!.outcome, "winner");
  assert.equal(b.effects.find((e) => e.status === "buff_005")!.outcome, "suppressed");
});

test("passive x active = 1.44 (stats level)", () => {
  const { state, pack } = lookup();
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "passive"), inst("buff_005", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "ATK", pack) - 115 * 1.44) < 1e-9);
});

test("strongest wins is per stat", () => {
  const { state, pack } = lookup(undefined, { buff_atk30: { stat: "ATK", value: 30 } });
  const leon = unit(state, LEON);
  // Berserk-like: a status that buffs ATK and DEF is not cancelled as a whole by a bigger ATK-only buff.
  leon.statuses.push(inst("buff_004", "active"), inst("buff_atk30", "active"), inst("buff_005", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "DEF", pack) - 70 * 1.2) < 1e-9);
  assert.ok(Math.abs(effectiveStat(leon, "ATK", pack) - 115 * 1.3) < 1e-9);
});

test("debuffs mirror buffs and multiply with buffs; flat modifiers add", () => {
  const { state, pack } = lookup(undefined, { debuff_x30: { stat: "DEF", value: -30 }, flat10: { stat: "DEF", mode: "flat", value: 10 } as any });
  const leon = unit(state, LEON);
  leon.statuses.push(inst("debuff_001", "active"), inst("debuff_x30", "active"));
  assert.ok(Math.abs(effectiveStat(leon, "DEF", pack) - 70 * 0.7) < 1e-9); // strongest debuff in the category
  leon.statuses.push(inst("debuff_001", "passive"), inst("buff_004", "active"), inst("flat10", "active"));
  const b = statBreakdown(leon, "DEF", pack);
  assert.ok(Math.abs(b.result - (70 + 10) * 0.7 * 0.8 * 1.2) < 1e-9);
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
  assert.ok(Math.abs(effectiveStat(leon, "ATK", state.pack) - 115 * 1.44) < 1e-9);
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
  assert.equal(unit(state, LEON).maxHp, 800);
  const leonPP = state.pack.byId.characters.get(LEON)!.pp; // content PP, not a literal
  assert.deepEqual(unit(state, LEON).pp.active, { cur: leonPP.active, max: leonPP.active });
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

test("INT/MDEF pairing: a skill status on ATK / DEF also applies to INT / MDEF as an entry of the same category; not for equipment", () => {
  const { state, pack } = lookup(undefined, { atk_int: { stat: "ATK", value: 30 } });
  (pack.byId.statuses.get("atk_int") as Status).modifiers.push({ stat: "INT", mode: "percent", value: 10 }); // the source names INT: no pairing
  const leon = unit(state, LEON);
  leon.statuses.push(inst("buff_005", "active"), inst("debuff_001", "passive")); // ATK +20% active, DEF -20% passive
  const int = statBreakdown(leon, "INT", pack);
  assert.deepEqual(int.effects.map((e) => [e.status, e.category, e.value, e.outcome]), [["buff_005", "active", 20, "winner"]]);
  assert.ok(Math.abs(int.result - 30 * 1.2) < 1e-9);
  assert.ok(Math.abs(effectiveStat(leon, "MDEF", pack) - 46 * 0.8) < 1e-9); // a debuff pairs too
  leon.statuses.push(inst("atk_int", "active")); // same category: strongest wins on INT between the paired +20% and the explicit +10%
  const int2 = statBreakdown(leon, "INT", pack);
  assert.deepEqual(int2.effects.map((e) => [e.status, e.value, e.outcome]), [["buff_005", 20, "winner"], ["atk_int", 10, "suppressed"]]);
  leon.statuses = [inst("buff_005", "equipment"), inst("buff_005", "prayer")]; // item and blessing statuses name their stats: never paired
  assert.equal(effectiveStat(leon, "INT", pack), 30);
});

test("PP override (what-if knob) replaces every hero's base PP before gear PP; the cap rises to override + gear", async () => {
  const { createBattleState } = await import("../src/engine");
  const { loadReal } = await import("./engineHelpers");
  const { pack, battle } = loadReal();
  battle.challenger.heroes[0]!.equipment.accessory_1 = "equip_002";
  const leonBase = pack.byId.characters.get(LEON)!.pp;
  const gearA = pack.byId.equipment.get("equip_002")!.pp_modifiers.active;
  const s = createBattleState(pack, battle, 1, { pp: { active: 5 } });
  assert.deepEqual(unit(s, LEON).pp.active, { cur: 5 + gearA, max: 5 + gearA });
  assert.deepEqual(unit(s, LEON).pp.passive, { cur: leonBase.passive, max: leonBase.passive }); // passive not overridden: content value
  assert.deepEqual(unit(s, "char_002").pp.active, { cur: 5, max: 5 });
  assert.deepEqual(unit(createBattleState(pack, battle, 1, { pp: { active: 0, passive: 1 } }), "char_002").pp, { active: { cur: 0, max: 0 }, passive: { cur: 1, max: 1 } });
  assert.deepEqual(unit(createBattleState(pack, battle), LEON).pp.active, { cur: Math.min(leonBase.active + gearA, pack.rules.pp.max), max: Math.min(leonBase.active + gearA, pack.rules.pp.max) });
});
