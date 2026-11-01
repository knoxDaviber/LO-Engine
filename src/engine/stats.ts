// Effective stats with the Section 9.1 stacking rules.
//   result = (base + flat) * multiplier
//   flat       = equipment flat lines + flat status modifiers (all add)
//   multiplier = product over stacking groups of (1 + value/100)
// A stacking group is (stat, source category, buff|debuff). Inside a group the strongest percent wins and the rest are
// suppressed (kept on the unit, they resume when the winner goes away). Unique statuses are exempt: each multiplies on its own.
import type { SourceCategory, Stat, Status } from "../schema";
import { STATS } from "../schema";
import type { Pack } from "../validate/pack";
import type { BattleState, StatusInstance, Unit } from "./state";

export interface StatEffect {
  status: string; // status id
  category: SourceCategory;
  mode: "flat" | "percent";
  value: number;
  unique: boolean;
  outcome: "winner" | "suppressed";
}

export interface StatBreakdown {
  stat: Stat;
  base: number;
  flat: number;
  effects: StatEffect[];
  multiplier: number;
  result: number;
}

export function statBreakdown(unit: Unit, stat: Stat, pack: Pick<Pack, "byId">): StatBreakdown {
  const effects: StatEffect[] = [];
  const groups = new Map<string, number[]>(); // group key -> indexes into effects (percent, non-unique)
  let flat = unit.equipFlat[stat];
  // Always-on modifiers that are not statuses (soldier skills) come first, as if applied before any status, and never count as unique.
  for (const m of unit.innate) {
    if (m.stat !== stat) continue;
    const e: StatEffect = { status: m.id, category: m.category, mode: m.mode, value: m.value, unique: false, outcome: "winner" };
    effects.push(e);
    if (m.mode === "flat") flat += m.value;
    else {
      const key = `${m.category}|${m.value < 0 ? "debuff" : "buff"}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(effects.length - 1);
    }
  }
  // A squad shares its leader's buffs and debuffs (design 2.1): the leader's status modifiers count for the squad too, stat modifiers only
  // (nothing else of a status exists in this function). A status the squad already carries in the same category is not counted twice.
  // Terrain is per class, not a buff: the squad gets its own terrain instances (by its soldier class), never its leader's.
  const lead = unit.leaderUnit && unit.leaderUnit.alive ? unit.leaderUnit : null;
  const shared = lead ? lead.statuses.filter((l) => l.category !== "terrain" && !unit.statuses.some((s) => s.statusId === l.statusId && s.category === l.category)) : [];
  const ordered = [...unit.statuses, ...shared].sort((a, b) => a.seq - b.seq);
  for (const inst of ordered) {
    const st = pack.byId.statuses.get(inst.statusId);
    if (!st && !inst.inline) continue;
    for (const m of inst.inline ? inst.inline.modifiers : st!.modifiers) {
      if (m.stat !== stat) continue;
      const unique = inst.inline ? false : st!.stacking.unique;
      const e: StatEffect = { status: inst.inline ? inst.statusId : st!.id, category: inst.category, mode: m.mode, value: m.value, unique, outcome: "winner" };
      effects.push(e);
      if (m.mode === "flat") flat += m.value;
      else if (!unique) {
        const key = `${inst.category}|${m.value < 0 ? "debuff" : "buff"}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(effects.length - 1);
      }
    }
  }
  for (const idxs of groups.values()) {
    let best = idxs[0]!;
    for (const i of idxs) if (Math.abs(effects[i]!.value) > Math.abs(effects[best]!.value)) best = i; // earlier wins ties
    for (const i of idxs) if (i !== best) effects[i]!.outcome = "suppressed";
  }
  let multiplier = 1;
  for (const e of effects) if (e.mode === "percent" && e.outcome === "winner") multiplier *= 1 + e.value / 100;
  const base = unit.baseStats[stat];
  return { stat, base, flat, effects, multiplier, result: Math.max(0, (base + flat) * multiplier) };
}

export const effectiveStat = (unit: Unit, stat: Stat, pack: Pick<Pack, "byId">): number => statBreakdown(unit, stat, pack).result;

export function allBreakdowns(unit: Unit, pack: Pick<Pack, "byId">): Record<Stat, StatBreakdown> {
  return Object.fromEntries(STATS.map((s) => [s, statBreakdown(unit, s, pack)])) as Record<Stat, StatBreakdown>;
}

// ------------------------------------------------------------------ applying and ticking statuses

export interface ApplyResult {
  applied: boolean;
  notes: string[]; // e.g. "not implemented: ..." reasons for the log
}

/**
 * Applies a status to a unit. `applierCategory` is the stacking category of whatever applied it; a status whose
 * source_category is "inherit" takes it (in the slice every applier is "active"). Reapplying the same status in the
 * same category refreshes it (or extends, per on_reapply); a different category coexists.
 */
export function applyStatus(state: BattleState, unit: Unit, statusId: string, applierCategory: SourceCategory, sourceUnitId: string): ApplyResult {
  const st = state.pack.byId.statuses.get(statusId) as Status | undefined;
  if (!st) return { applied: false, notes: [`unknown status ${statusId}`] };
  if (st.flags.delays_pending_action) {
    return { applied: false, notes: [`not implemented: ${st.name} pushback (rules.stun_pushback_counts is ${state.pack.rules.stun_pushback_counts ?? "null"})`] };
  }
  if (st.duration.unit === "instant") return { applied: false, notes: [`not implemented: instant status ${st.name}`] };
  const category: SourceCategory = st.source_category === "inherit" ? applierCategory : st.source_category;
  const count = st.duration.count;
  // Only the applier's own action is "the applying action"; a status put on another unit ticks on that unit's next own action.
  const skipTick = unit.id === sourceUnitId && !st.duration.applying_action_counts;
  const existing = unit.statuses.find((s) => s.statusId === statusId && s.category === category);
  if (existing) {
    existing.remaining = st.stacking.on_reapply === "extend" && existing.remaining !== null && count !== null ? existing.remaining + count : count;
    existing.skipNextTick = skipTick;
    existing.sourceUnitId = sourceUnitId;
    return { applied: true, notes: [`${st.name} refreshed (${category})`] };
  }
  const inst: StatusInstance = { statusId, category, sourceUnitId, remaining: count, skipNextTick: skipTick, seq: state.statusSeq++ };
  unit.statuses.push(inst);
  return { applied: true, notes: [] };
}

export function removeStatus(unit: Unit, statusId: string, category?: SourceCategory): void {
  unit.statuses = unit.statuses.filter((s) => !(s.statusId === statusId && (category === undefined || s.category === category)));
}

/**
 * Call when a unit finishes an action. Only an active skill use ends "turns" (affected_unit_actions); an idle action
 * does not. Statuses applied during this action skip this tick unless applying_action_counts is true.
 * Returns the ids of statuses that expired.
 */
export function completeAction(state: BattleState, unit: Unit, usedActiveSkill: boolean): string[] {
  if (!usedActiveSkill) return [];
  const expired: string[] = [];
  for (const inst of [...unit.statuses]) {
    const st = state.pack.byId.statuses.get(inst.statusId);
    if (!st || st.duration.unit !== "affected_unit_actions" || inst.remaining === null) continue;
    if (inst.skipNextTick) {
      inst.skipNextTick = false;
      continue;
    }
    inst.remaining -= 1;
    if (inst.remaining <= 0) {
      unit.statuses = unit.statuses.filter((s) => s !== inst);
      expired.push(inst.statusId);
    }
  }
  return expired;
}
