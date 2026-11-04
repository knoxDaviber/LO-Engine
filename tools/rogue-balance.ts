// Rogue balance (game/logic): seeded full runs with the automatic line-up and default tactics, through the real run functions.
// Per wave: how many runs reached it, win % over its battles (retries included), and average heroes alive when it starts.
//   npx tsx tools/rogue-balance.ts [--runs=N] [--seed=S]
// --late skips the runs and fights each designed team directly, as the auto line-up rarely gets there: the 4 best of 6 rolled heroes, fully geared, full HP, default tactics.
import { readContentTexts } from "../src/load";
import { bootPack } from "../game/logic/content";
import { runBattle } from "../src/engine";
import { buildBattle } from "../game/logic/battle";
import { autoField, mix, pickLeader, poolHero, rollOrder } from "../game/logic/party";
import { afterResult, companyLeft, fight, pickRecruit, startRun, toPrep, type RunState } from "../game/logic/run";
import { resolveEnemies, ROGUE_STAGES, rogueEnemyCount } from "../game/logic/stages";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const RUNS = Number(arg("runs") ?? 100), SEED = Number(arg("seed") ?? 1), MAX_ATTEMPTS = 20;
const pack = bootPack(readContentTexts("content"));

if (process.argv.includes("--late")) {
  // Heroes by measured worth, from a one-off trial of every 4-hero line-up against an early draft of these teams. The top 4 of the 6 rolled are fielded, whatever their rows.
  // Leon leads when he is fielded with his Emperor; otherwise the first fielded front-liner.
  const BEST = ["char_002", "char_001", "char_003", "char_004", "char_017", "char_020", "char_018", "char_016", "char_015", "char_019"];
  console.table(ROGUE_STAGES.flatMap((st, w) => {
    if (!st.team) return [];
    let wins = 0, timeouts = 0;
    for (let i = 0; i < RUNS; i++) {
      const seed = mix(SEED, i), ids = rollOrder(pack, seed).slice(0, 6).sort((a, b) => BEST.indexOf(a) - BEST.indexOf(b)).slice(0, 4);
      const pool = autoField(pack, ids.map((id) => poolHero(pack, id)));
      const battle = buildBattle(pack, { seed, stage: w, attempt: 0, pool, leader: ids.includes("char_001") && ids.includes("char_002") ? "char_001" : pickLeader(pool)!, enemy: resolveEnemies(pack, seed, w, ids, "rogue"), mode: "rogue" });
      const r = runBattle(pack, battle);
      if (r.winner === "challenger") wins++;
      if (r.reason === "phase3_timeout") timeouts++;
    }
    return [{ wave: w + 1, team: st.party, leader: pack.byId.characters.get(st.team[0]!.hero)!.name, "win %": ((wins / RUNS) * 100).toFixed(0), "timeout %": ((timeouts / RUNS) * 100).toFixed(0) }];
  }));
  process.exit(0);
}

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
