// Tutorial balance (game/logic): random runs with the automatic line-up and default tactics, win rate per stage. Every stage is played by every
// run, whatever happened before, so stage rates are independent. Prints timeouts, median hero actions and any `not implemented` line.
//   npx tsx tools/tutorial-balance.ts [--runs=N] [--seed=S]
import { runBattle } from "../src/engine";
import { loadContentPack } from "../src/cliBattle";
import { buildBattle } from "../game/logic/battle";
import { autoField, pickLeader, poolHero, rollOrder } from "../game/logic/party";
import { buildReplay } from "../game/logic/replay";
import { START_POOL } from "../game/logic/run";
import { resolveEnemies, STAGES } from "../game/logic/stages";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const RUNS = Number(arg("runs") ?? 300), SEED = Number(arg("seed") ?? 1);
const pack = loadContentPack();

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const rows = STAGES.map((st, stage) => {
  let wins = 0, timeouts = 0;
  const actions: number[] = [], notes = new Set<string>();
  for (let i = 0; i < RUNS; i++) {
    const seed = SEED * 100003 + i;
    const order = rollOrder(pack, seed);
    const ids = order.slice(0, START_POOL + stage);
    const pool = autoField(pack, ids.map((id) => poolHero(pack, id)));
    const battle = buildBattle(pack, { seed, stage, attempt: 0, pool, leader: pickLeader(pool)!, enemy: resolveEnemies(pack, seed, stage, ids) });
    const r = runBattle(pack, battle);
    if (r.winner === "challenger") wins++;
    if (r.reason === "phase3_timeout") timeouts++;
    actions.push(r.phases.reduce((n, p) => n + p.actions, 0));
    for (const w of buildReplay(r.events).notImplemented) notes.add(w);
  }
  return { stage: st.name, enemies: st.enemies.length, "win %": ((wins / RUNS) * 100).toFixed(1), "timeout %": ((timeouts / RUNS) * 100).toFixed(1), "median actions": median(actions), "not implemented": [...notes].join("; ") || "-" };
});
console.table(rows);
