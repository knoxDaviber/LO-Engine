// Tactic evaluator (design Section 4.2). Picks at most one tactic for a unit's action and says why every other one was skipped.
// Pure: it reads the state, draws random numbers only from the Rng it is given, and mutates nothing.
//
// Decisions (slice):
//  - targeting (Decision 136, resolveTargets): a tactic is a skill plus two slots, main and sub, each a condition leaf (filters candidates) or a
//    selector (orders them, never skips). Decision 145: the effective Main is the tactic's main, else the skill's default_main (a player Main
//    REPLACES it); no effective Main = the tactic does not trigger ("no condition"). The skill's default_activation (no target) still applies
//    too; default_sub only when neither player slot is a selector. Ties fall back to nearest (front row first), then column index, then unit id. The first candidate is the anchor:
//    single = it, row/column = everyone alive in its row/column on its side, all = every candidate that passed the filters,
//    self = the caster, caster_row = the caster's row.
//  - selector metrics: hp_percent / hp_current / hp_missing / max_hp / active_pp / passive_pp / max_active_pp / max_passive_pp / a stat name.
//  - use_limit / cooldown (skillReady below): a skill that is not ready is skipped with the reason.
//  - The skill-level fallback (re_evaluate/skip) both mean "continue with the next tactic" in the slice.
//  - Confusion (a status with ignores_tactics, design 9): the sheet's conditions and targeting are ignored. [DEFAULT] The unit uses its first
//    enabled, runnable, affordable skill with a damage effect (sheet order) on a random living unit drawn from the rng: any side but itself when
//    overrides_targeting is random_any, else an enemy (soldier mode and valid_rows still apply; row/column/all expand around it). No such
//    skill: it idles. The status ends after that attack by its own duration (1 turn) or, if until_used, at once.
import type { ConditionNode, Selector, Skill, Stat, Tactic } from "../schema";
import { isSelector, STATS } from "../schema";
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

function metricValue(u: Unit, metric: string, pack: Pack): number | null {
  switch (metric) {
    case "hp_percent": return (u.hp / u.maxHp) * 100;
    case "hp_current": return u.hp;
    case "hp_missing": return u.maxHp - u.hp;
    case "max_hp": return u.maxHp;
    case "active_pp": return u.pp.active.cur;
    case "passive_pp": return u.pp.passive.cur;
    case "max_active_pp": return u.pp.active.max;
    case "max_passive_pp": return u.pp.passive.max;
    default: return (STATS as readonly string[]).includes(metric) ? effectiveStat(u, metric as Stat, pack) : null;
  }
}

/** A selector as a sort key over the candidates (lower first), or a reason it cannot run. random_seeded draws one candidate, which sorts first. */
function selectorKey(sel: Selector, cands: Unit[], caster: Unit, state: BattleState, rng: Rng): { key: Map<Unit, number>; note: string } | string {
  const key = new Map<Unit, number>();
  switch (sel.select) {
    case "nearest": cands.forEach((u) => key.set(u, 0)); return { key, note: "nearest" }; // default order already is nearest
    case "farthest": cands.forEach((u) => key.set(u, -rowRank(u))); return { key, note: "farthest" };
    case "random_seeded": {
      const r = rng.int(cands.length);
      cands.forEach((u, i) => key.set(u, i === r ? 0 : 1));
      return { key, note: "random_seeded" };
    }
    case "prefer":
      cands.forEach((u) => key.set(u, evaluateCondition(sel.filter, { state, self: caster, target: u }).value ? 0 : 1));
      return { key, note: `prefer ${describe(sel.filter!)}` };
    case "lowest":
    case "highest": {
      const metric = sel.metric ?? "hp_percent";
      for (const u of cands) {
        const v = metricValue(u, metric, state.pack);
        if (v === null) return `not implemented: selector metric ${metric}`;
        key.set(u, sel.select === "lowest" ? v : -v);
      }
      return { key, note: `${sel.select} ${metric}` };
    }
    default: return `not implemented: selector ${String(sel.select)}`;
  }
}

/** Short text for a condition leaf in reasons: its type and parameter values. */
function describe(node: ConditionNode): string {
  const { type, ...rest } = node as Record<string, unknown>;
  return [type ?? JSON.stringify(node), ...Object.values(rest).map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))].join(" ");
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

/**
 * One condition for a tactic outside targeting (passive triggers, while_condition statuses): the skill's default_activation ANDed with the
 * player's main / sub leaves (selectors do not apply). null = no condition.
 */
export function tacticCondition(tactic: Tactic | null | undefined, skill: Pick<Skill, "default_activation">): ConditionNode | null {
  const parts = [skill.default_activation, tactic?.main, tactic?.sub].filter((c): c is ConditionNode => !!c && !isSelector(c));
  return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { all: parts };
}

type TargetResult = { targets: Unit[]; reason: string };

/**
 * Targets for a player tactic (Decision 136). Candidates = the skill's target pool (side, soldier mode, valid_rows). Filters, in order: the
 * effective main (the tactic's main, else the skill's default_main), a leaf in sub, then default_sub (only when neither slot is a selector). A candidate passes a leaf iff it
 * is true for (self = caster, target = candidate), so a self/board leaf is an "only if" check. Selectors only order: main's first, sub's breaks
 * ties, then default order. The first candidate anchors the shape.
 */
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
  if (pool.length === 0) return { targets: [], reason: "no valid target: no candidate in the skill's target pool" };

  const main = tactic.main ?? t.default_main;
  const leaf = (c: Tactic["main"]): ConditionNode | null => (c && !isSelector(c) ? c : null);
  const anySelector = isSelector(tactic.main) || isSelector(tactic.sub);
  const filters: [string, ConditionNode | null][] = [
    [tactic.main ? "main" : "skill default_main", leaf(main)], ["sub", leaf(tactic.sub)], ["skill default_sub", anySelector ? null : t.default_sub],
  ];
  let kept = pool;
  for (const [name, cond] of filters) {
    if (!cond) continue;
    const notes: string[] = [];
    kept = kept.filter((u) => {
      const r = evaluateCondition(cond, { state, self: caster, target: u });
      notes.push(...r.reasons);
      return r.value;
    });
    const uniq = [...new Set(notes)];
    if (kept.length === 0) return { targets: [], reason: `condition false: ${name} ${describe(cond)} holds for no candidate${uniq.length ? ` (${uniq.join("; ")})` : ""}` };
  }

  let ordered = [...kept].sort(byDefault);
  const via: string[] = [];
  const keys: Map<Unit, number>[] = [];
  for (const [name, sel] of [["main", main], ["sub", tactic.sub]] as const) {
    if (!isSelector(sel)) continue;
    const k = selectorKey(sel, ordered, caster, state, rng);
    if (typeof k === "string") return { targets: [], reason: `no valid target: ${name} ${k}` };
    keys.push(k.key);
    via.push(`${name} ${k.note}`);
  }
  // Stable sort: main's key first, sub's breaks ties, default order last.
  if (keys.length) ordered = ordered.sort((a, b) => { for (const k of keys) { const d = k.get(a)! - k.get(b)!; if (d) return d; } return 0; });
  const targets = expand(skill, caster, ordered[0]!, pool, kept, state);
  return { targets, reason: `targets ${targets.map((u) => u.id).join(", ")} via ${via.length ? via.join(", ") : "nearest, front row first"}` };
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
    if (!tactic.main && !skill.targeting.default_main) { skip(tactic, "no condition: no Main set and the skill has no default_main"); continue; }
    const act = evaluateCondition(skill.default_activation, { state, self: unit });
    if (!act.value) { skip(tactic, `condition false: skill default_activation${act.reasons.length ? ` (${[...new Set(act.reasons)].join("; ")})` : ""}`); continue; }
    if (unit.pp.active.cur < skill.pp_cost) { skip(tactic, `not enough Active PP (${unit.pp.active.cur} < ${skill.pp_cost})`); continue; }
    const res = resolveTargets(skill, tactic, unit, state, rng);
    if (res.targets.length === 0) { skip(tactic, res.reason); continue; }
    evaluations.push({ priority: tactic.priority, skillId: tactic.skill_id, outcome: "chosen", reason: res.reason });
    return { tactic, skillId: tactic.skill_id, targets: res.targets, evaluations };
  }
  return { tactic: null, skillId: null, targets: [], evaluations };
}
