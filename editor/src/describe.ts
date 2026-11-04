// The ONE plain-words formatter for content (tooltips, unit overview, pinned panels). Pure TypeScript: no DOM, no Node imports, so the
// browser and test/describe.test.ts both use it. Everything is generated from the structured data; ids are resolved to names through the
// Catalog (GET /api/catalog). A field or shape it does not know falls back to a generic "key: value" rendering, never "undefined".
//
// Every describeX returns a `Described`:
//   summary  one line, the tooltip headline (always non-empty)
//   lines    optional extra detail lines (may be empty), one fact per line
// `text(d)` joins both into a multi-line string.
import { equipmentStats, equipmentType } from "../../src/equipmentBase";
import type { ConditionNode, Effect } from "../../src/schema";
import { isSelector } from "../../src/schema";
import type { Catalog } from "../apiTypes";

export interface Described { summary: string; lines: string[] }

type Cat = Catalog;
type Skill = Catalog["skills"][number];
type Equipment = Catalog["equipment"][number];
type Status = Catalog["statuses"][number];
type God = Catalog["gods"][number];
type Soldier = Catalog["soldiers"][number];
type SoldierSkill = Soldier["passive_effects"][number];
type Terrain = Catalog["terrains"][number];
type Character = Catalog["characters"][number];
type Aura = Character["leader_aura"];

export const text = (d: Described): string => [d.summary, ...d.lines].join("\n");

// ------------------------------------------------------------------ helpers
const fmt = (n: unknown): string => (typeof n === "number" && Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(n));
const signed = (n: number): string => (n >= 0 ? `+${fmt(n)}` : fmt(n));
const words = (s: unknown): string => String(s).replace(/_/g, " ");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const list = (xs: string[]): string => xs.join(", ");
const SIDE_WORD: Record<string, string> = { self: "self", ally: "ally", enemy: "enemy", target: "target", any: "any unit", both: "both sides" };

/** Plain rendering of any value (used by the generic fallbacks). */
function plain(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "number") return fmt(v);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length ? `[${v.map(plain).join(", ")}]` : "none";
  if (typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${k}: ${plain(x)}`).join(", ")}}`;
  return String(v);
}
/** "key: value" rendering of an unknown object (never drops a field). */
const generic = (label: string, o: object): string => {
  const rest = Object.entries(o).filter(([k]) => k !== "type").map(([k, v]) => `${k}=${plain(v)}`);
  return rest.length ? `${label} (${rest.join(", ")})` : label;
};

interface Idx { byName: Map<string, string>; leaf: Map<string, Cat["leaves"][number]> }
const cache = new WeakMap<Cat, Idx>();
function idx(cat: Cat): Idx {
  let i = cache.get(cat);
  if (!i) {
    const byName = new Map<string, string>();
    for (const k of ["characters", "skills", "equipment", "statuses", "gods", "soldiers", "terrains", "factions"] as const) {
      for (const x of cat[k] as { id: string; name: string }[]) byName.set(`${k}:${x.id}`, x.name);
    }
    i = { byName, leaf: new Map(cat.leaves.map((l) => [l.type, l])) };
    cache.set(cat, i);
  }
  return i;
}
/** Name of an id in a collection; the id itself when unknown. */
const nameOf = (cat: Cat, kind: "characters" | "skills" | "equipment" | "statuses" | "gods" | "soldiers" | "terrains" | "factions", id: unknown): string =>
  idx(cat).byName.get(`${kind}:${String(id)}`) ?? String(id);

/** `paired`: the stat the line also applies to (INT/MDEF pairing), shown as "ATK (and INT)". */
const modText = (stat: string, mode: string, value: number, paired?: string): string => {
  const st = paired ? `${stat} (and ${paired})` : stat;
  return mode === "percent" ? `${signed(value)}% ${st}` : `${signed(value)} ${st}`;
};
/** INT/MDEF pairing (src/engine/stats.ts PAIRED_STATS, Decision 132): skill statuses, auras and soldier skills that change ATK / DEF also change INT / MDEF, unless the same source names that stat. */
const PAIRS: Record<string, string> = { ATK: "INT", DEF: "MDEF" };
const pairOf = (stat: string, named: readonly string[]): string | undefined => {
  const p = PAIRS[stat];
  return p && !named.includes(p) ? p : undefined;
};
const namedStats = (es: readonly Effect[]): string[] => es.flatMap((e) => (e.type === "modify_stat" ? [e.stat] : []));

const TARGET: Record<string, string> = {
  self: "itself", targets: "the targets", field: "the whole field", attacker: "the attacker", caster_row: "the caster's row", hit_unit: "each unit hit",
};
const target = (t: unknown): string => (t === undefined ? "the targets" : TARGET[String(t)] ?? words(t));

/** Targeting phrase for a skill's `targeting` block: "one enemy", "a row of enemies", ... */
function targetPhrase(t: Skill["targeting"]): string {
  const one: Record<string, string> = { self: "itself", ally: "one ally", enemy: "one enemy", any: "one unit" };
  const many: Record<string, string> = { self: "itself", ally: "allies", enemy: "enemies", any: "units" };
  switch (t.shape) {
    case "single": return one[t.side] ?? "one unit";
    case "row": return `a row of ${many[t.side] ?? "units"}`;
    case "column": return `a column of ${many[t.side] ?? "units"}`;
    case "all": return `all ${many[t.side] ?? "units"}`;
    case "self": return "itself";
    case "event_unit": return "the unit that set it off";
    case "caster_row": return "the caster's row";
    case "attacker": return "the attacker";
    case null: return one[t.side] ?? "one unit";
    default: return words(t.shape);
  }
}

// ------------------------------------------------------------------ conditions
function leafParams(cat: Cat, type: string, p: Record<string, unknown>): string {
  const ref = cat.leaf_refs[type];
  const parts: string[] = [];
  if ("side" in p) parts.push(SIDE_WORD[String(p.side)] ?? words(p.side));
  if ("stat" in p) parts.push(String(p.stat));
  if ("status_id" in p) parts.push(nameOf(cat, "statuses", p.status_id));
  if ("is" in p) parts.push(`is ${words(p.is)}`);
  if ("ignore" in p) parts.push(`ignoring ${words(p.ignore)}s`);
  const known = new Set(["type", "side", "stat", "status_id", "is", "ignore", "op", "value"]);
  if ("op" in p) parts.push(`${p.op} ${fmt(p.value)}`);
  else if ("value" in p) {
    let v: string = typeof p.value === "boolean" ? (p.value ? "yes" : "no") : words(p.value);
    if (ref?.field === "value") v = nameOf(cat, ref.kind === "hero" ? "characters" : ref.kind === "faction" ? "factions" : "statuses", p.value);
    parts.push(v);
  }
  for (const [k, v] of Object.entries(p)) if (!known.has(k)) parts.push(`${k}=${plain(v)}`);
  return parts.join(" ");
}

/** One-line wording of a condition tree. Groups: all -> "a and b", any -> "a or b", not -> "not (...)". `lines` lists a group's members. */
export function describeCondition(node: ConditionNode | null | undefined, cat: Cat): Described {
  if (!node) return { summary: "always", lines: [] };
  const n = node as Record<string, unknown>;
  const one = (c: ConditionNode): string => {
    const s = describeCondition(c, cat).summary;
    const g = c as Record<string, unknown>;
    const multi = (Array.isArray(g.all) && g.all.length > 1) || (Array.isArray(g.any) && g.any.length > 1);
    return multi ? `(${s})` : s;
  };
  if (Array.isArray(n.all)) {
    const kids = n.all as ConditionNode[];
    return { summary: kids.map((c) => one(c)).join(" and "), lines: kids.length > 1 ? kids.map((c) => `- ${describeCondition(c, cat).summary}`) : [] };
  }
  if (Array.isArray(n.any)) {
    const kids = n.any as ConditionNode[];
    return { summary: kids.map((c) => one(c)).join(" or "), lines: kids.length > 1 ? kids.map((c) => `- ${describeCondition(c, cat).summary}`) : [] };
  }
  if ("not" in n) return { summary: `not (${describeCondition(n.not as ConditionNode, cat).summary})`, lines: [] };
  const { type, ...params } = n as { type?: unknown } & Record<string, unknown>;
  if (typeof type !== "string") return { summary: generic("condition", n), lines: [] };
  const leaf = idx(cat).leaf.get(type);
  const desc = leaf?.description ?? words(type);
  const ps = leafParams(cat, type, params);
  return { summary: ps ? `${desc}: ${ps}` : desc, lines: [] };
}

// ------------------------------------------------------------------ effects
const TRIGGER_WORD: Record<string, string> = { pre_battle: "before battle", on_event: "on its event", on_hit: "on hit", on_attack: "after attacking" };
const DURATION_WORD: Record<string, string> = {
  this_attack: "for this attack", next_hit: "for the next hit", until_next_action: "until its next action", phase: "for the phase", battle: "for the whole battle",
  first_single_hit: "on the first single-target hit each phase",
};

function scaling(terms: { stat: string; coef: number }[], mult: number): string {
  if (terms.length === 1) return `${fmt(mult * terms[0]!.coef)}x ${terms[0]!.stat}`;
  return `${fmt(mult)}x (${terms.map((t) => (t.coef === 1 ? t.stat : `${fmt(t.coef)} ${t.stat}`)).join(" + ")})`;
}

function effectBody(e: Effect, cat: Cat, at?: string, named?: readonly string[]): string {
  switch (e.type) {
    case "damage": {
      const extra: string[] = [];
      if (e.ignores_guard) extra.push("ignores GUARD");
      if (e.hit_bonus_percent) extra.push(`${signed(e.hit_bonus_percent)}% hit chance`);
      for (const b of e.bonus_vs_class) extra.push(`${signed(b.modifier_percent)}% vs ${b.class}`);
      for (const b of e.bonus_on_terrain ?? []) extra.push(`${signed(b.modifier_percent)}% on ${nameOf(cat, "terrains", b.terrain)}`);
      if (e.bonus_if_target_full_hp_percent) extra.push(`${signed(e.bonus_if_target_full_hp_percent)}% if the target is at full HP`);
      return [`Deals ${scaling(e.scaling, e.multiplier)} ${e.damage_type} ${e.range} damage${at ? ` to ${at}` : ""}`, ...extra].join("; ");
    }
    case "heal": {
      const amount = e.percent_max_hp !== undefined ? `${fmt(e.percent_max_hp)}% of max HP` : e.scaling && e.multiplier !== undefined ? `${scaling(e.scaling, e.multiplier)} HP` : "HP";
      const heal = `Heals ${e.target === "lowest_hp_ally" ? "the lowest-HP ally hero" : at ?? "the target"} for ${amount}`;
      return e.chance_percent === undefined ? heal : `${fmt(e.chance_percent)}% chance: ${heal}`;
    }
    case "apply_status": {
      const name = nameOf(cat, "statuses", e.status_id);
      const chance = e.chance_percent >= 100 ? "Applies" : `${fmt(e.chance_percent)}% chance to apply`;
      return `${chance} ${name} to ${target(e.target)}${e.include_soldiers ? " (soldiers too)" : ""}`;
    }
    case "remove_buffs":
      return `Removes dispellable buffs from ${e.target !== undefined ? target(e.target) : e.side === "enemy" ? "every enemy" : e.side === "ally" ? "every ally" : "the targets"}`;
    case "self_hp_cost": return `Costs the caster ${fmt(e.percent)}% of its current HP (never below 1)`;
    case "remove_debuffs": return `Removes up to ${e.count} debuff${e.count === 1 ? "" : "s"} from ${at ?? "the target"}, newest first`;
    case "modify_stat":
      return `${modText(e.stat, e.mode, e.value, named ? pairOf(e.stat, named) : undefined)}${e.source_category ? ` (${e.source_category} stacking)` : ""}`;
    case "modify_pp":
      return `${signed(e.amount)} ${e.pool} PP for ${target(e.target)}${e.once_per_attack ? " (once per attack)" : ""}`;
    case "reduce_damage": {
      const when = e.duration === null || e.duration === undefined ? "" : ` ${DURATION_WORD[e.duration] ?? words(e.duration)}`;
      return `Reduces ${e.applies_to === "all" ? "all" : e.applies_to} damage taken by ${fmt(e.percent)}%${when}${e.counts_as_guard ? " (counts as GUARD: ignored by attacks that ignore GUARD)" : ""}`;
    }
    case "delay_action": return `Delays the target's next action by ${fmt(e.counts)} timeline counts`;
    case "advance_action": return `Brings the target's next action ${fmt(e.counts)} timeline counts closer`;
    case "cover": return `Takes single-target ${e.damage_type ? `${e.damage_type} ` : ""}hits aimed at an ally${e.same_row ? " in its row" : ""} instead of them`;
    case "reflect_damage": return `Reflects ${fmt(e.percent)}% of the damage taken from an attacking action back at the attacker`;
    case "ignore_guard": return "Its attacks ignore GUARD";
    case "ignore_defense": return `Its attacks ignore ${fmt(e.percent)}% of the target's DEF and MDEF`;
    case "damage_bonus": return e.trigger === "on_event" ? `Its next attack deals ${signed(e.percent)}% damage (one charge, does not stack)` : `Deals ${signed(e.percent)}% damage`;
    case "crit_damage": return `${signed(e.percent)}% crit damage ${e.on}`;
    default: return generic(words((e as { type?: unknown }).type ?? "effect"), e as object);
  }
}

/**
 * One effect in words, including its `trigger` and `condition` as a suffix: "Deals 1.2x ATK physical melee damage to one enemy; +25% vs
 * cavalry (on hit, if Active PP: self >= 2)". `at` names who the skill aims it at (damage / heal only); describeSkill passes it. `named`: the
 * stats its source names, for a source whose ATK / DEF lines are paired with INT / MDEF (auras, soldier skills); absent = never paired.
 */
export function describeEffect(e: Effect, cat: Cat, at?: string, named?: readonly string[]): Described {
  const rec = e as { trigger?: string; condition?: ConditionNode | null };
  const extra: string[] = [];
  if (rec.trigger && TRIGGER_WORD[rec.trigger]) extra.push(TRIGGER_WORD[rec.trigger]!);
  else if (rec.trigger && rec.trigger !== "always") extra.push(words(rec.trigger));
  if (rec.condition) extra.push(`if ${describeCondition(rec.condition, cat).summary}`);
  const body = effectBody(e, cat, at, named);
  return { summary: extra.length ? `${body} (${list(extra)})` : body, lines: [] };
}

/** `paired`: the source's ATK / DEF lines also apply to INT / MDEF (auras, soldier skills). */
const effectLines = (es: Effect[], cat: Cat, at?: string, paired = false): string[] => es.map((e) => describeEffect(e, cat, at, paired ? namedStats(es) : undefined).summary);

// ------------------------------------------------------------------ skills
const TRIGGER_SKILL: Record<string, string> = { own_turn: "on its own turn", pre_battle: "before battle", on_event: "when triggered", while_condition: "while its condition holds" };

export function describeSkill(s: Skill, cat: Cat): Described {
  const t = s.targeting;
  const aim = targetPhrase(t);
  let trig = TRIGGER_SKILL[s.trigger] ?? words(s.trigger);
  if (s.trigger === "on_event" && s.trigger_event) trig = `when ${words(s.trigger_event)}${s.trigger_timing ? ` (${words(s.trigger_timing)})` : ""}`;
  const summary = `${cap(trig)}; costs ${s.pp_cost} ${s.pp_pool} PP; ${s.category === "active" ? "aims at" : "applies to"} ${aim}`;
  const lines = effectLines(s.effects, cat, aim);
  if (s.use_limit) lines.push(`Limited to ${s.use_limit} use${s.use_limit === 1 ? "" : "s"} per phase`);
  if (s.cooldown) lines.push(`Cooldown: ${s.cooldown} of its own actions`);
  if (s.default_activation) lines.push(`Default activation: ${describeCondition(s.default_activation, cat).summary}`);
  if (s.targeting.default_main) lines.push(`Default Main: ${(isSelector(s.targeting.default_main) ? { summary: `${s.targeting.default_main.select}${s.targeting.default_main.metric ? ` ${s.targeting.default_main.metric}` : ""}` } : describeCondition(s.targeting.default_main, cat)).summary}`);
  if (s.targeting.default_sub) lines.push(`Then: ${describeCondition(s.targeting.default_sub, cat).summary}`);
  if (t.valid_rows.length) lines.push(`Valid target rows: ${list(t.valid_rows)}`);
  if (t.max_targets) lines.push(`Up to ${t.max_targets} target${t.max_targets === 1 ? "" : "s"}`);
  if (s.interactions.guard !== "standard") lines.push(`GUARD: ${s.interactions.guard}`);
  if (s.interactions.soldiers !== "standard") lines.push(`Soldiers: ${words(s.interactions.soldiers)}`);
  if (s.pp_recovery.allowed === false) lines.push("Cannot recover PP");
  if (s.tags.length) lines.push(`Tags: ${list(s.tags)}`);
  if (s.eligible.classes.length || s.eligible.characters.length) {
    lines.push(`Only for: ${list([...s.eligible.classes, ...s.eligible.characters.map((c) => nameOf(cat, "characters", c))])}`);
  }
  return { summary, lines };
}

// ------------------------------------------------------------------ equipment
/** "Sword base: ATK +150, DEF +24": the item type's flat stat lines (rules.equipment_bases, Decision 133). */
export function describeEquipmentBase(q: Pick<Equipment, "slot" | "tags">, cat: Cat): string {
  const t = equipmentType(q);
  if (!t) return `${cap(q.slot)} (no equipment type)`;
  const mods = Object.entries(equipmentStats(q, cat.rules.equipment_bases)).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${signed(v)}`);
  return `${cap(words(t))} base: ${mods.length ? list(mods) : "no stats"}`;
}

export function describeEquipment(q: Equipment, cat: Cat): Described {
  const pp = Object.entries(q.pp_modifiers).filter(([, v]) => v !== 0).map(([k, v]) => `${signed(v)} ${k} PP`);
  const extra = [...pp, ...(q.effects.length ? [`${q.effects.length} effect${q.effects.length === 1 ? "" : "s"}`] : [])];
  const summary = `${describeEquipmentBase(q, cat)}${extra.length ? `; ${list(extra)}` : ""}`;
  const lines = effectLines(q.effects, cat);
  const el = q.eligible;
  if (el.classes.length) lines.push(`Classes: ${list(el.classes)}`);
  if (el.characters.length) lines.push(`Heroes: ${list(el.characters.map((c) => nameOf(cat, "characters", c)))}`);
  if (el.required_tags.length) lines.push(`Wearer needs: ${list(el.required_tags)}`);
  if (q.rules.duplicate_allowed_in_both_accessory_slots) lines.push("May be worn in both accessory slots");
  return { summary, lines };
}

// ------------------------------------------------------------------ statuses
const DURATION_UNIT: Record<string, string> = {
  affected_unit_actions: "the affected unit's actions", source_unit_actions: "the source's actions", until_next_hit: "hits", timeline_counts: "timeline counts",
};

export function describeStatus(s: Status, cat: Cat): Described {
  void cat;
  const d = s.duration;
  let dur: string;
  switch (d.unit) {
    case "affected_unit_actions": case "source_unit_actions": case "until_next_hit": case "timeline_counts":
      dur = `lasts ${d.count ?? "?"} of ${DURATION_UNIT[d.unit]}`; break;
    case "while_condition": dur = "lasts while its condition holds"; break;
    case "until_used": dur = "lasts until used"; break;
    case "battle": dur = "lasts the whole battle"; break;
    case "instant": dur = "takes effect instantly and is not stored"; break;
    default: dur = `duration ${words(d.unit)}`;
  }
  const named = s.modifiers.map((m) => m.stat);
  const mods = s.modifiers.map((m) => modText(m.stat, m.mode, m.value, pairOf(m.stat, named)));
  const f = s.flags;
  const flags: string[] = [];
  if (f.blocks_debuffs) flags.push("Blocks debuffs");
  if (f.intercepts_death.enabled) flags.push(`Revives at ${fmt(f.intercepts_death.revive_hp_percent)}% HP instead of dying`);
  if (f.overrides_targeting) flags.push(`Targeting becomes ${words(f.overrides_targeting)}`);
  if (f.ignores_tactics) flags.push("Ignores its tactic sheet");
  if (f.prevents_action) flags.push("Loses its actions");
  if (f.delays_pending_action) flags.push("Its pending action is pushed back");
  if (f.removes_on_hit) flags.push("Ends when hit");
  if (f.prevents_evasion) flags.push("Cannot evade");
  if (f.heals_on_hit_percent_max_hp > 0) flags.push(`Heals ${fmt(f.heals_on_hit_percent_max_hp)}% of max HP when hit`);
  const summary = `${cap(s.category)}: ${list([...mods, ...flags]) || "no stat changes"}; ${dur}`;
  const lines: string[] = [];
  if (s.description) lines.push(s.description);
  if (s.modifiers.some((m) => pairOf(m.stat, named))) lines.push("The INT / MDEF part applies when a skill or soldier skill applies it, not an item or blessing");
  if (d.applying_action_counts) lines.push("The applying action counts as the first turn");
  lines.push(`Expires ${words(d.expires)}; counts actions of the ${d.counts_actions_of} unit`);
  const k = s.stacking;
  lines.push(k.stackable ? `Stacks${k.max_stacks ? ` up to ${k.max_stacks}` : ""}; on reapply: ${words(k.on_reapply)}` : `Does not stack; on reapply: ${words(k.on_reapply)}`);
  if (k.unique) lines.push("Only one at a time");
  if (k.suppress_weaker) lines.push("Suppresses weaker copies");
  lines.push(s.removal.removable_by_dispel ? "Can be dispelled" : "Cannot be dispelled");
  if (!s.removal.removed_on_death) lines.push("Stays after death");
  if (s.source_category !== "inherit") lines.push(`Stacks as ${s.source_category}`);
  return { summary, lines };
}

// ------------------------------------------------------------------ gods
/** `tier` 2 = the two_piece blessing (2 sigils), 4 = a 4-piece enchantment (4 sigils; the 2-sigil tier stays unlocked as well): `side`'s, or both, one line each. */
export function describeBlessing(g: God, tier: 2 | 4, cat: Cat, side?: "def" | "atk"): Described {
  const lines = tier === 2 ? effectLines(g.blessing.two_piece, cat) : (side ? [side] : (["def", "atk"] as const)).map((s) => {
    const f = g.blessing[`four_piece_${s}`];
    return `${s.toUpperCase()}${f.name ? ` ${f.name}` : ""}: ${effectLines(f.effects, cat).join("; ")}`;
  });
  return { summary: `${g.blessing.name} (${tier} ${g.name} sigils): ${lines.join("; ")}`, lines };
}

// ------------------------------------------------------------------ auras
export function describeAura(a: Aura, cat: Cat): Described {
  const side = a.target.side === "both" ? "units on both sides" : a.target.side === "ally" ? "allies" : "enemies";
  const when = a.trigger === "on_event" ? `when ${words(a.trigger_event ?? "its event")}` : "always";
  const lines = effectLines(a.effects, cat, undefined, true);
  const summary = `${a.name} (${words(a.type)} aura, ${when}): ${lines.join("; ")}; affects ${side}${a.target.include_soldiers ? " and their soldiers" : ""}`;
  const out = [...lines];
  if (a.condition) out.push(`Only while: ${describeCondition(a.condition, cat).summary}`);
  if (a.target.filter) out.push(`Only on: ${describeCondition(a.target.filter, cat).summary}`);
  if (a.faction_id) out.push(`Faction: ${nameOf(cat, "factions", a.faction_id)}`);
  if (a.trigger_includes_idle_action) out.push("Also fires on idle actions");
  return { summary, lines: out };
}

// ------------------------------------------------------------------ soldiers
const SOLDIER_TARGET: Record<string, string> = { self_squad: "its own squad", leader: "the leader", party: "the whole party" };

export function describeSoldierSkill(p: SoldierSkill, cat: Cat): Described {
  const lines = effectLines(p.effects, cat, undefined, true);
  const who = SOLDIER_TARGET[p.target] ?? words(p.target);
  return { summary: `${p.name ?? "Soldier skill"} (${who}): ${lines.join("; ")}`, lines };
}

export function describeSoldier(s: Soldier, cat: Cat): Described {
  const b = s.basic_attack;
  const summary = `${s.count} ${s.mounted ? "mounted " : ""}${s.class} soldiers (${s.default_soldier_row} row); ${b.range} ${b.damage_type} attack ${scaling(b.scaling, 1)}`;
  const lines = [
    `Per soldier: ${list(Object.entries(s.per_soldier_stats).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${fmt(v)}`)) || "no stats"}`,
    `Rows: ${list(s.allowed_soldier_rows)}`,
    ...s.passive_effects.map((p) => describeSoldierSkill(p, cat).summary),
  ];
  if (s.eligible_classes.length) lines.push(`Classes: ${list(s.eligible_classes)}`);
  if (s.eligible_heroes.length) lines.push(`Heroes: ${list(s.eligible_heroes.map((h) => nameOf(cat, "characters", h)))}`);
  return { summary, lines };
}

// ------------------------------------------------------------------ terrain
export function describeTerrain(t: Terrain, cat: Cat): Described {
  void cat;
  const lines = t.modifiers.map((m) => `${modText(m.stat, m.mode, m.value)} for ${list(m.classes)}`);
  if (t.water) lines.push("Water: aquatic units gain a SPD bonus");
  return { summary: lines.length ? lines.join("; ") : "No modifiers", lines };
}

// ------------------------------------------------------------------ rules
/** "Infantry beats lancer (+X% damage)" for every class_advantage pair; pair override or the default matchup percent. */
export function describeClassAdvantage(cat: Cat): Described {
  const lines = cat.rules.class_advantage.map((p) => `${p.attacker} beats ${p.defender} (+${fmt(p.damage_percent ?? cat.rules.matchup.advantage_damage_percent)}% damage)`);
  return { summary: lines.length ? `${lines.length} class advantages` : "No class advantages", lines };
}
