// Leader rules (design Section 2, roadmap 2.4). Aura content lives in prebattle.ts (2.5); leader death ends the aura through removeAuras.
//  - Leader front row: formation.ts (already). Leader stat modifiers reach the squad through `Unit.leaderUnit` in stats.ts (statuses only).
//  - Soft leader rule: when the leader dies its squad is removed at once (all soldiers dead, off the timeline, its soldier skills end),
//    the side's `auraActive` flag goes false, and the battle goes on. Soldiers are never a victory condition.
//  - Succession: between phases, a dead leader is replaced and the aura flag comes back; the squad does not (no respawn).
//    [DEFAULT] No leader line exists in the fixed 4-hero slice (it comes with the draft in 3e), so the line is the battle input's hero order: the
//    successor is the first living hero in it. [DEFAULT] The successor keeps its row (no re-placement mid-battle; edits come with 3e).
//  - Pairing penalties (Leon's SPD -20 with non-mounted soldiers): `restrictions.soldier.stat_penalties` of the LEADER, evaluated against the
//    soldier type of its deployed squad, applied as always-on flat/percent modifiers through the normal stat pipeline. [DEFAULT] Only the
//    leader has a deployed squad, so only the leader is penalised; a hero whose squad is not deployed is not.
import type { Battle, Character, ConditionNode, SoldierType } from "../schema";
import type { ExecCtx } from "./damage";
import type { EventSink } from "./log";
import { at } from "./log";
import type { BattleState, InnateModifier, Side, Unit } from "./state";
import { squadOf, syncSquad } from "./state";
import { unschedule } from "./timeline";
import { removeAuras } from "./prebattle";

export interface SideLeader {
  leaderId: string;
  /** True while the leader lives and leads. Set false on the leader's death, restored by succession at the next phase start. */
  auraActive: boolean;
}

/** Evaluates a pairing condition against the paired soldier type. Only `soldier_mounted` exists; anything else is false and reported. */
function pairingHolds(node: ConditionNode, st: SoldierType, unknown: string[]): boolean {
  const n = node as any;
  if ("all" in n) return (n.all as ConditionNode[]).every((c) => pairingHolds(c, st, unknown));
  if ("any" in n) return (n.any as ConditionNode[]).some((c) => pairingHolds(c, st, unknown));
  if ("not" in n) return !pairingHolds(n.not as ConditionNode, st, unknown);
  if (n.type === "soldier_mounted") return st.mounted === n.value;
  unknown.push(n.type);
  return false;
}

/** Always-on modifiers from the character's soldier stat penalties that apply to the pairing with `st`. */
export function pairingPenalties(ch: Character, st: SoldierType, notes: { unit: string; what: string }[]): InnateModifier[] {
  const out: InnateModifier[] = [];
  for (const p of ch.restrictions.soldier.stat_penalties) {
    const unknown: string[] = [];
    const holds = pairingHolds(p.when, st, unknown);
    for (const t of unknown) notes.push({ unit: ch.id, what: `not implemented: pairing condition ${t}` });
    if (holds) out.push({ id: `${ch.name} with ${st.name}`, stat: p.stat, mode: p.mode, value: p.value, category: "soldier" });
  }
  return out;
}

/** Removes the always-on soldier-skill modifiers a squad put on other units (leader / party targets). Used when the squad is removed or wiped. */
export function endSquadSkills(state: BattleState, squad: Unit): void {
  for (const u of state.units) u.innate = u.innate.filter((m) => m.from !== squad.id);
}

/** Soft leader rule. Call when a hero dies. Does nothing unless it was the side's active leader. */
export function onLeaderDeath(x: ExecCtx, dead: Unit): void {
  const { state, log } = x;
  const lead = state.leaders[dead.side];
  if (dead.kind !== "hero" || lead.leaderId !== dead.id || !lead.auraActive) return;
  lead.auraActive = false;
  const squad = squadOf(state, dead.side);
  let removed = false;
  if (squad && squad.alive) {
    for (const s of squad.soldiers) { s.hp = 0; s.alive = false; }
    syncSquad(squad);
    unschedule(state, squad);
    removed = true;
  }
  if (squad) endSquadSkills(state, squad);
  log.emit({ type: "leader_down", ...at(state), unit: dead.id, side: dead.side, squad_removed: removed, aura_active: false });
  removeAuras(state, log, dead.id); // the aura statuses it put on units end with it (2.5)
}

/** The side's leader line in the slice: the battle input's hero order. */
export const leaderLine = (battle: Battle, side: Side): string[] => battle[side].heroes.map((h) => h.char_id);

/**
 * Phase start: a dead leader is replaced by the first living hero of the leader line and the aura flag returns; a living leader just keeps
 * the flag on. The squad is never restored (it was copied dead from the previous phase). With no living hero the battle is already over.
 */
export function applySuccession(state: BattleState, prev: BattleState, battle: Battle, log: EventSink): void {
  for (const side of ["challenger", "defender"] as const) {
    const prevId = prev.leaders[side].leaderId;
    const cur = state.units.find((u) => u.id === prevId)!;
    const nextId = cur.alive ? prevId : leaderLine(battle, side).find((id) => state.units.some((u) => u.id === id && u.alive));
    if (!nextId) {
      state.leaders[side] = { leaderId: prevId, auraActive: false };
      continue;
    }
    // The state was rebuilt from the battle input, so the leader flag follows the carried-over leader, not the input's.
    for (const u of state.units) if (u.side === side && u.kind === "hero") u.isLeader = u.id === nextId;
    state.leaders[side] = { leaderId: nextId, auraActive: true };
    if (nextId === prevId) continue;
    log.emit({ type: "leader_succession", ...at(state), side, previous: prevId, leader: nextId, aura_active: true, squad: false });
  }
}
