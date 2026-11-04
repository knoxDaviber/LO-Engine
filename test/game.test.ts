// The main game's logic (game/logic): always-true rules only, no win rates and no hardcoded tunables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readContentTexts } from "../src/load";
import { beginPhase, MAX_PHASES, preBattleState, runBattle, runPhase, setupEvent, timeoutWinner, type BattleEvent, type BattleState } from "../src/engine";
import type { Battle } from "../src/schema";
import { Collector } from "../src/types";
import { validateBattle } from "../src/validate/battle";
import { bootPack } from "../game/logic/content";
import { buildBattle } from "../game/logic/battle";
import { autoField, kitOf, matchupPct, moveHero, pickLeader, poolHero, rollOrder, type PoolHero } from "../game/logic/party";
import { buildReplay, motionOf, type Beat, type Pop, type UnitInfo } from "../game/logic/replay";
import { afterResult, fight, fightBlocker, moveTo, poolIds, rerollStart, startRun, START_POOL, toggleField, toPrep, type RunState } from "../game/logic/run";
import { resolveEnemies, STAGES } from "../game/logic/stages";
import { captionsFor, CAPTIONS, fillText, PREP_STEPS, tutorialContext, tutorialEvent, tutorialHero, startTutorial } from "../game/logic/tutorial";

const pack = bootPack(readContentTexts("content"));
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7);
const errors = (battle: unknown) => {
  const c = new Collector();
  validateBattle(battle, pack, c, { file: "t", tier: "official" });
  return c.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`);
};
/** A stage's battle with the automatic line-up, for a pool from the run's rolled order. */
function stageBattle(seed: number, stage: number) {
  const ids = rollOrder(pack, seed).slice(0, START_POOL + stage);
  const pool = autoField(pack, ids.map((id) => poolHero(pack, id)));
  return { ids, pool, battle: buildBattle(pack, { seed, stage, attempt: 0, pool, leader: pickLeader(pool)!, enemy: resolveEnemies(pack, seed, stage, ids) }) };
}
/** Plays a run to its end, pretending every battle was won; the real battles still run and validate. */
function winAll(seed: number): RunState[] {
  const seen: RunState[] = [];
  let s = toPrep(pack, startRun(pack, seed, false));
  for (;;) {
    s = fight(pack, s);
    seen.push(s);
    s = { ...s, fought: { ...s.fought!, summary: { ...s.fought!.summary, won: true } } };
    s = afterResult(pack, s);
    if (s.screen === "victory") return seen;
    s = toPrep(pack, s);
  }
}

test("every hero builds a valid battle with its kit and squad", () => {
  for (const ch of pack.characters) {
    const pool = autoField(pack, [poolHero(pack, ch.id)]);
    const enemyPool = [ch.id];
    const battle = buildBattle(pack, { seed: 1, stage: 0, attempt: 0, pool, leader: ch.id, enemy: resolveEnemies(pack, 1, 0, enemyPool) });
    assert.deepEqual(errors(battle), [], ch.id);
    assert.deepEqual(battle.challenger.heroes[0]!.equipment, kitOf(ch.class));
    assert.ok(battle.challenger.heroes[0]!.tactic_sheet.some((t) => pack.byId.skills.get(t.skill_id)!.category === "active"), `${ch.id} has an active order`);
  }
});

test("pools grow 4, 5, 6 and at most rules.draft.fielded fight, against 2, 3, 4 enemies with no collisions", () => {
  for (const seed of SEEDS) {
    STAGES.forEach((st, stage) => {
      const { ids, battle, pool } = stageBattle(seed, stage);
      assert.equal(new Set(ids).size, START_POOL + stage);
      assert.equal(pool.length, START_POOL + stage);
      assert.ok(battle.challenger.heroes.length <= pack.rules.draft.fielded);
      assert.equal(battle.defender.heroes.length, st.enemies.length);
      for (const e of battle.defender.heroes) assert.ok(!ids.includes(e.char_id), `${e.char_id} is in the pool`);
      assert.deepEqual(errors(battle), []);
    });
  }
});

test("the player pool rolls only named heroes, enough for the tutorial", () => {
  const o = rollOrder(pack, 1);
  assert.ok(o.every((id) => { const c = pack.byId.characters.get(id)!; return c.name.toLowerCase() !== c.class; }));
  assert.ok(o.length >= START_POOL + 2);
});

test("a reroll of the starting pool rolls a new, full, valid company", () => {
  const s = startRun(pack, 5, false);
  const r = rerollStart(pack, s, 6);
  assert.equal(r.screen, "reveal");
  assert.equal(r.seed, 6);
  assert.deepEqual(r.order, rollOrder(pack, 6));
  assert.equal(r.pool.length, START_POOL);
  assert.equal(new Set(poolIds(r)).size, START_POOL);
  assert.ok(r.leader && r.pool.find((h) => h.entry.char_id === r.leader)!.slot);
  assert.deepEqual(rerollStart(pack, s, 6), r);
  assert.deepEqual(fight(pack, toPrep(pack, r)).fought!.replay.notImplemented, []);
  const recruit = { ...s, stage: 1 };
  assert.equal(rerollStart(pack, recruit, 7), recruit);
});

test("a benched hero cannot join a full team, a swap keeps the count, a benched leader hands over", () => {
  const ids = rollOrder(pack, 3).slice(0, pack.rules.draft.fielded + 1);
  const pool = autoField(pack, ids.map((id) => poolHero(pack, id)));
  const benched = pool.find((h) => !h.slot)!;
  const taken = pool.find((h) => h.slot)!;
  const empty = [1, 2, 3].flatMap((column) => (["front", "back"] as const).map((row) => ({ row, column }))).find((sl) => !pool.some((h) => h.slot?.row === sl.row && h.slot.column === sl.column))!;
  assert.equal(moveHero(pack, pool, benched.entry.char_id, empty), pool);
  const swapped = moveHero(pack, pool, benched.entry.char_id, taken.slot);
  assert.equal(swapped.filter((h) => h.slot).length, pack.rules.draft.fielded);
  assert.equal(swapped.find((h) => h.entry.char_id === taken.entry.char_id)!.slot, null);

  let s = toPrep(pack, startRun(pack, 9, false));
  const was = s.leader!;
  s = moveTo(pack, s, was, null);
  assert.notEqual(s.leader, was);
  assert.ok(s.pool.find((h) => h.entry.char_id === s.leader)!.slot);
  for (const h of s.pool) if (h.slot) s = toggleField(pack, s, h.entry.char_id);
  assert.equal(s.leader, null);
  assert.ok(fightBlocker(pack, s));
  assert.equal(fight(pack, s), s);
});

test("the same seed gives the same run", () => {
  const a = winAll(77), b = winAll(77);
  assert.deepEqual(a.map((s) => s.fought!.result.events), b.map((s) => s.fought!.result.events));
});

test("a retry changes the seeds, not the enemies or the pool", () => {
  let s = fight(pack, toPrep(pack, startRun(pack, 21, false)));
  const first = s.fought!.result.events.find((e) => e.type === "battle_setup");
  s = { ...s, fought: { ...s.fought!, summary: { ...s.fought!.summary, won: false } } };
  const retry = afterResult(pack, s);
  assert.equal(retry.screen, "prep");
  assert.equal(retry.stage, 0);
  assert.equal(retry.attempt, 1);
  assert.deepEqual(retry.enemy, s.enemy);
  assert.deepEqual(retry.pool, s.pool);
  const again = fight(pack, retry).fought!.result.events.find((e) => e.type === "battle_setup");
  assert.notDeepEqual((again as { seeds: number[] }).seeds, (first as { seeds: number[] }).seeds);
});

test("the replay's last snapshot equals the engine's final state, and no battle logs not implemented", () => {
  for (const seed of SEEDS) {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const r = runBattle(pack, stageBattle(seed, stage).battle);
      const replay = buildReplay(r.events);
      assert.deepEqual(replay.notImplemented, []);
      const last = replay.beats.at(-1)!;
      for (const u of [...r.units, ...r.squads]) {
        const snap = last.units.find((x) => x.id === u.id)!;
        assert.equal(snap.hp, u.alive ? u.hp : 0, `${u.id} hp, seed ${seed} stage ${stage}`);
        assert.equal(snap.alive, u.alive, `${u.id} alive, seed ${seed} stage ${stage}`);
      }
      for (const q of r.squads) assert.equal(last.units.find((x) => x.id === q.id)!.soldiers, q.soldiers.filter((h) => h > 0).length);
      assert.equal(replay.winner, r.winner);
      assert.ok(replay.beats.every((b, i) => b.index === i));
    }
  }
});

/** runBattle by hand, recording after every event what the engine has scheduled. The unit acting right now has left the timeline, so it is added back at the clock. */
function runRecorded(battle: Battle) {
  const events: BattleEvent[] = [], schedule: Map<string, number>[] = [];
  let state: BattleState | null = null;
  const log = {
    emit(e: BattleEvent) {
      events.push(e);
      const due = new Map([...(state?.timeline.pending.values() ?? [])].map((p) => [p.unitId, p.due]));
      if (state && (e.type === "tactic_evaluation" || e.type === "squad_attack" || e.type === "action_prevented")) due.set(e.unit, state.timeline.now);
      schedule.push(due);
    },
  };
  log.emit(setupEvent(pack, battle, preBattleState(pack, battle, 1)));
  let wipe = false;
  for (let phase = 1; phase <= MAX_PHASES && !wipe; phase++) {
    const prev: BattleState | null = state;
    state = null;
    const b = beginPhase(pack, battle, phase, prev, log);
    state = b.state;
    wipe = runPhase(state, b.rng, log).reason === "wipe";
  }
  const alive = (side: string) => state!.units.some((u) => u.side === side && u.kind === "hero" && u.alive);
  log.emit({ type: "battle_end", winner: wipe ? (alive("challenger") ? "challenger" : "defender") : timeoutWinner(state!), reason: wipe ? "wipe" : "phase3_timeout", phases: state!.phase });
  return { events, schedule };
}

test("every beat's next-to-act queue matches the engine's schedule, through stuns and delays", () => {
  let moved = 0;
  // Leon opens with a stunning skill, so these battles always exercise a delayed action.
  for (const seed of SEEDS) {
    const ids = ["char_001", ...rollOrder(pack, seed).filter((id) => id !== "char_001").slice(0, START_POOL - 1)];
    const pool = autoField(pack, ids.map((id) => poolHero(pack, id)));
    const battle = buildBattle(pack, { seed, stage: 2, attempt: 0, pool, leader: pickLeader(pool)!, enemy: resolveEnemies(pack, seed, 2, ids) });
    const { events, schedule } = runRecorded(battle);
    assert.deepEqual(events, runBattle(pack, battle).events, "the recorded run is the real run");
    moved += events.filter((e) => (e.type === "action_delayed" || e.type === "action_moved") && e.due !== null).length;
    for (const b of buildReplay(events).beats) {
      if (b.kind === "end") continue; // the battle is over, nothing is next
      const due = schedule[b.at]!;
      const want = [...due.values()].sort((x, y) => x - y).slice(0, b.next.length);
      assert.deepEqual(b.next.map((id) => due.get(id)), want, `seed ${seed} beat ${b.index}`);
      assert.equal(b.next.length, Math.min(due.size, 8), `seed ${seed} beat ${b.index}`);
    }
  }
  assert.ok(moved > 0, "the sample must contain a delayed action");
});

test("tutorial steps declare their targets, and every target exists in the renderer", () => {
  const dir = "game/src";
  const src = readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
  for (const step of PREP_STEPS) {
    assert.ok("target" in step, step.id);
    if (step.target) assert.ok(src.includes(`"${step.target}"`), `no data-tut for ${step.target}`);
  }
  assert.equal(new Set(PREP_STEPS.map((s) => s.id)).size, PREP_STEPS.length);
});

test("the tutorial names the hero it points at, a fielded one, even after pool[0] is benched", () => {
  let s = toPrep(pack, startRun(pack, 12, true));
  s = moveTo(pack, s, s.pool[0]!.entry.char_id, null);
  const id = tutorialHero(s.pool);
  assert.notEqual(id, s.pool[0]!.entry.char_id);
  assert.ok(s.pool.find((h) => h.entry.char_id === id)!.slot);
  assert.equal(tutorialContext(pack, s.pool, s.leader, "x").hero, pack.byId.characters.get(id)!.name);
});

test("tutorial text fills in for any party and the waits advance", () => {
  for (const seed of SEEDS) {
    const s = toPrep(pack, startRun(pack, seed, true));
    const ctx = tutorialContext(pack, s.pool as PoolHero[], s.leader, STAGES[0]!.party);
    for (const step of PREP_STEPS) assert.doesNotMatch(fillText(step.text, pack, ctx), /[{}]/, step.id);
    const r = fight(pack, s).fought!.replay;
    const caps = captionsFor(r);
    assert.equal(new Set(caps.map((c) => c.beat)).size, caps.length);
    for (const c of caps) assert.doesNotMatch(fillText(CAPTIONS[c.id], pack, ctx, { spent: c.spent }), /[{}]/, c.id);
  }
  let t = startTutorial();
  for (const step of PREP_STEPS) {
    if (step.wait) t = tutorialEvent(t, step.wait)!;
    else t = { ...t, step: t.step + 1 };
  }
  assert.equal(t.step, PREP_STEPS.length);
  const won = fight(pack, toPrep(pack, startRun(pack, 4, true)));
  assert.equal(afterResult(pack, { ...won, fought: { ...won.fought!, summary: { ...won.fought!.summary, won: true } } }).tutorial, null);
  assert.equal(tutorialEvent(startTutorial(), "fight")!.step, 0);
});

test("motionOf: attack, support and class motions", () => {
  const mk = (id: string, side: "challenger" | "defender", cls = "warrior") => ({ id, side, cls, kind: "hero" }) as UnitInfo;
  const a = mk("a", "challenger", "archer"), ally = mk("b", "challenger"), foe = mk("c", "defender"), units = [a, ally, foe];
  const beat = (pops: Pop[], kind = "action", actor = "a") => ({ kind, actor, pops }) as Beat;
  assert.equal(motionOf(a, beat([{ kind: "heal", unit: "a", amount: 3 }]), units), "support");
  assert.equal(motionOf(a, beat([{ kind: "heal", unit: "b", amount: 3 }]), units), "support");
  assert.equal(motionOf(a, beat([{ kind: "text", unit: "c", text: "Slow" }]), units), "shot");
  assert.equal(motionOf(a, beat([{ kind: "damage", unit: "c", amount: 5, crit: false, guard: false }, { kind: "heal", unit: "a", amount: 2 }]), units), "shot");
  assert.equal(motionOf(a, beat([{ kind: "text", unit: "a", text: "Up" }]), units), "shot");
  assert.equal(motionOf(a, beat([], "stunned"), units), "stun");
  assert.equal(motionOf(a, beat([], "action", "c"), units), null);
});

test("matchupPct reads the class rules: advantage up, reverse down, same class neutral", () => {
  const p = pack.rules.class_advantage[0]!;
  assert.ok(matchupPct(pack, p.attacker, p.defender) > 0);
  assert.equal(matchupPct(pack, p.defender, p.attacker), pack.rules.matchup.disadvantage_damage_percent);
  assert.equal(matchupPct(pack, p.attacker, p.attacker), 0);
});
