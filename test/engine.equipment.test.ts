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
function setup(gear: Record<string, Slots>, opts: { auras?: boolean; damage?: boolean; over?: (pack: Pack, battle: Battle) => void } = {}) {
  const { pack, battle } = loadReal({ auras: opts.auras ?? false, damage: opts.damage ?? false });
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
/** Clears Dragon Scale's stat lines: the armor-base worked examples below are about the base numbers and the damage maths. */
const bareScale = { over: (p: Pack) => { item(p, "equip_002").effects = []; } };

test("the equipment step is the first pre-battle step", () => {
  assert.equal(PREBATTLE_STEPS[0]!.name, "equipment");
});

test("Dragon Scale worked example: bare Leon vs Dragon-Scale Emperor (DEF 140): Charging Assault 32, Thousand Azure Hooves 118", () => {
  const { pack, u, stat } = setup({ [EMPEROR]: { armor: "equip_002" } }, bareScale);
  close(stat(EMPEROR, "DEF"), 140); // 70 + 70, the heavy armor base (Decision 133) added to base once
  close(stat(EMPEROR, "MDEF"), 40 + 15); // the heavy armor base MDEF line only
  close(stat(LEON, "ATK"), 115);
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_001"), { pack }, HIT).amount, 32); // 172.5 - 140
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_002"), { pack }, HIT).amount, 118); // 258.75 - 140
});

test("Dragon Scale with Empire's Dominion (Emperor leads, DEF 168): Charging Assault 4, Thousand Azure Hooves 90", () => {
  const { pack, u, stat, state } = setup({ [EMPEROR]: { armor: "equip_002" } }, { auras: true, ...bareScale });
  assert.equal(state.leaders.defender.leaderId, EMPEROR);
  close(stat(EMPEROR, "DEF"), 140 * 1.2);
  close(stat(LEON, "ATK"), 115); // Leon's own aura needs the Emperor in HIS party
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_001"), { pack }, HIT).amount, 4);
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_002"), { pack }, HIT).amount, 90);
});

test("content formula (pool, hero_hits 4, Decision 135 bases): sworded Leon vs Dragon-Scale Emperor", () => {
  const { pack, u, stat } = setup({ [LEON]: { weapon: "equip_009" }, [EMPEROR]: { armor: "equip_002" } }, { damage: true, ...bareScale });
  assert.equal(pack.rules.damage.formula, "pool");
  assert.equal(pack.rules.damage.hero_hits, 4);
  close(stat(LEON, "ATK"), 115 + 150); // sword base ATK 150
  close(stat(EMPEROR, "DEF"), 70 + 70); // heavy armor base DEF 70
  // Charging Assault: (265 x 1.2 - 140) = 178, pool 1.25 (cavalry > infantry) = 222, x hero_hits 4
  assert.equal(computeDamage(u(LEON), u(EMPEROR), dmg(pack, "skl_cav_active_001"), { pack }, HIT).amount, 888);
});

test("Dragon Scale gives +1 Active PP; PP bonuses are capped at rules.pp.max", () => {
  const a = setup({ [EMPEROR]: { armor: "equip_002" } });
  const base = a.pack.byId.characters.get(EMPEROR)!.pp, mod = item(a.pack, "equip_002").pp_modifiers, cap = a.pack.rules.pp.max;
  const act = Math.min(base.active + mod.active, cap), pas = Math.min(base.passive + mod.passive, cap);
  assert.deepEqual(a.u(EMPEROR).pp.active, { cur: act, max: act });
  assert.deepEqual(a.u(EMPEROR).pp.passive, { cur: pas, max: pas });
  const b = setup({ [EMPEROR]: { armor: "equip_002" } }, { over: (p) => { item(p, "equip_002").pp_modifiers.active = 5; } });
  assert.equal(b.u(EMPEROR).pp.active.max, b.pack.rules.pp.max);
});

test("duplicate accessories: two Traveller's Boots = SPD +10 (their type base twice)", () => {
  const { stat } = setup({ [LIEF]: { accessory_1: "equip_023", accessory_2: "equip_023" } });
  close(stat(LIEF, "SPD"), 40 + 10);
});

test("equipment vs equipment does not stack: the strongest equipment percent wins, and it multiplies with other categories", () => {
  const pct = (value: number) => ({ type: "modify_stat", stat: "SPD", mode: "percent", value });
  const { stat, u, pack, ev } = setup({ [LIEF]: { accessory_1: "equip_023", accessory_2: "equip_022" } }, {
    over: (p) => { item(p, "equip_023").effects = [pct(10)]; item(p, "equip_022").effects = [pct(20)]; },
  });
  close(stat(LIEF, "SPD"), (40 + 5) * 1.2); // boots base SPD 5, Charm's 20% wins over the boots' 10%
  const b = statBreakdown(u(LIEF), "SPD", pack);
  assert.deepEqual(b.effects.map((e) => [e.category, e.value, e.outcome]), [["equipment", 10, "suppressed"], ["equipment", 20, "winner"]]);
  assert.equal(ev("equipment_applied").length, 2);
  // Two identical boots effects (duplicate accessory): one counts.
  const two = setup({ [LIEF]: { accessory_1: "equip_023", accessory_2: "equip_023" } }, { over: (p) => { item(p, "equip_023").effects = [pct(10)]; } });
  close(two.stat(LIEF, "SPD"), (40 + 10) * 1.1);
  // Across categories it multiplies: a 20% passive on top.
  const lief = u(LIEF);
  lief.statuses.push({ statusId: "aura:x:0", category: "passive", sourceUnitId: LIEF, remaining: null, skipNextTick: false, seq: 999, inline: { name: "x", modifiers: [{ stat: "SPD", mode: "percent", value: 20 }] } });
  close(stat(LIEF, "SPD"), 45 * 1.2 * 1.2);
});

test("flat equipment effects of one category do not stack either (strongest wins); flat item lines still add", () => {
  const flat = (value: number) => ({ type: "modify_stat", stat: "SPD", mode: "flat", value });
  const { stat } = setup({ [LIEF]: { accessory_1: "equip_023", accessory_2: "equip_022" } }, {
    over: (p) => { item(p, "equip_023").effects = [flat(10)]; item(p, "equip_022").effects = [flat(20)]; },
  });
  close(stat(LIEF, "SPD"), 40 + 5 + 20); // base 40 + boots base 5 + the stronger flat effect 20 (not +30)
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
  close(stat(JASMINE, "INT"), (100 + 120) * 1.2); // staff base INT 120
  const jas = u(JASMINE);
  jas.hp = Math.floor(jas.maxHp / 2);
  checkEquipment(x);
  close(stat(JASMINE, "INT"), 220);
  assert.equal(ev("equipment_removed").length, 1);
  jas.hp = jas.maxHp;
  checkEquipment(x);
  close(stat(JASMINE, "INT"), 220 * 1.2);
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
  const ppBefore = emp.pp.passive.cur;
  executeSkill(x, leon, decideTactic(s, leon, rng));
  assert.equal(emp.pp.passive.cur, ppBefore - 1);
  const changes = log.events.filter((e) => e.type === "pp_change");
  assert.deepEqual(changes.map((e: any) => [e.unit, e.skill, e.before, e.after]), [[EMPEROR, "equip_004", ppBefore, ppBefore - 1]]);
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

// PP gear (Decision 147): `stacks` lines add up across items; other gear lines keep Section 9.1 (strongest wins).
const gear = (a: string, b?: string): Slots => ({ accessory_1: a, ...(b ? { accessory_2: b } : {}) });
const line = (pack: Pack, id: string, st: string) => item(pack, id).effects.find((e: any) => e.stat === st).value as number;

test("two Reckless Gauntlets: percent lines add, Active PP caps at rules.pp.max, Passive loses 2", () => {
  const { pack, u } = setup({ [LEON]: gear("equip_028", "equip_028") });
  const one = setup({ [LEON]: gear("equip_028") });
  const atk = line(pack, "equip_028", "ATK"), def = line(pack, "equip_028", "DEF");
  const b = statBreakdown(u(LEON), "ATK", pack);
  close(b.multiplier, 1 + (2 * atk) / 100);
  close(statBreakdown(u(LEON), "DEF", pack).multiplier, 1 + (2 * def) / 100);
  close(statBreakdown(one.u(LEON), "ATK", pack).multiplier, 1 + atk / 100);
  const ch = pack.byId.characters.get(LEON)!.pp, m = item(pack, "equip_028").pp_modifiers, cap = pack.rules.pp.max;
  assert.equal(u(LEON).pp.active.max, Math.min(ch.active + 2 * m.active, cap));
  assert.equal(u(LEON).pp.passive.max, ch.passive + 2 * m.passive);
});

test("Dragon Scale + Leaden Boots: SPD lines add across different items", () => {
  const { pack, u } = setup({ [EMPEROR]: { armor: "equip_002", accessory_1: "equip_030" } });
  const b = statBreakdown(u(EMPEROR), "SPD", pack);
  close(b.multiplier, 1 + (line(pack, "equip_002", "SPD") + line(pack, "equip_030", "SPD")) / 100);
  assert.equal(b.effects.filter((e) => e.outcome === "winner" && e.mode === "percent").length, 1);
});

test("a stacking line and a non-stacking gear line on the same stat and sign: the sum and the other line compete, strongest wins", () => {
  const run = (v: number) => {
    const { pack, u } = setup({ [LEON]: gear("equip_028", "equip_023") }, { over: (p) => {
      item(p, "equip_023").effects = [{ type: "modify_stat", stat: "ATK", mode: "percent", value: v }];
    } });
    return statBreakdown(u(LEON), "ATK", pack).multiplier;
  };
  const probe = setup({});
  const atk = line(probe.pack, "equip_028", "ATK");
  close(run(atk + 20), 1 + (atk + 20) / 100); // the plain line is stronger than the stacking sum
  close(run(atk - 5), 1 + atk / 100); // the stacking line is stronger
});

test("Bloodpact Ring lowers Max HP and starting HP; two add; maxHp matches statBreakdown HP", () => {
  const hp = (slots: Slots) => { const { pack, u } = setup({ [LEON]: slots }); return { unit: u(LEON), pack }; };
  const none = hp({}).unit, one = hp(gear("equip_029")), two = hp(gear("equip_029", "equip_029"));
  const pct = line(one.pack, "equip_029", "HP");
  for (const [r, n] of [[one, 1], [two, 2]] as const) {
    const flat = r.unit.equipFlat.HP, base = r.unit.baseStats.HP;
    assert.equal(r.unit.maxHp, Math.floor((base + flat) * (1 + (n * pct) / 100) + 1e-9));
    assert.equal(r.unit.hp, r.unit.maxHp);
    assert.equal(r.unit.maxHp, Math.floor(statBreakdown(r.unit, "HP", r.pack).result + 1e-9));
  }
  assert.ok(one.unit.maxHp < none.maxHp && two.unit.maxHp < one.unit.maxHp);
});

test("without `stacks`, two identical gear lines still follow strongest-wins (Section 9.1)", () => {
  const { pack, u } = setup({ [LEON]: gear("equip_023", "equip_023") }, { over: (p) => {
    item(p, "equip_023").effects = [{ type: "modify_stat", stat: "ATK", mode: "percent", value: 20 }];
  } });
  close(statBreakdown(u(LEON), "ATK", pack).multiplier, 1.2);
});

test("a non-stacking HP percent line worn twice applies once to Max HP", () => {
  const { pack, u } = setup({ [LEON]: gear("equip_023", "equip_023") }, { over: (p) => {
    item(p, "equip_023").effects = [{ type: "modify_stat", stat: "HP", mode: "percent", value: 20 }];
  } });
  const un = u(LEON);
  assert.equal(un.maxHp, Math.floor((un.baseStats.HP + un.equipFlat.HP) * 1.2 + 1e-9));
  assert.equal(un.maxHp, Math.floor(statBreakdown(un, "HP", pack).result + 1e-9));
});
