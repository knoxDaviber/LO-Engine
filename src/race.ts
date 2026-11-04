// Race lean (Decision 148): a hero's base stats are its authored ones plus its race's and sub-race's flat lean from rules.races / rules.sub_races.
// Pure, so the engine state and the draft read the same numbers.
import type { Character } from "./schema/content";
import type { Stat } from "./schema/enums";
import { STATS } from "./schema/enums";
import type { Rules } from "./schema/rules";

export function leanedBase(rules: Pick<Rules, "races" | "sub_races">, ch: Pick<Character, "race" | "sub_race" | "base_stats">): Record<Stat, number> {
  const out = { ...ch.base_stats } as Record<Stat, number>;
  for (const e of [rules.races[ch.race], ch.sub_race ? rules.sub_races[ch.sub_race] : undefined]) if (e) for (const s of STATS) out[s] += e.lean[s] ?? 0;
  return out;
}
