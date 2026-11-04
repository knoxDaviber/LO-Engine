// Turns the engine's event log into renderer-agnostic beats: one per action, phase change or battle end, each carrying what happened and every
// unit's state after it. Any renderer (React now, Godot later) just plays the list. Pure: no DOM.
import type { BattleEvent } from "../../src/engine/log";

export type SideName = "challenger" | "defender";

export interface UnitInfo {
  id: string; name: string; side: SideName; cls: string; kind: "hero" | "squad"; row: string; column: number;
  maxHp: number; ppActive: number; ppPassive: number; soldiers: number;
}
export interface StatusTag { id: string; name: string; category: string }
export interface UnitSnap { id: string; hp: number; maxHp: number; alive: boolean; ppActive: number; ppPassive: number; soldiers: number; leader: boolean; statuses: StatusTag[] }

/** Something to float over a unit. `by` is set when it comes from a reaction, not from the beat's actor. */
export type Pop =
  | { kind: "damage"; unit: string; amount: number; crit: boolean; guard: boolean; by?: string }
  | { kind: "heal"; unit: string; amount: number; by?: string }
  | { kind: "miss"; unit: string; by?: string }
  | { kind: "text"; unit: string; text: string };

export interface Beat {
  index: number;
  kind: "phase" | "action" | "squad" | "stunned" | "phase_end" | "end";
  phase: number;
  actor: string | null;
  /** The skill's display name; null for a phase beat or a hero that could only idle. */
  skill: string | null;
  targets: string[];
  pops: Pop[];
  /** Heroes and whole squads that fell here. */
  deaths: string[];
  soldierDeaths: number;
  /** Active PP the actor paid for this action. */
  spent: number;
  squadHit: boolean;
  /** Why the phase ended, on a phase_end beat. */
  reason: string | null;
  lines: string[];
  units: UnitSnap[];
  /** Next units to act, soonest first. */
  next: string[];
  /** Index in the event log of the event that ended this beat. */
  at: number;
}

export interface Replay {
  units: UnitInfo[];
  beats: Beat[];
  winner: SideName;
  reason: "wipe" | "phase3_timeout";
  phases: number;
  /** Per unit: damage dealt and HP healed over the battle. */
  totals: Record<string, { damage: number; healing: number }>;
  notImplemented: string[];
}

const END_WORDS: Record<string, string> = {
  exhausted: "Everyone is out of PP", idle_cycle: "No one can act", action_cap: "The phase runs out of time", no_actions: "No one can act", wipe: "A side has fallen",
};

export function buildReplay(events: BattleEvent[]): Replay {
  const setup = events.find((e) => e.type === "battle_setup");
  if (!setup || setup.type !== "battle_setup") throw new Error("log has no battle_setup");
  const units: UnitInfo[] = [
    ...setup.units.map((u): UnitInfo => ({ id: u.id, name: u.name, side: u.side, cls: u.class, kind: "hero", row: u.row, column: u.column, maxHp: u.max_hp, ppActive: u.pp_active, ppPassive: u.pp_passive, soldiers: 0 })),
    ...setup.squads.map((q): UnitInfo => ({ id: q.id, name: q.name, side: q.side, cls: q.class, kind: "squad", row: q.row, column: 0, maxHp: q.soldiers * q.soldier_hp, ppActive: 0, ppPassive: 0, soldiers: q.soldiers })),
  ];
  const info = new Map(units.map((u) => [u.id, u]));
  const soldierMax = new Map(setup.squads.map((q) => [q.id, q.soldier_hp]));
  const soldierHp = new Map(setup.squads.map((q) => [q.id, Array.from({ length: q.soldiers }, () => q.soldier_hp)]));
  const skillName = new Map(setup.skills.map((s) => [s.id, s.name]));
  skillName.set("soldier_basic_attack", "Squad attack");
  const statusName = new Map(setup.statuses.map((s) => [s.id, s.name]));
  const leaders = new Set(setup.units.filter((u) => u.leader).map((u) => u.id));
  const snaps = new Map<string, UnitSnap>(units.map((u) => [u.id, {
    id: u.id, hp: u.maxHp, maxHp: u.maxHp, alive: true, ppActive: u.ppActive, ppPassive: u.ppPassive, soldiers: u.soldiers, leader: leaders.has(u.id), statuses: [],
  }]));
  const due = new Map<string, number>();
  const totals: Replay["totals"] = Object.fromEntries(units.map((u) => [u.id, { damage: 0, healing: 0 }]));
  const beats: Beat[] = [];
  const notImplemented: string[] = [];

  const U = (id: string) => info.get(id)?.name ?? id;
  const S = (id: string) => skillName.get(id) ?? id;
  const ST = (id: string) => statusName.get(id) ?? id;
  const syncSquad = (id: string) => {
    const hp = soldierHp.get(id)!, s = snaps.get(id)!;
    s.hp = hp.reduce((a, b) => a + b, 0);
    s.soldiers = hp.filter((x) => x > 0).length;
    s.alive = s.soldiers > 0;
  };

  let cur: Beat | null = null;
  let changed = false;
  let phase = 1;
  let pos = 0;
  const open = (kind: Beat["kind"], actor: string | null, skill: string | null): Beat => {
    close();
    changed = kind !== "action";
    return (cur = { index: 0, kind, phase, actor, skill, targets: [], pops: [], deaths: [], soldierDeaths: 0, spent: 0, squadHit: false, reason: null, lines: [], units: [], next: [], at: 0 });
  };
  function close(): void {
    const b = cur;
    cur = null;
    if (!b || (!changed && b.skill === null)) return; // a hero that idled with nothing happening: no state changed
    b.index = beats.length;
    b.at = pos;
    b.units = units.map((u) => { const s = snaps.get(u.id)!; return { ...s, statuses: [...s.statuses] }; });
    b.next = [...due.entries()].filter(([id]) => snaps.get(id)!.alive).sort((x, y) => x[1] - y[1]).map(([id]) => id).slice(0, 8);
    beats.push(b);
  }
  /** The beat to write to; an event outside any beat (never expected after phase_start) still lands in one. */
  const beat = (): Beat => { changed = true; return cur ?? open("action", null, null); };
  const by = (unit: string) => (cur && unit !== cur.actor ? { by: unit } : {});

  for (const [i, e] of events.entries()) {
    pos = i;
    switch (e.type) {
      case "phase_start": {
        phase = e.phase;
        due.clear();
        open("phase", null, null);
        for (const u of e.units) {
          const s = snaps.get(u.id)!;
          Object.assign(s, { hp: u.hp, maxHp: u.max_hp, alive: u.alive, ppActive: u.pp_active, ppPassive: info.get(u.id)!.ppPassive, statuses: [] });
        }
        for (const q of e.squads) { soldierHp.set(q.id, [...q.soldiers]); snaps.get(q.id)!.statuses = []; syncSquad(q.id); }
        cur!.lines.push(`Phase ${e.phase} begins.`);
        break;
      }
      case "schedule": due.set(e.unit, e.due); break;
      case "action_delayed":
      case "action_moved": // due null: no pending entry, the unit's next schedule event brings it back
        if (e.due === null) due.delete(e.unit); else due.set(e.unit, e.due);
        break;
      case "tactic_evaluation": {
        open("action", e.unit, e.chosen ? S(e.chosen) : null);
        break;
      }
      case "squad_attack":
        open("squad", e.unit, "Squad attack").lines.push(`${U(e.unit)} attacks with ${e.attackers} soldiers.`);
        break;
      case "action_prevented":
        open("stunned", e.unit, null).lines.push(`${U(e.unit)} cannot act (${ST(e.status)}).`);
        beat().pops.push({ kind: "text", unit: e.unit, text: ST(e.status) });
        break;
      case "target_selection": {
        const b = beat();
        b.targets = e.targets;
        b.lines.push(`${U(e.unit)} uses ${S(e.skill)} on ${e.targets.map(U).join(", ")}.`);
        break;
      }
      case "pp_spend": {
        const s = snaps.get(e.unit)!, b = beat();
        if (e.pool === "active") s.ppActive = e.after; else s.ppPassive = e.after;
        if (e.unit === b.actor && e.pool === "active") b.spent += e.cost;
        else { b.pops.push({ kind: "text", unit: e.unit, text: S(e.skill) }); b.lines.push(`${U(e.unit)} triggers ${S(e.skill)}.`); }
        break;
      }
      case "pp_change": {
        const s = snaps.get(e.unit)!;
        if (e.pool === "active") s.ppActive = e.after; else s.ppPassive = e.after;
        beat().lines.push(`${U(e.unit)} ${e.amount > 0 ? "gains" : "loses"} ${Math.abs(e.amount)} ${e.pool} PP.`);
        break;
      }
      case "roll":
        if (e.kind === "hit" && !e.result) { const b = beat(); b.pops.push({ kind: "miss", unit: e.target, ...by(e.unit) }); b.lines.push(`${U(e.unit)} misses ${U(e.target)}.`); }
        else if (e.kind === "status" && !e.result) beat().pops.push({ kind: "text", unit: e.target, text: "Resisted" });
        break;
      case "damage": {
        const b = beat();
        totals[e.unit]!.damage += e.amount;
        if (e.soldier === undefined) snaps.get(e.target)!.hp = e.hp_after;
        else { soldierHp.get(e.target)![e.soldier] = e.hp_after; syncSquad(e.target); }
        if (info.get(e.target)!.kind === "squad" || info.get(e.unit)!.kind === "squad") b.squadHit = true;
        const last = b.pops.at(-1);
        if (e.spill && last?.kind === "damage" && last.unit === e.target) last.amount += e.amount; // one hit carrying over several soldiers
        else {
          b.pops.push({ kind: "damage", unit: e.target, amount: e.amount, crit: e.crit, guard: e.guard, ...by(e.unit) });
          b.lines.push(`${U(e.unit)} hits ${U(e.target)} for ${e.amount}${e.crit ? " (critical!)" : ""}${e.guard ? " (guarded)" : ""}.`);
        }
        break;
      }
      case "self_hp_cost": {
        const b = beat();
        snaps.get(e.unit)!.hp = e.hp_after;
        b.pops.push({ kind: "damage", unit: e.unit, amount: e.amount, crit: false, guard: false });
        b.lines.push(`${U(e.unit)} pays ${e.amount} HP.`);
        break;
      }
      case "heal": {
        const b = beat();
        if (e.share !== undefined) {
          const hp = soldierHp.get(e.target)!, max = soldierMax.get(e.target)!;
          if (e.share > 0) soldierHp.set(e.target, hp.map((x) => Math.min(max, x + e.share!)));
          syncSquad(e.target);
        } else snaps.get(e.target)!.hp = e.hp_after;
        totals[e.unit]!.healing += e.applied;
        if (e.applied > 0) { b.pops.push({ kind: "heal", unit: e.target, amount: e.applied, ...by(e.unit) }); b.lines.push(`${U(e.unit)} heals ${U(e.target)} for ${e.applied}.`); }
        break;
      }
      case "death_intercepted": {
        const b = beat();
        if (e.soldier === undefined) { const s = snaps.get(e.unit)!; s.hp = e.hp; s.alive = true; }
        else { soldierHp.get(e.unit)![e.soldier] = e.hp; syncSquad(e.unit); }
        b.pops.push({ kind: "text", unit: e.unit, text: ST(e.status) });
        b.lines.push(`${ST(e.status)} saves ${U(e.unit)}!`);
        break;
      }
      case "death": {
        const b = beat();
        if (e.soldier !== undefined) { soldierHp.get(e.unit)![e.soldier] = 0; syncSquad(e.unit); b.soldierDeaths++; break; }
        const sq = soldierHp.get(e.unit);
        if (sq) { sq.fill(0); syncSquad(e.unit); } else { const s = snaps.get(e.unit)!; s.hp = 0; s.alive = false; }
        due.delete(e.unit);
        b.deaths.push(e.unit);
        b.lines.push(`${U(e.unit)} ${sq ? "is wiped out" : "falls"}.`);
        break;
      }
      case "leader_down": {
        const b = beat();
        snaps.get(e.unit)!.leader = false;
        b.lines.push(`Leader down: ${U(e.unit)}.`);
        if (e.squad_removed) {
          const id = `squad_${e.unit}`;
          soldierHp.get(id)?.fill(0);
          syncSquad(id);
          due.delete(id);
          b.deaths.push(id);
          b.lines.push(`${U(id)} leaves the field.`);
        }
        break;
      }
      case "leader_succession":
        snaps.get(e.previous)!.leader = false;
        snaps.get(e.leader)!.leader = true;
        beat().lines.push(`${U(e.leader)} takes command.`);
        break;
      case "status_applied": {
        if (e.notes.includes("instant")) break;
        const s = snaps.get(e.unit)!;
        s.statuses = [...s.statuses.filter((x) => x.id !== e.status), { id: e.status, name: ST(e.status), category: e.category }];
        beat().lines.push(`${U(e.unit)} gains ${ST(e.status)}.`);
        break;
      }
      case "status_expired": {
        const s = snaps.get(e.unit)!;
        if (s.statuses.some((x) => x.id === e.status)) { s.statuses = s.statuses.filter((x) => x.id !== e.status); changed = true; }
        break;
      }
      case "status_blocked":
        beat().pops.push({ kind: "text", unit: e.unit, text: "Immune" });
        break;
      case "cover": {
        const b = beat();
        b.pops.push({ kind: "text", unit: e.unit, text: "Cover" });
        b.lines.push(`${U(e.unit)} shields ${U(e.ally)}.`);
        break;
      }
      case "not_implemented": notImplemented.push(e.what); break;
      case "phase_end":
        open("phase_end", null, null).reason = END_WORDS[e.reason] ?? e.reason;
        cur!.lines.push(`Phase ${e.phase} ends.`);
        close();
        break;
      case "battle_end": {
        const b = open("end", null, null);
        b.reason = e.reason;
        b.lines.push(`${e.winner === "challenger" ? "Victory" : "Defeat"}.`);
        close();
        return { units, beats, winner: e.winner, reason: e.reason as Replay["reason"], phases: e.phases, totals, notImplemented };
      }
      default: break; // setup, tactic detail and gear bookkeeping change nothing a player can see
    }
  }
  throw new Error("log has no battle_end");
}

export interface Summary {
  won: boolean;
  timeout: boolean;
  mvp: { id: string; name: string; cls: string; damage: number; healing: number } | null;
  survivors: number;
  fielded: number;
  phases: number;
  felled: number;
}

export function summarize(r: Replay): Summary {
  const heroes = r.units.filter((u) => u.kind === "hero");
  const last = r.beats.at(-1)!.units;
  const alive = (id: string) => last.find((s) => s.id === id)!.alive;
  const mine = heroes.filter((u) => u.side === "challenger");
  const score = (id: string) => r.totals[id]!.damage + r.totals[id]!.healing;
  const best = [...mine].sort((a, b) => score(b.id) - score(a.id))[0];
  return {
    won: r.winner === "challenger", timeout: r.reason === "phase3_timeout", phases: r.phases,
    mvp: best ? { id: best.id, name: best.name, cls: best.cls, ...r.totals[best.id]! } : null,
    survivors: mine.filter((u) => alive(u.id)).length, fielded: mine.length,
    felled: heroes.filter((u) => u.side === "defender" && !alive(u.id)).length,
  };
}
