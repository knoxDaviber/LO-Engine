// Event bus (design Section 14, roadmap 2.3): a typed, synchronous bus. Subscribers (soldier skills now, leader auras in 2.5, passives in 3a)
// register a handler with an owner and an order; the engine emits events from the damage, heal, death and phase paths.
//
// Events (the design doc names the system but not the list; this is the roadmap's list, [DEFAULT] payloads):
//   before_hit    before each hit's rolls            {attacker, defender, skillId, by?, soldier?}
//   after_hit     after each LANDED hit is applied   {attacker, defender, skillId, amount, killed, by?, soldier?}   (a miss emits nothing)
//   after_action  after an action's effects and status ticks, before rescheduling   {actor, skillId (null for idle and squad attacks), idle, hit}
//   on_death      a hero died or a squad was wiped out (single soldier deaths are not events)   {unit, killer}
//   phase_start   once per phase, after the phase set-up is logged   {phase}
//
// Rules:
//  - Order: handlers run by (order ascending, registration sequence), so dispatch is deterministic. Soldier skills use order 100, engine system handlers 0.
//  - Per-hit-once (design Section 7): a handler fires AT MOST ONCE per attacking action per affected unit (the defender for hit events, the actor for
//    after_action, the dead unit for on_death). A 10-hit squad attack therefore triggers an after_hit handler once per defender hit, not 10 times.
//    The key is (action id, event, handler, affected unit); actions are numbered by `beginAction`.
//  - A handler whose owner is dead does not fire. `owner: null` is an engine handler that is always on.
//  - Handlers' effects run through the normal effect executor. Events raised while a handler runs are NOT dispatched ([DEFAULT]: reactions
//    never trigger reactions), which also rules out loops.
//  - Every fire is logged as a `trigger` event (source, event, effect) before the handler runs.
import type { ExecCtx } from "./damage";
import { at } from "./log";
import type { Unit } from "./state";

export const EVENT_NAMES_BUS = ["before_hit", "after_hit", "after_action", "on_death", "phase_start"] as const;
export type BusEvent = (typeof EVENT_NAMES_BUS)[number];

export interface HitRef {
  attacker: Unit;
  defender: Unit;
  skillId: string;
  by?: number; // attacking squad soldier index
  soldier?: number; // defending squad soldier index
}

export interface BusPayloads {
  before_hit: HitRef;
  after_hit: HitRef & { amount: number; killed: boolean };
  after_action: { actor: Unit; skillId: string | null; idle: boolean; hit: Unit[] };
  on_death: { unit: Unit; killer: Unit | null };
  phase_start: { phase: number };
}

export interface Handler<E extends BusEvent = BusEvent> {
  event: E;
  /** Label shown as the trigger's source detail; also part of the once-key. */
  id: string;
  owner: Unit | null;
  order: number;
  /** What the handler does, for the log (e.g. "heal"). */
  effect: string;
  /** Cheap filter; the once-key is only spent when it returns true. */
  match?: (p: BusPayloads[E]) => boolean;
  run: (p: BusPayloads[E], x: ExecCtx) => void;
}

/** The unit an event is "about", for the once-per-action rule. */
function subjectOf<E extends BusEvent>(event: E, p: BusPayloads[E]): Unit | null {
  switch (event) {
    case "before_hit":
    case "after_hit":
      return (p as HitRef).defender;
    case "after_action":
      return (p as BusPayloads["after_action"]).actor;
    case "on_death":
      return (p as BusPayloads["on_death"]).unit;
    default:
      return null;
  }
}

export class EventBus {
  private handlers: (Handler<any> & { seq: number })[] = [];
  private seq = 0;
  private fired = new Set<string>();
  private depth = 0;
  /** Id of the current attacking action (0 before the first). */
  actionId = 0;
  /** Distinct units that took a landed hit in the current action, in order. */
  hitUnits: Unit[] = [];

  subscribe<E extends BusEvent>(h: Handler<E>): void {
    this.handlers.push({ ...h, seq: this.seq++ });
    this.handlers.sort((a, b) => a.order - b.order || a.seq - b.seq);
  }

  handlerCount(): number {
    return this.handlers.length;
  }

  /** Starts a new attacking action: per-hit-once bookkeeping restarts. */
  beginAction(): void {
    this.actionId++;
    this.hitUnits = [];
  }

  emit<E extends BusEvent>(x: ExecCtx, event: E, payload: BusPayloads[E]): void {
    if (this.depth > 0) return; // reactions never trigger reactions
    if (event === "after_hit") {
      const d = (payload as BusPayloads["after_hit"]).defender;
      if (!this.hitUnits.includes(d)) this.hitUnits.push(d);
    }
    const subject = subjectOf(event, payload);
    for (const h of this.handlers) {
      if (h.event !== event) continue;
      if (h.owner && !h.owner.alive) continue;
      if (h.match && !h.match(payload)) continue;
      const key = `${this.actionId}|${event}|${h.seq}|${subject?.id ?? ""}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      x.log.emit({ type: "trigger", ...at(x.state), source: h.owner?.id ?? "engine", handler: h.id, event, subject: subject?.id ?? null, effect: h.effect });
      this.depth++;
      try {
        h.run(payload, x);
      } finally {
        this.depth--;
      }
    }
  }
}
