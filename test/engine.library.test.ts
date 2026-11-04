// Roadmap 3a part 3: the full condition library, selectors and the remaining effects (modify_pp, delay/advance_action, reduce_damage
// durations, effect-level trigger/condition), prevents_action, use_limit / cooldown and Hegemony (design Sections 4.3, 6, 7, 9 and 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, applyHeal, applyStatus, checkStatePassives, createBattleState, evaluateCondition, executeSquadAction, killUnit, performAction, rescheduleOnSpdChange,
  resolveTargets,
  runEffect, scheduleInitial,
  type BattleEvent, type CondContext, type ExecCtx, type Unit,
} from "../src/engine";
import { LEAF_REGISTRY } from "../src/registry/conditions";
import type { Battle, Skill, Status } from "../src/schema";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, scripted, tactic } from "./engineHelpers";

const ASSAULT = "skl_cav_active_001"; // single target, physical melee, 1 PP
const QUICK_GUARD = "skl_passive_001", HEGEMONY = "skl_passive_002";
const SQ_C = `squad_${LEON}`, SQ_D = `squad_${EMPEROR}`;
const LONGINUS = { type: "modify_pp", pool: "passive", amount: -1, target: "hit_unit", trigger: "on_attack", once_per_attack: true }; // equip_004's effect

const always = (): ExecCtx["rng"] => ({ next: () => 0.999999, int: (k) => Math.floor(0.999999 * k), get draws() { return 0; } });

/** A test skill cloned from Charging Assault with the given changes, put on `hero`'s skill list and alone on its sheet. */
function skill(pack: Pack, battle: Battle, hero: string, id: string, over: Partial<Skill>): void {
  const base = structuredClone(pack.byId.skills.get(ASSAULT)!);
  pack.byId.skills.set(id, { ...base, id, name: id, ...over });
  pack.byId.characters.get(hero)!.skills.push(id);
  const entry = [...battle.challenger.heroes, ...battle.defender.heroes].find((h) => h.char_id === hero)!;
  entry.tactic_sheet = [tactic(id)];
}

/** Real sample (squads off unless asked); every hit lands, nothing crits or guards. */
function setup(over?: (pack: Pack, battle: Battle) => void, opts: { squads?: boolean } = {}) {
  const { pack, battle } = loadReal({ squads: true });
  pack.rules.rolls.hit_min = 100;
  pack.rules.rolls.crit_max = 0;
  pack.rules.rolls.guard_max = 0;
  over?.(pack, battle);
  const state = createBattleState(pack, battle);
  const log = new EventLog();
  const x: ExecCtx = { state, rng: always(), log };
  const u = (id: string) => state.units.find((v) => v.id === id)!;
  if (!opts.squads) { u(SQ_C).alive = false; u(SQ_D).alive = false; }
  scheduleInitial(state);
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  /** `actor` takes its scheduled action now (pops its timeline entry first). */
  const act = (actor: Unit) => { state.timeline.pending.delete(actor.id); return performAction(x, actor); };
  const cond = (node: any, ctx: Partial<CondContext> & { self: Unit }) => evaluateCondition(node, { state, ...ctx } as CondContext);
  return { pack, battle, state, log, x, u, ev, act, cond };
}

// ------------------------------------------------------------------ condition leaves

/** One valid instance of every registry leaf. */
const SAMPLE_LEAVES: Record<string, Record<string, unknown>> = {
  hp_percent: { side: "self", op: ">", value: 0 }, hp_current: { side: "self", op: ">", value: 0 }, hp_missing: { side: "self", op: ">=", value: 0 },
  unit_kind: { is: "hero" }, is_leader: { side: "self" }, not_leader: { side: "self" }, class_is: { side: "self", value: "cavalry" },
  has_class_advantage: { side: "self", value: "infantry" }, faction_is: { side: "self", value: "faction_001" }, row_is: { value: "front" },
  column_is: { value: 1 }, same_column_as: { value: "self" }, has_status: { side: "self", status_id: "buff_001" }, lacks_status: { side: "self", status_id: "buff_001" },
  has_any_debuff: { side: "self" }, stat_compare: { stat: "SPD", op: ">", value: 0 }, active_pp: { side: "self", op: ">", value: 0 },
  passive_pp: { side: "self", op: ">", value: 0 }, enemies_alive: { op: ">", value: 0 }, allies_alive: { op: ">", value: 0 },
  enemy_soldiers_remaining: { op: ">=", value: 0 }, phase: { op: "=", value: 1 }, action_count: { op: ">=", value: 0 },
  hero_is: { side: "self", value: LEON }, party_has_hero: { side: "ally", value: LIEF }, soldier_mounted: { value: false },
  hero_class: { value: "cavalry" }, hero_faction: { value: "faction_001" }, leader_aura_type: { value: "ally_buff" }, has_skill_tag: { value: "damage" },
  cost: { op: ">", value: 0 }, is_official: { value: true },
};

test("every LEAF_REGISTRY leaf evaluates in the engine: none reports 'not implemented', in or out of an event context", () => {
  const { u, cond } = setup();
  const event = { bus: "before_hit" as const, payload: { attacker: u(EMPEROR), defender: u(LEON), skillId: "s", damageType: "physical" as const, range: "melee" as const, single: true } };
  for (const type of Object.keys(LEAF_REGISTRY)) {
    const leaf = { type, ...(SAMPLE_LEAVES[type] ?? {}) };
    for (const ctx of [{ self: u(LEON) }, { self: u(LEON), target: u(EMPEROR) }, { self: u(LEON), event }]) {
      const r = cond(leaf, ctx);
      assert.deepEqual(r.reasons.filter((m) => m.startsWith("not implemented")), [], `${type}`);
    }
  }
});

test("unit type: is_leader / not_leader follow the side's current leader; a squad is never a leader", () => {
  const { state, u, cond } = setup(undefined, { squads: true });
  assert.equal(cond({ type: "is_leader", side: "self" }, { self: u(LEON) }).value, true);
  assert.equal(cond({ type: "not_leader", side: "target" }, { self: u(LEON), target: u(LIEF) }).value, true);
  assert.equal(cond({ type: "is_leader", side: "enemy" }, { self: u(LEON), target: u(SQ_D) }).value, false);
  assert.equal(cond({ type: "is_leader", side: "enemy" }, { self: u(LEON) }).value, true); // the Emperor
  state.leaders.challenger.leaderId = LIEF; // succession
  assert.equal(cond({ type: "is_leader", side: "self" }, { self: u(LEON) }).value, false);
  assert.equal(cond({ type: "is_leader", side: "ally" }, { self: u(LEON), target: u(LIEF) }).value, true);
});

test("class: has_class_advantage against a class, against me (target side) and from me against the target", () => {
  const { u, cond } = setup();
  // cavalry > infantry, lancer > cavalry
  assert.equal(cond({ type: "has_class_advantage", side: "self", value: "infantry" }, { self: u(LEON) }).value, true);
  assert.equal(cond({ type: "has_class_advantage", side: "self" }, { self: u(LEON), target: u(EMPEROR) }).value, true);
  assert.equal(cond({ type: "has_class_advantage", side: "target" }, { self: u(LEON), target: u(EMPEROR) }).value, false);
  assert.equal(cond({ type: "has_class_advantage", side: "target" }, { self: u(EMPEROR), target: u(LEON) }).value, true); // Leon beats the Emperor
  assert.equal(cond({ type: "has_class_advantage", side: "self" }, { self: u(LEON) }).value, false); // no pair without a target
});

test("position: column_is and same_column_as (a squad spans every column)", () => {
  const { u, cond } = setup(undefined, { squads: true });
  const leon = u(LEON), lief = u(LIEF), emp = u(EMPEROR);
  assert.equal(cond({ type: "column_is", value: leon.column }, { self: leon }).value, true);
  assert.equal(cond({ type: "column_is", side: "target", value: lief.column }, { self: leon, target: lief }).value, true);
  assert.equal(cond({ type: "column_is", side: "target", value: 3 }, { self: leon, target: u(SQ_D) }).value, true);
  assert.equal(cond({ type: "same_column_as", value: "self" }, { self: leon, target: emp }).value, leon.column === emp.column);
  assert.equal(cond({ type: "same_column_as", value: "self" }, { self: leon, target: lief }).value, leon.column === lief.column);
  const bad = cond({ type: "same_column_as", value: "nobody" }, { self: leon });
  assert.equal(bad.value, false);
  assert.match(bad.reasons[0]!, /unknown reference/);
});

test("status: has_any_debuff sees debuff/control statuses, not buffs", () => {
  const { state, u, cond } = setup();
  const c = () => cond({ type: "has_any_debuff", side: "self" }, { self: u(LEON) }).value;
  applyStatus(state, u(LEON), "buff_005", "active", LEON);
  assert.equal(c(), false);
  applyStatus(state, u(LEON), "debuff_001", "active", EMPEROR);
  assert.equal(c(), true);
});

test("stats and resources: stat_compare (effective stat), active_pp, passive_pp", () => {
  const { state, u, cond } = setup();
  const leon = u(LEON);
  const atk = leon.baseStats.ATK;
  assert.equal(cond({ type: "stat_compare", stat: "ATK", op: "=", value: atk }, { self: leon }).value, true);
  applyStatus(state, leon, "buff_005", "active", LEON); // ATTACK UP
  assert.equal(cond({ type: "stat_compare", side: "self", stat: "ATK", op: ">", value: atk }, { self: leon }).value, true);
  leon.pp.active.cur = 1;
  leon.pp.passive.cur = 0;
  assert.equal(cond({ type: "active_pp", side: "self", op: ">=", value: 1 }, { self: leon }).value, true);
  assert.equal(cond({ type: "passive_pp", side: "self", op: ">", value: 0 }, { self: leon }).value, false);
  assert.equal(cond({ type: "passive_pp", side: "enemy", op: ">", value: 0 }, { self: leon }).value, true);
});

test("counts: enemies_alive, allies_alive (living heroes), enemy_soldiers_remaining", () => {
  const { u, cond } = setup(undefined, { squads: true });
  const leon = u(LEON);
  assert.equal(cond({ type: "enemies_alive", op: "=", value: 2 }, { self: leon }).value, true);
  assert.equal(cond({ type: "allies_alive", op: "=", value: 2 }, { self: leon }).value, true);
  const sq = u(SQ_D);
  assert.equal(cond({ type: "enemy_soldiers_remaining", op: "=", value: sq.soldiers.length }, { self: leon }).value, true);
  sq.soldiers[0]!.alive = false;
  u(JASMINE).alive = false;
  assert.equal(cond({ type: "enemy_soldiers_remaining", op: "=", value: sq.soldiers.length - 1 }, { self: leon }).value, true);
  assert.equal(cond({ type: "enemies_alive", op: "=", value: 1 }, { self: leon }).value, true);
});

test("battle: action_count counts the actor's own completed actions this phase", () => {
  const { u, act, cond } = setup();
  const leon = u(LEON);
  assert.equal(cond({ type: "action_count", op: "=", value: 0 }, { self: leon }).value, true);
  act(leon);
  act(leon);
  assert.equal(cond({ type: "action_count", op: "=", value: 2 }, { self: leon }).value, true);
  assert.equal(cond({ type: "action_count", op: "=", value: 0 }, { self: u(LIEF) }).value, true);
});

test("authored and ban leaves: soldier_mounted, hero_class, hero_faction, leader_aura_type, has_skill_tag, cost, is_official", () => {
  const { u, cond } = setup(undefined, { squads: true });
  const leon = u(LEON), lief = u(LIEF);
  assert.equal(cond({ type: "soldier_mounted", value: false }, { self: leon }).value, true); // leads Heavy Infantry
  assert.equal(cond({ type: "soldier_mounted", value: false }, { self: lief }).value, false); // leads no deployed squad
  assert.equal(cond({ type: "hero_class", value: "cavalry" }, { self: leon }).value, true);
  assert.equal(cond({ type: "hero_faction", value: "faction_004" }, { self: leon, target: lief }).value, true);
  assert.equal(cond({ type: "leader_aura_type", value: "faction_buff" }, { self: leon, target: u(EMPEROR) }).value, true);
  assert.equal(cond({ type: "has_skill_tag", value: "heal" }, { self: leon, target: u(JASMINE) }).value, true);
  assert.ok(leon.cost > 0);
  assert.equal(cond({ type: "cost", op: "=", value: leon.cost }, { self: leon }).value, true);
  assert.equal(cond({ type: "is_official", value: true }, { self: leon }).value, true);
  assert.equal(cond({ type: "hero_class", value: "infantry" }, { self: leon, target: u(SQ_D) }).value, false); // a squad is no candidate hero
});

test("event leaves outside an event read 'since my last action': attacked / healed since then, reset by the unit's own action", () => {
  const { x, u, act, cond, state } = setup();
  const emp = u(EMPEROR), leon = u(LEON);
  const c = (type: string, self: Unit) => cond({ type }, { self }).value;
  assert.equal(c("was_attacked_since_last_action", emp), false);
  act(leon); // Charging Assault on the nearest enemy, the Emperor
  assert.deepEqual(["was_attacked_since_last_action", "self_attacked", "self_hit_by_melee", "ally_attacked"].map((t) => c(t, emp)), [true, true, true, false]);
  assert.equal(c("ally_attacked", u(JASMINE)), true);
  assert.equal(c("was_attacked_since_last_action", leon), false);
  assert.equal(c("self_action_completed", leon), true); // its own completed action opens its window
  emp.hp -= 10;
  applyHeal(x, u(JASMINE), emp, { id: "h" }, 5);
  assert.equal(c("just_healed", emp), true);
  state.timeline.pending.delete(EMPEROR);
  performAction(x, emp);
  assert.deepEqual(["was_attacked_since_last_action", "just_healed"].map((t) => c(t, emp)), [false, false]);
});

test("attacked_since_last_action filters the window by damage type, shape and attacker class / race", () => {
  const { u, act, cond } = setup();
  const emp = u(EMPEROR), leon = u(LEON);
  const c = (params: Record<string, unknown>) => cond({ type: "attacked_since_last_action", ...params }, { self: emp }).value;
  assert.equal(c({}), false);
  act(leon); // Charging Assault: physical, single target, cavalry, human
  assert.deepEqual([c({}), c({ damage_type: "physical" }), c({ damage_type: "magical" }), c({ shape: "single" }), c({ shape: "row" })], [true, true, false, true, false]);
  assert.deepEqual([c({ by_class: "cavalry" }), c({ by_class: "infantry" }), c({ by_race: "human" }), c({ by_race: "elf", damage_type: "physical" })], [true, false, true, false]);
  assert.equal(cond({ type: "attacked_since_last_action" }, { self: leon }).value, false);
});

// ------------------------------------------------------------------ selectors

test("selectors: lowest / highest by stat, PP or max HP, farthest, random_seeded", () => {
  const { state, u, pack, x } = setup();
  const leon = u(LEON);
  const sk = pack.byId.skills.get(ASSAULT)!;
  const pick = (sub: any, side: Skill["targeting"]["side"] = "enemy") =>
    resolveTargets({ ...sk, targeting: { ...sk.targeting, side } }, tactic(ASSAULT, { main: null, sub }), leon, state, x.rng).targets.map((t) => t.id);
  u(EMPEROR).pp.passive.cur = 0;
  assert.deepEqual(pick({ select: "lowest", metric: "passive_pp" }), [EMPEROR]);
  assert.deepEqual(pick({ select: "highest", metric: "passive_pp" }), [JASMINE]);
  assert.deepEqual(pick({ select: "farthest" }), [JASMINE]); // back row
  assert.deepEqual(pick({ select: "highest", metric: "INT" }), [JASMINE]);
  assert.deepEqual(resolveTargets(sk, tactic(ASSAULT, { main: null, sub: { select: "random_seeded" } }), leon, state, scripted([0.9])).targets.map((t) => t.id), [JASMINE]);
  u(LEON).hp = 1;
  assert.deepEqual(pick({ select: "lowest", metric: "hp_percent" }, "any"), [LEON]);
  assert.deepEqual(pick({ select: "highest", metric: "max_hp" }), [[EMPEROR, JASMINE].sort((a, b) => u(b).maxHp - u(a).maxHp || (a < b ? -1 : 1))[0]]);
});

// ------------------------------------------------------------------ effects

test("Longinus (modify_pp on_attack, once_per_attack): a two-hit attack takes 1 Passive PP from the unit hit, once; never below 0", () => {
  const { u, ev, act } = setup((pack, battle) => skill(pack, battle, LEON, "skl_test_lance", {
    effects: [...pack.byId.skills.get(ASSAULT)!.effects, ...pack.byId.skills.get(ASSAULT)!.effects, LONGINUS, LONGINUS] as Skill["effects"],
  }));
  u(EMPEROR).hp = u(EMPEROR).maxHp = 5000;
  const ppBefore = u(EMPEROR).pp.passive.cur;
  act(u(LEON));
  assert.equal(ev("damage").filter((d) => d.target === EMPEROR).length, 2);
  assert.deepEqual(ev("pp_change").map((e) => [e.unit, e.pool, e.before, e.after]), [[EMPEROR, "passive", ppBefore, ppBefore - 1]]);
  u(EMPEROR).pp.passive.cur = 0;
  act(u(LEON));
  assert.deepEqual(ev("pp_change").map((e) => [e.unit, e.before, e.after]).at(-1), [EMPEROR, 0, 0]);
});

test("Longinus per-hit-once: as an on_hit reaction to a squad attack on a hero it takes 1 Passive PP, once", () => {
  const { state, x, u, ev } = setup(undefined, { squads: true });
  // A squad is no hero: the per-hit-once rule is shown on the bus with the effect run as an on_hit reaction of the attacking squad.
  state.bus.subscribe({
    event: "after_hit", id: "Longinus", owner: u(SQ_C), order: 100, effect: "modify_pp", match: (p) => p.attacker === u(SQ_C),
    run: (p, xx) => runEffect(xx, u(SQ_C), { id: "equip_004", name: "Longinus", shape: "single", interactions: { guard: "standard", soldiers: "standard" } }, LONGINUS as any, [p.defender], new Set(), true),
  });
  u(SQ_D).alive = false;
  u(EMPEROR).hp = 5000;
  const ppBefore = u(EMPEROR).pp.passive.cur;
  state.timeline.pending.delete(SQ_C);
  executeSquadAction(x, u(SQ_C));
  assert.equal(ev("damage").filter((d) => d.unit === SQ_C).length, 1);
  assert.deepEqual(ev("pp_change").map((e) => [e.unit, e.after]), [[EMPEROR, ppBefore - 1]]);
});

test("delay_action and advance_action move the target's pending action by counts; advancing never goes before now", () => {
  const { state, u, ev, act } = setup((pack, battle) => {
    skill(pack, battle, LEON, "skl_test_delay", { effects: [{ type: "delay_action", counts: 12 }] as Skill["effects"] });
    skill(pack, battle, LIEF, "skl_test_hurry", { targeting: { ...pack.byId.skills.get(ASSAULT)!.targeting, side: "ally" }, effects: [{ type: "advance_action", counts: 1000 }] as Skill["effects"] });
  });
  const before = state.timeline.pending.get(EMPEROR)!.due;
  act(u(LEON));
  assert.equal(state.timeline.pending.get(EMPEROR)!.due, before + 12);
  act(u(LIEF)); // nearest ally: Leon (pending again after his action)
  const e = ev("action_moved").at(-1)!;
  assert.deepEqual([e.unit, e.counts, e.due], [LEON, -1000, state.timeline.now]);
});

test("reduce_damage durations: next_hit covers one attacking action, until_next_action lasts until the holder's own action ends, phase stays", () => {
  for (const [duration, afterNextAction, afterOwnAction] of [["next_hit", false, false], ["until_next_action", true, false], ["phase", true, true]] as const) {
    const { state, u, ev, act } = setup((pack, battle) => skill(pack, battle, EMPEROR, "skl_test_brace", {
      use_limit: 1, // its second action idles
      targeting: { ...pack.byId.skills.get(ASSAULT)!.targeting, side: "self", shape: "self" },
      effects: [{ type: "reduce_damage", percent: 50, applies_to: "all", duration }] as Skill["effects"],
    }));
    const has = () => state.bus.reductions.some((r) => r.unit === u(EMPEROR));
    act(u(EMPEROR)); // sets the reduction during its own action: it outlasts that action
    assert.equal(has(), true, duration);
    act(u(LEON)); // Thousand Azure Hooves on the Emperor: reduced
    assert.deepEqual(ev("damage").filter((d) => d.target === EMPEROR)[0]!.reductions, [50], duration);
    act(u(LIEF)); // the next action begins
    assert.equal(has(), afterNextAction, duration);
    act(u(EMPEROR)); // the holder's next own action ends
    assert.equal(has(), afterOwnAction, duration);
  }
});

test("effect-level condition keeps only the targets it holds for; an on_hit effect does nothing when the action hit no one", () => {
  const { u, ev, act } = setup((pack, battle) => skill(pack, battle, LEON, "skl_test_finisher", {
    targeting: { ...pack.byId.skills.get(ASSAULT)!.targeting, shape: "row" },
    effects: [
      { type: "apply_status", status_id: "debuff_001", chance_percent: 100, target: "targets", condition: { type: "hp_percent", side: "target", op: "<", value: 50 } },
      { type: "apply_status", status_id: "buff_005", chance_percent: 100, target: "hit_unit", trigger: "on_hit" },
    ] as Skill["effects"],
  }));
  u(EMPEROR).hp = 10;
  u(EMPEROR).row = "front"; u(JASMINE).row = "front"; // one row, two candidates
  act(u(LEON)); // only the Emperor is below 50%; no damage effect, so nothing was hit
  assert.deepEqual(ev("status_applied").map((e) => [e.unit, e.status]), [[EMPEROR, "debuff_001"]]);
});

test("an on_hit effect on a damage skill applies to each unit the action hit, after the damage", () => {
  const { u, ev, log, act } = setup((pack, battle) => skill(pack, battle, LEON, "skl_test_mark", {
    effects: [...pack.byId.skills.get(ASSAULT)!.effects, { type: "apply_status", status_id: "debuff_001", chance_percent: 100, target: "hit_unit", trigger: "on_hit" }] as Skill["effects"],
  }));
  act(u(LEON));
  assert.deepEqual(ev("status_applied").map((e) => [e.unit, e.status]), [[EMPEROR, "debuff_001"]]);
  const types = log.events.map((e) => e.type);
  assert.ok(types.indexOf("damage") < types.indexOf("status_applied"));
});

test("prevents_action: the unit loses its action (no tactic, no PP); the 1-turn status ends with it", () => {
  const { state, u, ev, act } = setup((pack) => {
    const st = structuredClone(pack.byId.statuses.get("debuff_001")!) as Status;
    pack.byId.statuses.set("status_test_sleep", { ...st, id: "status_test_sleep", name: "Sleep", modifiers: [], flags: { ...st.flags, prevents_action: true }, duration: { ...st.duration, count: 1 } });
  });
  applyStatus(state, u(EMPEROR), "status_test_sleep", "active", LEON);
  const pp = u(EMPEROR).pp.active.cur;
  assert.equal(act(u(EMPEROR)), false);
  assert.deepEqual(ev("action_prevented").map((e) => [e.unit, e.status]), [[EMPEROR, "status_test_sleep"]]);
  assert.equal(ev("tactic_evaluation").length, 0);
  assert.equal(u(EMPEROR).pp.active.cur, pp);
  assert.deepEqual(ev("status_expired").map((e) => [e.unit, e.status]), [[EMPEROR, "status_test_sleep"]]);
  assert.ok(state.timeline.pending.has(EMPEROR));
  assert.equal(act(u(EMPEROR)), true);
});

test("use_limit and cooldown on an active skill: skipped with a reason, back after the cooldown's own actions", () => {
  const { u, ev, act } = setup((pack, battle) => {
    skill(pack, battle, LEON, "skl_test_once", { pp_cost: 0, use_limit: 1 });
    skill(pack, battle, LIEF, "skl_test_cd", { pp_cost: 0, cooldown: 1 });
  });
  act(u(LEON));
  act(u(LEON));
  assert.match(ev("tactic_evaluation").at(-1)!.evaluations[0]!.reason, /use limit reached \(1\/1/);
  const chosen = () => ev("tactic_evaluation").at(-1)!.chosen;
  act(u(LIEF));
  assert.equal(chosen(), "skl_test_cd");
  act(u(LIEF));
  assert.equal(chosen(), null);
  assert.match(ev("tactic_evaluation").at(-1)!.evaluations[0]!.reason, /on cooldown/);
  act(u(LIEF));
  assert.equal(chosen(), "skl_test_cd");
});

test("use_limit on a passive: Quick Guard with use_limit 1 guards once, then does not fire (logged)", () => {
  const { pack, u, ev, x, state } = setup((pack, battle) => {
    pack.byId.skills.get(QUICK_GUARD)!.use_limit = 1;
    battle.challenger.heroes.find((h) => h.char_id === LEON)!.tactic_sheet.push(tactic(QUICK_GUARD, { priority: 9 }));
  });
  const strike = () => {
    const sk = pack.byId.skills.get(ASSAULT)!;
    state.bus.beginAction(u(EMPEROR));
    runEffect(x, u(EMPEROR), { id: sk.id, name: sk.name, shape: "single", interactions: sk.interactions }, sk.effects[0]!, [u(LEON)], new Set(), false);
  };
  const ppBefore = u(LEON).pp.passive.cur;
  strike();
  strike();
  assert.equal(ev("damage_reduction").length, 1);
  assert.deepEqual(ev("passive_blocked").map((e) => [e.skill, e.reason]), [[QUICK_GUARD, "use limit reached (1/1 this phase)"]]);
  assert.equal(u(LEON).pp.passive.cur, ppBefore - 1);
});

test("Hegemony strips only the attacker's buffs, before the attack resolves; other units keep theirs", () => {
  const { state, u, ev, log, act } = setup((pack, battle) => {
    battle.defender.heroes.find((h) => h.char_id === EMPEROR)!.tactic_sheet.push(tactic(HEGEMONY, { priority: 9 }));
  });
  for (const id of [LEON, LIEF, EMPEROR, JASMINE]) applyStatus(state, u(id), "buff_005", "active", id);
  act(u(LEON));
  assert.deepEqual(ev("status_expired").map((e) => [e.unit, e.status, e.reason]), [[LEON, "buff_005", "removed"]]);
  for (const id of [LIEF, EMPEROR, JASMINE]) assert.ok(u(id).statuses.some((s) => s.statusId === "buff_005"), id);
  const types = log.events.map((e) => e.type);
  assert.ok(types.indexOf("status_expired") < types.indexOf("damage"));
});

// ------------------------------------------------------------------ review regressions

test("an SPD change never reschedules before now, even with the negative delay advance_action leaves", () => {
  const { state, u } = setup();
  const e = state.timeline.pending.get(EMPEROR)!;
  state.timeline.now = e.due - 5;
  e.delay = -100; // as left by a big advance_action
  applyStatus(state, u(EMPEROR), "buff_007", "active", EMPEROR); // SPD UP: the interval changes
  assert.equal(rescheduleOnSpdChange(state, u(EMPEROR)), true);
  assert.ok(e.due >= state.timeline.now);
});

test("a state passive's statuses on allies end when its owner dies, even if the condition still holds", () => {
  const { x, u, ev } = setup((pack, battle) => {
    const base = structuredClone(pack.byId.skills.get("skl_021")!);
    pack.byId.skills.set("skl_test_rally", {
      ...base, id: "skl_test_rally", name: "Rally", pp_cost: 0, default_activation: { type: "phase", op: "=", value: 1 },
      targeting: { ...base.targeting, side: "ally", shape: "all", max_targets: null },
      effects: [{ type: "apply_status", status_id: "buff_005", chance_percent: 100, target: "targets" }] as Skill["effects"],
    });
    pack.byId.characters.get(LEON)!.skills.push("skl_test_rally");
    battle.challenger.heroes.find((h) => h.char_id === LEON)!.tactic_sheet.push(tactic("skl_test_rally", { priority: 9 }));
  });
  checkStatePassives(x);
  assert.ok(u(LIEF).statuses.some((s) => s.statusId === "buff_005"));
  killUnit(x, u(LEON), u(EMPEROR));
  checkStatePassives(x);
  assert.ok(!u(LIEF).statuses.some((s) => s.statusId === "buff_005"));
  assert.deepEqual(ev("passive_ended").map((e) => e.skill), ["skl_test_rally"]);
});

test("an on_hit skill effect is a reaction: its hits dispatch no handlers", () => {
  const { state, u, ev, act } = setup((pack, battle) => {
    const dmg = pack.byId.skills.get(ASSAULT)!.effects[0]!;
    skill(pack, battle, LEON, "skl_test_echo", { effects: [dmg, { ...dmg, damage_type: "magical", trigger: "on_hit" }] as Skill["effects"] });
  });
  let echoes = 0;
  state.bus.subscribe({ event: "after_hit", id: "probe", owner: null, order: 0, effect: "none", match: (p) => p.damageType === "magical", run: () => { echoes++; } });
  u(EMPEROR).hp = u(EMPEROR).maxHp = 5000;
  act(u(LEON));
  assert.equal(ev("damage").filter((d) => d.target === EMPEROR).length, 2); // the echo hit lands
  assert.equal(echoes, 0);
});
