// Effective stats with the Section 9.1 stacking rules.
//   result = (base + flat) * multiplier
//   flat       = equipment flat lines (base, always add) + innate flat modifiers (add) + winning flat status modifiers
//   multiplier = product over stacking groups of (1 + value/100)
// A stacking group is (stat, source category, buff|debuff, flat|percent). Inside a group the strongest wins and the rest are
// suppressed (kept on the unit, they resume when the winner goes away). Unique statuses are exempt: each adds / multiplies on its own.
// INT/MDEF pairing (Decision 132): skill statuses, auras and soldier skills that modify ATK / DEF also modify INT / MDEF (withPairedStats).
// Exception (Decision 125): one god's blessing lines (`prayer:<god>:<tier>:<n>`) on the same stat, mode and sign add up into one prayer
// contribution (Full Moon 2- + DEF 4-piece: DEF +30%) before the strongest-wins; different gods still compete.
import type { SourceCategory, Stat, Status } from "../schema";
import { STATS } from "../schema";
import type { Pack } from "../validate/pack";
import type { BattleState, StatusInstance, Unit } from "./state";

/**
 * INT/MDEF pairing (Section 9.1, Decision 132, [DEFAULT] meaning of the designer's "skills or auras boosting ATK or DEF should also apply to INT
 * and MDEF"): a modifier on ATK from a skill status (active or passive), a leader aura or a soldier skill also applies the same mode and value to
 * INT, one on DEF also to MDEF, buffs and debuffs alike, unless the same source already has a line on the paired stat. Equipment lines, item
 * effects, blessings and terrain name their stats explicitly and are never paired. The paired line is an ordinary modifier of the same source
 * and category, so the 9.1 strongest-wins handles overlaps.
 */
export const PAIRED_STATS: Partial<Record<Stat, Stat>> = { ATK: "INT", DEF: "MDEF" };
/** Source categories of statuses whose modifiers are paired (skills: active / passive; soldier skills). Auras pair when they are built (prebattle.ts). */
export const PAIRING_CATEGORIES: readonly SourceCategory[] = ["active", "passive", "soldier"];

/** `mods` plus the paired INT / MDEF lines of its ATK / DEF lines (see PAIRED_STATS); a stat the source already names is not paired. */
export function withPairedStats<M extends { stat: Stat }>(mods: readonly M[]): M[] {
  const out = [...mods];
  for (const m of mods) {
    const p = PAIRED_STATS[m.stat];
    if (p && !mods.some((x) => x.stat === p)) out.push({ ...m, stat: p });
  }
  return out;
}

export interface StatEffect {
  status: string; // status id
  category: SourceCategory;
  mode: "flat" | "percent";
  value: number;
  unique: boolean;
  outcome: "winner" | "suppressed";
  /** A god's summed blessing lines (Decision 125): every contributing status id, in application order. */
  parts?: string[];
  /** Squads: the modifier comes from the leader's status (shared, design 2.1). */
  shared?: true;
}

export interface StatBreakdown {
  stat: Stat;
  base: number;
  flat: number;
  effects: StatEffect[];
  multiplier: number;
  result: number;
  /** Squads: the part of `flat` that comes from the leader's shared statuses (absent when 0). Counted once for the squad total (summedStat). */
  sharedFlat?: number;
}

export function statBreakdown(unit: Unit, stat: Stat, pack: Pick<Pack, "byId">): StatBreakdown {
  const effects: StatEffect[] = [];
  const groups = new Map<string, number[]>(); // group key -> indexes into effects (non-unique status modifiers and innate percents)
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
  // The leader's own equipment and blessing modifiers are its gear, not a buff: not shared either ([DEFAULT], like its flat lines).
  // Leader auras are not shared either: an aura reaches the squad only through its own targeting (include_soldiers, faction, filter), which
  // gives the squad its own instance (prebattle.ts auraTargets).
  const isShareable = (l: StatusInstance) => l.category !== "terrain" && !l.statusId.startsWith("equip:") && !l.statusId.startsWith("prayer:") && !l.statusId.startsWith("aura:");
  const shared = lead ? lead.statuses.filter((l) => isShareable(l) && !unit.statuses.some((s) => s.statusId === l.statusId && s.category === l.category)) : [];
  const sharedSet = new Set(shared);
  const ordered = [...unit.statuses, ...shared].sort((a, b) => a.seq - b.seq);
  const godSums = new Map<string, StatEffect>(); // `<god>|<category>|<mode>|<sign>` -> the god's summed effect for this stat
  for (const inst of ordered) {
    const st = pack.byId.statuses.get(inst.statusId);
    if (!st && !inst.inline) continue;
    const mods = inst.inline ? inst.inline.modifiers : PAIRING_CATEGORIES.includes(inst.category) ? withPairedStats(st!.modifiers) : st!.modifiers;
    for (const m of mods) {
      if (m.stat !== stat) continue;
      const unique = inst.inline ? false : st!.stacking.unique;
      const god = inst.statusId.startsWith("prayer:") ? inst.statusId.split(":")[1] : undefined;
      const godKey = god !== undefined ? `${god}|${inst.category}|${m.mode}|${m.value < 0 ? "-" : "+"}` : undefined;
      const sum = godKey !== undefined ? godSums.get(godKey) : undefined;
      if (sum) { sum.value += m.value; sum.parts!.push(inst.statusId); continue; } // the god's lines add (Decision 125)
      const e: StatEffect = { status: inst.inline ? inst.statusId : st!.id, category: inst.category, mode: m.mode, value: m.value, unique, outcome: "winner", ...(sharedSet.has(inst) ? { shared: true as const } : {}) };
      effects.push(e);
      if (godKey !== undefined) { e.parts = [inst.statusId]; godSums.set(godKey, e); }
      if (m.mode === "flat" && unique) flat += m.value;
      else if (!unique) {
        const key = `${inst.category}|${m.value < 0 ? "debuff" : "buff"}${m.mode === "flat" ? "|flat" : ""}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(effects.length - 1);
      }
    }
  }
  for (const idxs of groups.values()) {
    let best = idxs[0]!;
    for (const i of idxs) if (Math.abs(effects[i]!.value) > Math.abs(effects[best]!.value)) best = i; // earlier wins ties
    for (const i of idxs) if (i !== best) effects[i]!.outcome = "suppressed";
  }
  for (const idxs of groups.values()) for (const i of idxs) if (effects[i]!.mode === "flat" && effects[i]!.outcome === "winner") flat += effects[i]!.value;
  let multiplier = 1;
  for (const e of effects) if (e.mode === "percent" && e.outcome === "winner") multiplier *= 1 + e.value / 100;
  const base = unit.baseStats[stat];
  const sharedFlat = effects.reduce((n, e) => n + (e.shared && e.mode === "flat" && e.outcome === "winner" ? e.value : 0), 0);
  return { stat, base, flat, effects, multiplier, result: Math.max(0, (base + flat) * multiplier), ...(sharedFlat !== 0 ? { sharedFlat } : {}) };
}

/** How many units a stat sum covers (Decision 130): a squad's living soldiers (all have the same per-soldier stats), 1 for a hero. */
export const squadSize = (u: Unit): number => (u.kind === "squad" ? u.soldiers.filter((s) => s.alive).length : 1);

/**
 * The stat a unit attacks or defends with (Decision 130): a hero's effective stat; for a squad the sum over its living soldiers. [DEFAULT] Flat
 * lines shared from the leader's statuses count ONCE for the squad total, not per soldier (times the squad's multiplier, as flat lines come
 * before percentages): n x result - (n - 1) x sharedFlat x multiplier, at least 0.
 */
export function summedStat(unit: Unit, stat: Stat, pack: Pick<Pack, "byId">): number {
  const b = statBreakdown(unit, stat, pack);
  if (unit.kind !== "squad") return b.result;
  const n = squadSize(unit);
  if (n === 0) return 0;
  return Math.max(0, n * b.result - (n - 1) * (b.sharedFlat ?? 0) * b.multiplier);
}

export const effectiveStat = (unit: Unit, stat: Stat, pack: Pick<Pack, "byId">): number => statBreakdown(unit, stat, pack).result;

export function allBreakdowns(unit: Unit, pack: Pick<Pack, "byId">): Record<Stat, StatBreakdown> {
  return Object.fromEntries(STATS.map((s) => [s, statBreakdown(unit, s, pack)])) as Record<Stat, StatBreakdown>;
}

// ------------------------------------------------------------------ applying and ticking statuses

export interface ApplyResult {
  applied: boolean;
  notes: string[]; // e.g. "not implemented: ..." reasons for the log
  /** An `instant` status (Stun): its flags act once, nothing is stored on the unit. */
  instant?: boolean;
  /** The blocks_debuffs status (Immunity) that stopped this debuff. */
  blockedBy?: StatusInstance;
}

/** [DEFAULT] Status categories Immunity (blocks_debuffs) stops: debuffs, damage over time and control (Stun). */
export const DEBUFF_CATEGORIES: readonly string[] = ["debuff", "dot", "control"];
export const isDebuffStatus = (st: Pick<Status, "category">): boolean => DEBUFF_CATEGORIES.includes(st.category);

/** The unit's first blocks_debuffs status (Immunity), if any. A squad is not covered by its leader's Immunity (only stat modifiers are shared). */
export function immunityOf(state: BattleState, unit: Unit): StatusInstance | undefined {
  return unit.statuses.find((s) => state.pack.byId.statuses.get(s.statusId)?.flags.blocks_debuffs);
}

/** Flags the engine does not run yet, as "not implemented" notes. */
function unsupportedFlags(st: Status): string[] {
  const out: string[] = [];
  if (st.flags.overrides_targeting !== null && st.flags.overrides_targeting !== "random_any") out.push(`not implemented: ${st.name} overrides_targeting ${st.flags.overrides_targeting}`);
  return out;
}

/**
 * Applies a status to a unit. `applierCategory` is the stacking category of whatever applied it; a status whose
 * source_category is "inherit" takes it. Reapplying the same status in the same category refreshes it (or extends, per
 * on_reapply); a different category coexists. A debuff (DEBUFF_CATEGORIES) on a unit with Immunity is blocked (`blockedBy`).
 * An `instant` status is not stored (`instant`); the caller runs its one-off flags (Stun pushback, damage.ts).
 * `inAction` false (pre-battle passives) means there is no applying action, so nothing skips the wearer's first tick.
 */
export function applyStatus(state: BattleState, unit: Unit, statusId: string, applierCategory: SourceCategory, sourceUnitId: string, inAction = true): ApplyResult {
  const st = state.pack.byId.statuses.get(statusId) as Status | undefined;
  if (!st) return { applied: false, notes: [`unknown status ${statusId}`] };
  if (isDebuffStatus(st)) {
    const imm = immunityOf(state, unit);
    if (imm) return { applied: false, notes: [], blockedBy: imm };
  }
  const notes = unsupportedFlags(st);
  if (st.duration.unit === "instant") return { applied: true, notes, instant: true };
  const category: SourceCategory = st.source_category === "inherit" ? applierCategory : st.source_category;
  const count = st.duration.count;
  // Only the applier's own action is "the applying action"; a status put on another unit ticks on that unit's next own action.
  const skipTick = inAction && unit.id === sourceUnitId && !st.duration.applying_action_counts;
  const existing = unit.statuses.find((s) => s.statusId === statusId && s.category === category);
  if (existing) {
    existing.remaining = st.stacking.on_reapply === "extend" && existing.remaining !== null && count !== null ? existing.remaining + count : count;
    existing.skipNextTick = skipTick;
    existing.sourceUnitId = sourceUnitId;
    return { applied: true, notes: [...notes, `${st.name} ${st.stacking.on_reapply === "extend" ? "extended" : "refreshed"} (${category})`] };
  }
  const inst: StatusInstance = { statusId, category, sourceUnitId, remaining: count, skipNextTick: skipTick, seq: state.statusSeq++ };
  unit.statuses.push(inst);
  return { applied: true, notes };
}

export function removeStatus(unit: Unit, statusId: string, category?: SourceCategory): void {
  unit.statuses = unit.statuses.filter((s) => !(s.statusId === statusId && (category === undefined || s.category === category)));
}

/**
 * Call when a unit finishes an action. Only an active skill use ends "turns" (affected_unit_actions); an idle action
 * does not. Statuses applied during this action skip this tick unless applying_action_counts is true. `only` limits the tick to some
 * statuses (a prevented action ticks only the preventing ones). Returns the ids of statuses that expired.
 */
export function completeAction(state: BattleState, unit: Unit, usedActiveSkill: boolean, only?: (st: Status) => boolean): string[] {
  if (!usedActiveSkill) return [];
  const expired: string[] = [];
  for (const inst of [...unit.statuses]) {
    const st = state.pack.byId.statuses.get(inst.statusId);
    if (!st || st.duration.unit !== "affected_unit_actions" || inst.remaining === null || (only && !only(st))) continue;
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
