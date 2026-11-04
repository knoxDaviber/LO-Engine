// Condition evaluator (design 4.3). Every LEAF_REGISTRY leaf evaluates; groups all/any/not. A leaf type outside the registry (never valid
// content) is false with reason "not implemented: <type>".
//
// `side` resolution for a leaf:
//   self   -> the acting unit
//   target -> the candidate under evaluation (false + reason when the context has none)
//   ally / enemy -> with a candidate in context: the candidate, provided it is on that side of the actor (else false);
//                   without one (activation): true if any living unit on that side satisfies the leaf.
// Leaves without a `side` (unit_kind, row_is / column_is / stat_compare without side, same_column_as, soldier_mounted, the ban leaves) test the
// candidate if present, else the actor. Count and battle leaves (enemies_alive, allies_alive, enemy_soldiers_remaining, phase, action_count)
// are about the actor and the board.
// Leaf meanings [DEFAULT where the design is silent]:
//   is_leader / not_leader   the side's CURRENT leader (state.leaders, after succession); a squad is never a leader
//   has_class_advantage      the unit's class beats `value` (rules.class_advantage); without value it beats the other unit of the pair: the
//                            actor when the unit is someone else ("class has advantage over me"), else the candidate (false without one)
//   column_is                hero column 1-3; a squad spans every column (true)
//   same_column_as           value names the reference unit: self (the actor), target (the candidate), attacker / event_unit (the event's);
//                            a squad shares every column. Any other value is false with a reason
//   has_any_debuff           a status of a debuff category (stats.ts DEBUFF_CATEGORIES) or an aura instance with a negative modifier
//   stat_compare             effective stat (stats.ts); active_pp / passive_pp the current pool (a squad has none: 0)
//   enemies_alive / allies_alive   living heroes (allies include the actor); enemy_soldiers_remaining: living soldiers of enemy squads
//   action_count             the actor's own completed actions this phase (skills and idles): "first action" = action_count = 0
//   has_any_buff / lacks_*   buff = a `buff`-category status or an aura instance with a positive modifier (debuff as above)
//   is_self / not_self       the unit is / is not the actor
//   always                   true (the default Main of skills that need no filter)
//   row_size / row_rank      living combatants (a hero 1, a squad its living soldiers) in the unit's board row on its side; row_rank compares
//                            with the side's non-empty board rows (ties count as both most and least)
//   column_full              a hero whose column holds a living hero in both hero rows of its side (a squad: false)
//   average_hp_percent       mean HP% over the unit's side, every living hero and every living soldier one entry
//   time_is / combatants / side_has   board leaves: battle time; living combatants of a side; any living unit (squads included) of the class /
//                            race on that side (present: false = none)
//   attacked_since_last_action  params filter the hits in the window (damage_type: hybrid matches either; shape: event_unit / attacker count as
//                            single, caster_row as row; by_class / by_race: the attacker's; a squad's race is human)
//   action_is_single_target  the unit is the current actor and its action is a single-target attack (EventBus.singleAttack, set by executeSkill
//                            for an active damage skill of shape single); false for squads, passives and reactions
//   soldier_mounted          the unit's deployed soldier type (a squad's own, a leader's squad's); no deployed squad: false
//   ban leaves               hero_class / hero_faction / leader_aura_type / has_skill_tag / cost read the hero's character and its computed
//                            roster cost; is_official compares with true (the engine only runs the official pack; heroes carry no origin)
// Event leaves (the EVENT_NAMES): in an event context (a passive's trigger) they judge that event from the actor's point of view by the
// predicates the passive triggers use (events.ts EVENT_SPECS). Outside an event (a tactic activation) they mean "since my last action": true
// when any event in the actor's window (EventBus.windowOf: from its last after_action on, reactions' events included) matches.
// was_attacked_since_last_action always reads the window (a hit aimed at the actor, landed or not).
import type { ConditionNode, Status } from "../schema";
import type { EventCtx, HitRef } from "./events";
import { EVENT_SPECS, eventAttacker, eventUnit } from "./events";
import { effectiveStat, isDebuffStatus } from "./stats";
import type { BattleState, Side, Unit } from "./state";
import { alliesOf, boardRank, enemiesOf, livingOf, otherSide, targetsOf } from "./state";

export interface CondContext {
  state: BattleState;
  self: Unit;
  target?: Unit | null;
  /** The event that triggered a passive, for event leaves. */
  event?: EventCtx;
}
export interface CondResult {
  value: boolean;
  reasons: string[];
}

export function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "=": return a === b;
    case "!=": return a !== b;
    default: return false;
  }
}

interface Inner extends CondResult {
  unknown: boolean; // contains a leaf we could not evaluate; `not` must not turn that into true
}

type LeafFn = (u: Unit, leaf: Record<string, any>, ctx: CondContext) => boolean;

const hpPercent = (u: Unit) => (u.maxHp > 0 ? (u.hp / u.maxHp) * 100 : 0);

const isLeader = (u: Unit, ctx: CondContext) => u.kind === "hero" && ctx.state.leaders[u.side].leaderId === u.id;
const beats = (ctx: CondContext, a: string, d: string) => ctx.state.pack.rules.class_advantage.some((p) => p.attacker === a && p.defender === d);
const character = (u: Unit, ctx: CondContext) => (u.kind === "hero" ? ctx.state.pack.byId.characters.get(u.charId) : undefined);
/** The unit's deployed soldier type id: a squad's own, a hero's squad when it leads one. */
const soldierTypeOf = (u: Unit, ctx: CondContext) =>
  u.kind === "squad" ? u.soldierTypeId : (ctx.state.units.find((v) => v.kind === "squad" && v.leaderId === u.id)?.soldierTypeId ?? null);

/** same_column_as reference unit; undefined for an unknown reference name. */
function columnRef(name: string, ctx: CondContext): Unit | null | undefined {
  switch (name) {
    case "self": return ctx.self;
    case "target": return ctx.target ?? null;
    case "attacker": return ctx.event ? eventAttacker(ctx.event) : null;
    case "event_unit": return ctx.event ? eventUnit(ctx.event) : null;
    default: return undefined;
  }
}

const LEAVES: Record<string, LeafFn> = {
  hp_percent: (u, l) => compare(hpPercent(u), l.op, l.value),
  hp_current: (u, l) => compare(u.hp, l.op, l.value),
  hp_missing: (u, l) => compare(u.maxHp - u.hp, l.op, l.value),
  // is: hero|soldier keeps that kind; ignore: hero|soldier drops that kind. A squad is the "soldier" kind.
  unit_kind: (u, l) => {
    const kind = u.kind === "squad" ? "soldier" : "hero";
    return l.is !== undefined ? l.is === kind : l.ignore !== kind;
  },
  is_leader: (u, _l, c) => isLeader(u, c),
  not_leader: (u, _l, c) => !isLeader(u, c),
  // front / back are hero rows; soldier_front / soldier_back are the soldier rows, which only a squad stands in.
  row_is: (u, l) => (u.kind === "squad" ? l.value === `soldier_${u.row}` : u.row === l.value),
  column_is: (u, l) => u.kind === "squad" || u.column === l.value,
  class_is: (u, l) => u.class === l.value,
  has_class_advantage: (u, l, c) => {
    if (l.value !== undefined) return beats(c, u.class, l.value);
    const other = u === c.self ? c.target : c.self;
    return !!other && other !== u && beats(c, u.class, other.class);
  },
  // Authored-only hero leaves (auras, 2.5). Squads are never "a hero"; party_has_hero is hero_is read over the ally pool (activation context).
  hero_is: (u, l) => u.kind === "hero" && u.charId === l.value,
  party_has_hero: (u, l) => u.kind === "hero" && u.charId === l.value,
  faction_is: (u, l) => u.kind === "hero" && u.factions.includes(l.value),
  soldier_mounted: (u, l, c) => {
    const id = soldierTypeOf(u, c);
    const st = id ? c.state.pack.byId.soldiers.get(id) : undefined;
    return st !== undefined && st.mounted === l.value;
  },
  action_is_single_target: (u, _l, c) => c.state.bus.singleAttack && c.state.bus.actor === u,
  has_status: (u, l) => u.statuses.some((s) => s.statusId === l.status_id),
  lacks_status: (u, l) => !u.statuses.some((s) => s.statusId === l.status_id),
  has_any_debuff: (u, _l, c) => hasDebuff(u, c),
  has_any_buff: (u, _l, c) => hasBuff(u, c),
  lacks_any_buff: (u, _l, c) => !hasBuff(u, c),
  lacks_any_debuff: (u, _l, c) => !hasDebuff(u, c),
  race_is: (u, l) => u.race === l.value,
  is_self: (u, _l, c) => u === c.self,
  not_self: (u, _l, c) => u !== c.self,
  always: () => true,
  row_size: (u, l, c) => compare(rowCount(c.state, u.side, boardRank(u)), l.op, l.value),
  row_rank: (u, l, c) => {
    // Among the side's non-empty board rows; ties count as both most and least.
    const counts = [0, 1, 2, 3].map((r) => rowCount(c.state, u.side, r)).filter((n) => n > 0);
    const mine = rowCount(c.state, u.side, boardRank(u));
    return mine === (l.value === "most" ? Math.max(...counts) : Math.min(...counts));
  },
  column_full: (u, _l, c) =>
    u.kind === "hero" && (["front", "back"] as const).every((row) => livingOf(c.state, u.side).some((h) => h.row === row && h.column === u.column)),
  average_hp_percent: (u, l, c) => {
    // [DEFAULT] every living hero and every living soldier counts as one unit.
    const pcts = targetsOf(c.state, u.side).flatMap((v) => (v.kind === "squad" ? v.soldiers.filter((s) => s.alive).map((s) => (s.hp / s.maxHp) * 100) : [hpPercent(v)]));
    return pcts.length > 0 && compare(pcts.reduce((a, b) => a + b, 0) / pcts.length, l.op, l.value);
  },
  stat_compare: (u, l, c) => compare(effectiveStat(u, l.stat, c.state.pack), l.op, l.value),
  active_pp: (u, l) => compare(u.pp.active.cur, l.op, l.value),
  passive_pp: (u, l) => compare(u.pp.passive.cur, l.op, l.value),
  // Ban-sheet leaves, read off the hero (draft is 3e; in battle they describe a candidate hero).
  hero_class: (u, l) => u.kind === "hero" && u.class === l.value,
  hero_faction: (u, l) => u.kind === "hero" && u.factions.includes(l.value),
  leader_aura_type: (u, l, c) => character(u, c)?.leader_aura.type === l.value,
  has_skill_tag: (u, l, c) => u.kind === "hero" && u.skills.some((id) => c.state.pack.byId.skills.get(id)?.tags.includes(l.value)),
  cost: (u, l) => u.kind === "hero" && compare(u.cost, l.op, l.value),
  is_official: (u, l) => u.kind === "hero" && l.value === true,
};

/** Living combatants: a hero counts 1, a squad its living soldiers. */
const combatantCount = (u: Unit): number => (u.kind === "squad" ? u.soldiers.filter((s) => s.alive).length : 1);
/** Living combatants in board row `rank` (boardRank) of a side. */
const rowCount = (state: BattleState, side: Side, rank: number): number =>
  targetsOf(state, side).filter((v) => boardRank(v) === rank).reduce((n, v) => n + combatantCount(v), 0);
const statusIs = (u: Unit, c: CondContext, inline: (v: number) => boolean, cat: (st: Status) => boolean) =>
  u.statuses.some((s) => {
    if (s.inline) return s.inline.modifiers.some((m) => inline(m.value));
    const st = c.state.pack.byId.statuses.get(s.statusId);
    return st !== undefined && cat(st);
  });
/** Debuff: a DEBUFF_CATEGORIES status or an aura with a negative modifier; buff: a `buff` status or an aura with a positive one. */
const hasDebuff = (u: Unit, c: CondContext) => statusIs(u, c, (v) => v < 0, isDebuffStatus);
const hasBuff = (u: Unit, c: CondContext) => statusIs(u, c, (v) => v > 0, (st) => st.category === "buff");
/** Shape family of an attacking skill's shape: event_unit / attacker are single-target, caster_row a row. */
const shapeFamily = (shape: string | undefined): string | undefined =>
  shape === "event_unit" || shape === "attacker" ? "single" : shape === "caster_row" ? "row" : shape;

/** Leaves about the actor and the board rather than a unit picked by `side`. */
const BOARD: Record<string, (leaf: Record<string, any>, ctx: CondContext) => boolean> = {
  phase: (l, c) => compare(c.state.phase, l.op, l.value),
  action_count: (l, c) => compare(c.self.actions, l.op, l.value),
  enemies_alive: (l, c) => compare(livingOf(c.state, otherSide(c.self.side)).length, l.op, l.value),
  allies_alive: (l, c) => compare(livingOf(c.state, c.self.side).length, l.op, l.value),
  time_is: (l, c) => c.state.time === l.value,
  combatants: (l, c) => compare(targetsOf(c.state, l.side === "ally" ? c.self.side : otherSide(c.self.side)).reduce((n, u) => n + combatantCount(u), 0), l.op, l.value),
  side_has: (l, c) => {
    const pool = targetsOf(c.state, l.side === "ally" ? c.self.side : otherSide(c.self.side));
    return pool.some((u) => (l.class !== undefined ? u.class === l.class : u.race === l.race)) === l.present;
  },
  // The actor was hit (aimed at, landed or not) since its last action by an attack matching every given param; hybrid matches either type.
  attacked_since_last_action: (l, c) =>
    c.state.bus.windowOf(c.self).some((e) => {
      if (!EVENT_SPECS.self_attacked!.match(c.self, e)) return false;
      const h = e.payload as HitRef;
      return (l.damage_type === undefined || h.damageType === l.damage_type || h.damageType === "hybrid") &&
        (l.shape === undefined || shapeFamily(h.shape) === l.shape) &&
        (l.by_class === undefined || h.attacker.class === l.by_class) &&
        (l.by_race === undefined || h.attacker.race === l.by_race);
    }),
  enemy_soldiers_remaining: (l, c) => {
    const squads = targetsOf(c.state, otherSide(c.self.side)).filter((u) => u.kind === "squad");
    return compare(squads.reduce((n, q) => n + q.soldiers.filter((s) => s.alive).length, 0), l.op, l.value);
  },
};

const ok = (value: boolean): Inner => ({ value, reasons: [], unknown: false });

function evalLeaf(leaf: Record<string, any>, ctx: CondContext): Inner {
  const type = leaf.type as string;
  const board = BOARD[type];
  if (board) return ok(board(leaf, ctx));
  if (type === "was_attacked_since_last_action") {
    return ok(ctx.state.bus.windowOf(ctx.self).some((e) => EVENT_SPECS.self_attacked!.match(ctx.self, e)));
  }
  const spec = EVENT_SPECS[type];
  if (spec) return ok(ctx.event ? spec.match(ctx.self, ctx.event) : ctx.state.bus.windowOf(ctx.self).some((e) => spec.match(ctx.self, e)));
  if (type === "same_column_as") {
    const ref = columnRef(leaf.value, ctx);
    if (ref === undefined) return { value: false, reasons: [`same_column_as: unknown reference '${leaf.value}' (self, target, attacker, event_unit)`], unknown: false };
    const u = ctx.target ?? ctx.self;
    return ok(!!ref && (u.kind === "squad" || ref.kind === "squad" || u.column === ref.column));
  }
  const fn = LEAVES[type];
  if (!fn) return { value: false, reasons: [`not implemented: ${type}`], unknown: true };
  const side: string | undefined = leaf.side;
  const cand = ctx.target ?? null;
  if (side === undefined) return ok(fn(cand ?? ctx.self, leaf, ctx));
  if (side === "self") return ok(fn(ctx.self, leaf, ctx));
  if (side === "target") {
    if (!cand) return { value: false, reasons: [`${type}: side 'target' used with no target in context`], unknown: false };
    return ok(fn(cand, leaf, ctx));
  }
  // A candidate may be a squad (targets of its side include it); without a candidate (activation) only heroes are considered.
  const sideOf = side === "ally" ? ctx.self.side : otherSide(ctx.self.side);
  if (cand) return ok(targetsOf(ctx.state, sideOf).includes(cand) && fn(cand, leaf, ctx));
  const pool = side === "ally" ? alliesOf(ctx.state, ctx.self) : enemiesOf(ctx.state, ctx.self);
  return ok(pool.some((u) => fn(u, leaf, ctx)));
}

function evalNode(node: ConditionNode, ctx: CondContext): Inner {
  const n = node as any;
  if ("all" in n) {
    const rs = (n.all as ConditionNode[]).map((c) => evalNode(c, ctx));
    return { value: rs.every((r) => r.value), reasons: rs.flatMap((r) => r.reasons), unknown: rs.some((r) => r.unknown) };
  }
  if ("any" in n) {
    const rs = (n.any as ConditionNode[]).map((c) => evalNode(c, ctx));
    return { value: rs.some((r) => r.value), reasons: rs.flatMap((r) => r.reasons), unknown: rs.some((r) => r.unknown) };
  }
  if ("not" in n) {
    const r = evalNode(n.not as ConditionNode, ctx);
    return { value: r.unknown ? false : !r.value, reasons: r.reasons, unknown: r.unknown };
  }
  return evalLeaf(n, ctx);
}

/** A null/undefined condition is "no condition": true. */
export function evaluateCondition(node: ConditionNode | null | undefined, ctx: CondContext): CondResult {
  if (!node) return { value: true, reasons: [] };
  const { value, reasons } = evalNode(node, ctx);
  return { value, reasons };
}
