// Tactic evaluator (design Section 4.2). Picks at most one tactic for a unit's action and says why every other one was skipped.
// Pure: it reads the state, draws random numbers only from the Rng it is given, and mutates nothing.
//
// Decisions (slice):
//  - tactic main/sub fall back to the skill's default_main/default_sub when null; nothing set = nearest (front row first),
//    ties by column index then unit id.
//  - main filters the candidate set on the skill's targeting side and valid_rows. A sub *selector* picks one candidate; a sub
//    *condition* keeps only the candidates that satisfy it (first in default order wins). The picked unit is the anchor:
//    single = it, row/column = everyone alive in its row/column on its side, all = every candidate main kept,
//    self = the caster, caster_row = the caster's row.
//  - fallback `skip` skips the tactic when the sub cannot pick; `next_valid_target` then takes the next candidate in
//    default order. The skill-level fallback (re_evaluate/skip) both mean "continue with the next tactic" in the slice.
import type { Skill, Stat, Tactic } from "../schema";
import { STATS } from "../schema";
import type { Pack } from "../validate/pack";
import { evaluateCondition } from "./conditions";
import type { Rng } from "./rng";
import { effectiveStat } from "./stats";
import type { BattleState, Unit } from "./state";
import { alliesOf, boardRank, targetsOf, otherSide } from "./state";

export interface TacticEvaluation {
  priority: number;
  skillId: string;
  outcome: "chosen" | "skipped";
  reason: string;
}

export interface TacticDecision {
  tactic: Tactic | null; // null = idle
  skillId: string | null;
  targets: Unit[];
  evaluations: TacticEvaluation[];
}

const SUPPORTED_SHAPES = ["single", "row", "column", "all", "self", "caster_row"];

/** null when the slice can run the skill, otherwise a "not implemented: ..." reason. */
export function skillSupport(skill: Skill, pack: Pick<Pack, "byId">): string | null {
  if (skill.category !== "active") return `not implemented: ${skill.category} skill`;
  if (skill.trigger !== "own_turn") return `not implemented: trigger ${skill.trigger}`;
  if (skill.pp_pool !== "active") return `not implemented: pp pool ${skill.pp_pool}`;
  const shape = skill.targeting.shape ?? "single";
  if (!SUPPORTED_SHAPES.includes(shape)) return `not implemented: target shape ${shape}`;
  for (const e of skill.effects) {
    if (e.type === "damage" || e.type === "heal") continue;
    if (e.type === "apply_status") {
      const st = pack.byId.statuses.get(e.status_id);
      if (!st) return `not implemented: unknown status ${e.status_id}`;
      if (st.modifiers.length === 0 && !st.flags.delays_pending_action) return `not implemented: status ${st.name} has no stat modifiers`;
      continue;
    }
    return `not implemented: effect ${e.type}`;
  }
  return null;
}

const rowRank = boardRank; // board order: soldier front row, hero front, hero back, soldier back row
/** Default order: front row first (a front squad is the first row), then column index, then unit id. */
const byDefault = (a: Unit, b: Unit) => rowRank(a) - rowRank(b) || a.column - b.column || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byFormation = (a: Unit, b: Unit) => a.formationIndex - b.formationIndex;

function metricValue(u: Unit, metric: string, stat: Stat | undefined, pack: Pack): number | null {
  switch (metric) {
    case "hp_percent": return (u.hp / u.maxHp) * 100;
    case "hp_current": return u.hp;
    case "hp_missing": return u.maxHp - u.hp;
    default: {
      const s = (metric === "stat" ? stat : (STATS as readonly string[]).includes(metric) ? (metric as Stat) : undefined);
      if (!s) return null;
      return effectiveStat(u, s, pack);
    }
  }
}

interface Picked {
  unit: Unit | null;
  note: string;
}

function pickBySelector(ordered: Unit[], sel: any, state: BattleState, rng: Rng): Picked {
  switch (sel.select) {
    case "nearest": return { unit: ordered[0] ?? null, note: "nearest" };
    case "farthest": {
      const far = [...ordered].sort((a, b) => rowRank(b) - rowRank(a) || a.column - b.column || (a.id < b.id ? -1 : 1));
      return { unit: far[0] ?? null, note: "farthest" };
    }
    case "random_seeded": return { unit: ordered.length ? ordered[rng.int(ordered.length)]! : null, note: "random_seeded" };
    case "lowest":
    case "highest": {
      const metric: string = sel.metric ?? sel.type ?? (sel.stat ? "stat" : "hp_percent");
      const vals = ordered.map((u) => metricValue(u, metric, sel.stat, state.pack));
      if (vals.some((v) => v === null)) return { unit: null, note: `not implemented: selector metric ${metric}` };
      const sign = sel.select === "lowest" ? 1 : -1;
      let best = 0;
      // ordered is in default order, so a strict comparison keeps ties on column index then unit id.
      for (let i = 1; i < ordered.length; i++) if (sign * (vals[i]! - vals[best]!) < 0) best = i;
      return { unit: ordered[best] ?? null, note: `${sel.select} ${metric}` };
    }
    default: return { unit: null, note: `not implemented: selector ${String(sel.select)}` };
  }
}

function expand(skill: Skill, caster: Unit, anchor: Unit, pool: Unit[], kept: Unit[], state: BattleState): Unit[] {
  const shape = skill.targeting.shape ?? "single";
  let out: Unit[];
  switch (shape) {
    case "self": out = [caster]; break;
    case "caster_row": out = alliesOf(state, caster).filter((u) => u.row === caster.row); break; // heroes only: a squad stands in a soldier row
    // A row is a board row: a squad is alone in its soldier row, heroes share the hero row.
    case "row": out = pool.filter((u) => u.side === anchor.side && boardRank(u) === boardRank(anchor)); break;
    // A squad fills all 3 columns, so a column always passes through it. A squad anchor stands in no single column: [DEFAULT] column 1.
    case "column": {
      const col = anchor.kind === "squad" ? 1 : anchor.column;
      out = pool.filter((u) => u.side === anchor.side && (u.kind === "squad" || u.column === col));
      break;
    }
    case "all": out = kept; break;
    default: out = [anchor];
  }
  out = [...out].sort(byFormation);
  const max = skill.targeting.max_targets;
  return max !== null && shape !== "single" ? out.slice(0, max) : out;
}

type TargetResult = { targets: Unit[]; reason: string };

function resolveTargets(skill: Skill, tactic: Tactic, caster: Unit, state: BattleState, rng: Rng): TargetResult {
  const t = skill.targeting;
  const shape = t.shape ?? "single";
  let pool: Unit[];
  if (t.side === "self" || shape === "self") pool = [caster];
  else if (t.side === "ally") pool = targetsOf(state, caster.side);
  else if (t.side === "enemy") pool = targetsOf(state, otherSide(caster.side));
  else pool = state.units.filter((u) => u.alive);
  // Soldier mode: skip_soldiers keeps heroes only, soldiers_only keeps the squad only. A squad passes valid_rows by its squad_row.
  if (skill.interactions.soldiers === "skip_soldiers") pool = pool.filter((u) => u.kind === "hero");
  else if (skill.interactions.soldiers === "soldiers_only") pool = pool.filter((u) => u.kind === "squad");
  pool = pool.filter((u) => (t.valid_rows as string[]).includes(u.row));

  const main = tactic.targeting.main ?? t.default_main;
  const notes: string[] = [];
  const kept = pool.filter((u) => {
    const r = evaluateCondition(main, { state, self: caster, target: u });
    notes.push(...r.reasons);
    return r.value;
  });
  const uniqueNotes = [...new Set(notes)];
  if (kept.length === 0) return { targets: [], reason: `no valid target: no candidate passes the main condition${uniqueNotes.length ? ` (${uniqueNotes.join("; ")})` : ""}` };

  const ordered = [...kept].sort(byDefault);
  const sub = tactic.targeting.sub ?? t.default_sub;
  let pick: Picked;
  if (!sub) pick = { unit: ordered[0]!, note: "nearest, front row first" };
  else if ("select" in (sub as object)) pick = pickBySelector(ordered, sub, state, rng);
  else {
    const hit = ordered.find((u) => {
      const r = evaluateCondition(sub as any, { state, self: caster, target: u });
      notes.push(...r.reasons);
      return r.value;
    });
    pick = { unit: hit ?? null, note: hit ? "sub condition" : `no candidate satisfies the sub condition${[...new Set(notes)].length ? ` (${[...new Set(notes)].join("; ")})` : ""}` };
  }
  let via = pick.note;
  if (!pick.unit) {
    if (tactic.fallback === "next_valid_target") {
      pick = { unit: ordered[0]!, note: "next valid target" };
      via = `${pick.note} (sub failed: ${via})`;
    } else {
      return { targets: [], reason: `no valid target: ${via}; tactic fallback skip (skill fallback ${t.fallback})` };
    }
  }
  const targets = expand(skill, caster, pick.unit!, pool, kept, state);
  return { targets, reason: `targets ${targets.map((u) => u.id).join(", ")} via ${via}` };
}

/** Evaluates the unit's tactic sheet top to bottom and returns the first tactic that qualifies, or idle. */
export function decideTactic(state: BattleState, unit: Unit, rng: Rng): TacticDecision {
  const evaluations: TacticEvaluation[] = [];
  const skip = (t: Tactic, reason: string) => evaluations.push({ priority: t.priority, skillId: t.skill_id, outcome: "skipped", reason });
  for (const tactic of [...unit.tactics].sort((a, b) => a.priority - b.priority)) {
    if (!tactic.enabled) { skip(tactic, "tactic disabled"); continue; }
    if (!unit.skills.includes(tactic.skill_id)) { skip(tactic, "skill is not in the hero's skill list"); continue; }
    const skill = state.pack.byId.skills.get(tactic.skill_id);
    if (!skill) { skip(tactic, `unknown skill ${tactic.skill_id}`); continue; }
    const unsupported = skillSupport(skill, state.pack);
    if (unsupported) { skip(tactic, unsupported); continue; }
    const act = evaluateCondition(tactic.activation ?? skill.default_activation, { state, self: unit });
    if (!act.value) { skip(tactic, `activation condition false${act.reasons.length ? ` (${[...new Set(act.reasons)].join("; ")})` : ""}`); continue; }
    if (unit.pp.active.cur < skill.pp_cost) { skip(tactic, `not enough Active PP (${unit.pp.active.cur} < ${skill.pp_cost})`); continue; }
    const res = resolveTargets(skill, tactic, unit, state, rng);
    if (res.targets.length === 0) { skip(tactic, res.reason); continue; }
    evaluations.push({ priority: tactic.priority, skillId: tactic.skill_id, outcome: "chosen", reason: res.reason });
    return { tactic, skillId: tactic.skill_id, targets: res.targets, evaluations };
  }
  return { tactic: null, skillId: null, targets: [], evaluations };
}
