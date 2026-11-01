// Batch simulator (roadmap 4.2): N seeded runs of one matchup, aggregated from the battle events only (never engine internals).
//
// [DEFAULT] choices:
//  - Run seeds: hash(base seed, file basename, run index), one per phase, via an FNV-1a string hash and the splitmix32 finalizer.
//  - Per-unit averages (damage, healing, actions) and the death rate are per run the unit was fielded in; fielded / banned rates are per run.
//  - Damage dealt = the `amount` of the unit's damage events (overkill included); healing = the `applied` of its heal events.
//  - A hero action is a tactic evaluation or a prevented action (as phase_end.actions); a squad action is a squad_attack.
//  - Hero deaths count `death` events of heroes (not soldiers, not squad wipes); a hero is fielded when it is in battle_setup.
import { basename } from "node:path";
import { runBattle, type BattleEvent } from "./engine";
import type { BattleInput } from "./schema";
import type { Pack } from "./validate/pack";

type Side = "challenger" | "defender";
const SIDES: Side[] = ["challenger", "defender"];

export interface UnitRow {
  id: string;
  name: string;
  side: Side;
  kind: "hero" | "squad";
  fielded_rate: number;
  banned_rate: number;
  avg_damage: number;
  avg_healing: number;
  death_rate: number;
  avg_actions: number;
}

export interface MatchupReport {
  matchup: string;
  runs: number;
  challenger_win_rate: number;
  defender_win_rate: number;
  timeout_rate: number;
  reasons: Record<string, number>; // battle_end reason -> rate
  avg_phases: number;
  avg_actions_per_phase: number; // hero actions (phase_end.actions)
  avg_hero_deaths: Record<Side, number>;
  units: UnitRow[];
}

const mix32 = (x: number): number => {
  x = (x + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/** The three phase seeds of run `run` (integers in [0, 2^32)). Same inputs, same seeds. */
export function runSeeds(base: number, file: string, run: number): number[] {
  let h = mix32(mix32(fnv1a(basename(file)) ^ mix32(base)) ^ run);
  return [0, 1, 2].map(() => (h = mix32(h)));
}

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const div = (a: number, b: number): number => (b === 0 ? 0 : r4(a / b));

interface Acc { id: string; name: string; side: Side; kind: "hero" | "squad"; fielded: number; banned: number; damage: number; healing: number; died: number; actions: number }

/** Aggregates the event logs of a matchup's runs. Pure. */
export function aggregate(matchup: string, runs: BattleEvent[][]): MatchupReport {
  const wins: Record<Side, number> = { challenger: 0, defender: 0 };
  const reasons: Record<string, number> = {};
  const deaths: Record<Side, number> = { challenger: 0, defender: 0 };
  const acc = new Map<string, Acc>();
  let phases = 0, phaseEnds = 0, heroActions = 0;
  const row = (side: Side, id: string, name: string, kind: Acc["kind"]): Acc => {
    const key = `${side}:${id}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { id, name, side, kind, fielded: 0, banned: 0, damage: 0, healing: 0, died: 0, actions: 0 }));
    return a;
  };
  for (const events of runs) {
    const sideOf = new Map<string, Acc>(); // unit id -> row, for fielded units of this run
    const names = new Map<string, string>();
    for (const e of events) if (e.type === "draft_step") names.set(e.hero, e.name);
    const dead = new Set<Acc>();
    for (const e of events) {
      switch (e.type) {
        case "draft_result":
          for (const id of e.banned) row(e.side, id, names.get(id) ?? id, "hero").banned++;
          break;
        case "battle_setup":
          for (const u of e.units) { const a = row(u.side, u.id, u.name, "hero"); a.fielded++; sideOf.set(u.id, a); }
          for (const q of e.squads) { const a = row(q.side, q.id, q.name, "squad"); a.fielded++; sideOf.set(q.id, a); }
          break;
        case "damage": { const a = sideOf.get(e.unit); if (a) a.damage += e.amount; break; }
        case "heal": { const a = sideOf.get(e.unit); if (a) a.healing += e.applied; break; }
        case "tactic_evaluation":
        case "action_prevented":
        case "squad_attack": { const a = sideOf.get(e.unit); if (a) a.actions++; break; }
        case "death": {
          const a = sideOf.get(e.unit);
          if (a?.kind === "hero" && e.soldier === undefined) { deaths[a.side]++; dead.add(a); }
          break;
        }
        case "phase_end": phaseEnds++; heroActions += e.actions; break;
        case "battle_end": wins[e.winner]++; reasons[e.reason] = (reasons[e.reason] ?? 0) + 1; phases += e.phases; break;
      }
    }
    for (const a of dead) a.died++;
  }
  const n = runs.length;
  const sorted = [...acc.values()].sort((a, b) => SIDES.indexOf(a.side) - SIDES.indexOf(b.side) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return {
    matchup,
    runs: n,
    challenger_win_rate: div(wins.challenger, n),
    defender_win_rate: div(wins.defender, n),
    timeout_rate: div(Object.entries(reasons).filter(([k]) => k.includes("timeout")).reduce((s, [, v]) => s + v, 0), n),
    reasons: Object.fromEntries(Object.keys(reasons).sort().map((k) => [k, div(reasons[k]!, n)])),
    avg_phases: div(phases, n),
    avg_actions_per_phase: div(heroActions, phaseEnds),
    avg_hero_deaths: { challenger: div(deaths.challenger, n), defender: div(deaths.defender, n) },
    units: sorted.map((a) => ({
      id: a.id, name: a.name, side: a.side, kind: a.kind,
      fielded_rate: div(a.fielded, n), banned_rate: div(a.banned, n),
      avg_damage: div(a.damage, a.fielded), avg_healing: div(a.healing, a.fielded),
      death_rate: div(a.died, a.fielded), avg_actions: div(a.actions, a.fielded),
    })),
  };
}

/** Runs one matchup `runs` times with derived seeds (the roster form drafts every run) and aggregates the logs. */
export function runMatchup(pack: Pack, input: BattleInput, file: string, runs: number, base: number): MatchupReport {
  const logs: BattleEvent[][] = [];
  for (let i = 0; i < runs; i++) logs.push(runBattle(pack, { ...input, seeds: runSeeds(base, file, i) } as BattleInput).events);
  return aggregate(basename(file), logs);
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const num = (x: number): string => x.toFixed(1);

function table(rows: string[][], right: boolean[]): string[] {
  const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => r.map((cell, c) => (right[c] ? cell.padStart(w[c]!) : cell.padEnd(w[c]!))).join("  ").trimEnd());
}

/** Compact text report: a summary line block and one aligned unit table per matchup. */
export function renderReport(reports: MatchupReport[], base: number): string {
  const out: string[] = [];
  for (const m of reports) {
    out.push(`=== ${m.matchup}: ${m.runs} runs (base seed ${base}) ===`);
    out.push(`  challenger wins ${pct(m.challenger_win_rate)}, defender wins ${pct(m.defender_win_rate)}, timeout ${pct(m.timeout_rate)}`);
    out.push(`  end reasons: ${Object.entries(m.reasons).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
    out.push(`  avg phases ${num(m.avg_phases)}, avg hero actions/phase ${num(m.avg_actions_per_phase)}, avg hero deaths challenger ${num(m.avg_hero_deaths.challenger)} / defender ${num(m.avg_hero_deaths.defender)}`);
    const rows = [["side", "unit", "id", "fielded", "banned", "dmg", "heal", "died", "actions"]];
    for (const u of m.units) {
      rows.push([u.side, u.kind === "squad" ? `${u.name} (squad)` : u.name, u.id, pct(u.fielded_rate), pct(u.banned_rate), num(u.avg_damage), num(u.avg_healing), u.kind === "squad" ? "-" : pct(u.death_rate), num(u.avg_actions)]);
    }
    out.push(...table(rows, [false, false, false, true, true, true, true, true, true]).map((l) => `  ${l}`), "");
  }
  return out.join("\n");
}
