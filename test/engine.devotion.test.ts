// Devotion (roadmap 3c; design Section 9A, Decision 125): sigils, blessing tiers, the prayer category, Full Moon, Mirror, Gift, Meteor / Rush,
// blessing pricing and tiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, beginPhase, checkEquipment, effectiveStat, evaluateCondition, executeSkill, executeSquadAction, statBreakdown,
  type BattleEvent, type ExecCtx, type Unit,
} from "../src/engine";
import type { RosterHero } from "../src/schema";
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
function setup(sigils: Record<string, Sigils>, opts: { squads?: boolean; gear?: Partial<RosterHero["equipment"]> } = {}) {
  const { pack, battle } = loadReal({ squads: opts.squads ?? false });
  for (const side of [battle.challenger, battle.defender]) {
    for (const h of side.heroes) {
      Object.assign(h.equipment, GEAR, opts.gear ?? {});
      if (sigils[h.char_id]) h.sigils = sigils[h.char_id];
    }
  }
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  const u = (id: string) => p.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const x: ExecCtx = { state: p.state, rng: p.rng, log };
  return { pack, battle, state: p.state, log, u, ev, x };
}
const prayer = (u: Unit) => u.statuses.filter((s) => s.statusId.startsWith("prayer:")).map((s) => s.statusId).sort();

test("2 same-god sigils unlock the 2-piece, 4 unlock both tiers, 2 + 2 gives each god's 2-piece; one or three sigils of a god add nothing more", () => {
  const { u } = setup({
    [LEON]: { weapon: "god_005" }, // 1 Hotei: nothing
    [LIEF]: { weapon: "god_005", armor: "god_005", accessory_1: "god_005" }, // 3 Hotei: 2-piece only
    [EMPEROR]: all4("god_005"), // 4 Hotei: both tiers
    [JASMINE]: { weapon: "god_005", armor: "god_005", accessory_1: "god_007", accessory_2: "god_007" }, // 2 Hotei + 2 Ebisu
  });
  assert.deepEqual(prayer(u(LEON)), []);
  assert.deepEqual(prayer(u(LIEF)), ["prayer:god_005:2:0"]);
  assert.deepEqual(prayer(u(EMPEROR)), ["prayer:god_005:2:0", "prayer:god_005:4:0"]);
  assert.deepEqual(prayer(u(JASMINE)), ["prayer:god_005:2:0", "prayer:god_007:2:0"]);
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
  const { u } = setup({ [LIEF]: { weapon: "god_003", armor: "god_003" } }); // Plate 2-piece
  assert.equal(u(LIEF).maxHp, Math.floor(plain.u(LIEF).maxHp * 1.2));
  assert.equal(u(LIEF).hp, u(LIEF).maxHp);
});

test("Full Moon: the 4-piece is on exactly while HP > 80%; its ATK +20% adds to the 2-piece's +10% (one god's tiers add)", () => {
  const { u, x, pack, ev } = setup({ [JASMINE]: all4("god_002") });
  const jas = u(JASMINE);
  const atk = () => statBreakdown(jas, "ATK", pack).effects.filter((e) => e.category === "prayer").map((e) => [e.value, e.outcome]);
  assert.deepEqual(atk(), [[30, "winner"]]);
  const b = statBreakdown(jas, "ATK", pack);
  assert.deepEqual(b.effects.find((e) => e.category === "prayer")!.parts, ["prayer:god_002:2:0", "prayer:god_002:4:0"]); // both tiers attributed
  close(b.result, (b.base + b.flat) * 1.3);
  assert.equal(prayer(jas).length, 5);
  jas.hp = Math.floor(jas.maxHp * 0.8); // not above 80%
  checkEquipment(x);
  assert.deepEqual(atk(), [[10, "winner"]]);
  assert.deepEqual(prayer(jas), ["prayer:god_002:2:0"]);
  assert.equal(ev("blessing_removed").length, 4);
  jas.hp = jas.maxHp;
  checkEquipment(x);
  assert.equal(prayer(jas).length, 5);
});

test("Mirror: a 10-hit squad attack reflects 30% of its total damage once, onto the attacking squad's lowest-HP soldier, as a non-hit", () => {
  const { state, u, log, ev } = setup({ [EMPEROR]: all4("god_001") }, { squads: true });
  state.units = state.units.filter((v) => v.id !== `squad_${EMPEROR}`); // Leon's squad attacks the Emperor (front row)
  const squad = u(`squad_${LEON}`);
  const rng = scripted(Array.from({ length: 10 }, () => [0.5, 0.99, 0.99]).flat()); // every hit lands, no crit, no guard
  const x: ExecCtx = { state, rng, log };
  executeSquadAction(x, squad);
  const taken = ev("damage").filter((e) => e.unit === squad.id && e.target === EMPEROR);
  assert.equal(taken.length, 10);
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

test("Gift: heals 30% max HP once per attacking action that targeted the wearer with single-target hits (a 10-hit squad attack heals once)", () => {
  const { state, u, log, ev } = setup({ [EMPEROR]: all4("god_004") }, { squads: true });
  state.units = state.units.filter((v) => v.id !== `squad_${EMPEROR}`);
  const emp = u(EMPEROR);
  emp.hp = 50;
  const x: ExecCtx = { state, rng: scripted(Array.from({ length: 10 }, () => [0.5, 0.99, 0.99]).flat()), log };
  executeSquadAction(x, u(`squad_${LEON}`));
  const heals = ev("heal").filter((e) => e.target === EMPEROR);
  assert.equal(heals.length, 1);
  assert.equal(heals[0]!.amount, Math.floor(emp.maxHp * 0.3));
});

test("Rush and Meteor 4-piece are on only while their wearer resolves a single-target attack; Rush skips the guard roll then", () => {
  const s = setup({ [LIEF]: all4("god_007") }); // Rush
  const lief = s.u(LIEF), emp = s.u(EMPEROR);
  s.x.rng = scripted([0.5, 0.99]);
  executeSkill(s.x, lief, { tactic: null, skillId: "skl_lancer_active_002", targets: [emp], evaluations: [] });
  assert.deepEqual(s.ev("blessing_applied").filter((e) => e.status.startsWith("prayer:god_007:4:")).map((e) => e.effect), ["ATK +30%", "INT +30%"]);
  assert.deepEqual(s.ev("roll").filter((e) => e.unit === LIEF).map((e) => e.kind), ["hit", "crit"]); // no guard draw
  assert.deepEqual(prayer(lief), ["prayer:god_007:2:0"]); // off again after the attack
  assert.equal(s.ev("blessing_removed").length, 2);
  const area = setup({ [LIEF]: all4("god_007") });
  area.x.rng = scripted([0.5, 0.99, 0.99, 0.5, 0.99, 0.99]);
  executeSkill(area.x, area.u(LIEF), { tactic: null, skillId: "skl_lancer_active_001", targets: [area.u(EMPEROR), area.u(JASMINE)], evaluations: [] });
  assert.equal(area.ev("blessing_applied").filter((e) => e.status.startsWith("prayer:god_007:4:")).length, 0);
  assert.ok(area.ev("roll").some((e) => e.unit === LIEF && e.kind === "guard"));
  // Meteor: CRIT +30 adds to the 2-piece's +10 during the single-target attack (CRIT +40: crit chance +30 over the 2-piece alone).
  const crit = (sig: Record<string, Sigils>) => {
    const m = setup(sig);
    m.u(EMPEROR).baseStats.GUARD = 0; // keep the crit chance off its 0 floor
    m.x.rng = scripted([0.5, 0.99, 0.99]);
    executeSkill(m.x, m.u(LIEF), { tactic: null, skillId: "skl_lancer_active_002", targets: [m.u(EMPEROR)], evaluations: [] });
    return m.ev("roll").find((e) => e.unit === LIEF && e.kind === "crit")!.chance;
  };
  close(crit({ [LIEF]: all4("god_006") }) - crit({ [LIEF]: { weapon: "god_006", armor: "god_006" } }), 30);
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
  const cost = (sigils: Sigils) => heroCost(hero, pack.rules, { blessings: unlockedBlessings(pack, { equipment: GEAR, sigils }).flatMap((b) => b.effects) });
  const none = cost({}), two = cost({ weapon: "god_001", armor: "god_001" }), four = cost(all4("god_001"));
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
  find(raw.gods!, "god_005").blessing.four_piece = [{ type: "modify_stat", stat: "SPD", mode: "percent", value: 20, trigger: "on_hit" }];
  find(raw.gods!, "god_004").blessing.two_piece = [{ type: "apply_status", status_id: "debuff_002", chance_percent: 100, target: "self" }];
  const errs = validateRaw(raw, { tier: "official" }).report.issues.filter((i) => i.code === "E_EFFECT_TRIGGER" && i.file === "gods.yaml");
  assert.deepEqual(errs.map((i) => `${i.id} ${i.path}`).sort(), ["god_004 blessing.two_piece[0].trigger", "god_005 blessing.four_piece[0].trigger"]);
});

test("two different gods' identical lines do not stack (9.1 within prayer); max HP takes the strongest god", () => {
  const plain = setup({});
  const { u, pack } = setup({ [LIEF]: { weapon: "god_001", armor: "god_001", accessory_1: "god_003", accessory_2: "god_003" } }); // Mirror + Plate 2-piece, HP +20% each
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
