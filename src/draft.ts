// Draft (design 2A, variant C) for the roster form of the battle input: rules.draft.steps resolved in order, then the leader line and
// formation overflow. Shared by the battle validator (which reports the issues) and the engine (which runs the resulting fielded battle).
//
// Rules as implemented:
//  - A `ban` removes one hero of the OTHER side's roster; a `protect` marks one of the actor's own heroes. Neither ever picks a banned hero.
//  - The defender's anchor (rules.draft.defender_anchor) and every protected hero can never be banned.
//  - source human: the next pick from that side's `draft.bans` / `draft.protects` list. A pick that is not eligible is an issue (E_DRAFT_PICK);
//    a list whose length differs from the side's human steps of that kind is E_DRAFT_PICKS.
//  - source rule_sheet (ban): the actor's ban_sheet rules top to bottom (by priority); a rule that already fired is skipped; the first rule
//    whose filter matches an eligible hero bans the one its select/metric picks. No match: the fallback bans the highest-cost eligible hero.
//    [DEFAULT] Ties (rules and fallback) break by cost (highest), then id. [DEFAULT] metric is cost | hp | stat:<STAT>, read pre-battle
//    (base stat plus the entry's equipment lines); `nearest` = front row first (preferred row), then roster order.
//    [DEFAULT] A rule_sheet protect protects the highest-cost eligible own hero (variant C has none; the config allows it).
//  - Each side must end with exactly rules.draft.fielded heroes (E_DRAFT_RESULT otherwise).
//  - Leader: the highest-ranked fielded hero of the side's leader_line. The fielded heroes are ordered by leader-line rank, so the engine's
//    succession and formation order follow the leader line.
//  - Formation overflow: while a hero row holds more than rules.board.columns heroes, its lowest-ranked non-leader moves to the other row.
// Deterministic: no rng is involved.
import { classDefaultRow } from "./formation";
import type { Battle, BanSheet, Character, ConditionNode, Equipment, RosterBattle, RosterHero, Row, Stat } from "./schema";
import { STATS } from "./schema";
import { leanedBase } from "./race";
import { equipmentStats } from "./equipmentBase";
import { heroCost } from "./validate/cost";
import { unlockedBlessings } from "./devotion";
import type { Pack } from "./validate/pack";

export type DraftSide = "challenger" | "defender";

export interface DraftStepRecord {
  step: number; // 1-based index into rules.draft.steps
  actor: DraftSide;
  action: "ban" | "protect";
  source: "human" | "rule_sheet";
  side: DraftSide; // whose hero was picked
  hero: string;
  by: string; // "human", "rule <priority>" or "fallback"
}

export interface DraftSideResult {
  fielded: string[]; // leader-line order
  banned: string[];
  protected: string[];
  leader: string;
  anchor: string | null;
  moved: string[]; // heroes moved to the other row by the overflow rule
}

export interface DraftIssue {
  code: string;
  message: string;
  path: string;
}

export interface DraftOutcome {
  /** The fielded battle, or null when the draft had issues. */
  battle: Battle | null;
  steps: DraftStepRecord[];
  sides: Record<DraftSide, DraftSideResult> | null;
  issues: DraftIssue[];
}

const SIDES: readonly DraftSide[] = ["challenger", "defender"];
const other = (s: DraftSide): DraftSide => (s === "challenger" ? "defender" : "challenger");

function compare(a: number, op: string, b: number): boolean {
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

/** A roster hero with the attributes the ban sheet reads. */
interface Candidate {
  entry: RosterHero;
  ch: Character;
  cost: number;
  order: number; // roster order
  stat: (s: Stat) => number;
}

function candidate(pack: Pack, entry: RosterHero, order: number): Candidate {
  const ch = pack.byId.characters.get(entry.char_id) as Character;
  const items = [entry.equipment.weapon, entry.equipment.armor, entry.equipment.accessory_1, entry.equipment.accessory_2]
    .flatMap((id) => (id ? [pack.byId.equipment.get(id)] : []))
    .filter((e): e is Equipment => e !== undefined);
  const skills = ch.skills.map((id) => pack.byId.skills.get(id)).filter((s) => s !== undefined);
  const cost = heroCost(ch, pack.rules, { squad: pack.byId.soldiers.get(entry.squad_id) ?? null, equipment: items, skills, blessings: unlockedBlessings(pack, entry).flatMap((b) => b.effects) });
  const lean = leanedBase(pack.rules, ch);
  const stat = (s: Stat) => lean[s] + items.reduce((n, e) => n + equipmentStats(e, pack.rules.equipment_bases)[s], 0);
  return { entry, ch, cost, order, stat };
}

/** Ban-sheet filter over a candidate (ban-context leaves of the condition registry). Any other leaf is false. */
function banFilter(pack: Pack, node: ConditionNode, c: Candidate): boolean {
  const n = node as any;
  if ("all" in n) return (n.all as ConditionNode[]).every((x) => banFilter(pack, x, c));
  if ("any" in n) return (n.any as ConditionNode[]).some((x) => banFilter(pack, x, c));
  if ("not" in n) return !banFilter(pack, n.not as ConditionNode, c);
  switch (n.type) {
    case "hero_class": return c.ch.class === n.value;
    case "hero_faction": return c.ch.factions.includes(n.value);
    case "leader_aura_type": return c.ch.leader_aura.type === n.value;
    case "has_skill_tag": return c.ch.skills.some((id) => pack.byId.skills.get(id)?.tags.includes(n.value));
    case "cost": return compare(c.cost, n.op, n.value);
    case "is_official": return n.value === true; // only the official pack runs; heroes carry no origin
    case "stat_compare": return compare(c.stat(n.stat), n.op, n.value);
    default: return false;
  }
}

/** Ban-sheet metric value; null for an unknown metric (the validator reports E_BAN_METRIC). */
export function banMetric(metric: string, c: Pick<Candidate, "cost" | "stat">): number | null {
  if (metric === "cost") return c.cost;
  if (metric === "hp") return c.stat("HP");
  const m = /^stat:([A-Z]+)$/.exec(metric);
  if (m && (STATS as readonly string[]).includes(m[1]!)) return c.stat(m[1] as Stat);
  return null;
}

const byCostThenId = (a: Candidate, b: Candidate) => b.cost - a.cost || (a.entry.char_id < b.entry.char_id ? -1 : a.entry.char_id > b.entry.char_id ? 1 : 0);
const prefRow = (c: Candidate): Row => c.entry.preferred_row ?? c.ch.preferred_row ?? classDefaultRow(c.ch.class);

function selectOne(pool: Candidate[], select: string, metric: string): Candidate {
  const sorted = [...pool];
  if (select === "nearest") {
    sorted.sort((a, b) => (prefRow(a) === prefRow(b) ? a.order - b.order : prefRow(a) === "front" ? -1 : 1));
  } else {
    const dir = select === "lowest" ? 1 : -1;
    sorted.sort((a, b) => dir * ((banMetric(metric, a) ?? 0) - (banMetric(metric, b) ?? 0)) || byCostThenId(a, b));
  }
  return sorted[0]!;
}

function ruleSheetPick(pack: Pack, sheet: BanSheet | null, eligible: Candidate[], fired: Set<number>): { hero: Candidate; by: string } {
  for (const r of [...(sheet?.rules ?? [])].sort((a, b) => a.priority - b.priority)) {
    if (fired.has(r.priority)) continue;
    const matches = eligible.filter((c) => banFilter(pack, r.filter, c));
    if (matches.length === 0) continue;
    fired.add(r.priority);
    return { hero: selectOne(matches, r.select, r.metric), by: `rule ${r.priority}` };
  }
  return { hero: [...eligible].sort(byCostThenId)[0]!, by: "fallback" };
}

/** Runs the draft for a schema-valid roster battle whose rosters passed the roster layer. */
export function resolveDraft(pack: Pack, input: RosterBattle): DraftOutcome {
  const { steps, fielded, defender_anchor } = pack.rules.draft;
  const issues: DraftIssue[] = [];
  const fail = (): DraftOutcome => ({ battle: null, steps: records, sides: null, issues });
  const records: DraftStepRecord[] = [];

  // Pick counts first: each human step consumes one pick of its kind.
  for (const side of SIDES) {
    for (const action of ["ban", "protect"] as const) {
      const need = steps.filter((s) => s.actor === side && s.source === "human" && s.action === action).length;
      const key = action === "ban" ? "bans" : "protects";
      const have = input[side].draft?.[key]?.length ?? 0;
      if (have !== need) issues.push({ code: "E_DRAFT_PICKS", message: `${side} has ${have} draft ${key}; its human ${action} steps need exactly ${need}`, path: `${side}.draft.${key}` });
    }
  }
  if (issues.length > 0) return fail();

  const pool: Record<DraftSide, Candidate[]> = {
    challenger: input.challenger.roster.heroes.map((h, i) => candidate(pack, h, i)),
    defender: input.defender.roster.heroes.map((h, i) => candidate(pack, h, i)),
  };
  const anchor: Record<DraftSide, string | null> = { challenger: null, defender: defender_anchor ? input.defender.roster.anchor : null };
  const banned: Record<DraftSide, string[]> = { challenger: [], defender: [] };
  const prot: Record<DraftSide, string[]> = { challenger: [], defender: [] };
  const fired: Record<DraftSide, Set<number>> = { challenger: new Set(), defender: new Set() };
  const used = { challenger: { ban: 0, protect: 0 }, defender: { ban: 0, protect: 0 } };

  for (const [i, st] of steps.entries()) {
    const side = st.action === "ban" ? other(st.actor) : st.actor;
    const eligible = pool[side].filter((c) => {
      const id = c.entry.char_id;
      if (banned[side].includes(id) || prot[side].includes(id)) return false;
      return st.action === "protect" || id !== anchor[side];
    });
    let hero: Candidate | undefined;
    let by: string;
    if (st.source === "human") {
      const key = st.action === "ban" ? "bans" : "protects";
      const k = used[st.actor][st.action]++;
      const id = input[st.actor].draft![key]![k]!;
      const path = `${st.actor}.draft.${key}[${k}]`;
      hero = eligible.find((c) => c.entry.char_id === id);
      if (!hero) {
        const why = !pool[side].some((c) => c.entry.char_id === id) ? `is not in the ${side} roster`
          : banned[side].includes(id) ? "is already banned"
          : prot[side].includes(id) ? (st.action === "ban" ? "is protected" : "is already protected")
          : id === anchor[side] ? "is the anchor" : "is not eligible";
        issues.push({ code: "E_DRAFT_PICK", message: `step ${i + 1} (${st.actor} ${st.action}): '${id}' ${why}`, path });
        return fail();
      }
      by = "human";
    } else {
      if (eligible.length === 0) {
        issues.push({ code: "E_DRAFT_RESULT", message: `step ${i + 1} (${st.actor} ${st.action}): no eligible ${side} hero`, path: `${side}.roster.heroes` });
        return fail();
      }
      ({ hero, by } = st.action === "ban"
        ? ruleSheetPick(pack, input[st.actor].roster.ban_sheet, eligible, fired[st.actor])
        : { hero: [...eligible].sort(byCostThenId)[0]!, by: "fallback" });
    }
    (st.action === "ban" ? banned : prot)[side].push(hero.entry.char_id);
    records.push({ step: i + 1, actor: st.actor, action: st.action, source: st.source, side, hero: hero.entry.char_id, by });
  }

  const sides = {} as Record<DraftSide, DraftSideResult>;
  const fieldedSides = {} as Record<DraftSide, Battle["challenger"]>;
  for (const side of SIDES) {
    const r = input[side].roster;
    const left = r.heroes.filter((h) => !banned[side].includes(h.char_id));
    if (left.length !== fielded) {
      issues.push({ code: "E_DRAFT_RESULT", message: `${side} ends the draft with ${left.length} heroes; must be exactly ${fielded}`, path: `${side}.roster.heroes` });
      continue;
    }
    const rank = (id: string) => r.leader_line.indexOf(id);
    const heroes = [...left].sort((a, b) => rank(a.char_id) - rank(b.char_id)).map((h) => ({ ...h }));
    const leader = heroes[0]!.char_id;
    const moved = resolveOverflow(pack, heroes, leader);
    if (moved === null) {
      issues.push({ code: "E_BATTLE_ROW_FULL", message: `${side} heroes do not fit in two rows of ${pack.rules.board.columns}`, path: `${side}.roster.heroes` });
      continue;
    }
    sides[side] = { fielded: heroes.map((h) => h.char_id), banned: [...banned[side]], protected: [...prot[side]], leader, anchor: anchor[side], moved };
    fieldedSides[side] = { heroes, leader, ...(input[side].edits ? { edits: input[side].edits } : {}) };
  }
  if (issues.length > 0) return fail();

  const battle: Battle = {
    battle_id: input.battle_id, version: input.version, battlefield: input.defender.roster.battlefield ?? null, ...(input.time ? { time: input.time } : {}), seeds: [...input.seeds],
    challenger: fieldedSides.challenger, defender: fieldedSides.defender,
  };
  return { battle, steps: records, sides, issues };
}

/**
 * Row overflow by leader-line rank (heroes already in rank order): while a row holds more than `columns` heroes, the lowest-ranked
 * non-leader in it gets preferred_row set to the other row (and its explicit column dropped). Mutates the entries; returns the moved ids, or null if both rows are full.
 */
function resolveOverflow(pack: Pack, heroes: RosterHero[], leader: string): string[] | null {
  const cols = pack.rules.board.columns;
  const rowOf = (h: RosterHero): Row => {
    const ch = pack.byId.characters.get(h.char_id) as Character;
    return h.preferred_row ?? ch.preferred_row ?? classDefaultRow(ch.class);
  };
  const moved: string[] = [];
  for (;;) {
    const full = (["front", "back"] as const).find((row) => heroes.filter((h) => rowOf(h) === row).length > cols);
    if (!full) return moved;
    const to: Row = full === "front" ? "back" : "front";
    if (heroes.filter((h) => rowOf(h) === to).length >= cols) return null;
    const h = [...heroes].reverse().find((x) => rowOf(x) === full && x.char_id !== leader)!;
    h.preferred_row = to;
    delete h.column; // an explicit column belonged to the old row's slot; it takes the first free column of the new row
    moved.push(h.char_id);
  }
}
