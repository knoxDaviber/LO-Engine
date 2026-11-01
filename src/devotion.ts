// Devotion (design Section 9A, roadmap 3c): the blessings a hero entry unlocks. Shared by the validator (cost) and the engine (equipment.ts).
// A hero entry names a god per equipment slot (`sigils`). A sigil counts only while its slot holds an item; an unknown god counts for nothing
// (E_REF_MISSING in the validator). 2 counted sigils of one god unlock its two_piece, 4 unlock two_piece AND four_piece; two gods at 2 + 2 each
// give their two_piece. The god list is open-ended (Decision 113): nothing here assumes a number of gods.
import type { Effect, God, RosterHero } from "./schema";
import type { Pack } from "./validate/pack";

export const SIGIL_SLOTS = ["weapon", "armor", "accessory_1", "accessory_2"] as const;

export interface Blessing {
  god: God;
  tier: 2 | 4;
  effects: Effect[];
}

/** Counted sigils per known god, in first-seen slot order. */
export function sigilCounts(pack: Pick<Pack, "byId">, entry: Pick<RosterHero, "equipment" | "sigils">): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of SIGIL_SLOTS) {
    const god = entry.sigils?.[slot];
    if (!god || !entry.equipment[slot] || !pack.byId.gods.has(god)) continue;
    counts.set(god, (counts.get(god) ?? 0) + 1);
  }
  return counts;
}

/** The blessing tiers the entry unlocks, per god in sigil order, 2-piece before 4-piece. */
export function unlockedBlessings(pack: Pick<Pack, "byId">, entry: Pick<RosterHero, "equipment" | "sigils">): Blessing[] {
  const out: Blessing[] = [];
  for (const [id, n] of sigilCounts(pack, entry)) {
    const god = pack.byId.gods.get(id)!;
    if (n >= 2) out.push({ god, tier: 2, effects: god.blessing.two_piece });
    if (n >= 4) out.push({ god, tier: 4, effects: god.blessing.four_piece });
  }
  return out;
}

/**
 * How the engine runs a blessing effect (engine/equipment.ts), or null when it cannot (the validator rejects it, E_EFFECT_TRIGGER):
 *   mod          modify_stat, no trigger / always (optionally with a condition)
 *   ignore_guard ignore_guard, no trigger / always
 *   reaction     reflect_damage (no trigger / always / on_event), or any other non-modify_stat effect with trigger on_event
 *   standing     reduce_damage with duration phase / battle, no trigger, no condition
 */
export function blessingKind(e: Effect): "mod" | "ignore_guard" | "reaction" | "standing" | null {
  const trig = e.trigger ?? "always";
  if (trig === "always" && e.type === "modify_stat") return "mod";
  if (trig === "always" && e.type === "ignore_guard") return "ignore_guard";
  if ((e.type === "reflect_damage" && trig === "always") || (trig === "on_event" && e.type !== "modify_stat")) return "reaction";
  if (trig === "always" && e.type === "reduce_damage" && !e.condition && (e.duration === "phase" || e.duration === "battle")) return "standing";
  return null;
}
