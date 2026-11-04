// Devotion (roadmap 3c; design Section 9A, Decisions 125 and 141): sigils, blessing tiers and sides, the prayer category, every enchantment,
// blessing pricing and tiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, beginPhase, checkEquipment, effectiveStat, evaluateCondition, executeSkill, executeSquadAction, statBreakdown,
  type BattleEvent, type ExecCtx, type Unit,
} from "../src/engine";
import { defenseFor } from "../src/engine/damage";
import type { Effect, RosterHero, SigilSide } from "../src/schema";
import { unlockedBlessings } from "../src/devotion";
import { heroCost } from "../src/validate/cost";
import { validateRaw } from "../src/validate";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, scripted } from "./engineHelpers";
import { find, fresh, roster } from "./helpers";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
type Sigils = NonNullable<RosterHero["sigils"]>;
const GEAR = { weapon: "equip_009", armor: "equip_017", accessory_1: "equip_021", accessory_2: "equip_021" };
const all4 = (god: string): Sigils => ({ weapon: god, armor: god, accessory_1: god, accessory_2: god });

/** The real sample (squads off unless asked, auras off), every hero in full generic gear, the given sigils, after the pre-battle steps. */
function setup(sigils: Record<string, Sigils>, opts: { squads?: boolean; gear?: Partial<RosterHero["equipment"]>; side?: SigilSide; damage?: boolean } = {}) {
  const { pack, battle } = loadReal({ squads: opts.squads ?? false, damage: opts.damage ?? false });
  for (const side of [battle.challenger, battle.defender]) {
    for (const h of side.heroes) {
      Object.assign(h.equipment, GEAR, opts.gear ?? {});
      if (sigils[h.char_id]) h.sigils = sigils[h.char_id];
      if (Object.keys(h.sigils ?? {}).length === 4 && new Set(Object.values(h.sigils!)).size === 1) h.sigil_side = opts.side ?? "def";
    }
  }
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  const u = (id: string) => p.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const x: ExecCtx = { state: p.state, rng: p.rng, log };
  return { pack, battle, state: p.state, log, u, ev, x };
}
type Setup = ReturnType<typeof setup>;
/** The first effect of `type` in a god's enchantment: tests read their numbers from it. */
const ench = <T extends Effect["type"]>(s: Pick<Setup, "pack">, god: string, side: SigilSide, type: T) =>
  s.pack.byId.gods.get(god)!.blessing[`four_piece_${side}`].effects.find((e) => e.type === type) as Extract<Effect, { type: T }>;
const LANDS = [0.5, 0.99, 0.99]; // the hit lands, no crit, no guard
const SINGLE = "skl_lancer_active_002", AREA = "skl_lancer_active_001"; // Lief's
const attack = (s: Setup, by: string, skillId: string, targets: string[], rolls: number[]) => {
  s.x.rng = scripted(rolls);
  executeSkill(s.x, s.u(by), { tactic: null, skillId, targets: targets.map(s.u), evaluations: [] });
};
const prayer = (u: Unit) => u.statuses.filter((s) => s.statusId.startsWith("prayer:")).map((s) => s.statusId).sort();

test("2 same-god sigils unlock the 2-piece, 4 unlock both tiers, 2 + 2 gives each god's 2-piece; one or three sigils of a god add nothing more", () => {
  const { u } = setup({
    [LEON]: { weapon: "god_005" }, // 1 Hotei: nothing
    [LIEF]: { weapon: "god_005", armor: "god_005", accessory_1: "god_005" }, // 3 Hotei: 2-piece only
    [EMPEROR]: all4("god_007"), // 4 Ebisu: both tiers
    [JASMINE]: { weapon: "god_005", armor: "god_005", accessory_1: "god_007", accessory_2: "god_007" }, // 2 Hotei + 2 Ebisu
  });
  assert.deepEqual(prayer(u(LEON)), []);
  assert.deepEqual(prayer(u(LIEF)), ["prayer:god_005:2:0", "prayer:god_005:2:1"]);
  assert.deepEqual(prayer(u(EMPEROR)), ["prayer:god_007:2:0", "prayer:god_007:4:0"]);
  assert.deepEqual(prayer(u(JASMINE)), ["prayer:god_005:2:0", "prayer:god_005:2:1", "prayer:god_007:2:0"]);
  assert.ok(u(EMPEROR).statuses.filter((s) => s.statusId.startsWith("prayer:")).every((s) => s.category === "prayer"));
});

test("a sigil on an empty slot does not count (engine) and is a W_SIGIL_EMPTY_SLOT warning; an unknown god is E_REF_MISSING", () => {
  const { u } = setup({ [LIEF]: { weapon: "god_005", armor: "god_005" } }, { gear: { armor: null } });
  assert.deepEqual(prayer(u(LIEF)), []);
  const raw = fresh();
  const r = roster(raw);
  r.heroes[3] = { ...r.heroes[3]!, equipment: { ...r.heroes[3]!.equipment, accessory_1: "equip_021" }, sigils: { accessory_1: "god_005", accessory_2: "god_005" } } as any;
  raw.rosters.push({ name: "challenger.yaml", data: r });
  const issues = validateRaw(raw, { tier: "official" }).report.issues;
  assert.deepEqual(issues.filter((i) => i.code === "W_SIGIL_EMPTY_SLOT").map((i) => i.path), ["heroes[3].sigils.accessory_2"]);
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  (r.heroes[3] as any).sigils = { accessory_1: "god_999" };
  assert.ok(validateRaw(raw, { tier: "official" }).report.issues.some((i) => i.code === "E_REF_MISSING" && i.path === "heroes[3].sigils.accessory_1"));
});

test("prayer is its own category: it multiplies with another category (9.1)", () => {
  const { u, pack } = setup({ [LIEF]: { weapon: "god_005", armor: "god_005" } }); // Breeze 2-piece ATK +10%
  const lief = u(LIEF);
  const b = statBreakdown(lief, "ATK", pack);
  close(b.result, (b.base + b.flat) * 1.1);
  lief.statuses.push({ statusId: "aura:x:0", category: "active", sourceUnitId: LIEF, remaining: null, skipNextTick: false, seq: 999, inline: { name: "x", modifiers: [{ stat: "ATK", mode: "percent", value: 20 }] } });
  close(effectiveStat(lief, "ATK", pack), (b.base + b.flat) * 1.1 * 1.2);
});

test("a blessing's HP +20% raises max HP", () => {
  const plain = setup({});
  const { u } = setup({ [LIEF]: { weapon: "god_001", armor: "god_001" } }); // Mirror 2-piece
  assert.equal(u(LIEF).maxHp, Math.floor(plain.u(LIEF).maxHp * 1.2));
  assert.equal(u(LIEF).hp, u(LIEF).maxHp);
});

test("Full Moon DEF and ATK: the 4-piece is on exactly while HP > the gate; its lines add to the 2-piece's where they share a stat (one god's tiers add)", () => {
  const s = setup({ [JASMINE]: all4("god_002") });
  const { u, x, pack, ev } = s;
  const jas = u(JASMINE);
  const god = pack.byId.gods.get("god_002")!.blessing;
  const pct = (es: Effect[], stat: string) => es.reduce((n, e) => n + (e.type === "modify_stat" && e.stat === stat ? e.value : 0), 0);
  const two = pct(god.two_piece, "DEF"), four = pct(god.four_piece_def.effects, "DEF");
  const def = () => statBreakdown(jas, "DEF", pack).effects.filter((e) => e.category === "prayer").map((e) => [e.value, e.outcome]);
  assert.deepEqual(def(), [[two + four, "winner"]]);
  const b = statBreakdown(jas, "DEF", pack);
  assert.deepEqual(b.effects.find((e) => e.category === "prayer")!.parts, ["prayer:god_002:2:0", "prayer:god_002:4:0"]); // both tiers attributed
  close(b.result, (b.base + b.flat) * (1 + (two + four) / 100));
  assert.equal(prayer(jas).length, 4);
  assert.equal(statBreakdown(jas, "ATK", pack).effects.filter((e) => e.category === "prayer").length, 0); // the DEF side gives no ATK
  const gate = (god.four_piece_def.effects[0]!.condition as unknown as { value: number }).value;
  jas.hp = Math.floor((jas.maxHp * gate) / 100); // not above the gate
  checkEquipment(x);
  assert.deepEqual(def(), [[two, "winner"]]);
  assert.deepEqual(prayer(jas), ["prayer:god_002:2:0", "prayer:god_002:2:1"]);
  assert.equal(ev("blessing_removed").length, 2);
  jas.hp = jas.maxHp;
  checkEquipment(x);
  assert.equal(prayer(jas).length, 4);

  const a = setup({ [JASMINE]: all4("god_002") }, { side: "atk" });
  const atk = statBreakdown(a.u(JASMINE), "ATK", a.pack);
  close(atk.result, (atk.base + atk.flat) * (1 + pct(god.four_piece_atk.effects, "ATK") / 100));
  assert.ok(statBreakdown(a.u(JASMINE), "INT", a.pack).effects.some((e) => e.category === "prayer"));
  assert.deepEqual(statBreakdown(a.u(JASMINE), "DEF", a.pack).effects.filter((e) => e.category === "prayer").map((e) => e.value), [two]);
});

test("Mirror: a squad attack (one combined hit) reflects 30% of its damage once, onto the attacking squad's lowest-HP soldier, as a non-hit", () => {
  const { state, u, log, ev } = setup({ [EMPEROR]: all4("god_001") }, { squads: true });
  state.units = state.units.filter((v) => v.id !== `squad_${EMPEROR}`); // Leon's squad attacks the Emperor (front row)
  const squad = u(`squad_${LEON}`);
  const rng = scripted([0.5, 0.99, 0.99]); // the hit lands, no crit, no guard
  const x: ExecCtx = { state, rng, log };
  executeSquadAction(x, squad);
  const taken = ev("damage").filter((e) => e.unit === squad.id && e.target === EMPEROR);
  assert.equal(taken.length, 1);
  const total = taken.reduce((n, e) => n + e.amount, 0);
  const reflect = ev("damage").filter((e) => e.unit === EMPEROR);
  assert.equal(reflect.length, 1);
  assert.equal(reflect[0]!.amount, Math.floor(total * 0.3));
  assert.equal(reflect[0]!.target, squad.id);
  assert.equal(typeof reflect[0]!.soldier, "number");
  assert.equal(ev("trigger").filter((e) => e.handler === "Mirror (Benzaiten 4-piece)").length, 1);
  assert.ok(!state.bus.history.some((e) => e.bus === "after_hit" && (e.payload as any).attacker === u(EMPEROR))); // not a hit
});

test("Mirror reflects onto a hero attacker after a single-target attack, and not after an area attack", () => {
  const single = setup({ [EMPEROR]: all4("god_001") });
  const lief = single.u(LIEF), emp = single.u(EMPEROR);
  single.x.rng = scripted([0.5, 0.99, 0.99]);
  executeSkill(single.x, lief, { tactic: null, skillId: "skl_lancer_active_002", targets: [emp], evaluations: [] });
  const dealt = single.ev("damage").find((e) => e.unit === LIEF)!.amount;
  const back = single.ev("damage").filter((e) => e.unit === EMPEROR);
  assert.deepEqual(back.map((e) => [e.target, e.amount]), [[LIEF, Math.floor(dealt * 0.3)]]);
  assert.equal(lief.hp, lief.maxHp - Math.floor(dealt * 0.3));
  const area = setup({ [EMPEROR]: all4("god_001") });
  area.x.rng = scripted([0.5, 0.99, 0.99, 0.5, 0.99, 0.99]);
  executeSkill(area.x, area.u(LIEF), { tactic: null, skillId: "skl_lancer_active_001", targets: [area.u(EMPEROR), area.u(JASMINE)], evaluations: [] });
  assert.ok(area.ev("damage").some((e) => e.unit === LIEF && e.target === EMPEROR));
  assert.equal(area.ev("damage").filter((e) => e.unit === EMPEROR).length, 0);
});

test("Gift DEF: when attacked, a phase-rng roll per enemy action heals after the attack; a miss counts, a failed roll heals nothing", () => {
  const s = setup({ [EMPEROR]: all4("god_004") }, { squads: true });
  const heal = ench(s, "god_004", "def", "heal");
  s.state.units = s.state.units.filter((v) => v.id !== `squad_${EMPEROR}`);
  const emp = s.u(EMPEROR);
  emp.hp = 500;
  const below = (heal.chance_percent! - 1) / 100, above = (heal.chance_percent! + 1) / 100;
  executeSquadAction({ ...s.x, rng: scripted([...LANDS, below]) }, s.u(`squad_${LEON}`));
  const heals = s.ev("heal").filter((e) => e.target === EMPEROR);
  assert.deepEqual(heals.map((e) => e.amount), [Math.floor((emp.maxHp * heal.percent_max_hp!) / 100)]);
  assert.equal(s.ev("roll").filter((e) => e.kind === "heal").length, 1);
  const order = s.log.events.map((e) => e.type);
  assert.ok(order.lastIndexOf("damage") < order.indexOf("heal")); // after the attack

  const f = setup({ [EMPEROR]: all4("god_004") });
  f.u(EMPEROR).hp = 500;
  attack(f, LIEF, SINGLE, [EMPEROR], [...LANDS, above]);
  assert.equal(f.ev("heal").length, 0);
  assert.deepEqual(f.ev("roll").filter((e) => e.kind === "heal").map((e) => e.result), [false]);

  const m = setup({ [EMPEROR]: all4("god_004") });
  m.u(EMPEROR).hp = 500;
  m.u(EMPEROR).baseStats.EVA = 1000; // down to hit_min
  attack(m, LIEF, SINGLE, [EMPEROR], [0.99, below]);
  assert.equal(m.ev("damage").length, 0);
  assert.equal(m.ev("heal").length, 1);
});

test("Gift ATK: a hero kill or a full squad wipe heals the lowest-HP% living ally hero, self included; a single soldier's death does not", () => {
  const s = setup({ [LIEF]: all4("god_004") }, { side: "atk" });
  const pct = ench(s, "god_004", "atk", "heal").percent_max_hp!;
  s.u(EMPEROR).hp = 1;
  s.u(LEON).hp = Math.floor(s.u(LEON).maxHp / 2);
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.equal(s.u(EMPEROR).alive, false);
  assert.deepEqual(s.ev("heal").map((e) => [e.target, e.amount]), [[LEON, Math.floor((s.u(LEON).maxHp * pct) / 100)]]);

  const self = setup({ [LIEF]: all4("god_004") }, { side: "atk" });
  self.u(EMPEROR).hp = 1;
  self.u(LIEF).hp = 10;
  attack(self, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.deepEqual(self.ev("heal").map((e) => e.target), [LIEF]);

  const q = setup({ [LIEF]: all4("god_004") }, { side: "atk", squads: true });
  const squad = q.u(`squad_${EMPEROR}`);
  q.u(LIEF).hp = 10;
  squad.soldiers.forEach((v, i) => { v.hp = v.maxHp = i === 0 ? 1 : 1e6; });
  attack(q, LIEF, SINGLE, [squad.id], LANDS);
  assert.ok(!squad.soldiers[0]!.alive && squad.alive);
  assert.equal(q.ev("heal").length, 0); // one soldier down: no heal
  squad.soldiers.slice(2).forEach((v) => { v.hp = 0; v.alive = false; });
  squad.soldiers[1]!.hp = 1;
  attack(q, LIEF, SINGLE, [squad.id], LANDS);
  assert.equal(squad.alive, false);
  assert.deepEqual(q.ev("heal").map((e) => e.target), [LIEF]);
});

test("Rush ATK: single-target attacks skip the guard roll and deal the bonus; area attacks do neither", () => {
  const s = setup({ [LIEF]: all4("god_007") }, { side: "atk", damage: true });
  const bonus = ench(s, "god_007", "atk", "damage_bonus").percent;
  const plain = setup({}, { damage: true });
  attack(s, LIEF, SINGLE, [EMPEROR], [0.5, 0.99]);
  attack(plain, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.deepEqual(s.ev("roll").filter((e) => e.unit === LIEF).map((e) => e.kind), ["hit", "crit"]); // no guard draw
  close(s.ev("damage")[0]!.bonus! - plain.ev("damage")[0]!.bonus!, bonus);
  const area = setup({ [LIEF]: all4("god_007") }, { side: "atk", damage: true });
  const areaPlain = setup({}, { damage: true });
  attack(area, LIEF, AREA, [EMPEROR, JASMINE], [...LANDS, ...LANDS]);
  attack(areaPlain, LIEF, AREA, [EMPEROR, JASMINE], [...LANDS, ...LANDS]);
  assert.ok(area.ev("roll").some((e) => e.unit === LIEF && e.kind === "guard"));
  assert.equal(area.ev("damage")[0]!.bonus, areaPlain.ev("damage")[0]!.bonus);
});

test("Rush DEF: EVA adds to the 2-piece; each dodge gets one rolled counter at the ATK share; a landed hit none; a counter never triggers a counter", () => {
  const s = setup({ [EMPEROR]: all4("god_007"), [LIEF]: all4("god_007") }, { damage: true }); // pool: power leaves the matchup out
  const emp = s.u(EMPEROR), lief = s.u(LIEF);
  const counter = ench(s, "god_007", "def", "damage");
  const eva = (es: Effect[]) => es.reduce((n, e) => n + (e.type === "modify_stat" && e.stat === "EVA" ? e.value : 0), 0);
  const god = s.pack.byId.gods.get("god_007")!.blessing;
  assert.equal(effectiveStat(emp, "EVA", s.pack), emp.baseStats.EVA + emp.equipFlat.EVA + eva(god.two_piece) + eva(god.four_piece_def.effects));
  emp.baseStats.EVA = lief.baseStats.EVA = 1000; // down to hit_min
  attack(s, LIEF, SINGLE, [EMPEROR], [0.99, ...LANDS]);
  const back = s.ev("damage").filter((e) => e.unit === EMPEROR);
  assert.equal(back.length, 1);
  assert.equal(back[0]!.target, LIEF);
  close(back[0]!.power, effectiveStat(emp, "ATK", s.pack) * counter.multiplier);
  // Both sides dodge: Lief's dodge of the counter brings nothing back.
  const rolls = s.ev("roll").length;
  attack(s, LIEF, SINGLE, [EMPEROR], [0.99, 0.99]);
  assert.deepEqual(s.ev("roll").slice(rolls).map((e) => [e.unit, e.kind, e.result]), [[LIEF, "hit", false], [EMPEROR, "hit", false]]);
  // Two dodges in one action: two counters.
  const twice = setup({ [EMPEROR]: all4("god_007") });
  const skill = twice.pack.byId.skills.get(SINGLE)!;
  twice.pack.byId.skills.set(SINGLE, { ...skill, effects: [...skill.effects, ...skill.effects] });
  twice.u(EMPEROR).baseStats.EVA = 1000;
  attack(twice, LIEF, SINGLE, [EMPEROR], [0.99, 0.99, ...LANDS, ...LANDS]);
  assert.equal(twice.ev("damage").filter((e) => e.unit === EMPEROR).length, 2);
  const hit = setup({ [EMPEROR]: all4("god_007") });
  attack(hit, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.equal(hit.ev("damage").filter((e) => e.unit === EMPEROR).length, 0);
});

test("Mirror ATK Retaliate: being attacked charges the next attack once, no stacking; the attack spends it, a dodged attack charges too", () => {
  const s = setup({ [LIEF]: all4("god_001") }, { side: "atk", damage: true });
  const bonus = ench(s, "god_001", "atk", "damage_bonus").percent;
  const plain = setup({}, { damage: true });
  attack(plain, LIEF, SINGLE, [EMPEROR], LANDS);
  const base = plain.ev("damage")[0]!.bonus!;
  const lief = s.u(LIEF), emp = s.u(EMPEROR);
  lief.hp = lief.maxHp = emp.hp = emp.maxHp = 1e6; // survive every hit below
  attack(s, EMPEROR, SINGLE, [LIEF], LANDS);
  attack(s, EMPEROR, SINGLE, [LIEF], LANDS);
  assert.equal(lief.attackCharge, bonus); // two attacks, one charge
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.equal(lief.attackCharge, undefined);
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  const mine = s.ev("damage").filter((e) => e.unit === LIEF).map((e) => e.bonus!);
  close(mine[0]! - base, bonus);
  close(mine[1]!, base);
  lief.baseStats.EVA = 1000;
  attack(s, EMPEROR, SINGLE, [LIEF], [0.99]);
  assert.equal(lief.attackCharge, bonus);
});

test("Plate DEF: damage taken is reduced for the battle; the 2-piece is flat GUARD", () => {
  const s = setup({ [EMPEROR]: all4("god_003") });
  const plain = setup({});
  const flat = s.pack.byId.gods.get("god_003")!.blessing.two_piece[0] as Extract<Effect, { type: "modify_stat" }>;
  assert.equal(effectiveStat(s.u(EMPEROR), "GUARD", s.pack), effectiveStat(plain.u(EMPEROR), "GUARD", s.pack) + flat.value);
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.deepEqual(s.ev("damage").map((e) => e.reductions), [[ench(s, "god_003", "def", "reduce_damage").percent], [ench(s, "god_003", "def", "reduce_damage").percent]]);
});

test("Plate ATK Sunder: hits ignore the percent of DEF / MDEF in every formula, a squad's summed defense included", () => {
  const dmg = (s: Setup) => s.pack.byId.skills.get(SINGLE)!.effects.find((e) => e.type === "damage") as Extract<Effect, { type: "damage" }>;
  for (const formula of ["pool", "subtract", "ratio", "scaled_subtract"] as const) {
    const run = (sig: Record<string, Sigils>) => {
      const s = setup(sig, { side: "atk" });
      s.pack.rules.damage.formula = formula;
      attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
      return { s, d: s.ev("damage")[0]! };
    };
    const a = run({ [LIEF]: all4("god_003") }), b = run({});
    close(a.d.defense, b.d.defense * (1 - ench(a.s, "god_003", "atk", "ignore_defense").percent / 100));
    assert.ok(a.d.amount > b.d.amount, `${formula}: ${a.d.amount} vs ${b.d.amount}`);
  }
  const q = setup({ [LIEF]: all4("god_003") }, { side: "atk", squads: true });
  const squad = q.u(`squad_${EMPEROR}`);
  const summed = defenseFor(squad, dmg(q).damage_type, q.pack);
  attack(q, LIEF, SINGLE, [squad.id], LANDS);
  close(q.ev("damage").find((e) => e.target === squad.id)!.defense, summed * (1 - ench(q, "god_003", "atk", "ignore_defense").percent / 100));
});

test("Breeze DEF Sidestep: only the first landed single-target hit each phase is reduced; a miss or an area hit does not use it", () => {
  const s = setup({ [EMPEROR]: all4("god_005") });
  const pct = ench(s, "god_005", "def", "reduce_damage").percent;
  const emp = s.u(EMPEROR);
  const eva = emp.baseStats.EVA;
  attack(s, LIEF, AREA, [EMPEROR, JASMINE], [...LANDS, ...LANDS]);
  emp.baseStats.EVA = 1000;
  attack(s, LIEF, SINGLE, [EMPEROR], [0.99]);
  emp.baseStats.EVA = eva;
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  attack(s, LIEF, SINGLE, [EMPEROR], LANDS);
  assert.deepEqual(s.ev("damage").filter((e) => e.target === EMPEROR).map((e) => e.reductions), [undefined, [pct], undefined]);
  // Two hits in one action: only the first.
  const two = setup({ [EMPEROR]: all4("god_005") });
  const skill = two.pack.byId.skills.get(SINGLE)!;
  two.pack.byId.skills.set(SINGLE, { ...skill, effects: [...skill.effects, ...skill.effects] });
  attack(two, LIEF, SINGLE, [EMPEROR], [...LANDS, ...LANDS]);
  assert.deepEqual(two.ev("damage").map((e) => e.reductions), [[pct], undefined]);
  // A new phase brings a fresh one.
  const next = beginPhase(s.pack, s.battle, 2, null, new EventLog());
  assert.equal(next.state.bus.reductions.filter((r) => r.unit.id === EMPEROR && r.until === "first_single").length, 1);
});

test("Breeze ATK Second Wind: below the gate SPD rises and the pending action is rescheduled", () => {
  const s = setup({ [LIEF]: all4("god_005") }, { side: "atk" });
  const line = ench(s, "god_005", "atk", "modify_stat");
  const lief = s.u(LIEF);
  const spd = effectiveStat(lief, "SPD", s.pack);
  const interval = s.state.timeline.pending.get(LIEF)!.interval;
  lief.hp = Math.floor((lief.maxHp * (line.condition as unknown as { value: number }).value) / 100) - 1;
  attack(s, EMPEROR, SINGLE, [LEON], LANDS);
  close(effectiveStat(lief, "SPD", s.pack), spd * (1 + line.value / 100));
  assert.ok(s.state.timeline.pending.get(LIEF)!.interval < interval);
  assert.ok(s.ev("schedule").some((e) => e.unit === LIEF && e.reason === "spd_change"));
});

test("Meteor: crit damage taken (DEF) and dealt (ATK) change the crit multiplier in every formula; other hits are untouched", () => {
  const crit = (sig: Record<string, Sigils>, side: SigilSide, formula: "pool" | "subtract" | "ratio" | "scaled_subtract", rolls?: number[]) => {
    const s = setup(sig, { side });
    s.pack.rules.damage.formula = formula;
    if (rolls === undefined) s.u(LIEF).baseStats.CRIT = 1000;
    attack(s, LIEF, SINGLE, [EMPEROR], rolls ?? [0.5, 0, 0.99]);
    return { s, d: s.ev("damage")[0]! };
  };
  for (const formula of ["pool", "subtract", "ratio", "scaled_subtract"] as const) {
    const plain = crit({}, "def", formula);
    assert.equal(plain.d.crit, true);
    const taken = crit({ [EMPEROR]: all4("god_006") }, "def", formula);
    const dealt = crit({ [LIEF]: all4("god_006") }, "atk", formula);
    const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 2, `${formula}: ${a} vs ${b}`); // two floors apart
    near(taken.d.amount, plain.d.amount * (1 + ench(taken.s, "god_006", "def", "crit_damage").percent / 100));
    near(dealt.d.amount, plain.d.amount * (1 + ench(dealt.s, "god_006", "atk", "crit_damage").percent / 100));
    assert.equal(crit({ [EMPEROR]: all4("god_006") }, "def", formula, LANDS).d.amount, crit({}, "def", formula, LANDS).d.amount); // no crit
  }
});

test("4 same-god sigils need a side (E_SIGIL_SIDE_MISSING, engine: 2-piece only plus a note); a side without a 4-piece is W_SIGIL_SIDE_UNUSED; the side picks the cost", () => {
  const issues = (over: Partial<RosterHero>) => {
    const raw = fresh();
    const r = roster(raw);
    r.heroes[3] = { ...r.heroes[3]!, equipment: { ...GEAR }, ...over } as any;
    raw.rosters.push({ name: "challenger.yaml", data: r });
    return validateRaw(raw, { tier: "official" }).report.issues.filter((i) => i.code.includes("SIGIL_SIDE"));
  };
  assert.deepEqual(issues({ sigils: all4("god_001") }).map((i) => [i.code, i.path]), [["E_SIGIL_SIDE_MISSING", "heroes[3].sigil_side"]]);
  assert.deepEqual(issues({ sigils: all4("god_001"), sigil_side: "atk" }), []);
  assert.deepEqual(issues({ sigil_side: "def" }).map((i) => [i.code, i.severity]), [["W_SIGIL_SIDE_UNUSED", "warning"]]);
  assert.deepEqual(issues({ sigils: { ...all4("god_001"), armor: "god_002" }, sigil_side: "def" }).map((i) => i.code), ["W_SIGIL_SIDE_UNUSED"]);
  const { pack, battle } = loadReal();
  const h = battle.challenger.heroes[0]!;
  Object.assign(h.equipment, GEAR);
  h.sigils = all4("god_001");
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  assert.deepEqual(p.state.units.find((v) => v.id === h.char_id)!.blessings!.map((b) => [b.tier, b.side, b.effects.length > 0]), [[2, undefined, true], [4, undefined, false]]);
  assert.ok(log.events.some((e) => e.type === "not_implemented" && /without a sigil_side/.test(e.what)));
  const names = (side: SigilSide) => unlockedBlessings(pack, { equipment: GEAR, sigils: all4("god_005"), sigil_side: side }).map((b) => b.name);
  assert.deepEqual(names("def"), ["Breeze", "Sidestep"]);
  assert.deepEqual(names("atk"), ["Breeze", "Second Wind"]);
});

test("action_is_single_target is true only for the current actor while bus.singleAttack is set", () => {
  const { state, u } = setup({});
  const leaf = { type: "action_is_single_target" } as any;
  const lief = u(LIEF);
  assert.equal(evaluateCondition(leaf, { state, self: lief }).value, false);
  state.bus.actor = lief;
  state.bus.singleAttack = true;
  assert.equal(evaluateCondition(leaf, { state, self: lief }).value, true);
  assert.equal(evaluateCondition(leaf, { state, self: u(LEON) }).value, false);
});

test("cost rises with the unlocked tiers", () => {
  const { pack } = loadReal();
  const hero = pack.byId.characters.get(LIEF)!;
  const cost = (sigils: Sigils, sigil_side?: SigilSide) => heroCost(hero, pack.rules, { blessings: unlockedBlessings(pack, { equipment: GEAR, sigils, ...(sigil_side ? { sigil_side } : {}) }).flatMap((b) => b.effects) });
  const none = cost({}), two = cost({ weapon: "god_001", armor: "god_001" }), four = cost(all4("god_001"), "def");
  assert.ok(none < two && two < four, `${none} ${two} ${four}`);
  close(two - none, 0.2 * hero.base_stats.HP * pack.rules.cost.stat_weights.HP); // HP +20% priced like a stat line
  close(four - two, pack.rules.cost.effect_price); // reflect: the flat effect price
});

test("the community tier accepts the blessings' effects and the action_is_single_target leaf", () => {
  const raw = fresh();
  const issues = validateRaw(raw, { tier: "community" }).report.issues.filter((i) => i.file === "gods.yaml" && i.severity === "error");
  assert.deepEqual(issues, []);
  // And a god id clashing with another collection is a duplicate id.
  const dup = fresh();
  find(dup.gods!, "god_001").id = "equip_001";
  assert.ok(validateRaw(dup, { tier: "official" }).report.issues.some((i) => i.code === "E_DUP_ID" && i.file === "gods.yaml"));
});

test("Mirror reflects the action that kills the wearer, counting only the HP it lost", () => {
  const s = setup({ [EMPEROR]: all4("god_001") });
  const lief = s.u(LIEF), emp = s.u(EMPEROR);
  emp.hp = 10;
  s.x.rng = scripted([0.5, 0.99, 0.99]);
  executeSkill(s.x, lief, { tactic: null, skillId: "skl_lancer_active_002", targets: [emp], evaluations: [] });
  assert.equal(emp.alive, false);
  assert.ok(s.ev("damage").find((e) => e.unit === LIEF)!.amount > 10);
  assert.deepEqual(s.ev("damage").filter((e) => e.unit === EMPEROR).map((e) => [e.target, e.amount]), [[LIEF, 3]]); // 30% of 10
});

test("Mirror with Fairy's Grace: a saved wearer reflects only the HP it had", () => {
  const s = setup({ [EMPEROR]: all4("god_001") });
  const lief = s.u(LIEF), emp = s.u(EMPEROR);
  const grace = s.pack.statuses.find((st) => st.flags.intercepts_death.enabled)!;
  emp.statuses.push({ statusId: grace.id, category: "active", sourceUnitId: EMPEROR, remaining: grace.duration.count, skipNextTick: false, seq: 999 });
  emp.hp = 10;
  s.x.rng = scripted([0.5, 0.99, 0.99]);
  executeSkill(s.x, lief, { tactic: null, skillId: "skl_lancer_active_002", targets: [emp], evaluations: [] });
  assert.equal(emp.alive, true);
  assert.equal(s.ev("death_intercepted").length, 1);
  assert.deepEqual(s.ev("damage").filter((e) => e.unit === EMPEROR).map((e) => e.amount), [3]);
});

test("a blessing effect the engine cannot run is rejected (E_EFFECT_TRIGGER)", () => {
  const raw = fresh();
  find(raw.gods!, "god_005").blessing.four_piece_def.effects = [{ type: "modify_stat", stat: "SPD", mode: "percent", value: 20, trigger: "on_hit" }];
  find(raw.gods!, "god_004").blessing.two_piece = [{ type: "apply_status", status_id: "debuff_002", chance_percent: 100, target: "self" }];
  const errs = validateRaw(raw, { tier: "official" }).report.issues.filter((i) => i.code === "E_EFFECT_TRIGGER" && i.file === "gods.yaml");
  assert.deepEqual(errs.map((i) => `${i.id} ${i.path}`).sort(), ["god_004 blessing.two_piece[0].trigger", "god_005 blessing.four_piece_def.effects[0].trigger"]);
});

test("two different gods' identical lines do not stack (9.1 within prayer); max HP takes the strongest god", () => {
  const plain = setup({});
  const { u, pack } = setup({ [LIEF]: { weapon: "god_001", armor: "god_001", accessory_1: "god_004", accessory_2: "god_004" } }); // Mirror + Gift 2-piece, HP +20% each
  const lief = u(LIEF);
  assert.deepEqual(statBreakdown(lief, "HP", pack).effects.map((e) => [e.value, e.outcome]), [[20, "winner"], [20, "suppressed"]]);
  assert.equal(lief.maxHp, Math.floor(plain.u(LIEF).maxHp * 1.2));
});

test("a negative unconditional blessing HP line lowers max HP consistently with the HP breakdown", () => {
  const { pack, battle } = loadReal();
  pack.byId.gods.get("god_005")!.blessing.two_piece = [{ type: "modify_stat", stat: "HP", mode: "percent", value: -10 }];
  const h = battle.challenger.heroes.find((x) => x.char_id === LIEF)!;
  Object.assign(h.equipment, GEAR);
  h.sigils = { weapon: "god_005", armor: "god_005" };
  const p = beginPhase(pack, battle, 1, null, new EventLog());
  const lief = p.state.units.find((v) => v.id === LIEF)!;
  assert.equal(lief.maxHp, Math.floor(statBreakdown(lief, "HP", pack).result + 1e-9));
  assert.ok(lief.maxHp < lief.baseStats.HP + lief.equipFlat.HP);
});
