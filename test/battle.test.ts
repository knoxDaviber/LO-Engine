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
  // leader forced to the front row counts toward the front row
  assert.ok(run((b) => { crowd(b, 4); b.challenger.heroes[3].preferred_row = "back"; b.challenger.heroes[0].preferred_row = "back"; b.challenger.heroes[1].preferred_row = "front"; })
    .includes("E_BATTLE_ROW_FULL") === false);
});

test("buildUnits throws on a full row instead of clamping the column", async () => {
  const { loadReal } = await import("./engineHelpers");
  const { createBattleState } = await import("../src/engine");
  const { pack, battle } = loadReal();
  crowd(battle, 4);
  assert.throws(() => createBattleState(pack, battle), /E_BATTLE_ROW_FULL/);
});
