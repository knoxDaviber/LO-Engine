import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "../editor/catalog";
import {
  describeAura, describeBlessing, describeCondition, describeEffect, describeEquipment, describeSkill, describeSoldier, describeSoldierSkill,
  describeStatus, describeTerrain, describeClassAdvantage, text, type Described,
} from "../editor/src/describe";
import { createApi } from "../editor/api";
import { forEachCondition, forEachEffect } from "../src/validate/walk";

const api = createApi("content");
const pack = api.pack;
const cat = buildCatalog(pack);
const BAD = /undefined|null|NaN|\[object/;

function good(d: Described, what: string) {
  assert.ok(d.summary.trim().length > 0, `${what}: empty summary`);
  const t = text(d);
  assert.ok(!BAD.test(t), `${what}: bad text: ${t}`);
}

test("catalog: real content round-trips through JSON and has every section", () => {
  const back = JSON.parse(JSON.stringify(cat));
  assert.deepEqual(back, cat);
  assert.ok(cat.characters.length > 0 && cat.skills.length > 0 && cat.equipment.length > 0 && cat.statuses.length > 0);
  assert.ok(cat.gods.length > 0 && cat.soldiers.length > 0 && cat.terrains.length > 0 && cat.factions.length > 0);
  assert.ok(cat.rules.class_advantage.length > 0 && cat.rules.board.columns > 0);
  assert.ok(cat.leaves.some((l) => l.type === "hero_is" && l.contexts.includes("authored")), "all contexts are listed");
});

test("describe: every effect in the real content formats cleanly", () => {
  let n = 0;
  forEachEffect(pack, (e, w) => { good(describeEffect(e, cat), `${w.id} ${w.path}`); n++; });
  assert.ok(n > 20);
});

test("describe: every condition in the real content formats cleanly", () => {
  let n = 0;
  forEachCondition(pack, (c, _ctx, w) => { good(describeCondition(c, cat), `${w.id} ${w.path}`); n++; });
  assert.ok(n > 0);
});

test("describe: every skill, equipment, status, god, soldier, terrain and aura has a description", () => {
  for (const s of cat.skills) good(describeSkill(s, cat), s.id);
  for (const q of cat.equipment) good(describeEquipment(q, cat), q.id);
  for (const s of cat.statuses) good(describeStatus(s, cat), s.id);
  for (const g of cat.gods) { good(describeBlessing(g, 2, cat), `${g.id}/2`); good(describeBlessing(g, 4, cat), `${g.id}/4`); }
  for (const s of cat.soldiers) { good(describeSoldier(s, cat), s.id); s.passive_effects.forEach((p, i) => good(describeSoldierSkill(p, cat), `${s.id}[${i}]`)); }
  for (const t of cat.terrains) good(describeTerrain(t, cat), t.id);
  for (const c of cat.characters) good(describeAura(c.leader_aura, cat), c.id);
  good(describeClassAdvantage(cat), "class advantage");
});

test("describe: unknown shapes fall back to a readable rendering", () => {
  const d = describeEffect({ type: "brand_new", power: 3, tags: ["a"] } as any, cat);
  assert.equal(d.summary, "brand new (power=3, tags=[a])");
  assert.equal(describeCondition({ type: "mystery", value: 2 } as any, cat).summary, "mystery: 2");
});

const base = { ignores_guard: false, bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0 };

test("describe: exact wording of representative effects", () => {
  const dmg = { type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 1 }], multiplier: 1.2, ...base, bonus_vs_class: [{ class: "cavalry", modifier_percent: 25 }] };
  assert.equal(describeEffect(dmg as any, cat, "one enemy").summary, "Deals 1.2x ATK physical melee damage to one enemy; +25% vs cavalry");

  const st = cat.statuses[0]!;
  const apply = { type: "apply_status", status_id: st.id, chance_percent: 30, target: "targets", include_soldiers: false };
  assert.equal(describeEffect(apply as any, cat).summary, `30% chance to apply ${st.name} to the targets`);

  assert.equal(describeEffect({ type: "modify_stat", stat: "ATK", mode: "percent", value: 20 } as any, cat).summary, "+20% ATK");
  assert.equal(describeEffect({ type: "modify_stat", stat: "SPD", mode: "flat", value: -5 } as any, cat).summary, "-5 SPD");
  assert.equal(describeEffect({ type: "heal", percent_max_hp: 25 } as any, cat).summary, "Heals the target for 25% of max HP");
  assert.equal(describeEffect({ type: "reduce_damage", percent: 50, applies_to: "physical", duration: "this_attack" } as any, cat).summary, "Reduces physical damage taken by 50% for this attack");
});

test("describe: a condition with two leaves, and trigger/condition suffixes", () => {
  const c = { all: [{ type: "hp_percent", side: "self", op: "<", value: 50 }, { type: "has_status", side: "enemy", status_id: cat.statuses[0]!.id }] };
  const d = describeCondition(c as any, cat);
  assert.equal(d.summary, `HP as a percentage of max: self < 50 and Has a status: enemy ${cat.statuses[0]!.name}`);
  assert.equal(d.lines.length, 2);
  const e = describeEffect({ type: "ignore_guard", trigger: "on_hit", condition: { type: "hp_percent", side: "self", op: ">=", value: 10 } } as any, cat);
  assert.equal(e.summary, "Its attacks ignore GUARD (on hit, if HP as a percentage of max: self >= 10)");
});

test("describe: INT/MDEF pairing shows on statuses, auras and soldier skills, not on items or blessings", () => {
  const st = (id: string) => cat.statuses.find((s) => s.id === id)!;
  assert.match(describeStatus(st("buff_005"), cat).summary, /\+20% ATK \(and INT\)/);
  assert.match(describeStatus(st("debuff_001"), cat).summary, /-20% DEF \(and MDEF\)/);
  assert.ok(describeStatus(st("buff_005"), cat).lines.some((l) => /not an item or blessing/.test(l)));
  assert.doesNotMatch(describeStatus(st("status_002"), cat).summary, /\(and /); // Berserk names INT and MDEF itself
  const emperor = cat.characters.find((c) => c.id === "char_002")!;
  assert.match(describeAura(emperor.leader_aura, cat).summary, /\+20% ATK \(and INT\); \+20% DEF \(and MDEF\)/);
  const heavy = cat.soldiers.find((s) => s.id === "soldier_001")!;
  assert.match(describeSoldierSkill(heavy.passive_effects[0]!, cat).summary, /\+30% ATK \(and INT\)/);
  assert.equal(describeEffect({ type: "modify_stat", stat: "ATK", mode: "percent", value: 20 } as any, cat).summary, "+20% ATK"); // a bare effect (items, blessings): not paired
});

test("describe: an item shows its type base plus its own PP and effects (Decision 133)", () => {
  const q = (id: string) => cat.equipment.find((e) => e.id === id)!;
  assert.equal(describeEquipment(q("equip_009"), cat).summary, "Sword base: ATK +30, DEF +8");
  assert.equal(describeEquipment(q("equip_002"), cat).summary, "Heavy armor base: HP +150, DEF +22, MDEF +6, SPD -5; +1 active PP");
  const scepter = describeEquipment(q("equip_003"), cat);
  assert.ok(scepter.summary.startsWith("Staff base: ") && scepter.summary.endsWith("; 1 effect"), scepter.summary);
  const info = api.content().equipment.find((e) => e.id === "equip_009")!;
  assert.deepEqual([info.type, info.base], ["sword", { ATK: 30, DEF: 8 }]);
});
