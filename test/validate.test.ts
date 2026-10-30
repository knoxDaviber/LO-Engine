import assert from "node:assert/strict";
import { test } from "node:test";
import { STATS, characterSchema, rulesSchema } from "../src/schema";
import { heroCost } from "../src/validate/cost";
import { validateContent, validateRaw } from "../src/validate";
import { codes, find, fresh, roster } from "./helpers";

test("real content has no errors", () => {
  const { report } = validateContent("content");
  assert.equal(report.errors, 0, JSON.stringify(report.issues.filter((i) => i.severity === "error"), null, 1));
});

test("STATS enum matches the stat block keys", () => {
  const keys = Object.keys((characterSchema.shape.base_stats as any).shape).sort();
  assert.deepEqual(keys, [...STATS].sort());
});

test("duplicate id", () => {
  const raw = fresh(); raw.skills.push(structuredClone(raw.skills[0]));
  assert.ok(codes(raw).includes("E_DUP_ID"));
});

test("unknown status reference", () => {
  const raw = fresh();
  const s = (raw.skills as any[]).find((x) => x.effects.some((e: any) => e.type === "apply_status"));
  s.effects.find((e: any) => e.type === "apply_status").status_id = "nope";
  assert.ok(codes(raw).includes("E_REF_MISSING"));
});

test("pp pool mismatch", () => {
  const raw = fresh(); const s = (raw.skills as any[]).find((x) => x.category === "active"); s.pp_pool = "passive";
  assert.ok(codes(raw).includes("E_PP_POOL_MISMATCH"));
});

test("on_event without timing", () => {
  const raw = fresh(); const s = (raw.skills as any[]).find((x) => x.trigger === "on_event"); delete s.trigger_timing; s.trigger_timing = null;
  assert.ok(codes(raw).includes("E_TIMING_REQUIRED"));
});

test("missing CRIT stat is a schema error", () => {
  const raw = fresh(); delete (raw.characters[0] as any).base_stats.CRIT;
  assert.ok(codes(raw).includes("E_SCHEMA"));
});

test("unknown condition leaf", () => {
  const raw = fresh(); (raw.skills as any[])[0].default_activation = { type: "banana" };
  assert.ok(codes(raw).includes("E_UNKNOWN_LEAF"));
});

test("hero-ID leaf forbidden in a tactic default", () => {
  const raw = fresh(); (raw.skills as any[])[0].default_activation = { type: "hero_is", side: "ally", value: "char_001" };
  assert.ok(codes(raw).includes("E_HERO_ID_FORBIDDEN"));
});

test("unique status must be stackable", () => {
  const raw = fresh(); const s = (raw.statuses as any[])[0]; s.stacking = { ...s.stacking, unique: true, stackable: false };
  assert.ok(codes(raw).includes("E_UNIQUE_NEEDS_STACKABLE"));
});

test("valid 6-hero roster passes", () => {
  const raw = fresh(); raw.rosters = [{ name: "challenger.yaml", data: roster(raw) }];
  assert.deepEqual(codes(raw), []);
});

test("roster with 5 heroes", () => {
  const raw = fresh(); const r: any = roster(raw); r.heroes.pop(); r.leader_line.pop();
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_ROSTER_SIZE"));
});

test("bad leader line", () => {
  const raw = fresh(); const r: any = roster(raw); r.leader_line[0] = "char_004";
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_LEADER_LINE"));
});

test("squad row not allowed", () => {
  const raw = fresh(); const r: any = roster(raw); r.heroes[0].squad_row = "back";
  const st = find(raw.soldiers, "soldier_001"); st.allowed_soldier_rows = ["front"]; st.default_soldier_row = "front";
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_SQUAD_ROW"));
});

test("mounted_only hero needs a mounted squad", () => {
  const raw = fresh(); const r: any = roster(raw);
  find(raw.characters, "char_001").restrictions.soldier.mounted_only = true;
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_SQUAD_INELIGIBLE"));
  r.heroes[0].squad_id = "soldier_002";
  assert.ok(!codes(raw).includes("E_SQUAD_INELIGIBLE"));
});

test("same accessory in both slots needs duplicate_allowed", () => {
  const raw = fresh(); const r: any = roster(raw);
  r.heroes[0].equipment.accessory_1 = "equip_006"; r.heroes[0].equipment.accessory_2 = "equip_006";
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(!codes(raw).includes("E_EQUIP_DUPLICATE"));
  find(raw.equipment, "equip_006").rules.duplicate_allowed_in_both_accessory_slots = false;
  assert.ok(codes(raw).includes("E_EQUIP_DUPLICATE"));
});

test("holy has class advantage over monster", () => {
  const raw = fresh();
  assert.ok((raw.rules as any).class_advantage.some((m: any) => m.attacker === "holy" && m.defender === "monster"));
});

test("more than max tactics", () => {
  const raw = fresh(); const r: any = roster(raw);
  const sk = find(raw.characters, "char_001").skills[0];
  r.heroes[0].tactic_sheet = Array.from({ length: 11 }, (_, i) => ({ priority: i + 1, skill_id: sk, enabled: true, activation: null, targeting: { main: null, sub: null }, fallback: "skip" }));
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_TACTIC_COUNT"));
});

test("defender needs anchor and ban sheet; ban sheet rejects hero_is", () => {
  const raw = fresh(); const r: any = roster(raw);
  raw.rosters = [{ name: "defender.yaml", data: r }];
  const c1 = codes(raw);
  assert.ok(c1.includes("E_ANCHOR") && c1.includes("E_BAN_SHEET"));
  r.anchor = "char_001";
  r.ban_sheet = { rules: [{ priority: 1, filter: { type: "hero_is", side: "ally", value: "char_002" }, select: "highest", metric: "cost" }] };
  assert.ok(codes(raw).includes("E_HERO_ID_FORBIDDEN"));
});

test("community tier rejects official-only effects", () => {
  const raw = fresh();
  const s = (raw.skills as any[])[0]; s.effects.push({ type: "modify_pp", target: "self", pool: "active", amount: 1 });
  assert.ok(codes(raw, "community").length > 0);
});

test("per-hero cost cap", () => {
  const raw = fresh(); (raw.rules as any).cost.caps.per_hero = 1; raw.rosters = [];
  const r: any = roster(raw); raw.rosters = [{ name: "challenger.yaml", data: r }];
  assert.ok(codes(raw).includes("E_COST_CAP"));
});

test("validateRaw is pure (does not mutate input)", () => {
  const raw = fresh(); const before = JSON.stringify(raw); validateRaw(raw); assert.equal(JSON.stringify(raw), before);
});

const phaseLeaf = { type: "phase", op: ">=", value: 2 };
const hpLeaf = { type: "hp_percent", side: "self", op: "<", value: 50 };
const withActivation = (activation: unknown) => {
  const raw = fresh(); const r: any = roster(raw);
  const sk = find(raw.characters, "char_001").skills[0];
  r.heroes[0].tactic_sheet = [{ priority: 1, skill_id: sk, enabled: true, activation, targeting: { main: null, sub: null }, fallback: "skip" }];
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  return codes(raw);
};

test("damage effect without range is a schema error", () => {
  const raw = fresh(); const e = (raw.skills as any[]).flatMap((s) => s.effects).find((x: any) => x.type === "damage"); delete e.range;
  assert.ok(codes(raw).includes("E_SCHEMA"));
});

test("player slot: one leaf or two ANDed leaves only", () => {
  assert.deepEqual(withActivation({ all: [phaseLeaf, hpLeaf] }), []);
  assert.deepEqual(withActivation(phaseLeaf), []);
  for (const bad of [{ any: [phaseLeaf, hpLeaf] }, { not: phaseLeaf }, { all: [phaseLeaf, { all: [hpLeaf, phaseLeaf] }] }, { all: [phaseLeaf, hpLeaf, phaseLeaf] }]) {
    assert.ok(withActivation(bad).includes("E_TACTIC_SHAPE"), JSON.stringify(bad));
  }
});

test("ban sheet filter rejects any", () => {
  const raw = fresh(); const r: any = roster(raw); r.anchor = "char_001";
  r.ban_sheet = { rules: [{ priority: 1, filter: { any: [{ type: "hero_class", value: "cavalry" }, { type: "hero_class", value: "lancer" }] }, select: "highest", metric: "cost" }] };
  raw.rosters = [{ name: "defender.yaml", data: r }];
  assert.ok(codes(raw).includes("E_TACTIC_SHAPE"));
});

test("hero cost_override replaces the computed hero part", () => {
  const raw = fresh(); const rules = rulesSchema.parse(raw.rules); const hero = characterSchema.parse(find(raw.characters, "char_001"));
  assert.ok(heroCost(hero, rules) > 7);
  assert.equal(heroCost({ ...hero, cost_override: 7 }, rules), 7);
});

test("cost_override is official-only", () => {
  const raw = fresh(); find(raw.characters, "char_001").cost_override = 5;
  assert.ok(!codes(raw).includes("E_NOT_COMMUNITY_SAFE"));
  assert.ok(codes(raw, "community").includes("E_NOT_COMMUNITY_SAFE"));
});

test("rules rolls with min above max", () => {
  const raw = fresh(); (raw.rules as any).rolls.hit_min = 101;
  assert.ok(codes(raw).includes("E_ROLLS"));
});
