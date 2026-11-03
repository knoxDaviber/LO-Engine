// Squads (roadmap 2.1/2.2, design Sections 2.1, 8, 10 and 17; Decision 130): per-soldier HP, one-target selection, attacking and defending as
// one (summed ATK / DEF, one roll set per hit), overflow, heal split, own SPD schedule, never keeping a phase alive, soldier-category stacking, area statuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyHeal, applyStatus, beginPhase, createBattleState, decideTactic, effectiveStat, executeSkill, executeSquadAction, hitSquad,
  lowestHpSoldier, runBattle, runPhase, scheduleInitial, statBreakdown, summedStat, syncSquad, type BattleEvent, type DamageEffect, type ExecCtx, type Unit,
} from "../src/engine";
import type { Battle, Skill } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, scripted, tactic } from "./engineHelpers";

/** Rng that always returns the same value and counts its draws. */
const counting = (): ExecCtx["rng"] => {
  let n = 0;
  return { next: () => (n++, 0.999999), int: (k) => (n++, Math.floor(0.999999 * k)), get draws() { return n; } };
};

const SQ_C = `squad_${LEON}`;
const SQ_D = `squad_${EMPEROR}`;

/** Real sample with real squads. Rolls are made certain: every hit lands, nothing crits or guards (the rng value is then irrelevant). */
function setup(over?: (pack: Pack, battle: Battle) => void) {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  over?.(pack, battle);
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: counting(), log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  const skill = (id: string) => pack.byId.skills.get(id) as Skill;
  const dmg = (id: string) => skill(id).effects.find((e) => e.type === "damage") as DamageEffect;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  return { pack, battle, state, log, x, u, skill, dmg, ev };
}
const sheetOf = (b: Battle, id: string) => [...b.challenger.heroes, ...b.defender.heroes].find((h) => h.char_id === id)!;
const hps = (sq: Unit) => sq.soldiers.map((s) => (s.alive ? s.hp : 0));

test("a side gets exactly its leader's squad as one unit with 10 soldiers of their own HP", () => {
  const { state, u } = setup();
  const squads = state.units.filter((v) => v.kind === "squad");
  assert.deepEqual(squads.map((s) => s.id), [SQ_C, SQ_D]); // only the leaders' squads, though Lief and Jasmine have a squad_id too
  const sq = u(SQ_C);
  assert.equal(sq.soldiers.length, 10);
  assert.ok(sq.soldiers.every((s) => s.hp === 153 && s.maxHp === 153));
  assert.equal(sq.hp, 1530);
  assert.equal(sq.maxHp, 1530);
  assert.equal(sq.class, "infantry"); // the squad's class follows its soldier type
});

test("a hit on a squad is resolved once against the summed DEF of its living soldiers; lowest-HP soldier first, ties lowest index, overflow", () => {
  const { x, u, skill, dmg, ev } = setup((p) => { (p.byId.characters.get(LEON) as any).base_stats.ATK = 200; });
  const sq = u(SQ_D);
  const leon = u(LEON);
  sq.soldiers[3]!.hp = 20;
  sq.soldiers[5]!.hp = 20;
  syncSquad(sq);
  const ca = skill("skl_cav_active_001"); // Charging Assault, 200 x 1.2 x 1.25 = 300 power vs 10 x DEF 18.2 = 182: 118
  hitSquad(x, leon, sq, ca, dmg("skl_cav_active_001"), false);
  assert.deepEqual(hps(sq), [75, 153, 153, 0, 153, 0, 153, 153, 153, 153]); // soldier 3 (index tie with 5 goes to the lower index) dies, the 98 left over go to the lowest HP: soldier 5 (20) dies, 78 more reach soldier 0
  assert.equal(sq.hp, 1530 - 2 * 133 - 118);
  assert.equal(ev("damage")[0]!.defense, 182);
  hitSquad(x, leon, sq, ca, dmg("skl_cav_active_001"), false); // 8 living: defense 145.6, 154 damage; soldier 0 (75 HP) dies, 79 overflow to soldier 1
  assert.deepEqual(hps(sq), [0, 74, 153, 0, 153, 0, 153, 153, 153, 153]);
  assert.equal(ev("roll").filter((e) => e.kind === "hit").length, 2); // one hit roll per hit, whatever the soldier count
  const hits = ev("damage").filter((e) => e.target === SQ_D);
  assert.deepEqual(hits.map((e) => e.soldier), [3, 5, 0, 0, 1]);
  assert.deepEqual(hits.map((e) => !!e.spill), [false, true, true, false, true]);
  assert.equal(hits[0]!.hp_before, 20);
  assert.equal(hits[0]!.hp_after, 0);
  assert.deepEqual(ev("death").map((e) => e.soldier), [3, 5, 0]);
  assert.equal(lowestHpSoldier(sq)!.index, 1);
});

test("a squad is selected as ONE target (the default target when it stands in front) and a hit goes through the tactic path", () => {
  const { state, battle, x, u, ev } = setup((p, b) => { (p.byId.characters.get(LEON) as any).base_stats.ATK = 200; sheetOf(b, LEON).tactic_sheet = [tactic("skl_cav_active_001")]; });
  const leon = u(LEON);
  const d = decideTactic(state, leon, x.rng);
  assert.deepEqual(d.targets.map((t) => t.id), [SQ_D]); // nearest, front board row first: the soldier row in front of the Emperor
  executeSkill(x, leon, d);
  assert.deepEqual(ev("damage").map((e) => e.soldier), [0]); // single-target: one hit, 118 damage on a 153 HP soldier
  assert.equal(u(SQ_D).hp, 1530 - 118);
  assert.equal(u(EMPEROR).hp, 950);
  void battle;
});

test("a back squad is the last target; soldier-kind conditions select or skip the squad", () => {
  const front = setup((_p, b) => { sheetOf(b, LEON).tactic_sheet = [tactic("skl_cav_active_001", { main: { type: "unit_kind", ignore: "soldier" }, sub: null })]; });
  assert.deepEqual(decideTactic(front.state, front.u(LEON), front.x.rng).targets.map((t) => t.id), [EMPEROR]); // heroes only, the squad is skipped
  const rowSoldier = setup((_p, b) => { sheetOf(b, LEON).tactic_sheet = [tactic("skl_cav_active_001", { main: { type: "row_is", value: "soldier_front" }, sub: null })]; });
  assert.deepEqual(decideTactic(rowSoldier.state, rowSoldier.u(LEON), rowSoldier.x.rng).targets.map((t) => t.id), [SQ_D]);
  const back = setup((p, b) => { sheetOf(b, EMPEROR).squad_row = "back"; sheetOf(b, LEON).tactic_sheet = [tactic("skl_cav_active_001")]; void p; });
  const d = decideTactic(back.state, back.u(LEON), back.x.rng);
  assert.deepEqual(d.targets.map((t) => t.id), [EMPEROR]); // the hero rows come first when the squad stands behind
});

test("a column skill hits the squad once (it defends as one), whichever column it is in", () => {
  const { state, x, u, ev } = setup((_p, b) => { sheetOf(b, LIEF).tactic_sheet = [tactic("skl_lancer_active_001", { main: { type: "class_is", side: "enemy", value: "holy" }, sub: null })]; });
  u(JASMINE).column = 3; // anchor in column 3: the squad is in every column, so it is in this one too
  u(SQ_D).soldiers[2]!.alive = false;
  u(SQ_D).soldiers[2]!.hp = 0;
  const lief = u(LIEF);
  const d = decideTactic(state, lief, x.rng);
  assert.deepEqual(d.targets.map((t) => t.id).sort(), [JASMINE, SQ_D]);
  executeSkill(x, lief, d);
  const onSquad = ev("damage").filter((e) => e.target === SQ_D);
  assert.deepEqual(onSquad.map((e) => e.soldier), [0]); // one hit, on the lowest-HP living soldier
  assert.equal(onSquad[0]!.defense, 163.8); // the 9 living soldiers' DEF summed (14 x 1.3 each)
  assert.equal(ev("roll").filter((e) => e.target === SQ_D && e.kind === "hit").length, 1); // one hit roll
  assert.equal(ev("damage").filter((e) => e.target === JASMINE).length, 1);
});

test("a row skill aimed at a squad hits it once; the Dirge row through the hero row skips the squad", () => {
  const { state, x, u, ev } = setup((_p, b) => { sheetOf(b, EMPEROR).tactic_sheet = [tactic("skl_inf_active_002")]; });
  const emp = u(EMPEROR);
  const d = decideTactic(state, emp, x.rng);
  assert.deepEqual(d.targets.map((t) => t.id), [SQ_C]); // nearest = the challenger squad's own soldier row
  executeSkill(x, emp, d);
  assert.equal(ev("damage").filter((e) => e.target === SQ_C).length, 1); // 150 power vs 182 summed DEF: the minimum, on one soldier
  assert.equal(ev("roll").filter((e) => e.target === SQ_C && e.kind === "hit").length, 1);
  const heroRow = setup((_p, b) => { sheetOf(b, EMPEROR).tactic_sheet = [tactic("skl_inf_active_002", { main: { type: "unit_kind", is: "hero" }, sub: null })]; });
  const d2 = decideTactic(heroRow.state, heroRow.u(EMPEROR), heroRow.x.rng);
  assert.deepEqual(d2.targets.map((t) => t.id), [LEON, LIEF]); // the hero front row, no squad
});

test("area statuses skip the squad unless include_soldiers; a directly hit single target keeps its status", () => {
  const weak = (p: Pack) => { (p.byId.characters.get(EMPEROR) as any).base_stats.ATK = 30; }; // so the Dirge does no more than the minimum
  const a = setup((p, b) => { weak(p); sheetOf(b, EMPEROR).tactic_sheet = [tactic("skl_inf_active_002")]; });
  const emp = a.u(EMPEROR);
  executeSkill(a.x, emp, decideTactic(a.state, emp, a.x.rng));
  assert.equal(a.ev("damage").filter((e) => e.target === SQ_C).length, 1); // damage still hits the squad
  assert.equal(a.u(SQ_C).alive, true);
  assert.deepEqual(a.u(SQ_C).statuses, []); // but the area status (Dark Dragon's Ire, Defense Down) skips the squad

  const b = setup((p, bt) => {
    weak(p);
    sheetOf(bt, EMPEROR).tactic_sheet = [tactic("skl_inf_active_002")];
    for (const e of (p.byId.skills.get("skl_inf_active_002") as Skill).effects) if (e.type === "apply_status") e.include_soldiers = true;
  });
  const emp2 = b.u(EMPEROR);
  executeSkill(b.x, emp2, decideTactic(b.state, emp2, b.x.rng));
  assert.deepEqual(b.u(SQ_C).statuses.map((s) => s.statusId).sort(), ["debuff_001", "status_003"]);

  const c = setup((p, bt) => { // caster_row (Iron Fist): the Emperor's own squad is not in his row; include_soldiers brings it in
    sheetOf(bt, EMPEROR).tactic_sheet = [tactic("skl_inf_active_001")];
    void p;
  });
  const emp3 = c.u(EMPEROR);
  executeSkill(c.x, emp3, decideTactic(c.state, emp3, c.x.rng));
  assert.deepEqual(c.u(SQ_D).statuses, []);
  const d = setup((p, bt) => {
    sheetOf(bt, EMPEROR).tactic_sheet = [tactic("skl_inf_active_001")];
    for (const e of (p.byId.skills.get("skl_inf_active_001") as Skill).effects) if (e.type === "apply_status" && e.target === "caster_row") e.include_soldiers = true;
  });
  executeSkill(d.x, d.u(EMPEROR), decideTactic(d.state, d.u(EMPEROR), d.x.rng));
  assert.deepEqual(d.u(SQ_D).statuses.map((s) => s.statusId), ["buff_006"]);
});

test("a single-target status applied straight to a squad stays (it was the explicit target)", () => {
  const { state, x, u } = setup();
  const res = applyStatus(state, u(SQ_D), "buff_004", "active", EMPEROR);
  assert.equal(res.applied, true);
  assert.equal(statBreakdown(u(SQ_D), "DEF", state.pack).effects.length, 2);
  void x;
});

test("heal on a squad is split evenly over all 10 soldiers, dead included: 60 is +6 each, revives at the share, capped", () => {
  const { x, u, ev } = setup();
  const sq = u(SQ_C);
  const jas = u(JASMINE);
  sq.soldiers[0]!.hp = 20;
  sq.soldiers[1]!.hp = 0;
  sq.soldiers[1]!.alive = false;
  sq.soldiers[2]!.hp = 150;
  syncSquad(sq);
  const before = sq.hp;
  const applied = applyHeal(x, jas, sq, { id: "skl_heal_active_001" }, 60);
  assert.equal(sq.soldiers[0]!.hp, 26); // living 20 -> 26
  assert.equal(sq.soldiers[1]!.hp, 6); // dead revives at its share
  assert.equal(sq.soldiers[1]!.alive, true);
  assert.equal(sq.soldiers[2]!.hp, 153); // 150 + 6 capped at max
  assert.equal(sq.soldiers[3]!.hp, 153);
  assert.equal(applied, 6 + 6 + 3);
  assert.equal(sq.hp, before + applied);
  const h = ev("heal")[0]!;
  assert.deepEqual([h.share, h.revived, h.amount], [6, 1, 60]);
  applyHeal(x, jas, sq, { id: "skl_heal_active_001" }, 69); // 6 each, the remainder is lost
  assert.equal(sq.soldiers[1]!.hp, 12);
  applyHeal(x, jas, sq, { id: "skl_heal_active_001" }, 9); // share 0: nobody changes, nobody revives
  assert.equal(sq.soldiers[1]!.hp, 12);
});

test("a wiped squad takes no heal and does not come back", () => {
  const { x, u } = setup();
  const sq = u(SQ_C);
  const jas = u(JASMINE);
  const emp = u(EMPEROR);
  for (const s of sq.soldiers) hitSquad(x, emp, sq, { id: "x", interactions: { guard: "standard", soldiers: "standard" } }, { type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 100 }], multiplier: 1, ignores_guard: false, bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0 }, true);
  assert.equal(sq.alive, false);
  assert.equal(applyHeal(x, jas, sq, { id: "h" }, 600), 0);
  assert.deepEqual(hps(sq), Array(10).fill(0));
});

test("squad defeated: all soldiers dead removes it from the timeline, logs it, and the heroes live on", () => {
  const { state, x, u, ev } = setup((p, b) => { (p.byId.characters.get(EMPEROR) as any).base_stats.ATK = 1000; sheetOf(b, EMPEROR).tactic_sheet = [tactic("skl_inf_active_002")]; });
  scheduleInitial(state);
  const sq = u(SQ_C);
  for (const s of sq.soldiers) s.hp = 1; // one Dirge hit (1500 - 182) overflows through all of them
  const emp = u(EMPEROR);
  executeSkill(x, emp, decideTactic(state, emp, x.rng));
  assert.equal(sq.alive, false);
  assert.equal(state.timeline.pending.has(SQ_C), false);
  const deaths = ev("death");
  assert.equal(deaths.filter((e) => e.unit === SQ_C && e.soldier !== undefined).length, 9);
  assert.equal(deaths.filter((e) => e.unit === SQ_C).length, 10); // the last soldier's death is the wipe, logged once
  assert.equal(deaths.at(-1)!.unit, SQ_C); // the squad's own defeat comes after the other soldiers
  assert.equal(deaths.at(-1)!.soldier, undefined);
  assert.equal(u(LEON).alive, true);
  assert.ok(state.units.filter((v) => v.kind === "hero" && v.side === "challenger").every((v) => v.alive));
});

test("a squad action is ONE attack: summed ATK of the living soldiers, one hit/crit/guard roll (3 draws), on the squad's own SPD schedule", () => {
  const { state, x, u, ev } = setup();
  scheduleInitial(state);
  u(SQ_D).alive = false; // so the squad's targets are heroes
  const sq = u(SQ_C);
  state.timeline.now = 33;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, sq);
  assert.equal(x.rng.draws, 3); // hit, crit, guard once
  const rolls = ev("roll");
  assert.deepEqual(rolls.map((r) => r.kind), ["hit", "crit", "guard"]);
  assert.ok(rolls.every((r) => r.by === undefined));
  const dmg = ev("damage");
  assert.equal(dmg.length, 1);
  assert.ok(dmg[0]!.target === EMPEROR && dmg[0]!.unit === SQ_C); // nearest, front row first, ties by column
  assert.ok(Math.abs(dmg[0]!.power - 221) < 1e-3); // 10 x ATK 22.1 (17 x 1.3)
  assert.equal(u(EMPEROR).hp, 950 - 151); // 221 - DEF 70
  assert.equal(ev("squad_attack")[0]!.attackers, 10);
  const next = ev("schedule").at(-1)!;
  assert.deepEqual([next.unit, next.reason, next.due, next.interval], [SQ_C, "next_action", 33 + 33, 33]); // SPD 30: round(1000 / 30)
});

test("a weakened squad hits softer: the attack sums only the living soldiers", () => {
  const { state, x, u, ev } = setup();
  scheduleInitial(state);
  u(SQ_D).alive = false;
  const sq = u(SQ_C);
  for (const i of [0, 2, 4, 6, 8]) { sq.soldiers[i]!.hp = 0; sq.soldiers[i]!.alive = false; }
  syncSquad(sq);
  executeSquadAction(x, sq);
  assert.ok(Math.abs(ev("damage")[0]!.power - 110.5) < 1e-3); // 5 x 22.1
  assert.equal(u(EMPEROR).hp, 950 - 40);
  assert.equal(ev("squad_attack")[0]!.attackers, 5);
});

test("the attack stops once the enemy has no living hero", () => {
  const { state, x, u, ev } = setup();
  scheduleInitial(state);
  for (const id of [EMPEROR, JASMINE]) { u(id).hp = 0; u(id).alive = false; }
  executeSquadAction(x, u(SQ_C));
  assert.equal(ev("damage").length, 0); // the defender squad still stands, but heroes decide the battle
});

test("a higher SPD squad makes more attacks per phase; every attack is one hit roll", () => {
  const run = (spd: number) => {
    const { pack, battle } = loadReal({ squads: true });
    pack.rules.rolls.hit_min = 100;
    pack.byId.soldiers.get("soldier_001")!.per_soldier_stats.SPD = spd;
    // Only the Emperor can act (Iron Fist x4), so the phase lasts until t = 4 * 33 while the squads keep attacking.
    for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) h.tactic_sheet = [];
    sheetOf(battle, EMPEROR).tactic_sheet = [tactic("skl_inf_active_001")];
    (pack.byId.characters.get(EMPEROR) as any).pp.active = 4;
    const log = new EventLog();
    const { state, rng } = beginPhase(pack, battle, 1, null, log);
    const res = runPhase(state, rng, log);
    const attacks = log.events.filter((e) => e.type === "squad_attack" && e.unit === SQ_C).length;
    const hitRolls = log.events.filter((e) => e.type === "roll" && e.kind === "hit" && e.unit === SQ_C).length;
    return { res, attacks, hitRolls };
  };
  const slow = run(30);
  const fast = run(60);
  assert.equal(slow.res.reason, "exhausted");
  assert.ok(slow.attacks >= 3, `slow squad attacked ${slow.attacks} times`);
  assert.ok(fast.attacks > slow.attacks, `${fast.attacks} > ${slow.attacks}`);
  assert.equal(slow.hitRolls, slow.attacks); // one hit roll per squad attack
  assert.equal(fast.hitRolls, fast.attacks);
});

test("squads never keep a phase alive: no usable hero skill ends the phase at once, even with squads at full strength", () => {
  const { pack, battle } = loadReal({ squads: true });
  for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) h.tactic_sheet = [];
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "exhausted");
  assert.equal(res.actions, 0);
  assert.equal(res.squadActions, 0); // the soldiers never even got to attack
  assert.ok(state.units.filter((v) => v.kind === "squad").every((s) => s.alive && s.hp === 1530));
});

test("squads take no part in the idle cycle either: heroes idling ends the phase while squads keep acting in between", () => {
  const { pack, battle } = loadReal({ squads: true });
  for (const h of [...battle.challenger.heroes, ...battle.defender.heroes]) for (const t of h.tactic_sheet) t.main = { type: "phase", op: "=", value: 9 };
  const log = new EventLog();
  const { state, rng } = beginPhase(pack, battle, 1, null, log);
  const res = runPhase(state, rng, log);
  assert.equal(res.reason, "idle_cycle");
  assert.equal(res.actions, 4); // each hero idled once
  assert.ok(res.squadActions >= 1); // squads acted in between without counting as idles or as skills
});

test("soldiers' HP and deaths persist into the next phase; they do not respawn", () => {
  const { pack, battle } = loadReal({ squads: true });
  const log = new EventLog();
  const p1 = beginPhase(pack, battle, 1, null, log);
  runPhase(p1.state, p1.rng, log);
  const sq1 = p1.state.units.find((v) => v.id === SQ_D)!;
  sq1.soldiers[4]!.hp = 0;
  sq1.soldiers[4]!.alive = false;
  sq1.soldiers[7]!.hp = 13;
  syncSquad(sq1);
  const p2 = beginPhase(pack, battle, 2, p1.state, log);
  const sq2 = p2.state.units.find((v) => v.id === SQ_D)!;
  assert.deepEqual(hps(sq2), hps(sq1));
  assert.equal(sq2.hp, sq1.hp);
  const start = log.events.filter((e) => e.type === "phase_start").at(-1) as Extract<BattleEvent, { type: "phase_start" }>;
  assert.deepEqual(start.squads.find((s) => s.id === SQ_D)!.soldiers, hps(sq1));
});

// ------------------------------------------------------------------ soldier skills and the `soldier` stacking category

test("soldier skills are always-on stat mods in the soldier category: ATK/DEF +30% on the squad", () => {
  const { state, u } = setup();
  const sq = u(SQ_C);
  assert.ok(Math.abs(effectiveStat(sq, "ATK", state.pack) - 17 * 1.3) < 1e-9);
  assert.ok(Math.abs(effectiveStat(sq, "DEF", state.pack) - 14 * 1.3) < 1e-9);
  assert.equal(effectiveStat(sq, "SPD", state.pack), 30);
  const bd = statBreakdown(sq, "ATK", state.pack);
  assert.deepEqual(bd.effects.map((e) => [e.category, e.value, e.outcome]), [["soldier", 30, "winner"]]);
  // INT/MDEF pairing (Decision 132): the ATK / DEF soldier skill lines also apply to INT / MDEF, as entries of the same skill and category
  assert.deepEqual(statBreakdown(sq, "INT", state.pack).effects.map((e) => [e.status, e.category, e.value]), [["soldier_001 skill 1.1", "soldier", 30]]);
  assert.deepEqual(statBreakdown(sq, "MDEF", state.pack).effects.map((e) => [e.status, e.category, e.value]), [["soldier_001 skill 1.2", "soldier", 30]]);
});

test("soldier-category effects multiply with active, passive and equipment effects; within the category the strongest wins", () => {
  const { state, u } = setup();
  const sq = u(SQ_C);
  applyStatus(state, sq, "buff_004", "active", LEON); // DEF UP 20%, active category
  assert.ok(Math.abs(effectiveStat(sq, "DEF", state.pack) - 14 * 1.3 * 1.2) < 1e-9); // 21.84
  applyStatus(state, sq, "buff_004", "passive", LEON); // the same status from a passive source coexists
  assert.ok(Math.abs(effectiveStat(sq, "DEF", state.pack) - 14 * 1.3 * 1.2 * 1.2) < 1e-9);
  sq.innate.push({ id: "second soldier skill", stat: "DEF", mode: "percent", value: 10, category: "soldier" }); // weaker, same category
  const bd = statBreakdown(sq, "DEF", state.pack);
  assert.ok(Math.abs(bd.result - 14 * 1.3 * 1.2 * 1.2) < 1e-9); // soldier vs soldier never stack
  assert.equal(bd.effects.find((e) => e.status === "second soldier skill")!.outcome, "suppressed");
  sq.innate.push({ id: "stronger soldier skill", stat: "DEF", mode: "percent", value: 50, category: "soldier" });
  assert.ok(Math.abs(statBreakdown(sq, "DEF", state.pack).result - 14 * 1.5 * 1.2 * 1.2) < 1e-9); // the strongest wins
  sq.equipFlat.DEF = 10; // flat lines come first
  assert.ok(Math.abs(statBreakdown(sq, "DEF", state.pack).result - 24 * 1.5 * 1.2 * 1.2) < 1e-9);
});

test("soldier skills the engine cannot run (on_event, a condition, non-stat leader/party effects) are logged, never silently dropped", () => {
  const { pack, battle } = loadReal({ squads: true });
  const st = pack.byId.soldiers.get("soldier_001")!;
  st.passive_effects.push({ name: "x", target: "self_squad", effects: [{ type: "heal", percent_max_hp: 20, trigger: "on_event" }] });
  st.passive_effects.push({ name: "y", target: "party", effects: [{ type: "heal", percent_max_hp: 5 }] });
  const log = new EventLog();
  const { state } = beginPhase(pack, battle, 1, null, log);
  const notes = log.events.filter((e): e is Extract<BattleEvent, { type: "not_implemented" }> => e.type === "not_implemented").map((e) => e.what);
  assert.ok(notes.includes("not implemented: event soldier skill"));
  assert.ok(notes.includes("not implemented: soldier skill effect heal"));
  assert.equal(state.units.find((v) => v.id === SQ_C)!.innate.length, 4); // only the always-on ATK/DEF mods run (with their paired INT/MDEF lines)
});

test("hero passive skills run (3a): no 'not implemented: passive' notes remain for fielded heroes", () => {
  const { pack, battle } = loadReal({ squads: true });
  const log = new EventLog();
  beginPhase(pack, battle, 1, null, log);
  const notes = log.events.filter((e): e is Extract<BattleEvent, { type: "not_implemented" }> => e.type === "not_implemented");
  assert.deepEqual(notes.filter((n) => n.what.startsWith("not implemented: passive ")), []);
});

// ------------------------------------------------------------------ whole battle

test("sample battle with real squads: runs, is deterministic, and the log shows the squads", () => {
  const a = loadReal({ squads: true });
  const b = loadReal({ squads: true });
  const ra = runBattle(a.pack, a.battle);
  const rb = runBattle(b.pack, b.battle);
  assert.equal(JSON.stringify(ra), JSON.stringify(rb));
  assert.equal(ra.squads.length, 2);
  const setup0 = ra.events[0] as Extract<BattleEvent, { type: "battle_setup" }>;
  assert.equal(setup0.squads.length, 2);
  assert.equal(setup0.squads[0]!.stats.ATK.result, 22.1);
  const types = new Set(ra.events.map((e) => e.type));
  assert.ok(types.has("squad_attack"));
  assert.ok(ra.events.some((e) => e.type === "damage" && e.soldier !== undefined));
});

test("a flat line shared from the leader counts once for the squad's summed ATK / DEF, not per soldier", () => {
  const { state, pack, x, u, ev } = setup((p) => {
    const base = structuredClone(p.byId.statuses.get("buff_005")!);
    p.byId.statuses.set("flat_atk", { ...base, id: "flat_atk", modifiers: [{ stat: "ATK", mode: "flat", value: 10 }, { stat: "DEF", mode: "flat", value: 10 }] });
  });
  applyStatus(state, u(LEON), "flat_atk", "active", LEON);
  const sq = u(SQ_C);
  const bd = statBreakdown(sq, "ATK", pack);
  assert.equal(bd.sharedFlat, 10);
  assert.ok(bd.effects.some((e) => e.status === "flat_atk" && e.shared));
  assert.ok(Math.abs(summedStat(sq, "ATK", pack) - (10 * 17 + 10) * 1.3) < 1e-9); // per soldier (17 + 10) x 1.3, but the +10 only once
  assert.ok(Math.abs(summedStat(sq, "DEF", pack) - (10 * 14 + 10) * 1.3) < 1e-9);
  scheduleInitial(state);
  u(SQ_D).alive = false;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, sq);
  assert.ok(Math.abs(ev("damage")[0]!.power - 234) < 1e-9); // (170 + 10) x 1.3
});

test("a conditional INT line in a soldier skill (not built) does not suppress the ATK -> INT pairing", () => {
  const { state, u } = setup((p) => {
    p.byId.soldiers.get("soldier_001")!.passive_effects[0]!.effects.push({ type: "modify_stat", stat: "INT", mode: "percent", value: 50, condition: { type: "phase", op: ">", value: 1 } } as any);
  });
  assert.deepEqual(statBreakdown(u(SQ_C), "INT", state.pack).effects.map((e) => [e.status, e.value]), [["soldier_001 skill 1.1", 30]]);
});
