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
//  - [DEFAULT] a selector's `side` narrows the candidates to that side of the caster (target: no narrowing); metrics are hp_percent /
//    hp_current / hp_missing / active_pp / passive_pp / a stat name / `stat` with `stat:`.
//  - use_limit / cooldown (skillReady below): a skill that is not ready is skipped with the reason.
//  - fallback `skip` skips the tactic when the sub cannot pick; `next_valid_target` then takes the next candidate in
//    default order. The skill-level fallback (re_evaluate/skip) both mean "continue with the next tactic" in the slice.
//  - Confusion (a status with ignores_tactics, design 9): the sheet's conditions and targeting are ignored. [DEFAULT] The unit uses its first
//    enabled, runnable, affordable skill with a damage effect (sheet order) on a random living unit drawn from the rng: any side but itself when
//    overrides_targeting is random_any, else an enemy (soldier mode and valid_rows still apply; row/column/all expand around it). No such
//    skill: it idles. The status ends after that attack by its own duration (1 turn) or, if until_used, at once.
import type { Skill, Stat, Tactic } from "../schema";
import { STATS } from "../schema";
import type { Pack } from "../validate/pack";
import { evaluateCondition } from "./conditions";
import type { Rng } from "./rng";
import { effectiveStat } from "./stats";
import type { BattleState, StatusInstance, Unit } from "./state";
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
  /** The ignores_tactics status (Confusion) that made this decision. */
  confusedBy?: StatusInstance;
}

const SUPPORTED_SHAPES = ["single", "row", "column", "all", "self", "caster_row"];

/** null when the slice can run the skill on the unit's turn, otherwise the reason (a passive runs on its trigger: passives.ts). */
export function skillSupport(skill: Skill, pack: Pick<Pack, "byId">): string | null {
  if (skill.category === "passive") return "passive skill: runs on its trigger, not on the unit's turn";
  if (skill.trigger !== "own_turn") return `not implemented: trigger ${skill.trigger}`;
  if (skill.pp_pool !== "active") return `not implemented: pp pool ${skill.pp_pool}`;
  const shape = skill.targeting.shape ?? "single";
  if (!SUPPORTED_SHAPES.includes(shape)) return `not implemented: target shape ${shape}`;
  for (const e of skill.effects) {
    if (["damage", "heal", "remove_buffs", "modify_pp", "reduce_damage", "delay_action", "advance_action"].includes(e.type)) continue;
    if (e.type === "apply_status") {
      const st = pack.byId.statuses.get(e.status_id);
      if (!st) return `not implemented: unknown status ${e.status_id}`;
      const f = st.flags;
      const does = st.modifiers.length > 0 || f.prevents_action || f.delays_pending_action || f.intercepts_death.enabled || f.blocks_debuffs || f.ignores_tactics ||
        f.removes_on_hit || f.prevents_evasion || f.heals_on_hit_percent_max_hp > 0;
      if (!does) return `not implemented: status ${st.name} has no effect the engine runs`;
      continue;
    }
    return `not implemented: effect ${e.type}`;
  }
  return null;
}

/**
 * use_limit and cooldown (design 7, templates: "cooldown: counts of the hero's own actions"). [DEFAULT] Both are per phase (units, like PP,
 * are fresh each phase). A skill used during its owner's action N with cooldown c is unavailable for the owner's next c actions; used outside
 * an own action (a passive on an enemy's hit) after M completed own actions, it is back after own action M + c. Every own action counts
 * (idles and prevented actions too). Null when the skill may be used now, else why not.
 */
export function skillReady(u: Unit, skill: Skill): string | null {
  const use = u.skillUses[skill.id];
  if (!use) return null;
  if (skill.use_limit !== null && use.uses >= skill.use_limit) return `use limit reached (${use.uses}/${skill.use_limit} this phase)`;
  if (u.actions < use.readyAt) return `on cooldown (${use.readyAt - u.actions} more own action(s))`;
  return null;
}

/** Records one use of `skill` by `u` (use_limit count, cooldown start). `inOwnAction`: u's own action is running. */
export function recordSkillUse(u: Unit, skill: Skill, inOwnAction: boolean): void {
  if (skill.use_limit === null && skill.cooldown === null) return;
  const use = (u.skillUses[skill.id] ??= { uses: 0, readyAt: 0 });
  use.uses++;
  use.readyAt = skill.cooldown === null ? 0 : u.actions + skill.cooldown + (inOwnAction ? 1 : 0);
}

// Board order: soldier front row, hero front, hero back, soldier back row. A wrapper, not an alias: state.ts imports tactics.ts (via passives.ts).
const rowRank = (u: Unit): number => boardRank(u);
/** Default order: front row first (a front squad is the first row), then column index, then unit id. */
const byDefault = (a: Unit, b: Unit) => rowRank(a) - rowRank(b) || a.column - b.column || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byFormation = (a: Unit, b: Unit) => a.formationIndex - b.formationIndex;

function metricValue(u: Unit, metric: string, stat: Stat | undefined, pack: Pack): number | null {
  switch (metric) {
    case "hp_percent": return (u.hp / u.maxHp) * 100;
    case "hp_current": return u.hp;
    case "hp_missing": return u.maxHp - u.hp;
    case "active_pp": return u.pp.active.cur;
    case "passive_pp": return u.pp.passive.cur;
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

function pickBySelector(all: Unit[], sel: any, caster: Unit, state: BattleState, rng: Rng): Picked {
  // [DEFAULT] A selector `side` narrows the candidates to that side of the caster (self = the caster; target = no narrowing).
  const ordered = sel.side === "ally" ? all.filter((u) => u.side === caster.side) : sel.side === "enemy" ? all.filter((u) => u.side !== caster.side)
    : sel.side === "self" ? all.filter((u) => u === caster) : all;
  if (ordered.length === 0) return { unit: null, note: `no candidate on side ${sel.side}` };
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

export function resolveTargets(skill: Skill, tactic: Tactic, caster: Unit, state: BattleState, rng: Rng): TargetResult {
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
  else if ("select" in (sub as object)) pick = pickBySelector(ordered, sub, caster, state, rng);
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

/** A confused unit's action (see the header): first affordable damage skill, random target. */
function decideConfused(state: BattleState, unit: Unit, rng: Rng, conf: StatusInstance): TacticDecision {
  const st = state.pack.byId.statuses.get(conf.statusId)!;
  for (const tactic of [...unit.tactics].sort((a, b) => a.priority - b.priority)) {
    const skill = state.pack.byId.skills.get(tactic.skill_id);
    if (!tactic.enabled || !unit.skills.includes(tactic.skill_id) || !skill || skillSupport(skill, state.pack) !== null) continue;
    if (unit.pp.active.cur < skill.pp_cost || !skill.effects.some((e) => e.type === "damage") || skillReady(unit, skill) !== null) continue;
    const anySide = st.flags.overrides_targeting === "random_any";
    let pool = state.units.filter((u) => u.alive && u !== unit && (anySide || u.side !== unit.side));
    if (skill.interactions.soldiers === "skip_soldiers") pool = pool.filter((u) => u.kind === "hero");
    else if (skill.interactions.soldiers === "soldiers_only") pool = pool.filter((u) => u.kind === "squad");
    pool = pool.filter((u) => (skill.targeting.valid_rows as string[]).includes(u.row)).sort(byDefault);
    if (pool.length === 0) continue;
    const anchor = pool[rng.int(pool.length)]!;
    const side = pool.filter((u) => u.side === anchor.side);
    const targets = expand(skill, unit, anchor, side, side, state);
    const reason = `confused (${st.name}): ignores tactics, random target ${anchor.id}; targets ${targets.map((u) => u.id).join(", ")}`;
    return { tactic, skillId: skill.id, targets, evaluations: [{ priority: tactic.priority, skillId: skill.id, outcome: "chosen", reason }], confusedBy: conf };
  }
  return { tactic: null, skillId: null, targets: [], evaluations: [{ priority: 0, skillId: st.id, outcome: "skipped", reason: `confused (${st.name}): no usable damage skill, idles` }], confusedBy: conf };
}

/** Evaluates the unit's tactic sheet top to bottom and returns the first tactic that qualifies, or idle. A confused unit ignores the sheet. */
export function decideTactic(state: BattleState, unit: Unit, rng: Rng): TacticDecision {
  const conf = unit.statuses.find((s) => state.pack.byId.statuses.get(s.statusId)?.flags.ignores_tactics);
  if (conf) return decideConfused(state, unit, rng, conf);
  const evaluations: TacticEvaluation[] = [];
  const skip = (t: Tactic, reason: string) => evaluations.push({ priority: t.priority, skillId: t.skill_id, outcome: "skipped", reason });
  for (const tactic of [...unit.tactics].sort((a, b) => a.priority - b.priority)) {
    if (!tactic.enabled) { skip(tactic, "tactic disabled"); continue; }
    if (!unit.skills.includes(tactic.skill_id)) { skip(tactic, "skill is not in the hero's skill list"); continue; }
    const skill = state.pack.byId.skills.get(tactic.skill_id);
    if (!skill) { skip(tactic, `unknown skill ${tactic.skill_id}`); continue; }
    const unsupported = skillSupport(skill, state.pack);
    if (unsupported) { skip(tactic, unsupported); continue; }
    const notReady = skillReady(unit, skill);
    if (notReady) { skip(tactic, notReady); continue; }
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
