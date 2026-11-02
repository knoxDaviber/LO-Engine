// Leader auras (roadmap 2.5, design Sections 2, 9, 9.1 and 17): targeting by aura type, filters, event-triggered auras, passive stacking,
// the pre-battle step order and the end of an aura with its leader.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventLog, PREBATTLE_STEPS, applyDamage, beginPhase, effectiveStat, executeIdle, runBattle, statBreakdown,
  type BattleEvent, type DamageBreakdown, type ExecCtx, type StatusInstance,
} from "../src/engine";
import { battleSchema, type Battle } from "../src/schema";
import { loadPack } from "../src/load";
import type { Pack } from "../src/validate/pack";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal } from "./engineHelpers";

const KILL: DamageBreakdown = { landed: true, scaled: 0, matchup: 1, power: 0, defense: 0, base: 1e9, crit: false, guard: false, guardFactor: 1, amount: 1e9 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const chr = (p: Pack, id: string) => p.byId.characters.get(id) as any;

/** The real sample (Leon+Lief vs Emperor+Jasmine, leaders Leon and Emperor) or full4v4.yaml (Leon+Emperor vs Jasmine+Lief, leaders Leon and Jasmine), auras on. */
function setup(opts: { file?: string; over?: (pack: Pack, battle: Battle) => void } = {}) {
  const { pack, battle: sample } = loadReal({ squads: true, auras: true });
  const battle = opts.file ? battleSchema.parse((loadPack("content").battles ?? []).find((b) => b.name === opts.file)!.data) : structuredClone(sample);
  opts.over?.(pack, battle);
  const log = new EventLog();
  const p = beginPhase(pack, battle, 1, null, log);
  const u = (id: string) => p.state.units.find((v) => v.id === id)!;
  const ev = <T extends BattleEvent["type"]>(t: T) => log.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
  const x: ExecCtx = { state: p.state, rng: p.rng, log };
  const stat = (id: string, s: any) => effectiveStat(u(id), s, pack);
  return { pack, battle, log, state: p.state, rng: p.rng, u, ev, x, stat };
}
const kill = (x: ExecCtx, killer: string, victim: string) =>
  applyDamage(x, x.state.units.find((v) => v.id === killer)!, x.state.units.find((v) => v.id === victim)!, { id: "s" }, KILL);
const setAura = (p: Pack, id: string, over: Record<string, unknown>) => { Object.assign(chr(p, id).leader_aura, over); };
const mod = (stat: string, value: number) => ({ type: "modify_stat", stat, mode: "percent", value });

// ------------------------------------------------------------------ the step list

test("pre-battle steps run in the Section 9 priority order", () => {
  assert.deepEqual(PREBATTLE_STEPS.map((s) => s.name), ["equipment", "terrain", "buff_grants", "immunity", "buff_removal", "debuffs", "event_auras", "spd_finalization"]);
});

test("buff grants resolve before debuffs, whichever side the aura belongs to", () => {
  // The challenger leader (Leon) debuffs, the defender leader (Emperor) buffs; sides are visited challenger first, so only the steps can put the buff first.
  const { ev } = setup({ over: (p) => {
    setAura(p, LEON, { type: "enemy_debuff", condition: null, target: { side: "enemy", filter: null, include_soldiers: false }, effects: [mod("ATK", -20)] });
    setAura(p, EMPEROR, { type: "ally_buff", faction_id: null, target: { side: "ally", filter: null, include_soldiers: false }, effects: [mod("DEF", 20)] });
  } });
  const order = ev("aura_applied").map((e) => e.leader);
  assert.deepEqual([...new Set(order)], [EMPEROR, LEON]);
});

// ------------------------------------------------------------------ the four authored auras

test("Lief's aura (class filter) buffs only Lancers, and only when Lief is the leader", () => {
  const led = setup({ over: (_p, b) => { b.challenger.leader = LIEF; } });
  close(led.stat(LIEF, "ATK"), 108);
  close(led.stat(LIEF, "DEF"), 84);
  close(led.stat(LIEF, "INT"), 48); // INT/MDEF pairing (Decision 132): the ATK line also applies to INT
  close(led.stat(LIEF, "MDEF"), 46 * 1.2);
  close(led.stat(LEON, "ATK"), 115); // a cavalry ally is not a Lancer
  const lief = led.ev("aura_applied").filter((e) => e.leader === LIEF);
  assert.ok(lief.length > 0 && lief.every((e) => e.unit === LIEF && e.category === "passive"));
  const notLed = setup(); // Leon leads: Lief's aura never applies
  close(notLed.stat(LIEF, "ATK"), 90);
});

test("Leon's aura needs The Emperor fielded and Leon as leader", () => {
  const sample = setup(); // Leon leads but the Emperor is on the other side
  close(sample.stat(LEON, "ATK"), 115);
  assert.equal(sample.ev("aura_applied").filter((e) => e.leader === LEON).length, 0);
  const full = setup({ file: "full4v4.yaml" }); // Leon + Emperor, Leon leads
  close(full.stat(LEON, "ATK"), 149.5); // 115 * 1.3
  close(full.stat(EMPEROR, "ATK"), 130); // 100 * 1.3
  close(full.stat(EMPEROR, "DEF"), 91);
  close(full.stat(EMPEROR, "SPD"), 39);
  close(full.stat(JASMINE, "ATK"), 20); // the enemy side gets nothing
  const emperorLeads = setup({ file: "full4v4.yaml", over: (_p, b) => { b.challenger.leader = EMPEROR; } }); // Leon's aura is silent
  close(emperorLeads.stat(LEON, "ATK"), 115 * 1.2); // only the Emperor's faction aura (+20%)
  close(emperorLeads.stat(EMPEROR, "ATK"), 100 * 1.2);
  assert.equal(emperorLeads.ev("aura_applied").filter((e) => e.leader === LEON).length, 0);
});

test("Leon's aura is off in a later phase when The Emperor is no longer fielded (dead)", () => {
  const s = setup({ file: "full4v4.yaml" });
  s.u(EMPEROR).alive = false; s.u(EMPEROR).hp = 0;
  const p2 = beginPhase(s.pack, s.battle, 2, s.state, new EventLog());
  close(effectiveStat(p2.state.units.find((v) => v.id === LEON)!, "ATK", s.pack), 115);
});

test("Emperor's aura (faction): Empire heroes of his side only, not the other side's Empire hero", () => {
  const { stat, u, pack } = setup(); // Leon (Empire) is on the challenger side, Emperor leads the defender
  close(stat(EMPEROR, "ATK"), 120);
  close(stat(EMPEROR, "DEF"), 84);
  close(stat(EMPEROR, "INT"), 36); // paired with the ATK line (Decision 132)
  close(stat(EMPEROR, "MDEF"), 48); // paired with the DEF line
  close(stat(JASMINE, "ATK"), 20); // not Empire
  close(stat(LEON, "ATK"), 115); // Empire, but an enemy
  // a leader's aura is not shared with its squad: the faction aura does not include soldiers, so the squad keeps 17 * 1.3 (soldier skill)
  close(statBreakdown(u(`squad_${EMPEROR}`), "ATK", pack).result, 17 * 1.3);
  assert.ok(!statBreakdown(u(`squad_${EMPEROR}`), "ATK", pack).effects.some((e) => e.status.startsWith("aura:")));
});

// ------------------------------------------------------------------ Jasmine: event-triggered aura

const hurt = (s: ReturnType<typeof setup>) => {
  s.u(LIEF).hp = 60;
  const sq = s.u(`squad_${JASMINE}`);
  sq.soldiers[0]!.hp = 10; sq.soldiers[1]!.alive = false; sq.soldiers[1]!.hp = 0;
  s.u(JASMINE).hp = 40;
};

test("Jasmine's aura heals every ally, soldiers included, after her action; no PP; logged as a trigger", () => {
  const s = setup({ file: "full4v4.yaml" });
  hurt(s);
  const sq = s.u(`squad_${JASMINE}`);
  const ppBefore = s.u(JASMINE).pp.passive.cur;
  executeIdle(s.x, s.u(JASMINE)); // an idle action counts
  assert.deepEqual(s.ev("trigger").map((e) => [e.source, e.event, e.subject]), [[JASMINE, "after_action", JASMINE]]);
  assert.match(s.ev("trigger")[0]!.handler, /^aura:/);
  assert.equal(s.u(LIEF).hp, 60 + 240); // 30% of 800
  assert.equal(s.u(JASMINE).hp, 205); // 40 + 165
  assert.equal(sq.soldiers[0]!.hp, 55); // 10 + floor(30% of 1530 / 10) = 45
  assert.equal(sq.soldiers[1]!.alive, true); // dead soldiers revive at their share
  assert.equal(s.ev("pp_spend").length, 0);
  assert.equal(s.u(JASMINE).pp.passive.cur, ppBefore);
  assert.equal(s.ev("heal").filter((e) => e.unit === JASMINE).length, 3); // Jasmine, Lief, squad; not the enemy side
});

test("Jasmine's aura: an idle action only counts when trigger_includes_idle_action is set; it fires once per action", () => {
  const s = setup({ file: "full4v4.yaml", over: (p) => setAura(p, JASMINE, { trigger_includes_idle_action: false }) });
  executeIdle(s.x, s.u(JASMINE));
  assert.equal(s.ev("trigger").length, 0);
});

test("Jasmine's aura stops when she is no longer leader, and never starts when she was never leader", () => {
  const off = setup({ file: "full4v4.yaml" });
  hurt(off);
  off.state.leaders.defender.auraActive = false; // what leader death or a dropped leadership does
  executeIdle(off.x, off.u(JASMINE));
  assert.equal(off.ev("trigger").length, 0);
  assert.equal(off.u(LIEF).hp, 60);
  const never = setup({ over: (_p, b) => { b.defender.leader = EMPEROR; } }); // sample: Emperor leads, Jasmine is a plain member
  executeIdle(never.x, never.u(JASMINE));
  assert.equal(never.ev("trigger").length, 0);
});

// ------------------------------------------------------------------ each aura type targets the right side

const group = (s: ReturnType<typeof setup>, stat: string) => Object.fromEntries([LEON, LIEF, EMPEROR, JASMINE].map((id) => [id, Math.round(s.stat(id, stat) * 100) / 100]));
/** Sample battle with Leon's aura replaced; the Emperor keeps his own (+20% ATK/DEF to Empire) so the two sides' auras meet. */
const withAura = (aura: Record<string, unknown>) => setup({ over: (p) => setAura(p, LEON, { condition: null, trigger: "always", faction_id: null, ...aura }) });
const side = (s: "ally" | "enemy" | "both", filter: unknown = null) => ({ side: s, filter, include_soldiers: false });

test("field aura reaches both sides (and meets the other leader's aura in the same passive category: strongest wins)", () => {
  const s = withAura({ type: "field", target: side("both"), effects: [mod("ATK", 10)] });
  assert.deepEqual(group(s, "ATK"), { [LEON]: 126.5, [LIEF]: 99, [EMPEROR]: 120, [JASMINE]: 22 }); // Emperor: passive 20 beats passive 10
  assert.deepEqual(s.ev("aura_applied").filter((e) => e.leader === LEON).map((e) => e.unit).sort(), [EMPEROR, JASMINE, LEON, LIEF].sort());
});

test("ally aura reaches every ally of the leader's side and nobody else", () => {
  const s = withAura({ type: "ally_buff", target: side("ally"), effects: [mod("ATK", 10)] });
  assert.deepEqual(group(s, "ATK"), { [LEON]: 126.5, [LIEF]: 99, [EMPEROR]: 120, [JASMINE]: 20 });
});

test("faction aura reaches only allies of the named faction", () => {
  const s = withAura({ type: "faction_buff", faction_id: "faction_004", target: side("ally"), effects: [mod("ATK", 10)] }); // Lief's faction
  assert.deepEqual(group(s, "ATK"), { [LEON]: 115, [LIEF]: 99, [EMPEROR]: 120, [JASMINE]: 20 });
});

test("enemy debuff reaches only the enemies, as a negative passive modifier", () => {
  const s = withAura({ type: "enemy_debuff", target: side("enemy"), effects: [mod("ATK", -20)] });
  assert.deepEqual(group(s, "ATK"), { [LEON]: 115, [LIEF]: 90, [EMPEROR]: 96, [JASMINE]: 16 }); // Emperor: (100) * 1.2 * 0.8, 1.2 buff and 0.8 debuff multiply
  const e = statBreakdown(s.u(JASMINE), "ATK", s.pack).effects[0]!;
  assert.deepEqual([e.category, e.value], ["passive", -20]);
});

test("hero-id filters (authored only) pick exactly the named heroes", () => {
  const s = withAura({ type: "ally_buff", target: side("ally", { type: "hero_is", side: "ally", value: LIEF }), effects: [mod("DEF", 10)] });
  assert.deepEqual(group(s, "DEF"), { [LEON]: 70, [LIEF]: 77, [EMPEROR]: 84, [JASMINE]: 40 });
});

test("aura effects the engine cannot run are logged as not implemented, never dropped silently", () => {
  const s = withAura({ type: "ally_buff", target: side("ally"), effects: [mod("ATK", 10), { type: "remove_buffs", side: "enemy" }] });
  assert.ok(s.ev("not_implemented").some((e) => e.unit === LEON && /aura Loyalty to the Crown effect remove_buffs/.test(e.what)));
  const ev = setup({ over: (p) => setAura(p, EMPEROR, { trigger: "on_event", trigger_event: "self_attacked" }) });
  assert.ok(ev.ev("not_implemented").some((e) => /trigger event self_attacked/.test(e.what)));
});

// ------------------------------------------------------------------ the aura ends with its leader and returns by succession

test("aura statuses stay for the whole phase while the leader lives, and end the moment the leader dies", () => {
  const s = setup({ file: "full4v4.yaml" });
  const auraOn = (id: string) => s.u(id).statuses.filter((i) => i.statusId.startsWith("aura:")).length;
  assert.equal(auraOn(EMPEROR), 3);
  executeIdle(s.x, s.u(EMPEROR)); // actions do not clear aura statuses
  assert.equal(auraOn(EMPEROR), 3);
  kill(s.x, JASMINE, LEON);
  assert.equal(auraOn(EMPEROR), 0);
  assert.equal(auraOn(LEON), 0);
  close(s.stat(EMPEROR, "ATK"), 100);
  assert.equal(s.state.leaders.challenger.auraActive, false);
  const gone = s.ev("aura_removed");
  assert.equal(gone.length, 6); // 3 effects on Leon, 3 on the Emperor
  assert.ok(gone.every((e) => e.leader === LEON && e.reason === "leader_down"));
  assert.ok(s.ev("aura_applied").every((e) => e.phase === 1));
});

test("a dead leader's enemy debuffs end with it", () => {
  const s = withAura({ type: "enemy_debuff", target: side("enemy"), effects: [mod("ATK", -20)] });
  close(s.stat(JASMINE, "ATK"), 16);
  kill(s.x, EMPEROR, LEON);
  close(s.stat(JASMINE, "ATK"), 20);
});

test("succession: the next phase's pre-battle step applies the successor's aura; the dead leader's aura is gone", () => {
  const s = setup({ file: "full4v4.yaml" });
  kill(s.x, JASMINE, LEON); // Leon (leader) dies in phase 1
  const log = new EventLog();
  const p2 = beginPhase(s.pack, s.battle, 2, s.state, log);
  assert.deepEqual(p2.state.leaders.challenger, { leaderId: EMPEROR, auraActive: true });
  const emp = p2.state.units.find((v) => v.id === EMPEROR)!;
  close(effectiveStat(emp, "ATK", s.pack), 120); // Empire's Dominion (+20%) now; Leon's +30% is not coming back
  const applied = log.events.filter((e): e is Extract<BattleEvent, { type: "aura_applied" }> => e.type === "aura_applied");
  assert.ok(applied.every((e) => e.leader === EMPEROR));
  const types = log.events.map((e) => e.type);
  assert.ok(types.indexOf("leader_succession") < types.indexOf("aura_applied")); // after succession, as part of the normal pre-battle step
});

// ------------------------------------------------------------------ stacking (Section 9.1)

test("passive (aura) 20% x active 20% on the same stat = x1.44; passive 20% vs passive 30% = 30%", () => {
  const s = setup();
  const leon = s.u(LEON);
  const inst = (statusId: string, category: StatusInstance["category"], seq: number, value?: number): StatusInstance => ({
    statusId, category, sourceUnitId: LEON, remaining: null, skipNextTick: false, seq,
    ...(value === undefined ? {} : { inline: { name: statusId, modifiers: [{ stat: "ATK" as const, mode: "percent" as const, value }] } }),
  });
  leon.statuses = [inst("aura:test:0", "passive", 1, 20), inst("buff_005", "active", 2)]; // buff_005 = ATTACK UP, +20% ATK
  const bd = statBreakdown(leon, "ATK", s.pack);
  close(bd.multiplier, 1.44);
  close(bd.result, 115 * 1.44);
  assert.deepEqual(bd.effects.map((e) => [e.category, e.outcome]), [["passive", "winner"], ["active", "winner"]]);
  leon.statuses = [inst("aura:test:0", "passive", 1, 20), inst("aura:test:1", "passive", 2, 30)];
  const same = statBreakdown(leon, "ATK", s.pack);
  close(same.multiplier, 1.3);
  assert.deepEqual(same.effects.map((e) => e.outcome), ["suppressed", "winner"]);
});

test("a real aura multiplies with a real active status (Emperor's +20% aura x ATTACK UP)", () => {
  const s = setup();
  const emp = s.u(EMPEROR);
  emp.statuses.push({ statusId: "buff_005", category: "active", sourceUnitId: EMPEROR, remaining: 1, skipNextTick: false, seq: 99 });
  close(statBreakdown(emp, "ATK", s.pack).multiplier, 1.44);
});

// ------------------------------------------------------------------ determinism with auras

test("a battle with auras is byte-identical across runs and the setup stats already include the auras", () => {
  const run = () => { const { pack, battle } = loadReal({ squads: true, auras: true }); return runBattle(pack, battle); };
  const a = run(), b = run();
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  const setupEv = a.events[0] as Extract<BattleEvent, { type: "battle_setup" }>;
  assert.equal(setupEv.units.find((u) => u.id === EMPEROR)!.stats.ATK.result, 120);
});

test("an aura reaches the leader's squad only through its own targeting (include_soldiers), never by sharing the leader's instance", () => {
  const off = withAura({ type: "ally_buff", target: side("ally"), effects: [mod("DEF", 10)] }); // include_soldiers false
  assert.ok(!statBreakdown(off.u(`squad_${LEON}`), "DEF", off.pack).effects.some((e) => e.status.startsWith("aura:")));
  close(off.stat(`squad_${LEON}`, "DEF"), 14 * 1.3);
  const on = withAura({ type: "ally_buff", target: { side: "ally", filter: null, include_soldiers: true }, effects: [mod("DEF", 10)] });
  const sq = on.u(`squad_${LEON}`);
  assert.equal(statBreakdown(sq, "DEF", on.pack).effects.filter((e) => e.status.startsWith("aura:")).length, 1); // its own instance, counted once
  close(on.stat(`squad_${LEON}`, "DEF"), 14 * 1.3 * 1.1);
});
