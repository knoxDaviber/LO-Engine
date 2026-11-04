// Races, sub-races and the Decision 148 skill mechanics: lean, time traits, sub_race_is, self_hp_cost, remove_debuffs, First Cut, Mercy Bolt,
// Bodyguard, Sworn Banner and the hero re-gating. Numbers come from content/rules.yaml, never hardcoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyStatus, beginPhase, computeHeal, createBattleState, effectiveStat, evaluateCondition, runEffect, type BattleEvent, type ExecCtx, type StatusInstance, type Unit,
} from "../src/engine";
import { STATS, SUB_RACE_PARENT, type Effect, type Race, type SubRace } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { leanedBase } from "../src/race";
import { codes, fresh, find } from "./helpers";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, tactic } from "./engineHelpers";

const score = (pack: Pack, lean: Partial<Record<(typeof STATS)[number], number>>) => STATS.reduce((n, s) => n + (lean[s] ?? 0) * pack.rules.cost.stat_weights[s], 0);

/** A state where `hero` has the given race / sub-race and the battle the given time; squads off, bare heroes. */
function raced(hero: string, race: Race, sub: SubRace | undefined, time: "day" | "night", opts: { squads?: boolean } = {}) {
  const { pack, battle } = loadReal(opts);
  const ch = pack.byId.characters.get(hero)!;
  ch.race = race;
  if (sub) ch.sub_race = sub;
  battle.time = time;
  const state = createBattleState(pack, battle);
  return { pack, battle, state, u: state.units.find((v) => v.id === hero)!, base: { ...ch.base_stats } };
}

const rig = (pack: Pack): void => { pack.rules.rolls.hit_min = 100; pack.rules.rolls.crit_max = 0; pack.rules.rolls.guard_max = 0; };
const counting = (): ExecCtx["rng"] => { let n = 0; return { next: () => (n++, 0.999999), int: (k) => (n++, Math.floor(0.999999 * k)), get draws() { return n; } }; };
function ctx(state: ReturnType<typeof createBattleState>) {
  const log = new EventLog();
  const x: ExecCtx = { state, rng: counting(), log };
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  return { x, ev };
}
/** Runs one effect of a skill as an own-turn action of `actor` on `targets`. */
function run(x: ExecCtx, pack: Pack, actor: Unit, skillId: string, i: number, targets: Unit[], shape = "single") {
  const sk = pack.byId.skills.get(skillId)!;
  x.state.bus.beginAction(actor);
  runEffect(x, actor, { id: sk.id, name: sk.name, shape, interactions: sk.interactions }, sk.effects[i]!, targets, new Set(), false);
}

test("every race and sub-race lean scores 0 under cost.stat_weights, also a sub-race on top of its parent", () => {
  const { pack } = loadReal();
  const { races, sub_races } = pack.rules;
  assert.equal(Object.keys(races).length, 6); // every race but human
  for (const [r, e] of Object.entries(races)) assert.ok(Math.abs(score(pack, e!.lean)) < 1e-9, r);
  for (const [sub, e] of Object.entries(sub_races)) {
    assert.ok(Math.abs(score(pack, e!.lean)) < 1e-9, sub);
    const parent = races[SUB_RACE_PARENT[sub as SubRace]]!;
    assert.ok(Math.abs(score(pack, e!.lean) + score(pack, parent.lean)) < 1e-9, `${sub} + parent`);
  }
});

test("lean reaches the base stats and Max HP; human has none", () => {
  const { pack, u, base, state } = raced(LEON, "dwarf", undefined, "day");
  const lean = pack.rules.races.dwarf!.lean;
  for (const s of STATS) assert.equal(u.baseStats[s], base[s] + (lean[s] ?? 0), s);
  assert.equal(u.maxHp, base.HP + lean.HP!);
  assert.equal(u.hp, u.maxHp);
  const human = state.units.find((v) => v.id === EMPEROR)!;
  assert.deepEqual(leanedBase(pack.rules, pack.byId.characters.get(LEON)!), u.baseStats); // the draft reads the same helper
  assert.equal(human.baseStats.HP, pack.byId.characters.get(EMPEROR)!.base_stats.HP);
});

test("day / night traits switch with battle.time (flat and percent)", () => {
  const elfNight = raced(LEON, "elf", undefined, "night"), elfDay = raced(LEON, "elf", undefined, "day");
  const flat = elfNight.pack.rules.races.elf!.traits.find((t) => "stat" in t && t.stat === "EVA")! as { value: number };
  assert.equal(effectiveStat(elfNight.u, "EVA", elfNight.pack) - effectiveStat(elfDay.u, "EVA", elfDay.pack), flat.value);
  const dNight = raced(LEON, "demon", undefined, "night"), dDay = raced(LEON, "demon", undefined, "day");
  const atk = dNight.pack.rules.races.demon!.traits.find((t) => "stat" in t && t.stat === "ATK" && t.time === "night")! as { value: number };
  assert.ok(Math.abs(effectiveStat(dNight.u, "ATK", dNight.pack) - dNight.u.baseStats.ATK * (1 + atk.value / 100)) < 1e-9);
  assert.equal(effectiveStat(dDay.u, "ATK", dDay.pack), dDay.u.baseStats.ATK); // the demon's day line is DEF / MDEF only
  assert.ok(effectiveStat(dDay.u, "DEF", dDay.pack) < dDay.u.baseStats.DEF);
});

test("a sub-race's traits replace its parent's; its lean adds to the parent's", () => {
  const { pack, u, state } = raced(LEON, "elf", "high_elf", "night");
  const lean = (s: (typeof STATS)[number]) => (pack.rules.races.elf!.lean[s] ?? 0) + (pack.rules.sub_races.high_elf!.lean[s] ?? 0);
  assert.equal(u.baseStats.INT, pack.byId.characters.get(LEON)!.base_stats.INT + lean("INT"));
  assert.equal(effectiveStat(u, "EVA", pack), u.baseStats.EVA); // the elf's night EVA trait is gone: high_elf has no night line
  assert.equal(u.innate.filter((m) => m.category === "race").length, 0);
  const day = raced(LEON, "elf", "high_elf", "day");
  assert.equal(effectiveStat(day.u, "SKL", day.pack), day.u.baseStats.SKL + (day.pack.rules.sub_races.high_elf!.traits[0] as { value: number }).value);
  assert.equal(state.units.find((v) => v.id === LEON)!.subRace, "high_elf");
});

test("a squad gets neither race lean nor race traits", () => {
  const { state, u } = raced(LEON, "demon", undefined, "night", { squads: true });
  const squad = state.units.find((v) => v.kind === "squad" && v.side === u.side)!;
  assert.ok(squad.innate.every((m) => m.category !== "race"));
  assert.equal(squad.race, "human");
  assert.equal(squad.subRace, undefined);
  assert.ok(u.innate.some((m) => m.category === "race"));
});

test("angel heal bonus: heals the unit casts +heal_percent by day, none at night; others unchanged", () => {
  const day = raced(JASMINE, "angel", undefined, "day"), night = raced(JASMINE, "angel", undefined, "night");
  const pct = (day.pack.rules.races.angel!.traits.find((t) => "heal_percent" in t) as { heal_percent: number }).heal_percent;
  const effect = { type: "heal", scaling: [{ stat: "INT", coef: 1 }], multiplier: 1.5 } as Extract<Effect, { type: "heal" }>;
  const d = computeHeal(day.u, day.u, effect, day.pack), n = computeHeal(night.u, night.u, effect, night.pack);
  assert.equal(d, Math.floor(effectiveStat(day.u, "INT", day.pack) * 1.5 * (1 + pct / 100)));
  assert.equal(n, Math.floor(effectiveStat(night.u, "INT", night.pack) * 1.5)); // night: no heal line
  const pctLine = { type: "heal", percent_max_hp: 10 } as Extract<Effect, { type: "heal" }>;
  assert.equal(computeHeal(day.u, day.u, pctLine, day.pack), Math.floor(day.u.maxHp * 0.1 * (1 + pct / 100)));
});

test("sub_race_is matches the sub-race only (false on a squad and on a plain parent); race_is matches the parent", () => {
  const { state, u } = raced(LEON, "elf", "dark_elf", "day", { squads: true });
  const squad = state.units.find((v) => v.kind === "squad")!;
  const ev = (node: unknown, self: Unit, target?: Unit) => evaluateCondition(node as never, { state, self, ...(target ? { target } : {}) }).value;
  assert.equal(ev({ type: "sub_race_is", side: "self", value: "dark_elf" }, u), true);
  assert.equal(ev({ type: "sub_race_is", side: "self", value: "high_elf" }, u), false);
  assert.equal(ev({ type: "race_is", side: "self", value: "elf" }, u), true);
  assert.equal(ev({ type: "sub_race_is", side: "target", value: "dark_elf" }, u, squad), false);
  const plain = state.units.find((v) => v.id === EMPEROR)!;
  assert.equal(ev({ type: "sub_race_is", side: "target", value: "dark_elf" }, u, plain), false);
});

test("E_SUB_RACE_PARENT: a sub-race must belong to the hero's race", () => {
  const raw = fresh();
  const lief = find(raw.characters, "char_004");
  lief.sub_race = "dark_elf"; // lief is human
  assert.ok(codes(raw).includes("E_SUB_RACE_PARENT"));
  lief.race = "elf";
  assert.ok(!codes(raw).includes("E_SUB_RACE_PARENT"));
  lief.race = "beastfolk";
  assert.ok(codes(raw).includes("E_SUB_RACE_PARENT"));
});

test("self_hp_cost: loses the percent of current HP, floored, never below 1 HP", () => {
  const { pack, battle } = loadReal();
  const state = createBattleState(pack, battle);
  const { x, ev } = ctx(state);
  const leon = state.units.find((v) => v.id === LEON)!;
  const cost = pack.byId.skills.get("skl_024")!.effects[0] as { percent: number };
  const hp = leon.hp;
  run(x, pack, leon, "skl_024", 0, [leon]);
  assert.equal(leon.hp, hp - Math.floor((cost.percent / 100) * hp));
  leon.hp = 1;
  run(x, pack, leon, "skl_024", 0, [leon]);
  assert.equal(leon.hp, 1);
  leon.hp = 7;
  runEffect(x, leon, { id: "t", name: "t", shape: "self", interactions: pack.byId.skills.get("skl_024")!.interactions }, { type: "self_hp_cost", percent: 100 }, [leon], new Set(), false);
  assert.equal(leon.hp, 1);
  assert.equal(ev("self_hp_cost").length, 2); // the run at 1 HP costs nothing and logs nothing
});

test("remove_debuffs: newest first, up to count; buffs and gear lines stay", () => {
  const { pack, battle } = loadReal();
  const state = createBattleState(pack, battle);
  const { x } = ctx(state);
  const leon = state.units.find((v) => v.id === LEON)!;
  const lief = state.units.find((v) => v.id === LIEF)!;
  applyStatus(state, leon, "debuff_001", "active", lief.id); // older
  applyStatus(state, leon, "buff_004", "active", lief.id);
  applyStatus(state, leon, "debuff_003", "active", lief.id); // newest debuff
  const gear: StatusInstance = { statusId: "equip:test", category: "equipment", sourceUnitId: leon.id, remaining: null, skipNextTick: false, seq: state.statusSeq++, inline: { name: "test", modifiers: [{ stat: "DEF", mode: "percent", value: -10 }] } };
  leon.statuses.push(gear);
  const ids = () => leon.statuses.map((s) => s.statusId);
  run(x, pack, lief, "skl_027", 1, [leon]); // Purify: count 1
  assert.deepEqual(ids(), ["debuff_001", "buff_004", "equip:test"]);
  run(x, pack, lief, "skl_027", 1, [leon]);
  assert.deepEqual(ids(), ["buff_004", "equip:test"]);
  run(x, pack, lief, "skl_027", 1, [leon]); // nothing left to remove
  assert.deepEqual(ids(), ["buff_004", "equip:test"]);
  pack.byId.statuses.get("debuff_003")!.removal.removable_by_dispel = false; // a debuff that cannot be dispelled stays
  applyStatus(state, leon, "debuff_003", "active", lief.id);
  run(x, pack, lief, "skl_027", 1, [leon]);
  assert.deepEqual(ids(), ["buff_004", "equip:test", "debuff_003"]);
});

test("First Cut: the bonus applies only while the target is at full HP", () => {
  const { pack, battle } = loadReal();
  rig(pack);
  const state = createBattleState(pack, battle);
  const { x, ev } = ctx(state);
  const leon = state.units.find((v) => v.id === LEON)!, emp = state.units.find((v) => v.id === EMPEROR)!;
  const bonus = (pack.byId.skills.get("skl_025")!.effects[0] as { bonus_if_target_full_hp_percent: number }).bonus_if_target_full_hp_percent;
  const maxHp = emp.maxHp;
  run(x, pack, leon, "skl_025", 0, [emp]);
  emp.hp = maxHp - 1; // not full any more
  run(x, pack, leon, "skl_025", 0, [emp]);
  emp.hp = maxHp;
  const [full, hurt] = ev("damage");
  assert.ok(bonus > 0 && full!.amount > hurt!.amount);
  // the hurt hit equals the same skill without the bonus field
  const plain = structuredClone(pack.byId.skills.get("skl_025")!);
  delete (plain.effects[0] as { bonus_if_target_full_hp_percent?: number }).bonus_if_target_full_hp_percent;
  pack.byId.skills.set("skl_025", plain);
  emp.hp = maxHp;
  run(x, pack, leon, "skl_025", 0, [emp]);
  assert.equal(ev("damage")[2]!.amount, hurt!.amount);
});

test("Mercy Bolt: the heal rider goes to the lowest-HP% ally hero, not to the target", () => {
  const { pack, battle } = loadReal();
  rig(pack);
  const state = createBattleState(pack, battle);
  const { x, ev } = ctx(state);
  const jas = state.units.find((v) => v.id === JASMINE)!, emp = state.units.find((v) => v.id === EMPEROR)!, leon = state.units.find((v) => v.id === LEON)!;
  emp.hp = Math.floor(emp.maxHp / 2); // the Emperor is the lowest ally of Jasmine
  const before = emp.hp;
  run(x, pack, jas, "skl_028", 0, [leon]);
  run(x, pack, jas, "skl_028", 1, [leon]);
  const heals = ev("heal");
  assert.equal(heals.length, 1);
  assert.equal(heals[0]!.target, EMPEROR);
  assert.ok(emp.hp > before);
  assert.ok(ev("damage").some((d) => d.target === LEON));
});

test("Bodyguard: takes a single-target physical hit on a same-row ally, spends 1 Passive PP; other rows and magic are not covered", () => {
  const go = (setupRows: (lief: Unit) => void, skillId = "skl_cav_active_001") => {
    const { pack, battle } = loadReal();
    rig(pack);
    const entry = battle.challenger.heroes.find((h) => h.char_id === LEON)!;
    entry.tactic_sheet.push(tactic("skl_030", { priority: 20 }));
    const state = createBattleState(pack, battle);
    const { x, ev } = ctx(state);
    const leon = state.units.find((v) => v.id === LEON)!, lief = state.units.find((v) => v.id === LIEF)!, emp = state.units.find((v) => v.id === EMPEROR)!;
    leon.row = "front";
    setupRows(lief);
    const pp = leon.pp.passive.cur, liefHp = lief.hp;
    const sk = pack.byId.skills.get(skillId)!;
    if (skillId !== "skl_cav_active_001") (sk.effects[0] as { damage_type: string }).damage_type = "magical";
    state.bus.beginAction(emp);
    runEffect(x, emp, { id: sk.id, name: sk.name, shape: "single", interactions: sk.interactions }, sk.effects[0]!, [lief], new Set(), false);
    return { covered: ev("cover").length, ppSpent: pp - leon.pp.passive.cur, liefHp: lief.hp, liefMax: liefHp };
  };
  const same = go((lief) => { lief.row = "front"; });
  assert.equal(same.covered, 1);
  assert.equal(same.ppSpent, loadReal().pack.byId.skills.get("skl_030")!.pp_cost);
  assert.equal(same.liefHp, same.liefMax); // Lief took nothing
  assert.equal(go((lief) => { lief.row = "back"; }).covered, 0);
  assert.equal(go((lief) => { lief.row = "front"; }, "skl_cav_active_002").covered, 0); // magical
});

test("Sworn Banner: only allies sharing the Emperor's faction get the buff (soldiers skipped)", () => {
  const run1 = (jasFactions: string[]) => {
    const { pack, battle } = loadReal({ squads: true });
    pack.byId.characters.get(JASMINE)!.factions = jasFactions;
    const entry = battle.defender.heroes.find((h) => h.char_id === EMPEROR)!;
    entry.tactic_sheet.push(tactic("skl_029", { priority: 20 }));
    const log = new EventLog();
    beginPhase(pack, battle, 1, null, log);
    return log.events.filter((e): e is Extract<BattleEvent, { type: "status_applied" }> => e.type === "status_applied" && e.status === "buff_008").map((e) => e.unit).sort();
  };
  assert.deepEqual(run1(["faction_003"]), [EMPEROR]);
  assert.deepEqual(run1(["faction_001"]), [EMPEROR, JASMINE]);
  assert.deepEqual(run1(["faction_002"]), [EMPEROR, JASMINE]); // any faction the Emperor has, not only the first
});

test("re-gated skills are hero skills: a generic hero of the old class may not carry them", () => {
  const raw = fresh();
  for (const [hero, skill] of [["char_007", "skl_cav_active_001"], ["char_007", "skl_cav_active_002"], ["char_012", "skl_heal_active_001"], ["char_012", "skl_passive_004"], ["char_006", "skl_lancer_active_001"], ["char_006", "skl_lancer_active_002"]] as const) {
    const r = fresh();
    find(r.characters, hero).skills.push(skill);
    assert.ok(codes(r).includes("E_SKILL_INELIGIBLE"), `${hero} ${skill}`);
  }
  assert.ok(!codes(raw).includes("E_SKILL_INELIGIBLE"));
});
