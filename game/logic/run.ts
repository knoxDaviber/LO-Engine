// The run state machine: plain functions from state to state. The UI holds one RunState and calls these. Pure: no DOM.
import { runBattle, type BattleResult } from "../../src/engine";
import type { BattleSide, Tactic } from "../../src/schema";
import type { Pack } from "../../src/validate/pack";
import { buildBattle } from "./battle";
import { autoField, freeSlot, moveHero, pickLeader, poolHero, rollOrder, type PoolHero, type Slot } from "./party";
import { buildReplay, summarize, type Replay, type Summary } from "./replay";
import { resolveEnemies, STAGES } from "./stages";
import { startTutorial, type TutorialState } from "./tutorial";

export const START_POOL = 4;

export type Screen = "title" | "reveal" | "prep" | "fight" | "result" | "victory";

export interface Fought { result: BattleResult; replay: Replay; summary: Summary }

export interface RunState {
  screen: Screen;
  seed: number;
  /** Every hero in rolled order: the pool is its start, the next one is the next recruit. */
  order: string[];
  pool: PoolHero[];
  leader: string | null;
  stage: number;
  attempt: number;
  /** Heroes the reveal screen shows as new. */
  fresh: string[];
  enemy: BattleSide | null;
  fought: Fought | null;
  tutorial: TutorialState | null;
}

export const titleState = (): RunState => ({
  screen: "title", seed: 0, order: [], pool: [], leader: null, stage: 0, attempt: 0, fresh: [], enemy: null, fought: null, tutorial: null,
});

export function startRun(pack: Pack, seed: number, guided: boolean): RunState {
  const order = rollOrder(pack, seed);
  const pool = autoField(pack, order.slice(0, START_POOL).map((id) => poolHero(pack, id)));
  return { ...titleState(), screen: "reveal", seed, order, pool, leader: pickLeader(pool), fresh: order.slice(0, START_POOL), tutorial: guided ? startTutorial() : null };
}

export const poolIds = (s: RunState): string[] => s.pool.map((h) => h.entry.char_id);

/** Free reroll of the starting pool: a new seed rolls a new order, and the recruits, enemies and battles follow it. */
export function rerollStart(pack: Pack, s: RunState, seed: number): RunState {
  if (s.stage !== 0) return s;
  const order = rollOrder(pack, seed);
  const pool = autoField(pack, order.slice(0, START_POOL).map((id) => poolHero(pack, id)));
  return { ...s, seed, order, pool, leader: pickLeader(pool), fresh: order.slice(0, START_POOL) };
}

export const toPrep = (pack: Pack, s: RunState): RunState => ({ ...s, screen: "prep", fresh: [], fought: null, enemy: resolveEnemies(pack, s.seed, s.stage, poolIds(s)) });

/** Keeps the leader valid after a move: a benched leader hands over, a first fielded hero takes it. */
const withLeader = (s: RunState, pool: PoolHero[]): RunState => {
  const stays = pool.some((h) => h.slot && h.entry.char_id === s.leader);
  return { ...s, pool, leader: stays ? s.leader : pickLeader(pool) };
};

export const moveTo = (pack: Pack, s: RunState, id: string, to: Slot | null): RunState => withLeader(s, moveHero(pack, s.pool, id, to));

/** Fields a benched hero on the first free slot, or benches a fielded one. */
export function toggleField(pack: Pack, s: RunState, id: string): RunState {
  const h = s.pool.find((x) => x.entry.char_id === id);
  return moveTo(pack, s, id, h?.slot ? null : freeSlot(pack, s.pool, id));
}

export const setLeader = (s: RunState, id: string): RunState => (s.pool.some((h) => h.slot && h.entry.char_id === id) ? { ...s, leader: id } : s);

export const setSheet = (s: RunState, id: string, sheet: Tactic[]): RunState => ({
  ...s, pool: s.pool.map((h) => (h.entry.char_id === id ? { ...h, entry: { ...h.entry, tactic_sheet: sheet } } : h)),
});

/** Why Fight is off, or null when the battle can start. */
export function fightBlocker(pack: Pack, s: RunState): string | null {
  const n = s.pool.filter((h) => h.slot).length;
  if (n === 0) return "Field at least one hero";
  if (n > pack.rules.draft.fielded) return `Field at most ${pack.rules.draft.fielded} heroes`;
  if (!s.leader) return "Choose a leader";
  return null;
}

export function fight(pack: Pack, s: RunState): RunState {
  if (fightBlocker(pack, s)) return s;
  const battle = buildBattle(pack, { seed: s.seed, stage: s.stage, attempt: s.attempt, pool: s.pool, leader: s.leader!, enemy: s.enemy! });
  const result = runBattle(pack, battle);
  const replay = buildReplay(result.events);
  return { ...s, screen: "fight", fought: { result, replay, summary: summarize(replay) } };
}

export const toResult = (s: RunState): RunState => ({ ...s, screen: "result" });

/** After the result: a loss retries the stage, a win recruits and moves on, the last win ends the run. */
export function afterResult(pack: Pack, s: RunState): RunState {
  if (!s.fought?.summary.won) return toPrep(pack, { ...s, attempt: s.attempt + 1 });
  if (s.stage + 1 >= STAGES.length) return { ...s, screen: "victory" };
  const id = s.order[s.pool.length]!;
  return { ...s, screen: "reveal", stage: s.stage + 1, attempt: 0, pool: [...s.pool, poolHero(pack, id)], fresh: [id], fought: null, tutorial: null };
}
