// Rogue balance (game/logic): seeded full runs with the automatic line-up and default tactics, through the real run functions.
// Per wave: how many runs reached it, win % over its battles (retries included), and average heroes alive when it starts.
//   npx tsx tools/rogue-balance.ts [--runs=N] [--seed=S]
import { readContentTexts } from "../src/load";
import { bootPack } from "../game/logic/content";
import { autoField, pickLeader } from "../game/logic/party";
import { afterResult, companyLeft, fight, pickRecruit, startRun, toPrep, type RunState } from "../game/logic/run";
import { ROGUE_STAGES, rogueEnemyCount } from "../game/logic/stages";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const RUNS = Number(arg("runs") ?? 100), SEED = Number(arg("seed") ?? 1), MAX_ATTEMPTS = 20;
const pack = bootPack(readContentTexts("content"));

const n = ROGUE_STAGES.length;
const reached = Array(n).fill(0), fights = Array(n).fill(0), wins = Array(n).fill(0), alive = Array(n).fill(0);
let cleared = 0;
const notes = new Set<string>();
for (let i = 0; i < RUNS; i++) {
  let s: RunState = startRun(pack, SEED * 100003 + i, false, "rogue");
  let seen = -1;
  for (;;) {
    const pool = autoField(pack, s.pool);
    s = toPrep(pack, { ...s, pool, leader: pickLeader(pool) });
    if (s.stage !== seen) { seen = s.stage; reached[s.stage]++; alive[s.stage] += s.pool.length; }
    s = fight(pack, s);
    for (const w of s.fought!.replay.notImplemented) notes.add(w);
    fights[s.stage]++;
    if (s.fought!.summary.won) wins[s.stage]++;
    const stage = s.stage;
    if (companyLeft(s).length === 0) break;
    s = afterResult(pack, s);
    if (s.offers.length) s = pickRecruit(pack, s, s.offers[0]!);
    if (s.screen === "victory") { cleared++; break; }
    if (s.stage === stage && s.attempt >= MAX_ATTEMPTS) break;
  }
}
console.table(ROGUE_STAGES.map((st, w) => ({
  wave: w + 1, name: st.name, foes: rogueEnemyCount(w), "reached %": ((reached[w] / RUNS) * 100).toFixed(0),
  "win %": fights[w] ? ((wins[w] / fights[w]) * 100).toFixed(0) : "-", "avg alive": reached[w] ? (alive[w] / reached[w]).toFixed(1) : "-",
})));
console.log(`cleared: ${((cleared / RUNS) * 100).toFixed(1)}% of ${RUNS} runs; not implemented: ${[...notes].join("; ") || "-"}`);
