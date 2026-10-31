// Condition evaluator. Slice leaves: hp_percent, hp_current, hp_missing, unit_kind, row_is, class_is, has_status,
// lacks_status, phase. Groups all/any/not. Every other leaf is false with reason "not implemented: <type>".
//
// `side` resolution for a leaf:
//   self   -> the acting unit
//   target -> the candidate under evaluation (false + reason when the context has none)
//   ally / enemy -> with a candidate in context: the candidate, provided it is on that side of the actor (else false);
//                   without one (activation): true if any living unit on that side satisfies the leaf.
// Leaves without a `side` (unit_kind, row_is without side) test the candidate if present, else the actor.
import type { ConditionNode } from "../schema";
import type { BattleState, Unit } from "./state";
import { alliesOf, enemiesOf, otherSide, targetsOf } from "./state";

export interface CondContext {
  state: BattleState;
  self: Unit;
  target?: Unit | null;
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

const LEAVES: Record<string, LeafFn> = {
  hp_percent: (u, l) => compare(hpPercent(u), l.op, l.value),
  hp_current: (u, l) => compare(u.hp, l.op, l.value),
  hp_missing: (u, l) => compare(u.maxHp - u.hp, l.op, l.value),
  // is: hero|soldier keeps that kind; ignore: hero|soldier drops that kind. A squad is the "soldier" kind.
  unit_kind: (u, l) => {
    const kind = u.kind === "squad" ? "soldier" : "hero";
    return l.is !== undefined ? l.is === kind : l.ignore !== kind;
  },
  // front / back are hero rows; soldier_front / soldier_back are the soldier rows, which only a squad stands in.
  row_is: (u, l) => (u.kind === "squad" ? l.value === `soldier_${u.row}` : u.row === l.value),
  class_is: (u, l) => u.class === l.value,
  // Authored-only hero leaves (auras, 2.5). Squads are never "a hero"; party_has_hero is hero_is read over the ally pool (activation context).
  hero_is: (u, l) => u.kind === "hero" && u.charId === l.value,
  party_has_hero: (u, l) => u.kind === "hero" && u.charId === l.value,
  faction_is: (u, l) => u.kind === "hero" && u.factions.includes(l.value),
  has_status: (u, l) => u.statuses.some((s) => s.statusId === l.status_id),
  lacks_status: (u, l) => !u.statuses.some((s) => s.statusId === l.status_id),
};

function evalLeaf(leaf: Record<string, any>, ctx: CondContext): Inner {
  const type = leaf.type as string;
  if (type === "phase") return { value: compare(ctx.state.phase, leaf.op, leaf.value), reasons: [], unknown: false };
  const fn = LEAVES[type];
  if (!fn) return { value: false, reasons: [`not implemented: ${type}`], unknown: true };
  const side: string | undefined = leaf.side;
  const cand = ctx.target ?? null;
  if (side === undefined) return { value: fn(cand ?? ctx.self, leaf, ctx), reasons: [], unknown: false };
  if (side === "self") return { value: fn(ctx.self, leaf, ctx), reasons: [], unknown: false };
  if (side === "target") {
    if (!cand) return { value: false, reasons: [`${type}: side 'target' used with no target in context`], unknown: false };
    return { value: fn(cand, leaf, ctx), reasons: [], unknown: false };
  }
  // A candidate may be a squad (targets of its side include it); without a candidate (activation) only heroes are considered.
  const sideOf = side === "ally" ? ctx.self.side : otherSide(ctx.self.side);
  if (cand) return { value: targetsOf(ctx.state, sideOf).includes(cand) && fn(cand, leaf, ctx), reasons: [], unknown: false };
  const pool = side === "ally" ? alliesOf(ctx.state, ctx.self) : enemiesOf(ctx.state, ctx.self);
  return { value: pool.some((u) => fn(u, leaf, ctx)), reasons: [], unknown: false };
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
