// Event bus (design Section 14, roadmap 2.3): a typed, synchronous bus. Subscribers (soldier skills, leader auras, hero passives)
// register a handler with an owner and an order; the engine emits events from the damage, heal, death and phase paths.
//
// Events (the design doc names the system but not the list; this is the roadmap's list, [DEFAULT] payloads):
//   before_hit    before each hit's rolls            {attacker, defender, skillId, damageType, range, single, by?, soldier?, redirect?}
//   after_hit     after each LANDED hit is applied   {...the same, amount, killed, lost}   (a miss emits nothing; amount = raw damage, lost = HP removed)
//   after_heal    a living unit regained HP (> 0)    {caster, target, skillId, amount}
//   after_action  after an action's effects and status ticks, before rescheduling   {actor, skillId (null for idle and squad attacks), idle, hit}
//   on_death      a hero died or a squad was wiped out (single soldier deaths are not events)   {unit, killer}
//   phase_start   once per phase, after the phase set-up is logged   {phase}
// `single` is true for a single-target attack (skill shape single, event_unit or attacker; soldier basic attacks). A before_hit handler may set
// `redirect` (cover, roadmap 3a): the hit then lands on that unit instead (damage.ts rollOutcome).
//
// Content event names (EVENT_NAMES, passives and auras) map onto bus events through EVENT_SPECS below; the same predicates make the matching
// condition leaves true in that event's context (conditions.ts). Every emitted event is also recorded in `history` (reactions' too); outside an
// event, event leaves read a unit's window of it (`windowOf`: since its last after_action), roadmap 3a.
//
// Rules:
//  - Order: handlers run by (order ascending, registration sequence), so dispatch is deterministic. Soldier skills use order 100, engine system handlers 0.
//  - Per-hit-once (design Section 7): a handler fires AT MOST ONCE per attacking action per affected unit (the defender for hit events, the actor for
//    after_action, the dead unit for on_death). A multi-hit action (a row skill on several units) therefore triggers an after_hit handler once per defender hit.
//    The key is (action id, event, handler, affected unit); actions are numbered by `beginAction`.
//  - A handler whose owner is dead does not fire (unless it sets `evenIfOwnerDead`). `owner: null` is an engine handler that is always on.
//  - Handlers' effects run through the normal effect executor. Events raised while a handler runs are NOT dispatched ([DEFAULT]: reactions
//    never trigger reactions), which also rules out loops.
//  - Every fire is logged as a `trigger` event (source, event, effect) before the handler runs.
import type { ExecCtx } from "./damage";
import { at } from "./log";
import type { Unit } from "./state";

export const EVENT_NAMES_BUS = ["before_hit", "after_hit", "after_heal", "after_action", "on_death", "phase_start"] as const;
export type BusEvent = (typeof EVENT_NAMES_BUS)[number];

/** What an event predicate needs to know about a hit. Always set by the engine; optional for hand-built payloads. */
export interface HitMeta {
  damageType?: "physical" | "magical" | "hybrid";
  range?: "melee" | "ranged";
  single?: boolean;
  /** The attacking skill's target shape (attacked_since_last_action `shape`). */
  shape?: string;
}

export interface HitRef extends HitMeta {
  attacker: Unit;
  defender: Unit;
  skillId: string;
  by?: number; // attacking squad soldier index
  soldier?: number; // defending squad soldier index
}

export interface BusPayloads {
  before_hit: HitRef & { redirect?: Unit; covered?: boolean };
  /** `amount`: the hit's raw damage, the same for heroes and squads (a single-target squad hit's overflow chain included). `lost`: HP the
   * defender actually lost (a hero: min of its HP before and amount; a squad: summed over the soldiers hit, each counting at most the HP it had;
   * set by the engine, absent in hand-built payloads = amount). Reflect reads `lost`. */
  after_hit: HitRef & { amount: number; killed: boolean; lost?: number };
  after_heal: { caster: Unit; target: Unit; skillId: string; amount: number };
  after_action: { actor: Unit; skillId: string | null; idle: boolean; hit: Unit[] };
  on_death: { unit: Unit; killer: Unit | null };
  phase_start: { phase: number };
}

export interface Handler<E extends BusEvent = BusEvent> {
  event: E;
  /** Label shown as the trigger's source detail; also part of the once-key. */
  id: string;
  owner: Unit | null;
  /** Fires even when its owner is dead (devotion Mirror: the action that killed the wearer is still reflected). */
  evenIfOwnerDead?: boolean;
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
    case "after_heal":
      return (p as BusPayloads["after_heal"]).target;
    case "after_action":
      return (p as BusPayloads["after_action"]).actor;
    case "on_death":
      return (p as BusPayloads["on_death"]).unit;
    default:
      return null;
  }
}

/**
 * A reduce_damage effect in force. until: action = the current attacking action (this_attack); hit = until the unit takes a landed hit (every hit
 * of that attacking action is reduced, like until_next_hit statuses); own_action = until the unit's next own action ends; phase = the whole phase.
 */
export interface Reduction {
  unit: Unit;
  percent: number;
  appliesTo: "physical" | "magical" | "all";
  until: "action" | "hit" | "own_action" | "phase";
  /** Bus action id when it was applied (an own_action reduction set during the unit's own action outlasts that action). */
  actionId: number;
  /** next_hit: it reduced a landed hit; it ends when the next action begins. */
  hit?: boolean;
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
  /** The unit whose action is running (null before the first and in tests that start an action by hand). */
  actor: Unit | null = null;
  /** Active reduce_damage effects (damage.ts): `until` says when each ends (see beginAction and damage.ts finishAction). */
  reductions: Reduction[] = [];
  /** modify_pp once_per_attack: (skill, unit) keys already applied in the current action. */
  ppOnce = new Set<string>();
  /** Index into `history` where the current action began (devotion reactions read that action's hits, equipment.ts). */
  actionStart = 0;
  /** True while the current actor resolves a single-target attack (its own damage skill of shape single): action_is_single_target (3c). */
  singleAttack = false;
  /**
   * Every event emitted this phase, reactions' events included (they are recorded, just not dispatched). Event leaves outside an event
   * (conditions.ts) read a unit's window of it: from the unit's last after_action (inclusive) on, or the whole phase before its first action.
   */
  history: EventCtx[] = [];
  private since = new Map<Unit, number>();

  subscribe<E extends BusEvent>(h: Handler<E>): void {
    this.handlers.push({ ...h, seq: this.seq++ });
    this.handlers.sort((a, b) => a.order - b.order || a.seq - b.seq);
  }

  handlerCount(): number {
    return this.handlers.length;
  }

  /** Starts a new attacking action: per-hit-once bookkeeping restarts; this_attack reductions and next_hit ones that took a hit end. */
  beginAction(actor: Unit | null = null): void {
    this.actionId++;
    this.actor = actor;
    this.hitUnits = [];
    this.ppOnce.clear();
    this.actionStart = this.history.length;
    this.singleAttack = false;
    this.reductions = this.reductions.filter((r) => r.until !== "action" && !(r.until === "hit" && r.hit));
  }

  /** Runs `fn` as a reaction: events it raises are recorded but not dispatched (reactions never trigger reactions). */
  reacting<T>(fn: () => T): T {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }

  /** The events `u` has seen since its last action (its own after_action included), for event leaves outside an event. */
  windowOf(u: Unit): EventCtx[] {
    return this.history.slice(this.since.get(u) ?? 0);
  }

  emit<E extends BusEvent>(x: ExecCtx, event: E, payload: BusPayloads[E]): void {
    if (event === "after_action") this.since.set((payload as BusPayloads["after_action"]).actor, this.history.length);
    this.history.push({ bus: event, payload });
    if (this.depth > 0) return; // reactions never trigger reactions
    if (event === "after_hit") {
      const d = (payload as BusPayloads["after_hit"]).defender;
      if (!this.hitUnits.includes(d)) this.hitUnits.push(d);
    }
    const subject = subjectOf(event, payload);
    for (const h of this.handlers) {
      if (h.event !== event) continue;
      if (h.owner && !h.owner.alive && !h.evenIfOwnerDead) continue;
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

// ------------------------------------------------------------------ content event names

type HitEvent = "before_hit" | "after_hit";
/** An event as passives and condition leaves see it: the bus event and its payload. */
export interface EventCtx {
  bus: BusEvent;
  payload: BusPayloads[BusEvent];
}

/**
 * Content event names. `bus` "hit" means before_hit or after_hit, chosen by the passive's trigger_timing; the predicate then sees either.
 * [DEFAULT] "ally" excludes the unit itself and includes its own squad; "attacked" counts a hit aimed at the unit, landed or not (before_hit) or a
 * landed hit (after_hit); self_action_completed ignores idle actions (an aura opts in with trigger_includes_idle_action).
 */
export const EVENT_SPECS: Record<string, { bus: HitEvent | "hit" | "after_heal" | "after_action"; match: (self: Unit, e: EventCtx) => boolean }> = {
  self_targeted_by_physical_attack: { bus: "hit", match: (s, e) => isHit(e) && hit(e).defender === s && hit(e).damageType === "physical" },
  self_attacked: { bus: "hit", match: (s, e) => isHit(e) && hit(e).defender === s },
  unit_attacked: { bus: "hit", match: (_s, e) => isHit(e) },
  unit_hit_by_single_target_attack: { bus: "hit", match: (_s, e) => isHit(e) && hit(e).single === true },
  ally_attacked: { bus: "hit", match: (s, e) => isHit(e) && hit(e).defender !== s && hit(e).defender.side === s.side },
  just_healed: { bus: "after_heal", match: (s, e) => e.bus === "after_heal" && (e.payload as BusPayloads["after_heal"]).target === s },
  self_action_completed: { bus: "after_action", match: (s, e) => e.bus === "after_action" && (e.payload as BusPayloads["after_action"]).actor === s && !(e.payload as BusPayloads["after_action"]).idle },
  self_landed_single_target_hit: { bus: "after_hit", match: (s, e) => e.bus === "after_hit" && hit(e).attacker === s && hit(e).single === true },
  ally_landed_single_target_hit: {
    bus: "after_hit",
    match: (s, e) => e.bus === "after_hit" && hit(e).attacker !== s && hit(e).attacker.side === s.side && hit(e).single === true,
  },
  self_hit_by_melee: { bus: "hit", match: (s, e) => isHit(e) && hit(e).defender === s && hit(e).range === "melee" },
};

const isHit = (e: EventCtx): boolean => e.bus === "before_hit" || e.bus === "after_hit";
const hit = (e: EventCtx): HitRef => e.payload as HitRef;

/** The bus event a content event fires on. Hit events take the passive's timing; [DEFAULT] none given = before_hit. */
export function busEventFor(name: string, timing: HitEvent | null): BusEvent | null {
  const spec = EVENT_SPECS[name];
  if (!spec) return null;
  return spec.bus === "hit" ? (timing ?? "before_hit") : spec.bus;
}

/** event_unit / hit_unit: the defender of a hit, the healed unit, the actor of an action. */
export function eventUnit(e: EventCtx): Unit | null {
  switch (e.bus) {
    case "before_hit":
    case "after_hit": return hit(e).defender;
    case "after_heal": return (e.payload as BusPayloads["after_heal"]).target;
    case "after_action": return (e.payload as BusPayloads["after_action"]).actor;
    case "on_death": return (e.payload as BusPayloads["on_death"]).unit;
    default: return null;
  }
}

/** attacker: the attacker of a hit, the caster of a heal, the killer of a death. */
export function eventAttacker(e: EventCtx): Unit | null {
  switch (e.bus) {
    case "before_hit":
    case "after_hit": return hit(e).attacker;
    case "after_heal": return (e.payload as BusPayloads["after_heal"]).caster;
    case "on_death": return (e.payload as BusPayloads["on_death"]).killer;
    default: return null;
  }
}
