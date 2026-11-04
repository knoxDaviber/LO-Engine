// Combat log (design Section 13): typed events in the order things happened, plus a text renderer.
//
// Determinism rules: no timestamps, no ids generated at run time, every event is built with a fixed key order, numbers
// that come from float math are rounded with r4() before they are logged. Two runs of the same battle give byte-identical JSON.
import type { Stat } from "../schema";
import type { Side } from "./state";

export type StatSummary = { base: number; flat: number; multiplier: number; result: number };

export interface SetupSquad {
  id: string;
  name: string;
  side: Side;
  leader: string;
  soldier_type: string;
  class: string;
  row: string; // soldier_front | soldier_back
  soldiers: number;
  soldier_hp: number; // per soldier
  stats: Record<Stat, StatSummary>; // per-soldier stats with the soldier-category skills applied
  breakdowns: Record<string, unknown>;
}

export interface SetupUnit {
  id: string;
  name: string;
  side: Side;
  class: string;
  row: string;
  column: number;
  leader: boolean;
  hp: number;
  max_hp: number;
  pp_active: number;
  pp_passive: number;
  stats: Record<Stat, StatSummary>; // full per-stat breakdown including winning and suppressed status effects
  breakdowns: Record<string, unknown>;
}

/** Position of an event in the battle. */
export interface Stamp {
  phase: number;
  t: number; // timeline count
}

export interface TacticEval {
  priority: number;
  skill: string;
  outcome: "chosen" | "skipped";
  reason: string;
}

/** Soldier fields of hit events: `soldier` = index of the squad soldier that was hit, `by` = index of the attacking squad soldier. */
export interface SoldierRef {
  soldier?: number;
  by?: number;
}

export type RollKind = "hit" | "crit" | "guard" | "status" | "heal";

export type BattleEvent =
  | { type: "battle_setup"; battle_id: string; seeds: number[]; units: SetupUnit[]; squads: SetupSquad[]; skills: { id: string; name: string }[]; statuses: { id: string; name: string }[] }
  | ({ type: "phase_start"; seed: number; units: { id: string; hp: number; max_hp: number; alive: boolean; pp_active: number }[]; squads: { id: string; alive: boolean; soldiers: number[] }[] } & Stamp)
  | ({ type: "schedule"; unit: string; due: number; interval: number; reason: "initial" | "next_action" | "spd_change" } & Stamp)
  | ({ type: "tactic_evaluation"; unit: string; evaluations: TacticEval[]; chosen: string | null } & Stamp)
  | ({ type: "target_selection"; unit: string; skill: string; targets: string[]; reason: string } & Stamp)
  | ({ type: "pp_spend"; unit: string; skill: string; pool: "active" | "passive"; cost: number; before: number; after: number } & Stamp)
  | ({ type: "roll"; unit: string; target: string; skill: string; kind: RollKind; chance: number; roll: number | null; result: boolean; note?: string } & SoldierRef & Stamp)
  | ({
      type: "damage"; unit: string; target: string; skill: string; power: number; defense: number; base: number; crit: boolean; guard: boolean;
      amount: number; hp_before: number; hp_after: number; reductions?: number[]; spill?: boolean;
      /** pool formula: summed bonus %, summed reduction % (guard + reduce_damage), the capped pool factor. hero_hits: the multiplier, when not 1. */
      bonus?: number; reduction?: number; pool?: number; hero_hits?: number;
    } & SoldierRef & Stamp)
  | ({ type: "heal"; unit: string; target: string; skill: string; amount: number; applied: number; hp_before: number; hp_after: number; share?: number; revived?: number } & Stamp)
  | ({ type: "status_applied"; unit: string; status: string; category: string; source: string; remaining: number | null; notes: string[] } & Stamp)
  | ({ type: "status_expired"; unit: string; status: string; reason: "duration" | "hit" | "death" | "condition" | "used" | "removed" } & Stamp)
  | ({ type: "status_blocked"; unit: string; status: string; source: string; by: string } & Stamp)
  | ({ type: "action_delayed"; unit: string; counts: number; due: number | null } & Stamp)
  | ({ type: "action_moved"; unit: string; source: string; skill: string; counts: number; due: number | null } & Stamp)
  | ({ type: "action_prevented"; unit: string; status: string } & Stamp)
  | ({ type: "pp_change"; unit: string; source: string; skill: string; pool: "active" | "passive"; amount: number; before: number; after: number } & Stamp)
  | ({ type: "self_hp_cost"; unit: string; skill: string; amount: number; hp_after: number } & Stamp)
  | ({ type: "death_intercepted"; unit: string; status: string; hp: number; soldier?: number } & Stamp)
  | ({ type: "death"; unit: string; killer: string | null; soldier?: number } & Stamp)
  | ({ type: "squad_attack"; unit: string; attackers: number } & Stamp)
  | ({ type: "idle"; unit: string } & Stamp)
  | ({ type: "trigger"; source: string; handler: string; event: string; subject: string | null; effect: string } & Stamp)
  | {
      type: "draft_step"; step: number; actor: Side; action: "ban" | "protect"; source: "human" | "rule_sheet"; side: Side; hero: string; by: string; name: string;
    }
  | { type: "draft_result"; side: Side; fielded: string[]; banned: string[]; protected: string[]; leader: string; anchor: string | null; moved: string[] }
  | ({ type: "edit"; side: Side; hero: string; fields: string[]; applied: boolean; note: string } & Stamp)
  | ({ type: "leader_down"; unit: string; side: Side; squad_removed: boolean; aura_active: boolean } & Stamp)
  | ({ type: "leader_succession"; side: Side; previous: string; leader: string; aura_active: boolean; squad: boolean } & Stamp)
  | ({ type: "aura_applied"; leader: string; aura: string; unit: string; status: string; category: "passive"; effect: string } & Stamp)
  | ({ type: "terrain_applied"; terrain: string; name: string; unit: string; status: string; category: "terrain"; effect: string } & Stamp)
  | ({ type: "equipment_applied"; unit: string; item: string; name: string; status: string; category: string; effect: string } & Stamp)
  | ({ type: "equipment_removed"; unit: string; item: string; name: string; status: string; reason: "condition" | "death" } & Stamp)
  | ({ type: "blessing_applied"; unit: string; name: string; status: string; category: string; effect: string; god: string } & Stamp)
  | ({ type: "blessing_removed"; unit: string; name: string; status: string; reason: "condition" | "death"; god: string } & Stamp)
  | ({ type: "aura_removed"; leader: string; aura: string; unit: string; status: string; reason: "leader_down" } & Stamp)
  | ({ type: "passive_blocked"; unit: string; skill: string; reason: string } & Stamp)
  | ({ type: "passive_ended"; unit: string; skill: string } & Stamp)
  | ({ type: "damage_reduction"; unit: string; source: string; skill: string; percent: number; applies_to: string; duration: string } & Stamp)
  | ({ type: "cover"; unit: string; ally: string; attacker: string; skill: string } & Stamp)
  | ({ type: "not_implemented"; unit: string | null; what: string } & Stamp)
  | ({ type: "phase_end"; reason: string; actions: number; skills: number; squad_actions: number; survivors: { challenger: number; defender: number } } & Stamp)
  | { type: "battle_end"; winner: Side; reason: string; phases: number };

export interface EventSink {
  emit(e: BattleEvent): void;
}

export class EventLog implements EventSink {
  readonly events: BattleEvent[] = [];
  emit(e: BattleEvent): void {
    this.events.push(e);
  }
}

export const nullSink: EventSink = { emit() {} };

export const at = (s: { phase: number; timeline: { now: number } }): Stamp => ({ phase: s.phase, t: s.timeline.now });

/** Rounds float noise out of logged numbers. */
export const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

// ------------------------------------------------------------------ text renderer

export function renderLog(events: BattleEvent[]): string {
  const units = new Map<string, string>();
  const skills = new Map<string, string>();
  const statuses = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "battle_setup") continue;
    for (const u of e.units) units.set(u.id, u.name);
    for (const u of e.squads) units.set(u.id, u.name);
    for (const s of e.skills) skills.set(s.id, s.name);
    for (const s of e.statuses) statuses.set(s.id, s.name);
  }
  for (const e of events) if (e.type === "draft_step" && !units.has(e.hero)) units.set(e.hero, e.name);
  const U = (id: string) => units.get(id) ?? id;
  const S = (id: string) => skills.get(id) ?? id;
  const ST = (id: string) => statuses.get(id) ?? id;
  skills.set("soldier_basic_attack", "basic attack");
  const out: string[] = [];
  const sol = (e: SoldierRef) => (e.soldier === undefined ? "" : ` soldier #${e.soldier + 1}`);
  const by = (e: SoldierRef) => (e.by === undefined ? "" : ` #${e.by + 1}`);
  const tag = (e: Stamp) => `[p${e.phase} t=${String(e.t).padStart(4, " ")}]`;
  let draftHeader = false;
  for (const e of events) {
    switch (e.type) {
      case "draft_step":
        if (!draftHeader) { out.push("=== Draft ==="); draftHeader = true; }
        out.push(`  step ${e.step}: ${e.actor} ${e.action === "ban" ? "bans" : "protects"} ${e.name} (${e.side}) [${e.by}]`);
        break;
      case "draft_result":
        out.push(`  ${e.side} fields ${e.fielded.map(U).join(", ")}; leader ${U(e.leader)}${e.anchor ? `; anchor ${U(e.anchor)}` : ""}; banned ${e.banned.map(U).join(", ") || "none"}${e.protected.length ? `; protected ${e.protected.map(U).join(", ")}` : ""}${e.moved.length ? `; moved to the other row (overflow) ${e.moved.map(U).join(", ")}` : ""}`);
        break;
      case "edit":
        out.push(`${tag(e)}   ${e.side} edit: ${U(e.hero)} ${e.fields.join(", ")}${e.applied ? "" : " NOT applied"}${e.note ? ` (${e.note})` : ""}`);
        break;
      case "battle_setup": {
        out.push(`=== Battle ${e.battle_id} (seeds ${e.seeds.join(", ")}) ===`);
        for (const u of e.units) {
          const st = (["HP", "ATK", "INT", "DEF", "MDEF", "SPD", "HIT", "SKL", "CRIT", "GUARD", "EVA"] as Stat[]).map((k) => `${k} ${u.stats[k].result}`).join(" ");
          out.push(`  ${u.side} ${u.name} (${u.class}, ${u.row} row ${u.column}${u.leader ? ", leader" : ""}) HP ${u.hp}/${u.max_hp} PP ${u.pp_active}/${u.pp_passive}`);
          out.push(`    ${st}`);
        }
        for (const q of e.squads) {
          const st = (["HP", "ATK", "DEF", "MDEF", "SPD", "HIT", "SKL", "CRIT", "GUARD", "EVA"] as Stat[]).map((k) => `${k} ${q.stats[k].result}`).join(" ");
          out.push(`  ${q.side} squad ${q.name} (${q.class}, ${q.row.replace("_", " ")} row, ${q.soldiers} soldiers x ${q.soldier_hp} HP)`);
          out.push(`    ${st} (per soldier)`);
        }
        break;
      }
      case "phase_start":
        out.push("", `=== Phase ${e.phase} (seed ${e.seed}) ===`);
        out.push(`  ${e.units.map((u) => `${U(u.id)} ${u.alive ? `${u.hp}/${u.max_hp} HP, ${u.pp_active} PP` : "dead"}`).join("; ")}`);
        for (const q of e.squads) out.push(`  ${U(q.id)}: ${q.alive ? `soldiers ${q.soldiers.map((h) => (h > 0 ? h : "x")).join(" ")}` : "wiped out"}`);
        break;
      case "schedule":
        out.push(`${tag(e)}   ${U(e.unit)} next action at ${e.due} (interval ${e.interval}, ${e.reason.replace("_", " ")})`);
        break;
      case "tactic_evaluation": {
        out.push(`${tag(e)} ${U(e.unit)} acts`);
        for (const ev of e.evaluations) out.push(`${tag(e)}   tactic #${ev.priority} ${S(ev.skill)}: ${ev.outcome === "chosen" ? "CHOSEN" : "skipped"} - ${ev.reason}`);
        if (e.evaluations.length === 0) out.push(`${tag(e)}   no tactics on the sheet`);
        break;
      }
      case "target_selection":
        out.push(`${tag(e)}   ${U(e.unit)} uses ${S(e.skill)} on ${e.targets.map(U).join(", ")} (${e.reason})`);
        break;
      case "pp_spend":
        out.push(`${tag(e)}   ${U(e.unit)} spends ${e.cost} ${e.pool} PP (${e.before} -> ${e.after})`);
        break;
      case "roll":
        out.push(`${tag(e)}   roll ${e.kind} ${U(e.unit)}${by(e)} -> ${U(e.target)}${sol(e)}: chance ${e.chance}%${e.roll === null ? "" : `, rolled ${e.roll}`} => ${e.result ? (e.kind === "hit" ? "HIT" : "yes") : e.kind === "hit" ? "MISS" : "no"}${e.note ? ` (${e.note})` : ""}`);
        break;
      case "damage":
        out.push(`${tag(e)}   ${U(e.unit)}${by(e)} deals ${e.amount} to ${U(e.target)}${sol(e)}${e.spill ? " (overflow)" : ""} (power ${e.power}, defense ${e.defense}, base ${e.base}${e.crit ? ", crit" : ""}${e.guard ? ", guarded" : ""}${e.reductions ? `, reduced ${e.reductions.map((r) => `${r}%`).join(" ")}` : ""}${e.pool !== undefined ? `, bonus ${e.bonus! >= 0 ? "+" : ""}${e.bonus}% reduction ${e.reduction}% -> x${e.pool}` : ""}${e.hero_hits !== undefined ? `, x${e.hero_hits} hero hits` : ""}) HP ${e.hp_before} -> ${e.hp_after}`);
        break;
      case "heal":
        out.push(`${tag(e)}   ${U(e.unit)} heals ${U(e.target)} for ${e.applied} (${e.amount} before cap${e.share === undefined ? "" : `; ${e.share} per soldier, ${e.revived} revived`}) HP ${e.hp_before} -> ${e.hp_after}`);
        break;
      case "status_applied":
        out.push(`${tag(e)}   ${U(e.unit)} gains ${ST(e.status)} (${e.category}${e.remaining === null ? "" : `, ${e.remaining} left`}) from ${U(e.source)}${e.notes.length ? `; ${e.notes.join("; ")}` : ""}`);
        break;
      case "status_expired":
        out.push(`${tag(e)}   ${U(e.unit)} loses ${ST(e.status)} (${e.reason})`);
        break;
      case "status_blocked":
        out.push(`${tag(e)}   ${U(e.unit)} resists ${ST(e.status)} from ${U(e.source)} (${ST(e.by)})`);
        break;
      case "action_delayed":
        out.push(`${tag(e)}   ${U(e.unit)} is stunned: pending action pushed back ${e.counts} counts${e.due === null ? " (applies to its next schedule)" : ` to ${e.due}`}`);
        break;
      case "action_moved":
        out.push(`${tag(e)}   ${U(e.unit)}'s pending action is ${e.counts > 0 ? "delayed" : "advanced"} ${Math.abs(e.counts)} counts by ${S(e.skill)}${e.due === null ? " (applies to its next schedule)" : ` to ${e.due}`}`);
        break;
      case "action_prevented":
        out.push(`${tag(e)} ${U(e.unit)} cannot act (${ST(e.status)})`);
        break;
      case "pp_change":
        out.push(`${tag(e)}   ${U(e.unit)} ${e.pool} PP ${e.amount > 0 ? "+" : ""}${e.amount} from ${S(e.skill)} (${e.before} -> ${e.after})`);
        break;
      case "self_hp_cost":
        out.push(`${tag(e)}   ${U(e.unit)} pays ${e.amount} HP for ${S(e.skill)} (HP ${e.hp_after})`);
        break;
      case "death_intercepted":
        out.push(`${tag(e)}   ${U(e.unit)}${sol(e)} would fall; ${ST(e.status)} revives it at ${e.hp} HP`);
        break;
      case "death":
        out.push(`${tag(e)}   ${U(e.unit)}${sol(e)} is ${e.soldier === undefined && e.unit.startsWith("squad_") ? "wiped out" : "defeated"}${e.killer ? ` by ${U(e.killer)}` : ""}`);
        break;
      case "squad_attack":
        out.push(`${tag(e)} ${U(e.unit)} attacks (${e.attackers} soldiers)`);
        break;
      case "idle":
        out.push(`${tag(e)}   ${U(e.unit)} idles`);
        break;
      case "trigger":
        out.push(`${tag(e)}   trigger ${e.event}: ${e.handler} (${e.source}) -> ${e.effect}${e.subject ? ` on ${U(e.subject)}` : ""}`);
        break;
      case "leader_down":
        out.push(`${tag(e)}   LEADER DOWN: ${U(e.unit)} (${e.side}); ${e.squad_removed ? "squad removed, " : ""}aura ends, the battle continues`);
        break;
      case "leader_succession":
        out.push(`${tag(e)}   ${e.side} succession: ${U(e.leader)} leads after ${U(e.previous)}; aura restored, no squad`);
        break;
      case "aura_applied":
        out.push(`${tag(e)}   AURA ${e.aura} (${U(e.leader)}): ${U(e.unit)} gets ${e.effect} (${e.category})`);
        break;
      case "terrain_applied":
        out.push(`${tag(e)}   TERRAIN ${e.name}: ${U(e.unit)} gets ${e.effect} (${e.category})`);
        break;
      case "equipment_applied":
        out.push(`${tag(e)}   EQUIPMENT ${e.name}: ${U(e.unit)} gets ${e.effect} (${e.category})`);
        break;
      case "equipment_removed":
        out.push(`${tag(e)}   EQUIPMENT ${e.name} ends on ${U(e.unit)} (${e.reason})`);
        break;
      case "blessing_applied":
        out.push(`${tag(e)}   BLESSING ${e.name}: ${U(e.unit)} gets ${e.effect} (${e.category})`);
        break;
      case "blessing_removed":
        out.push(`${tag(e)}   BLESSING ${e.name} ends on ${U(e.unit)} (${e.reason})`);
        break;
      case "aura_removed":
        out.push(`${tag(e)}   AURA ${e.aura} (${U(e.leader)}) ends on ${U(e.unit)} (${e.reason})`);
        break;
      case "passive_blocked":
        out.push(`${tag(e)}   ${U(e.unit)}: ${S(e.skill)} does not fire (${e.reason})`);
        break;
      case "passive_ended":
        out.push(`${tag(e)}   ${U(e.unit)}: ${S(e.skill)} ends (condition no longer holds)`);
        break;
      case "damage_reduction":
        out.push(`${tag(e)}   ${U(e.unit)} takes ${e.percent}% less ${e.applies_to} damage (${e.duration.replace(/_/g, " ")}, ${S(e.skill)})`);
        break;
      case "cover":
        out.push(`${tag(e)}   ${U(e.unit)} covers ${U(e.ally)}: ${U(e.attacker)}'s ${S(e.skill)} hits ${U(e.unit)} instead`);
        break;
      case "not_implemented":
        out.push(`${tag(e)}   ${e.unit ? `${U(e.unit)}: ` : ""}${e.what}`);
        break;
      case "phase_end":
        out.push(`--- Phase ${e.phase} ends: ${e.reason} after ${e.actions} actions, ${e.skills} skills${e.squad_actions ? `, ${e.squad_actions} squad attacks` : ""} (survivors: challenger ${e.survivors.challenger}, defender ${e.survivors.defender})`);
        break;
      case "battle_end":
        out.push("", `=== Battle over: ${e.winner} wins (${e.reason}) after ${e.phases} phase(s) ===`);
        break;
    }
  }
  return out.join("\n") + "\n";
}
