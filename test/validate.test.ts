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
  r.heroes[0].tactic_sheet = Array.from({ length: 11 }, (_, i) => ({ priority: i + 1, skill_id: sk, enabled: true, main: null, sub: null }));
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
  r.heroes[0].tactic_sheet = [{ priority: 1, skill_id: sk, enabled: true, main: activation, sub: null }];
  raw.rosters = [{ name: "challenger.yaml", data: r }];
  return codes(raw);
};

test("damage effect without range is a schema error", () => {
  const raw = fresh(); const e = (raw.skills as any[]).flatMap((s) => s.effects).find((x: any) => x.type === "damage"); delete e.range;
  assert.ok(codes(raw).includes("E_SCHEMA"));
});

test("player slot: one leaf or a selector; any group is E_TACTIC_SHAPE", () => {
  assert.deepEqual(withActivation(phaseLeaf), []);
  assert.deepEqual(withActivation({ select: "prefer", filter: { type: "row_is", value: "front" } }), []);
  assert.deepEqual(withActivation({ select: "lowest", metric: "max_hp" }), []);
  for (const bad of [{ all: [phaseLeaf, hpLeaf] }, { any: [phaseLeaf, hpLeaf] }, { not: phaseLeaf }, { select: "prefer", filter: { all: [phaseLeaf] } }, { select: "prefer" }, { select: "nearest", metric: "hp_percent" }]) {
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

test("an item modify_stat with an event-style trigger is rejected (E_EFFECT_TRIGGER)", () => {
  const raw = fresh();
  const eff: any = { type: "modify_stat", stat: "SPD", mode: "percent", value: 10 };
  find(raw.equipment, "equip_006").effects = [eff];
  assert.ok(!codes(raw).includes("E_EFFECT_TRIGGER"));
  for (const trigger of ["on_hit", "on_attack", "pre_battle"]) {
    eff.trigger = trigger;
    assert.ok(codes(raw).includes("E_EFFECT_TRIGGER"), trigger);
  }
});

// ------------------------------------------------------------------ equipment type standard (Decision 133)
test("equipment type: an item needs exactly one type valid for its slot (E_EQUIP_TYPE)", () => {
  const none = fresh(); find(none.equipment, "equip_009").tags = [];
  assert.ok(codes(none).includes("E_EQUIP_TYPE"));
  const two = fresh(); find(two.equipment, "equip_009").tags = ["sword", "axe"];
  assert.ok(codes(two).includes("E_EQUIP_TYPE"));
  const wrongSlot = fresh(); find(wrongSlot.equipment, "equip_009").tags = ["gloves"];
  const c = codes(wrongSlot);
  assert.ok(c.includes("E_SLOT_TAG") && c.includes("E_EQUIP_TYPE"));
});

test("equipment type: items no longer author stat_modifiers; every type needs a base in rules", () => {
  const raw = fresh(); find(raw.equipment, "equip_009").stat_modifiers = { ATK: 20 };
  assert.ok(codes(raw).includes("E_SCHEMA"));
  const rules = fresh().rules as any;
  delete rules.equipment_bases.belt;
  const r = rulesSchema.safeParse(rules);
  assert.ok(!r.success && r.error.issues.some((i) => i.path.join(".") === "equipment_bases.belt"));
});

test("equipment type: the item's cost is its type base, weighted", () => {
  const raw = fresh();
  const { pack } = validateRaw(raw);
  const hero = pack!.byId.characters.get("char_005")!;
  const bare = heroCost(hero, pack!.rules);
  const w = pack!.rules.cost.stat_weights;
  assert.equal(heroCost(hero, pack!.rules, { equipment: [pack!.byId.equipment.get("equip_009")!] }), Math.round((bare + 150 * w.ATK + 24 * w.DEF) * 10) / 10);
});

test("item pricing: base + signed PP + effect prices; cost_override replaces all", async () => {
  const { effectPrice } = await import("../src/validate/cost");
  const { pack } = validateRaw(fresh());
  const rules = pack!.rules, hero = pack!.byId.characters.get("char_005")!, base = pack!.byId.equipment.get("equip_009")!;
  const cost = (e: typeof base) => heroCost(hero, rules, { equipment: [e] });
  const plain = cost(base), r1 = (n: number) => Math.round(n * 10) / 10;
  const fx: any = { type: "modify_stat", stat: "ATK", mode: "flat", value: 5, trigger: "on_hit" }; // conditional-style line: flat effect_price
  const withFx = { ...structuredClone(base), effects: [fx, fx] };
  const bare = heroCost(hero, rules);
  assert.equal(effectPrice(fx, hero, rules), rules.cost.effect_price);
  assert.equal(cost(withFx), r1(bare + (plain - bare) + 2 * rules.cost.effect_price));
  const pp = (a: number, p: number) => ({ ...structuredClone(base), pp_modifiers: { active: a, passive: p } });
  assert.equal(cost(pp(1, 0)), r1(plain + rules.cost.pp_weights.active));
  assert.equal(cost(pp(0, -1)), r1(plain - rules.cost.pp_weights.passive));
  assert.equal(cost({ ...withFx, pp_modifiers: { active: 1, passive: 1 }, cost_override: 3 }), r1(bare + 3));
});

test("equipment type: weapon, armor and shield types are gated by the hero's equipment_tags; other accessory categories are open", async () => {
  const { canEquip } = await import("../src/validate/eligibility");
  const { pack } = validateRaw(fresh());
  const jasmine = pack!.byId.characters.get("char_003")!; // no shield, no sword
  const eq = (id: string) => pack!.byId.equipment.get(id)!;
  assert.equal(canEquip(jasmine, eq("equip_009")), false); // sword
  assert.equal(canEquip(jasmine, eq("equip_020")), false); // shield
  assert.equal(canEquip(jasmine, eq("equip_008")), true); // gloves
  assert.equal(canEquip(jasmine, eq("equip_023")), true); // boots
});

test("W_TACTIC_NO_CONDITION: an active skill with no Main and no default_main; passives and skills with a default are exempt; a selector default validates", () => {
  const raw = fresh(); const r: any = roster(raw);
  const skills = raw.skills as any[];
  const active = skills.find((s) => s.category === "active"), passive = skills.find((s) => s.category === "passive");
  const warn = () => validateRaw(raw).report.issues.filter((i) => i.code === "W_TACTIC_NO_CONDITION");
  const sheet = (...ids: string[]) => { r.heroes[0].tactic_sheet = ids.map((skill_id, i) => ({ priority: i + 1, skill_id, enabled: true, main: null, sub: null })); raw.rosters = [{ name: "challenger.yaml", data: r }]; };
  sheet(active.id, passive.id);
  assert.equal(warn().length, 0); // shipped defaults; passives exempt
  active.targeting.default_main = null;
  assert.equal(warn().length, 1);
  active.targeting.default_main = { select: "lowest", metric: "hp_percent" };
  assert.equal(warn().length, 0);
  assert.ok(!codes(raw).includes("E_SCHEMA") && !codes(raw).includes("E_TACTIC_SHAPE"));
  active.targeting.default_main = { select: "prefer", filter: { all: [{ type: "always" }, { type: "always" }] } };
  assert.ok(codes(raw).includes("E_TACTIC_SHAPE")); // a group in a selector default's filter, as in a player slot
});
