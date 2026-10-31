import { rowOverflows } from "../formation";
import { battleSchema } from "../schema";
import type { Collector, Tier } from "../types";
import type { Pack } from "./pack";
import { checkRosterHero } from "./roster";
import { reportZod } from "./schemaPass";

const SEED_LIMIT = 2 ** 32; // the rng does seed >>> 0

/** Validates a battle input (two fielded sides + per-phase seeds) against a content pack. Hero entries reuse the roster checks. */
export function validateBattle(raw: unknown, pack: Pack, c: Collector, opts: { file: string; tier: Tier }): void {
  const { file, tier } = opts;
  // A wrong seed count/value is its own stable code; pull it out of the generic schema report.
  const seeds = (raw as { seeds?: unknown } | null)?.seeds;
  const seedsOk = Array.isArray(seeds) && seeds.length === 3 && seeds.every((s) => Number.isInteger(s) && (s as number) >= 0 && (s as number) < SEED_LIMIT);
  if (raw && typeof raw === "object" && "seeds" in raw && !seedsOk) {
    c.error("E_BATTLE_SEEDS", "seeds must be exactly 3 integers in [0, 2^32), one per phase", { file, path: "seeds" });
    raw = { ...(raw as object), seeds: [0, 0, 0] };
  }
  const parsed = battleSchema.safeParse(raw);
  if (!parsed.success) return void reportZod(c, parsed.error.issues, { file });
  const b = parsed.data;
  const { fielded } = pack.rules.draft;

  const seen = new Map<string, string>(); // char_id -> side it was first seen on
  for (const side of ["challenger", "defender"] as const) {
    const s = b[side];
    if (s.heroes.length < 1 || s.heroes.length > fielded) {
      c.error("E_BATTLE_SIZE", `${side} fields ${s.heroes.length} heroes; must be between 1 and ${fielded}`, { file, path: `${side}.heroes` });
    }
    if (!s.heroes.some((h) => h.char_id === s.leader)) {
      c.error("E_BATTLE_LEADER", `${side} leader '${s.leader}' is not one of that side's heroes`, { file, path: `${side}.leader` });
    }
    s.heroes.forEach((h, i) => {
      const prev = seen.get(h.char_id);
      if (prev) {
        const where = prev === side ? "twice on " + side : "on both sides";
        c.error("E_BATTLE_DUP", `hero '${h.char_id}' appears ${where}`, { file, id: h.char_id, path: `${side}.heroes[${i}]` });
      }
      else seen.set(h.char_id, side);
      checkRosterHero(h, { file, id: h.char_id, path: `${side}.heroes[${i}]` }, pack, c, tier);
    });
  }
  // Row capacity, using the same placement the engine uses. Only meaningful once heroes resolve to known characters.
  for (const side of ["challenger", "defender"] as const) {
    if (!b[side].heroes.every((h) => pack.byId.characters.has(h.char_id))) continue;
    for (const row of rowOverflows(pack, b[side])) {
      c.error("E_BATTLE_ROW_FULL", `${side} ${row} row holds more than ${pack.rules.board.columns} heroes`, { file, path: `${side}.heroes` });
    }
  }
}
