import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../src/load";
import { validateRaw } from "../src/validate";
import { fresh } from "./helpers";

const sampleBattle = () => structuredClone((loadPack("content").battles ?? []).find((b) => b.name === "sample.yaml")!.data) as any;
const run = (mutate: (b: any) => void) => {
  const raw = fresh();
  const b = sampleBattle();
  mutate(b);
  raw.battles = [{ name: "bad.yaml", data: b }];
  return validateRaw(raw).report.issues.filter((i) => i.severity === "error").map((i) => i.code);
};

test("sample battle validates with 0 errors", () => {
  const { report } = validateRaw(loadPack("content"));
  assert.deepEqual(report.issues.filter((i) => i.severity === "error"), []);
  assert.ok((loadPack("content").battles ?? []).some((b) => b.name === "sample.yaml"));
});

test("E_BATTLE_SIZE: empty side and oversized side", () => {
  assert.ok(run((b) => { b.challenger.heroes = []; }).includes("E_BATTLE_SIZE"));
  assert.ok(run((b) => {
    b.challenger.heroes = Array.from({ length: 5 }, () => structuredClone(b.challenger.heroes[0]));
  }).includes("E_BATTLE_SIZE"));
});

test("E_BATTLE_LEADER: leader not on that side", () => {
  assert.ok(run((b) => { b.challenger.leader = "char_002"; }).includes("E_BATTLE_LEADER"));
});

test("E_BATTLE_DUP: hero on both sides, and twice on one side", () => {
  assert.ok(run((b) => { b.defender.heroes[0].char_id = "char_001"; b.defender.heroes[0].tactic_sheet = []; }).includes("E_BATTLE_DUP"));
  assert.ok(run((b) => { b.challenger.heroes.push(structuredClone(b.challenger.heroes[0])); }).includes("E_BATTLE_DUP"));
});

test("E_BATTLE_SEEDS: wrong count, negative, non-integer", () => {
  assert.ok(run((b) => { b.seeds = [1, 2]; }).includes("E_BATTLE_SEEDS"));
  assert.ok(run((b) => { b.seeds = [1, -2, 3]; }).includes("E_BATTLE_SEEDS"));
  assert.ok(run((b) => { b.seeds = [1, 2.5, 3]; }).includes("E_BATTLE_SEEDS"));
});

test("roster hero checks apply to battle heroes", () => {
  assert.ok(run((b) => { b.challenger.heroes[0].tactic_sheet[0].skill_id = "skl_heal_active_001"; }).includes("E_TACTIC_SKILL"));
  assert.ok(run((b) => { b.challenger.heroes[0].char_id = "char_999"; }).includes("E_REF_MISSING"));
});

test("E_BATTLE_TERRAIN: battlefield must name a known terrain; null/absent means none; bonus_on_terrain refs are checked", () => {
  const withTerrain = (battlefield: unknown, mutate: (raw: ReturnType<typeof fresh>) => void = () => {}) => {
    const raw = fresh();
    raw.terrains = [...(raw.terrains ?? []), { id: "terrain_901", name: "Test Field", description: "", modifiers: [{ classes: ["cavalry"], stat: "SPD", mode: "percent", value: -10 }] }]; // keep the real terrains: content skills reference them
    mutate(raw);
    raw.battles = [{ name: "t.yaml", data: { ...sampleBattle(), battlefield } }];
    return validateRaw(raw).report.issues.filter((i) => i.severity === "error").map((i) => i.code);
  };
  assert.ok(withTerrain("terrain_999").includes("E_BATTLE_TERRAIN"));
  assert.deepEqual(withTerrain("terrain_901"), []);
  assert.deepEqual(withTerrain(null), []);
  const ref = withTerrain(null, (raw) => {
    const dmg = (raw.skills as any[]).flatMap((s) => s.effects).find((e: any) => e.type === "damage");
    dmg.bonus_on_terrain = [{ terrain: "terrain_999", modifier_percent: 20 }];
  });
  assert.ok(ref.includes("E_REF_MISSING"));
});

test("strict objects: unknown field rejected", () => {
  assert.ok(run((b) => { b.extra = 1; }).length > 0);
});

test("E_BATTLE_SEEDS: seeds must be below 2^32", () => {
  assert.ok(run((b) => { b.seeds = [1, 2, 2 ** 32]; }).includes("E_BATTLE_SEEDS"));
  assert.ok(!run((b) => { b.seeds = [1, 2, 2 ** 32 - 1]; }).includes("E_BATTLE_SEEDS"));
});

const crowd = (b: any, n: number) => {
  const ids = ["char_001", "char_002", "char_003", "char_004"];
  b.challenger.heroes = ids.slice(0, n).map((id) => ({ ...structuredClone(b.challenger.heroes[0]), char_id: id, preferred_row: "front" }));
  b.challenger.leader = "char_001";
};

test("E_BATTLE_ROW_FULL: more heroes in a row than board columns", () => {
  assert.ok(run((b) => crowd(b, 4)).includes("E_BATTLE_ROW_FULL")); // 4 in front, 3 columns
  assert.ok(!run((b) => crowd(b, 3)).includes("E_BATTLE_ROW_FULL"));
  // the leader is not forced front: with it in the back row, the front row of 3 fits
  assert.ok(!run((b) => { crowd(b, 4); b.challenger.heroes[0].preferred_row = "back"; }).includes("E_BATTLE_ROW_FULL"));
});

test("E_BATTLE_SLOT: explicit slots (duplicates, column beyond the board); edits are checked too", () => {
  const two = (b: any, over0: any, over1: any) => { crowd(b, 2); Object.assign(b.challenger.heroes[0], over0); Object.assign(b.challenger.heroes[1], over1); };
  const slots = (m: (b: any) => void) => run(m).filter((k) => k === "E_BATTLE_SLOT" || k === "E_BATTLE_ROW_FULL"); // crowd's clones bring unrelated errors
  assert.ok(run((b) => two(b, { column: 2 }, { column: 2 })).includes("E_BATTLE_SLOT"));
  assert.ok(!run((b) => two(b, { column: 2 }, { column: 1 })).includes("E_BATTLE_SLOT"));
  assert.ok(!run((b) => two(b, { column: 2 }, { column: 2, preferred_row: "back" })).includes("E_BATTLE_SLOT"), "same column, other row");
  assert.ok(run((b) => two(b, { column: 4 }, {})).includes("E_BATTLE_SLOT"), "column beyond rules.board.columns");
  assert.deepEqual(slots((b) => two(b, { column: 4 }, {})), ["E_BATTLE_SLOT"], "one cause, one error: no E_BATTLE_ROW_FULL");
  assert.deepEqual(slots((b) => two(b, { column: 4 }, { column: 4 })), ["E_BATTLE_SLOT", "E_BATTLE_SLOT"], "per entry, no extra clash error");
  assert.deepEqual(slots((b) => { two(b, { column: 1 }, {}); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_002", column: 4 }] }]; }), ["E_BATTLE_SLOT"], "edit column beyond the board");
  assert.deepEqual(slots((b) => { two(b, { column: 4 }, {}); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_001", tactic_sheet: [] }] }]; }), ["E_BATTLE_SLOT"], "not re-reported by an edit that leaves the column");
  assert.deepEqual(slots((b) => { two(b, { column: 4 }, {}); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_001", column: null }] }]; }), ["E_BATTLE_SLOT"], "phase 1 still bad; column: null is accepted");
  assert.deepEqual(slots((b) => { two(b, { column: 2 }, { column: 2 }); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_001", tactic_sheet: [] }] }, { phase: 3, heroes: [] }]; }), ["E_BATTLE_SLOT"], "a clash standing before the edits is reported once");
  assert.deepEqual(slots((b) => { two(b, { column: 2 }, { column: 1 }); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_002", column: null }] }]; }), [], "column: null = back to auto");
  assert.ok(run((b) => two(b, { column: 0 }, {})).length > 0, "schema: column >= 1");
  assert.ok(run((b) => { two(b, { column: 1 }, { column: 2 }); b.challenger.edits = [{ phase: 2, heroes: [{ char_id: "char_002", column: 1 }] }]; }).includes("E_BATTLE_SLOT"));
  assert.ok(!run((b) => { two(b, { column: 1 }, { column: 2 }); b.challenger.edits = [
    { phase: 2, heroes: [{ char_id: "char_001", column: 2 }, { char_id: "char_002", column: 1 }] }]; }).includes("E_BATTLE_SLOT"), "a swap in one edit is fine");
});

test("buildUnits throws on a full row instead of clamping the column", async () => {
  const { loadReal } = await import("./engineHelpers");
  const { createBattleState } = await import("../src/engine");
  const { pack, battle } = loadReal();
  crowd(battle, 4);
  assert.throws(() => createBattleState(pack, battle), /E_BATTLE_ROW_FULL/);
  const off = loadReal();
  off.battle.challenger.heroes[0]!.column = 9;
  assert.throws(() => createBattleState(off.pack, off.battle), /E_BATTLE_SLOT/);
});

test("battle hero entries get the sigil checks: unknown god E_REF_MISSING, sigil on an empty slot W_SIGIL_EMPTY_SLOT; sigils are locked between phases", () => {
  assert.ok(run((b) => { b.challenger.heroes[0].sigils = { weapon: "god_999" }; b.challenger.heroes[0].equipment.weapon = "equip_009"; }).includes("E_REF_MISSING"));
  const raw = fresh();
  const b = sampleBattle();
  b.challenger.heroes[0].equipment = { weapon: null, armor: null, accessory_1: null, accessory_2: null };
  b.challenger.heroes[0].sigils = { armor: "god_001" };
  raw.battles = [{ name: "warn.yaml", data: b }];
  const issues = validateRaw(raw).report.issues;
  assert.deepEqual(issues.filter((i) => i.code === "W_SIGIL_EMPTY_SLOT").map((i) => i.path), ["challenger.heroes[0].sigils.armor"]);
  assert.ok(run((x) => { x.challenger.edits = [{ phase: 2, heroes: [{ char_id: x.challenger.heroes[0].char_id, sigil_side: "atk" }] }]; }).includes("E_EDIT_LOCKED"));
  assert.ok(run((x) => { x.challenger.edits = [{ phase: 2, heroes: [{ char_id: x.challenger.heroes[0].char_id, sigils: { weapon: "god_001" } }] }]; }).includes("E_EDIT_LOCKED"));
});
