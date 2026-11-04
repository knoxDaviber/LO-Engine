// The run state machine: plain functions from state to state. The UI holds one RunState and calls these. Pure: no DOM.
import { runBattle, type BattleResult } from "../../src/engine";
import type { BattleSide, Tactic } from "../../src/schema";
import type { Pack } from "../../src/validate/pack";
import { buildBattle } from "./battle";
import { autoField, freeSlot, mix, moveHero, mulberry, pickLeader, poolHero, rollOrder, shuffled, type PoolHero, type Slot } from "./party";
import { buildReplay, summarize, type Replay, type Summary } from "./replay";
import { resolveEnemies, stagesOf, type Mode } from "./stages";
import { startTutorial, type TutorialState } from "./tutorial";

export const START_POOL = 4;
export const ROGUE_START_POOL = 2;
const startPool = (mode: Mode) => (mode === "rogue" ? ROGUE_START_POOL : START_POOL);

export type Screen = "title" | "reveal" | "prep" | "fight" | "result" | "victory";

export interface Fought { result: BattleResult; replay: Replay; summary: Summary }

export interface RunState {
  screen: Screen;
  mode: Mode;
  seed: number;
  /** Every hero in rolled order: the pool is its start, the next one is the next recruit. */
  order: string[];
  pool: PoolHero[];
  leader: string | null;
  /** Rogue mode: heroes lost for good, in order of death. */
  fallen: string[];
  /** Rogue mode: hero id to HP percent left going into the next battle; absent means full. Squads refill, only hero HP carries. */
  wounds: Record<string, number>;
  /** Rogue: the two heroes the player picks one recruit from, after a win. */
  offers: string[];
  stage: number;
  attempt: number;
  /** Heroes the reveal screen shows as new. */
  fresh: string[];
  enemy: BattleSide | null;
  fought: Fought | null;
  tutorial: TutorialState | null;
}

export const titleState = (): RunState => ({
  screen: "title", mode: "tutorial", fallen: [], wounds: {}, offers: [], seed: 0, order: [], pool: [], leader: null, stage: 0, attempt: 0, fresh: [], enemy: null, fought: null, tutorial: null,
});

export function startRun(pack: Pack, seed: number, guided: boolean, mode: Mode = "tutorial"): RunState {
  const order = rollOrder(pack, seed);
  const pool = autoField(pack, order.slice(0, startPool(mode)).map((id) => poolHero(pack, id)));
  return { ...titleState(), screen: "reveal", mode, seed, order, pool, leader: pickLeader(pool), fresh: order.slice(0, startPool(mode)), tutorial: guided ? startTutorial() : null };
}

export const poolIds = (s: RunState): string[] => s.pool.map((h) => h.entry.char_id);

/** Free reroll of the starting pool: a new seed rolls a new order, and the recruits, enemies and battles follow it. */
export function rerollStart(pack: Pack, s: RunState, seed: number): RunState {
  if (s.stage !== 0) return s;
  const order = rollOrder(pack, seed);
  const pool = autoField(pack, order.slice(0, startPool(s.mode)).map((id) => poolHero(pack, id)));
  return { ...s, seed, order, pool, leader: pickLeader(pool), fresh: order.slice(0, startPool(s.mode)) };
}

export const toPrep = (pack: Pack, s: RunState): RunState => ({ ...s, screen: "prep", fresh: [], fought: null, enemy: resolveEnemies(pack, s.seed, s.stage, poolIds(s), s.mode) });

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
  const battle = buildBattle(pack, { seed: s.seed, stage: s.stage, attempt: s.attempt, pool: s.pool, leader: s.leader!, enemy: s.enemy!, mode: s.mode, wounds: s.wounds });
  const result = runBattle(pack, battle);
  const replay = buildReplay(result.events);
  return { ...s, screen: "fight", fought: { result, replay, summary: summarize(replay) } };
}

export const toResult = (s: RunState): RunState => ({ ...s, screen: "result" });

/** Rogue: the fielded heroes dead at the last beat of the fought battle (benched heroes never fought). */
export const fellInBattle = (s: RunState): string[] => {
  const last = s.fought?.replay.beats.at(-1)?.units ?? [];
  return poolIds(s).filter((id) => last.some((u) => u.id === id && !u.alive));
};

/** Rogue: heroes still in the company once this battle's dead are out. Zero ends the run. */
export const companyLeft = (s: RunState): string[] => poolIds(s).filter((id) => !fellInBattle(s).includes(id));

/** Rogue: the dead leave the pool for good; a win offers two of the heroes not owned or fallen (none left: straight to prep), a loss retries with the survivors. */
function afterRogue(pack: Pack, s: RunState): RunState {
  const dead = fellInBattle(s);
  const pool = s.pool.filter((h) => !dead.includes(h.entry.char_id));
  const lined = pool.some((h) => h.slot) ? pool : autoField(pack, pool); // only the bench survived: field them
  const last = s.fought!.replay.beats.at(-1)?.units ?? [];
  const wounds = { ...s.wounds }; // fielded survivors take their last HP (rounded up, so never 0); the bench and the recruits keep theirs
  for (const id of dead) delete wounds[id];
  for (const u of last) {
    if (!u.alive || !pool.some((h) => h.entry.char_id === u.id)) continue;
    const pct = Math.ceil((u.hp * 100) / u.maxHp);
    if (pct >= 100) delete wounds[u.id]; else wounds[u.id] = pct;
  }
  const base = withLeader({ ...s, pool: lined, fallen: [...s.fallen, ...dead], wounds, fought: null }, lined);
  if (pool.length === 0) return titleState();
  if (!s.fought!.summary.won) return toPrep(pack, { ...base, attempt: s.attempt + 1 });
  if (s.stage + 1 >= stagesOf(s).length) return { ...base, screen: "victory" };
  const next = { ...base, stage: s.stage + 1, attempt: 0 };
  const owned = [...poolIds(next), ...next.fallen];
  const offers = shuffled(s.order.filter((id) => !owned.includes(id)), mulberry(mix(s.seed, s.stage, 0xc))).slice(0, 2);
  return offers.length === 0 ? toPrep(pack, next) : { ...next, screen: "reveal", offers, fresh: offers };
}

/** Rogue: the player's pick of the offered heroes joins (fielded on a free slot while the team is short) and the next wave's prep opens. */
export function pickRecruit(pack: Pack, s: RunState, id: string): RunState {
  if (!s.offers.includes(id)) return s;
  const joined = { ...s, pool: [...s.pool, poolHero(pack, id)], offers: [] };
  const slot = s.pool.filter((h) => h.slot).length < pack.rules.draft.fielded ? freeSlot(pack, joined.pool, id) : null;
  return toPrep(pack, slot ? moveTo(pack, joined, id, slot) : joined);
}

/** After the result: a loss retries the stage, a win recruits and moves on, the last win ends the run. */
export function afterResult(pack: Pack, s: RunState): RunState {
  if (s.mode === "rogue") return afterRogue(pack, s);
  if (!s.fought?.summary.won) return toPrep(pack, { ...s, attempt: s.attempt + 1 });
  if (s.stage + 1 >= stagesOf(s).length) return { ...s, screen: "victory" };
  const id = s.order[s.pool.length]!;
  return { ...s, screen: "reveal", stage: s.stage + 1, attempt: 0, pool: [...s.pool, poolHero(pack, id)], fresh: [id], fought: null, tutorial: null };
}
