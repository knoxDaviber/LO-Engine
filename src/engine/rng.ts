// Deterministic seeded PRNG (mulberry32). Every random roll in the engine goes through an Rng; never Math.random.
import type { Battle } from "../schema";

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** How many numbers have been drawn (useful for logs and tests). */
  readonly draws: number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  let draws = 0;
  const next = (): number => {
    draws++;
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    get draws() {
      return draws;
    },
  };
}

/** One stream per phase, seeded from battle.seeds[phase - 1] (phase is 1-based). */
export function phaseRng(battle: Pick<Battle, "seeds">, phase: number): Rng {
  const seed = battle.seeds[phase - 1];
  if (seed === undefined) throw new Error(`no seed for phase ${phase}`);
  return createRng(seed);
}
