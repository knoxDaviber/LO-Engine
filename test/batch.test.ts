import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { aggregate, runMatchup, runSeeds } from "../src/batchReport";
import type { BattleEvent } from "../src/engine";
import { loadReal } from "./engineHelpers";

const st = { phase: 1, t: 0 };
const setup = (ids: [string, "challenger" | "defender"][]): BattleEvent => ({
  type: "battle_setup", battle_id: "b", seeds: [1, 2, 3], skills: [], statuses: [],
  units: ids.map(([id, side]) => ({ id, name: id.toUpperCase(), side } as any)),
  squads: [{ id: "squad_a", name: "A squad", side: "challenger" } as any],
});
const dmg = (unit: string, target: string, amount: number): BattleEvent => ({
  type: "damage", ...st, unit, target, skill: "s", power: 0, defense: 0, base: 0, crit: false, guard: false, amount, hp_before: 0, hp_after: 0,
});
const phaseEnd = (actions: number): BattleEvent => ({ type: "phase_end", ...st, reason: "exhausted", actions, skills: 0, squad_actions: 0, survivors: { challenger: 1, defender: 1 } });
const tac = (unit: string): BattleEvent => ({ type: "tactic_evaluation", ...st, unit, evaluations: [], chosen: null });

test("aggregate: exact numbers from tiny event arrays", () => {
  const run1: BattleEvent[] = [
    { type: "draft_result", side: "defender", fielded: ["b"], banned: ["x"], protected: [], leader: "b", anchor: null, moved: [] },
    { type: "draft_step", step: 1, actor: "challenger", action: "ban", source: "human", side: "defender", hero: "x", by: "human", name: "Xena" },
    setup([["a", "challenger"], ["b", "defender"]]),
    tac("a"), dmg("a", "b", 30), dmg("squad_a", "b", 4), { type: "squad_attack", ...st, unit: "squad_a", attackers: 2 },
    { type: "heal", ...st, unit: "b", target: "b", skill: "h", amount: 20, applied: 10, hp_before: 0, hp_after: 10 },
    { type: "death", ...st, unit: "b", killer: "a" },
    { type: "death", ...st, unit: "squad_a", killer: "b", soldier: 0 },
    phaseEnd(3),
    { type: "battle_end", winner: "challenger", reason: "wipe", phases: 1 },
  ];
  const run2: BattleEvent[] = [
    setup([["a", "challenger"], ["b", "defender"]]),
    tac("a"), tac("a"), { type: "action_prevented", ...st, unit: "b", status: "sleep" }, dmg("a", "b", 10),
    phaseEnd(2), phaseEnd(1), phaseEnd(0),
    { type: "battle_end", winner: "defender", reason: "phase3_timeout", phases: 3 },
  ];
  const r = aggregate("m", [run1, run2]);
  assert.equal(r.runs, 2);
  assert.equal(r.challenger_win_rate, 0.5);
  assert.equal(r.defender_win_rate, 0.5);
  assert.equal(r.timeout_rate, 0.5);
  assert.deepEqual(r.reasons, { phase3_timeout: 0.5, wipe: 0.5 });
  assert.equal(r.avg_phases, 2);
  assert.equal(r.avg_actions_per_phase, 1.5);
  assert.deepEqual(r.avg_hero_deaths, { challenger: 0, defender: 0.5 });
  const u = (side: string, id: string) => r.units.find((x) => x.side === side && x.id === id)!;
  assert.deepEqual(u("challenger", "a"), { id: "a", name: "A", side: "challenger", kind: "hero", fielded_rate: 1, banned_rate: 0, avg_damage: 20, avg_healing: 0, death_rate: 0, avg_actions: 1.5 });
  assert.deepEqual(u("challenger", "squad_a"), { id: "squad_a", name: "A squad", side: "challenger", kind: "squad", fielded_rate: 1, banned_rate: 0, avg_damage: 2, avg_healing: 0, death_rate: 0, avg_actions: 0.5 });
  assert.deepEqual(u("defender", "b"), { id: "b", name: "B", side: "defender", kind: "hero", fielded_rate: 1, banned_rate: 0, avg_damage: 0, avg_healing: 5, death_rate: 0.5, avg_actions: 0.5 });
  assert.deepEqual(u("defender", "x"), { id: "x", name: "Xena", side: "defender", kind: "hero", fielded_rate: 0, banned_rate: 0.5, avg_damage: 0, avg_healing: 0, death_rate: 0, avg_actions: 0 });
  assert.deepEqual(r.units.map((x) => `${x.side}:${x.id}`), ["challenger:a", "challenger:squad_a", "defender:b", "defender:x"]);
});

test("run seeds: deterministic, in range, differ by base seed, file and run", () => {
  assert.deepEqual(runSeeds(1, "content/battles/sample.yaml", 0), runSeeds(1, "sample.yaml", 0));
  const set = (base: number) => JSON.stringify(Array.from({ length: 10 }, (_, i) => runSeeds(base, "sample.yaml", i)));
  assert.notEqual(set(1), set(2));
  assert.notDeepEqual(runSeeds(1, "a.yaml", 0), runSeeds(1, "b.yaml", 0));
  assert.notDeepEqual(runSeeds(1, "a.yaml", 0), runSeeds(1, "a.yaml", 1));
  for (let i = 0; i < 50; i++) for (const s of runSeeds(i, "x.yaml", i)) assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
});

test("same base seed gives the same report on sample.yaml; rates sum to 1", () => {
  const { pack, battle } = loadReal({ squads: true, auras: true });
  const a = runMatchup(pack, battle, "sample.yaml", 5, 7);
  assert.deepEqual(a, runMatchup(pack, battle, "sample.yaml", 5, 7));
  assert.equal(a.runs, 5);
  assert.ok(Math.abs(a.challenger_win_rate + a.defender_win_rate - 1) < 1e-9);
  assert.ok(Math.abs(Object.values(a.reasons).reduce((s, v) => s + v, 0) - 1) < 1e-9);
});

test("batch CLI rejects unknown options and non-decimal values with exit 2", () => {
  for (const extra of [["--josn"], ["--json=1"], ["--runs", "5"], ["--runs=0x10"], ["--seed=1e2"], ["--runs= 5"]]) {
    const r = spawnSync("npx", ["tsx", "src/batch.ts", "content/battles/sample.yaml", ...extra], { cwd: process.cwd(), encoding: "utf-8" });
    assert.equal(r.status, 2, extra.join(" "));
    assert.match(r.stderr, /usage: npm run batch/);
  }
});
