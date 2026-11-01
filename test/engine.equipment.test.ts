// Equipment in the engine (roadmap 3b; design Sections 7, 8, 9.1, 12 and 17): flat lines, PP bonuses, equipment-category effects (conditional
// and percentage), duplicate accessories, on-attack item effects (Longinus) and pre-battle item effects (Strange Box).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, PREBATTLE_STEPS, beginPhase, checkEquipment, computeDamage, createBattleState, decideTactic, effectiveStat, executeSkill, scheduleInitial, statBreakdown,
  type BattleEvent, type DamageEffect, type ExecCtx,
} from "../src/engine";
import type { Battle, Skill } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, scripted } from "./engineHelpers";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
type Slots = Partial<Record<"weapon" | "armor" | "accessory_1" | "accessory_2", string>>;

/** The real sample (Leon+Lief vs Emperor+Jasmine, leaders Leon and Emperor), squads off, with the given items worn, after the pre-battle steps. */
function setup(gear: Record<string, Slots>, opts: { auras?: boolean; over?: (pack: Pack, battle: Battle) => void } = {}) {
  const { pack, battle } = loadReal({ auras: opts.auras ?? false });
  for (const side of [battle.challenger, battle.defender]) for (const h of side.heroes) Object.assign(h.equipment, gear[h.char_id] ?? {});
  opts.over?.(pack, battle);
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  const u = (id: string) => p.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const x: ExecCtx = { state: p.state, rng: p.rng, log };
  return { pack, state: p.state, log, u, ev, x, stat: (id: string, s: any) => effectiveStat(u(id), s, pack) };
}
const dmg = (pack: Pack, id: string) => (pack.byId.skills.get(id) as Skill).effects.find((e) => e.type === "damage") as DamageEffect;
const HIT = { hit: true, crit: false, guard: false };
const item = (pack: Pack, id: string) => pack.byId.equipment.get(id) as any;

test("the equipment step is the first pre-battle step", () => {
  assert.equal(PREBATTLE_STEPS[0]!.name, "equipment");
});

test("Dragon Scale worked example: bare Leon vs Dragon-Scale Emperor (DEF 100): Charging Assault 5, Thousand Azure Hooves 57", () => {
  const { pack, u, stat } = setup({ [EMPEROR]: { armor: "equip_002" } });
  close(stat(EMPEROR, "DEF"), 100); // 50 + 50, a flat line added to base once
  close(stat(LEON, "ATK"), 70);
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_001"), { pack }, HIT).amount, 5);
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_002"), { pack }, HIT).amount, 57);
});

test("Dragon Scale with Empire's Dominion (Emperor leads, DEF 120): Charging Assault 1, Thousand Azure Hooves 37", () => {
  const { pack, u, stat, state } = setup({ [EMPEROR]: { armor: "equip_002" } }, { auras: true });
  assert.equal(state.leaders.defender.leaderId, EMPEROR);
  close(stat(EMPEROR, "DEF"), 120);
  close(stat(LEON, "ATK"), 70); // Leon's own aura needs the Emperor in HIS party
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_001"), { pack }, HIT).amount, 1);
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_002"), { pack }, HIT).amount, 37);
});

test("Dragon Scale gives +1 Active PP; PP bonuses are capped at rules.pp.max", () => {
  const a = setup({ [EMPEROR]: { armor: "equip_002" } });
  assert.deepEqual(a.u(EMPEROR).pp.active, { cur: 3, max: 3 });
  assert.deepEqual(a.u(EMPEROR).pp.passive, { cur: 2, max: 2 });
  const b = setup({ [EMPEROR]: { armor: "equip_002" } }, { over: (p) => { item(p, "equip_002").pp_modifiers.active = 5; } });
  assert.equal(b.u(EMPEROR).pp.active.max, b.pack.rules.pp.max);
});

test("duplicate accessories: two Speed Rings = SPD +40", () => {
  const { stat } = setup({ [LIEF]: { accessory_1: "equip_006", accessory_2: "equip_006" } });
  close(stat(LIEF, "SPD"), 40 + 40);
});

test("equipment vs equipment does not stack: the strongest equipment percent wins, and it multiplies with other categories", () => {
  const pct = (value: number) => ({ type: "modify_stat", stat: "SPD", mode: "percent", value });
  const { stat, u, pack, ev } = setup({ [LIEF]: { accessory_1: "equip_006", accessory_2: "equip_022" } }, {
    over: (p) => { item(p, "equip_006").effects = [pct(10)]; item(p, "equip_022").effects = [pct(20)]; },
  });
  close(stat(LIEF, "SPD"), (40 + 20) * 1.2); // Speed Ring flat 20, Charm's 20% wins over the Ring's 10%
  const b = statBreakdown(u(LIEF), "SPD", pack);
  assert.deepEqual(b.effects.map((e) => [e.category, e.value, e.outcome]), [["equipment", 10, "suppressed"], ["equipment", 20, "winner"]]);
  assert.equal(ev("equipment_applied").length, 2);
  // Two identical ring effects (duplicate accessory): one counts.
  const two = setup({ [LIEF]: { accessory_1: "equip_006", accessory_2: "equip_006" } }, { over: (p) => { item(p, "equip_006").effects = [pct(10)]; } });
  close(two.stat(LIEF, "SPD"), (40 + 40) * 1.1);
  // Across categories it multiplies: a 20% passive on top.
  const lief = u(LIEF);
  lief.statuses.push({ statusId: "aura:x:0", category: "passive", sourceUnitId: LIEF, remaining: null, skipNextTick: false, seq: 999, inline: { name: "x", modifiers: [{ stat: "SPD", mode: "percent", value: 20 }] } });
  close(stat(LIEF, "SPD"), 60 * 1.2 * 1.2);
});

test("flat equipment effects of one category do not stack either (strongest wins); flat item lines still add", () => {
  const flat = (value: number) => ({ type: "modify_stat", stat: "SPD", mode: "flat", value });
  const { stat } = setup({ [LIEF]: { accessory_1: "equip_006", accessory_2: "equip_022" } }, {
    over: (p) => { item(p, "equip_006").effects = [flat(10)]; item(p, "equip_022").effects = [flat(20)]; },
  });
  close(stat(LIEF, "SPD"), 40 + 20 + 20); // base 40 + Speed Ring line 20 + the stronger flat effect 20 (not +30)
});

test("a dead wearer's equipment modifiers come off (equipment_removed death)", () => {
  const { u, x, ev } = setup({ [JASMINE]: { weapon: "equip_003" } });
  const jas = u(JASMINE);
  jas.alive = false; jas.hp = 0;
  checkEquipment(x);
  assert.ok(!jas.statuses.some((s) => s.statusId.startsWith("equip:")));
  assert.deepEqual(ev("equipment_removed").map((e) => e.reason), ["death"]);
});

test("a conditional equipment effect (Queen's Scepter, HP > 80%) is on exactly while its condition holds", () => {
  const { stat, u, x, ev } = setup({ [JASMINE]: { weapon: "equip_003" } });
  close(stat(JASMINE, "INT"), (60 + 60) * 1.2);
  const jas = u(JASMINE);
  jas.hp = Math.floor(jas.maxHp / 2);
  checkEquipment(x);
  close(stat(JASMINE, "INT"), 120);
  assert.equal(ev("equipment_removed").length, 1);
  jas.hp = jas.maxHp;
  checkEquipment(x);
  close(stat(JASMINE, "INT"), 144);
  assert.equal(ev("equipment_applied").length, 2);
});

test("the leader's equipment modifiers are not shared with its squad", () => {
  const { pack, battle } = loadReal({ squads: true });
  battle.challenger.heroes.find((h) => h.char_id === LEON)!.equipment.accessory_1 = "equip_006";
  item(pack, "equip_006").effects = [{ type: "modify_stat", stat: "SPD", mode: "percent", value: 50 }];
  const p = beginPhase(pack, battle, 1, null, new EventLog());
  const squad = p.state.units.find((v) => v.kind === "squad" && v.leaderId === LEON)!;
  assert.ok(statBreakdown(squad, "SPD", pack).effects.every((e) => e.category !== "equipment"));
});

test("Longinus: -1 Passive PP to the unit hit, once per attacking action, in the equipment's name", () => {
  const { pack, battle } = loadReal();
  battle.challenger.heroes.find((h) => h.char_id === LEON)!.equipment.weapon = "equip_004";
  const s = createBattleState(pack, battle, 1);
  s.units = s.units.filter((v) => v.kind === "hero");
  scheduleInitial(s);
  const leon = s.units.find((v) => v.id === LEON)!, emp = s.units.find((v) => v.id === EMPEROR)!;
  const log = new EventLog();
  const rng = scripted([0.5, 0.9, 0.9]); // hit, no crit, no guard
  const x: ExecCtx = { state: s, rng, log };
  executeSkill(x, leon, decideTactic(s, leon, rng));
  assert.equal(emp.pp.passive.cur, 1);
  const changes = log.events.filter((e) => e.type === "pp_change");
  assert.deepEqual(changes.map((e: any) => [e.unit, e.skill, e.before, e.after]), [[EMPEROR, "equip_004", 2, 1]]);
});

test("Strange Box: pre-battle Confusion on every unit including the wearer; two boxes do not stack", () => {
  const { u, ev } = setup({ [JASMINE]: { accessory_1: "equip_007", accessory_2: "equip_007" } });
  for (const id of [LEON, LIEF, EMPEROR, JASMINE]) {
    const conf = u(id).statuses.filter((s) => s.statusId === "debuff_002");
    assert.equal(conf.length, 1, id);
    assert.equal(conf[0]!.category, "equipment");
  }
  assert.ok(ev("trigger").some((e) => e.event === "pre_battle" && e.handler === "Strange box"));
});
