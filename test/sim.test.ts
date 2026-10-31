import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLog, runBattle } from "../src/engine";
import { loadReal } from "./engineHelpers";

const run = (seeds?: number[]) => {
  const { pack, battle } = loadReal();
  if (seeds) battle.seeds = seeds;
  return runBattle(pack, battle);
};

test("same seed twice gives byte-identical JSON and text logs", () => {
  assert.equal(JSON.stringify(run().events), JSON.stringify(run().events));
  assert.equal(renderLog(run().events), renderLog(run().events));
});

test("different seeds give different logs and different roll sequences", () => {
  const rolls = (r: ReturnType<typeof run>) => JSON.stringify(r.events.filter((e) => e.type === "roll"));
  const base = run();
  assert.notEqual(JSON.stringify(base.events), JSON.stringify(run([1, 2, 3]).events));
  assert.ok([[1, 2, 3], [7, 8, 9], [11, 22, 33]].some((s) => rolls(run(s)) !== rolls(base)));
});

test("log shape: setup first with breakdowns and seeds, phase markers, every event typed", () => {
  const ev = run().events;
  assert.equal(ev[0]!.type, "battle_setup");
  const setup = ev[0] as Extract<(typeof ev)[number], { type: "battle_setup" }>;
  assert.deepEqual(setup.seeds, [101, 202, 303]);
  assert.equal(setup.units[0]!.stats.ATK.result, 70);
  assert.equal(ev.at(-1)!.type, "battle_end");
  const types = new Set(ev.map((e) => e.type));
  for (const t of ["phase_start", "schedule", "tactic_evaluation", "target_selection", "roll", "damage", "pp_spend", "status_applied", "idle", "phase_end", "not_implemented"]) assert.ok(types.has(t as any), t);
  assert.match(renderLog(ev), /=== Battle over: \w+ wins/);
});

test("sim CLI prints a text log, JSON with --json, and refuses an invalid battle", () => {
  const cwd = process.cwd();
  const text = execFileSync("npx", ["tsx", "src/sim.ts", "content/battles/sample.yaml"], { cwd, encoding: "utf-8" });
  assert.match(text, /=== Phase 1/);
  const json = JSON.parse(execFileSync("npx", ["tsx", "src/sim.ts", "content/battles/sample.yaml", "--json"], { cwd, encoding: "utf-8" }));
  assert.equal(json[0].type, "battle_setup");
  const dir = mkdtempSync(join(tmpdir(), "sim-"));
  const bad = join(dir, "bad.yaml");
  writeFileSync(bad, "battle_id: bad\nversion: '1'\nseeds: [1]\nchallenger: { leader: char_001, heroes: [] }\ndefender: { leader: char_002, heroes: [] }\n");
  const r = spawnSync("npx", ["tsx", "src/sim.ts", bad], { cwd, encoding: "utf-8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /E_BATTLE_SEEDS/);
});
