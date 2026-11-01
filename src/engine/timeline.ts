// Timeline scheduler (design Section 6). One pending entry per actor; the clock jumps to the earliest due entry.
import type { Pack } from "../validate/pack";
import { effectiveStat } from "./stats";
import type { BattleState, Side, TimelineEntry, Unit } from "./state";
import { getUnit, livingOf } from "./state";

/** interval = round(interval_constant / max(SPD, min_spd)). The one place SPD turns into counts. */
export function spdInterval(pack: Pick<Pack, "rules">, spd: number): number {
  const { interval_constant, min_spd } = pack.rules.timeline;
  return Math.round(interval_constant / Math.max(spd, min_spd));
}

const unitInterval = (state: BattleState, u: Unit): number => spdInterval(state.pack, effectiveStat(u, "SPD", state.pack));

/** Schedules every living unit's first action at interval (nobody acts at 0) and resets the clock. */
export function scheduleInitial(state: BattleState): void {
  const tl = state.timeline;
  tl.now = 0;
  tl.pending.clear();
  for (const u of state.units) if (u.alive) scheduleNext(state, u);
}

/** Puts the unit's next action `interval` counts after the current clock (plus any stun pushback waiting on the unit). Replaces any existing entry. */
export function scheduleNext(state: BattleState, u: Unit): TimelineEntry {
  const tl = state.timeline;
  const interval = unitInterval(state, u);
  // Pushback may be negative (advance_action while the unit had no pending entry); the action is never due before now.
  const due = Math.max(tl.now, tl.now + interval + (u.pushback ?? 0));
  const delay = due - tl.now - interval;
  u.pushback = 0;
  const entry: TimelineEntry = { unitId: u.id, due, interval, seq: ++tl.seqCounter, changed: false, ...(delay ? { delay } : {}) };
  tl.pending.set(u.id, entry);
  return entry;
}

/**
 * Stun (design Section 6): pushes the unit's pending action back by a fixed number of counts, whatever its SPD. No action or PP is lost.
 * With no pending entry (pre-battle, or the unit is mid-action), the pushback waits for its next schedule. Returns the new due, or null.
 */
export function delayPending(state: BattleState, u: Unit, counts: number): number | null {
  const e = state.timeline.pending.get(u.id);
  if (!e) {
    u.pushback = (u.pushback ?? 0) + counts;
    return null;
  }
  e.due += counts;
  e.delay = (e.delay ?? 0) + counts;
  return e.due;
}

/** advance_action: moves the pending action `counts` earlier, never before now (no entry: kept for the next schedule). Returns the new due, or null. */
export function advancePending(state: BattleState, u: Unit, counts: number): number | null {
  const e = state.timeline.pending.get(u.id);
  if (!e) {
    u.pushback = (u.pushback ?? 0) - counts;
    return null;
  }
  const due = Math.max(state.timeline.now, e.due - counts);
  e.delay = (e.delay ?? 0) - (e.due - due);
  e.due = due;
  return e.due;
}

export function unschedule(state: BattleState, u: Unit): void {
  state.timeline.pending.delete(u.id);
}

/**
 * Call after a unit's effective SPD may have changed. If the interval differs, the pending action is rescheduled
 * preserving the elapsed fraction of the interval. Returns true if the entry moved.
 */
export function rescheduleOnSpdChange(state: BattleState, u: Unit): boolean {
  const tl = state.timeline;
  const e = tl.pending.get(u.id);
  if (!e) return false;
  const interval = unitInterval(state, u);
  if (interval === e.interval) return false;
  const delay = e.delay ?? 0; // stun pushback is counts, not SPD: it carries over unscaled
  if (tl.now >= e.due - delay) return false; // the interval part is over, only pushback is left: SPD no longer matters
  const elapsed = tl.now - (e.due - delay - e.interval);
  const fraction = Math.min(1, Math.max(0, elapsed / e.interval));
  e.due = Math.max(tl.now, Math.round(tl.now + (1 - fraction) * interval) + delay); // a negative delay (advance_action) never goes before now
  e.interval = interval;
  e.seq = ++tl.seqCounter;
  e.changed = true;
  return true;
}

export function rescheduleAll(state: BattleState): void {
  for (const u of state.units) if (u.alive) rescheduleOnSpdChange(state, u);
}

function averageSkl(state: BattleState, side: Side): number {
  const hs = livingOf(state, side);
  return hs.length === 0 ? 0 : hs.reduce((n, u) => n + effectiveStat(u, "SKL", state.pack), 0) / hs.length;
}

/**
 * Orders two entries (negative = a acts first). A strict total order, as a lexicographic key:
 *   1. due count
 *   2. speed-changed entries before unchanged ones at the same due, and among changed entries FILO (higher seq, the later change, first).
 *      Section 6 only says "FILO for speed-change ties"; it does not rank a changed entry against an unchanged one. Choice: the
 *      changed entry goes first, which keeps the comparator transitive (a mixed pairwise rule is not).
 *   3. higher average SKL of living heroes (per side), then challenger
 *   4. formation order, then unit id
 */
export function compareEntries(state: BattleState, a: TimelineEntry, b: TimelineEntry): number {
  if (a.due !== b.due) return a.due - b.due;
  if (a.changed !== b.changed) return a.changed ? -1 : 1;
  if (a.changed && a.seq !== b.seq) return b.seq - a.seq;
  const ua = getUnit(state, a.unitId);
  const ub = getUnit(state, b.unitId);
  if (ua.side !== ub.side) {
    const d = averageSkl(state, ub.side) - averageSkl(state, ua.side); // higher average first
    if (d !== 0) return d;
    return ua.side === "challenger" ? -1 : 1;
  }
  if (ua.formationIndex !== ub.formationIndex) return ua.formationIndex - ub.formationIndex;
  return ua.id < ub.id ? -1 : ua.id > ub.id ? 1 : 0;
}

/** Pending entries in the order they will fire. */
export function pendingOrder(state: BattleState): TimelineEntry[] {
  return [...state.timeline.pending.values()].sort((a, b) => compareEntries(state, a, b));
}

/** Pops the earliest action: the clock jumps to its due count and the unit loses its pending entry (reschedule after it acts). */
export function nextAction(state: BattleState): { unit: Unit; due: number } | null {
  const first = pendingOrder(state)[0];
  if (!first) return null;
  state.timeline.pending.delete(first.unitId);
  state.timeline.now = first.due;
  return { unit: getUnit(state, first.unitId), due: first.due };
}
