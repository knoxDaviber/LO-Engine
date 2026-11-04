// Seat neutrality (Decision 142): the same battle with the sides exchanged plays out identically up to the challenger / defender labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { runSeeds } from "../src/batchReport";
import { runBattle } from "../src/engine";
import { battleSchema } from "../src/schema";
import { loadReal } from "./engineHelpers";

// Setup events are listed challenger-first by construction; blessings, terrain and phase-start successions at t0 are setup too.
const SETUP_ONLY = new Set(["battle_setup", "schedule", "aura_applied", "phase_start"]);
const setup = (e: { type: string; t?: number }): boolean => SETUP_ONLY.has(e.type) || ((e.type === "blessing_applied" || e.type === "terrain_applied" || e.type === "leader_succession") && e.t === 0);
// Keys sorted, so `{challenger, defender}` objects compare equal after the swap.
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));
const swapLabels = (s: string): string => s.replace(/"(challenger|defender)"/g, (_m, w) => (w === "challenger" ? '"defender"' : '"challenger"'));

test("city4v4 with the sides exchanged gives the same event log (labels swapped)", () => {
  const { pack } = loadReal({ squads: true, auras: true, damage: true });
  const raw = battleSchema.parse(parse(readFileSync("content/battles/city4v4.yaml", "utf-8")));
  const swapped = { ...raw, challenger: raw.defender, defender: raw.challenger };
  for (const run of [0, 1, 2, 3]) {
    const seeds = runSeeds(1, "city4v4.yaml", run);
    const a = runBattle(pack, { ...raw, seeds }).events.filter((e) => !setup(e));
    const b = runBattle(pack, { ...swapped, seeds }).events.filter((e) => !setup(e));
    const ja = a.map(canon);
    const jb = b.map((e) => canon(JSON.parse(swapLabels(JSON.stringify(e)))));
    const i = ja.findIndex((x, k) => x !== jb[k]);
    assert.equal(i, -1, `run ${run}: first divergent event #${i}\n A: ${ja[i]}\n B: ${jb[i]}`);
    assert.equal(ja.length, jb.length);
  }
});
