import { FILES } from "../load";
import { EFFECT_REGISTRY, OFFICIAL_ONLY_STATUS_FLAGS } from "../registry/effects";
import { CANONICAL_ID, COUNTED_DURATIONS, SLOT_TAGS, type Effect } from "../schema";
import type { Collector, Tier } from "../types";
import { checkCondition } from "./conditions";
import { canEquip, skillEligible } from "./eligibility";
import type { Pack } from "./pack";
import { checkSlotShape } from "./tactics";
import { forEachCondition, forEachEffect } from "./walk";

/** Cross-reference, semantic and tier rules over the entries that passed the schema pass. */
export function checkPack(c: Collector, pack: Pack, tier: Tier): void {
  checkIds(c, pack);
  checkConditions(c, pack, tier);
  checkEffects(c, pack, tier);
  checkSkills(c, pack, tier);
  checkStatuses(c, pack, tier);
  checkEquipment(c, pack, tier);
  checkSoldiers(c, pack);
  checkCharacters(c, pack, tier);
  checkRules(c, pack);
  checkUsage(c, pack);
}

// ------------------------------------------------------------------ ids
function checkIds(c: Collector, pack: Pack): void {
  const seen = new Map<string, string>();
  const groups: [string, { id: string }[]][] = [
    [FILES.characters, pack.characters],
    [FILES.skills, pack.skills],
    [FILES.equipment, pack.equipment],
    [FILES.statuses, pack.statuses],
    [FILES.soldiers, pack.soldiers],
    [FILES.factions, pack.factions],
  ];
  for (const [file, entries] of groups) {
    for (const e of entries) {
      const prev = seen.get(e.id);
      if (prev) c.error("E_DUP_ID", `id '${e.id}' is already used in ${prev}`, { file, id: e.id });
      else seen.set(e.id, file);
      if (!CANONICAL_ID.test(e.id)) {
        c.info("I_LEGACY_ID", `'${e.id}' is not in the canonical type_### form (kept as authored)`, { file, id: e.id });
      }
    }
  }
}

// ------------------------------------------------------------------ conditions and effects
function checkConditions(c: Collector, pack: Pack, tier: Tier): void {
  forEachCondition(pack, (node, ctx, where) => checkCondition(node, ctx, where, c, pack, tier));
}

function checkEffects(c: Collector, pack: Pack, tier: Tier): void {
  forEachEffect(pack, (e: Effect, where) => {
    if (e.type === "apply_status" && !pack.byId.statuses.has(e.status_id)) {
      c.error("E_REF_MISSING", `effect applies unknown status '${e.status_id}'`, where);
    }
    if (tier === "community") {
      if (!EFFECT_REGISTRY[e.type]?.communitySafe) c.error("E_NOT_COMMUNITY_SAFE", `effect type '${e.type}' is official-only`, where);
      if (e.type === "apply_status" && e.target === "field") c.error("E_NOT_COMMUNITY_SAFE", "field-wide effects are official-only", where);
    }
  });
}

// ------------------------------------------------------------------ skills
function checkSkills(c: Collector, pack: Pack, tier: Tier): void {
  const { limits } = pack.rules;
  for (const s of pack.skills) {
    const loc = { file: FILES.skills, id: s.id };
    if (s.pp_pool !== s.category) c.error("E_PP_POOL_MISMATCH", `a ${s.category} skill must spend ${s.category} PP, not ${s.pp_pool}`, { ...loc, path: "pp_pool" });
    if (s.category === "active" && s.trigger !== "own_turn") c.error("E_ACTIVE_TRIGGER", `an active skill runs on the unit's own turn, not '${s.trigger}'`, { ...loc, path: "trigger" });
    if (s.category === "passive" && s.trigger === "own_turn") c.error("E_PASSIVE_TRIGGER", "a passive skill needs a pre_battle, on_event or while_condition trigger", { ...loc, path: "trigger" });
    if (s.trigger === "on_event") {
      if (!s.trigger_event) c.error("E_EVENT_REQUIRED", "an on_event passive needs trigger_event", { ...loc, path: "trigger_event" });
      if (!s.trigger_timing) c.error("E_TIMING_REQUIRED", "an on_event passive needs trigger_timing (before_hit or after_hit)", { ...loc, path: "trigger_timing" });
    } else {
      if (s.trigger_event) c.error("E_EVENT_UNEXPECTED", "trigger_event is only for on_event passives", { ...loc, path: "trigger_event" });
      if (s.trigger_timing) c.error("E_TIMING_UNEXPECTED", "trigger_timing is only for on_event passives", { ...loc, path: "trigger_timing" });
    }
    if (limits.max_effects_per_skill !== null && s.effects.length > limits.max_effects_per_skill) {
      c.error("E_TOO_MANY_EFFECTS", `${s.effects.length} effects exceeds the limit of ${limits.max_effects_per_skill}`, { ...loc, path: "effects" });
    }

    // Tags drive ban rules and the gauntlet, so they must reflect what the skill really does.
    const has = (t: string) => (s.tags as string[]).includes(t);
    const needs = new Set<string>();
    const damaging = s.effects.some((e) => e.type === "damage");
    if (damaging) needs.add("damage");
    if (s.effects.some((e) => e.type === "heal")) needs.add("heal");
    if (damaging && (s.targeting.shape === "row" || s.targeting.shape === "column" || s.targeting.shape === "all")) needs.add("aoe");
    for (const e of s.effects) {
      if (e.type !== "apply_status") continue;
      const st = pack.byId.statuses.get(e.status_id);
      if (!st) continue;
      if (st.flags.intercepts_death.enabled) needs.add("revive");
      if (st.flags.prevents_action || st.flags.delays_pending_action) needs.add("stun");
    }
    for (const t of needs) if (!has(t)) c.warn("W_TAG_MISSING", `the skill's effects imply the '${t}' tag, which is missing`, { ...loc, path: "tags" });

    if (damaging && ["row", "column", "all"].includes(s.targeting.shape ?? "") && s.targeting.damage_distribution === null) {
      c.error("E_AOE_DISTRIBUTION", "an area damage skill must declare damage_distribution", { ...loc, path: "targeting.damage_distribution" });
    }
    s.eligible.characters.forEach((id, i) => {
      if (!pack.byId.characters.has(id)) c.error("E_REF_MISSING", `eligible character '${id}' does not exist`, { ...loc, path: `eligible.characters[${i}]` });
    });
    if (s.default_activation) checkSlotShape(s.default_activation, { ...loc, path: "default_activation" }, c);
    if (s.targeting.default_main) checkSlotShape(s.targeting.default_main, { ...loc, path: "targeting.default_main" }, c);
    if (s.targeting.default_sub) checkSlotShape(s.targeting.default_sub, { ...loc, path: "targeting.default_sub" }, c);
    if (tier === "community" && s.cost_override != null) c.error("E_NOT_COMMUNITY_SAFE", "cost_override is official-only", { ...loc, path: "cost_override" });
  }
}

// ------------------------------------------------------------------ statuses
function checkStatuses(c: Collector, pack: Pack, tier: Tier): void {
  for (const s of pack.statuses) {
    const loc = { file: FILES.statuses, id: s.id };
    if (s.stacking.unique && !s.stacking.stackable) c.error("E_UNIQUE_NEEDS_STACKABLE", "a unique status stacks by definition, so stackable must be true", { ...loc, path: "stacking" });
    const unit = s.duration.unit;
    if ((COUNTED_DURATIONS as readonly string[]).includes(unit) && s.duration.count === null) {
      c.error("E_DURATION_COUNT", `duration unit '${unit}' needs a count`, { ...loc, path: "duration.count" });
    }
    if (unit === "instant" && s.duration.count !== null) c.error("E_DURATION_COUNT", "an instant status takes no count", { ...loc, path: "duration.count" });

    const inert =
      s.modifiers.length === 0 && !s.flags.blocks_debuffs && !s.flags.intercepts_death.enabled && s.flags.overrides_targeting === null &&
      !s.flags.ignores_tactics && !s.flags.prevents_action && !s.flags.delays_pending_action && !s.flags.removes_on_hit &&
      !s.flags.prevents_evasion && s.flags.heals_on_hit_percent_max_hp === 0;
    if (inert) c.warn("W_STATUS_INERT", "the status has no modifiers and no active flags, so it does nothing", loc);

    if (tier === "community") {
      for (const [flag, used] of Object.entries(OFFICIAL_ONLY_STATUS_FLAGS)) {
        if (used(s.flags)) c.error("E_NOT_COMMUNITY_SAFE", `status flag '${flag}' is official-only`, { ...loc, path: `flags.${flag}` });
      }
    }
  }
}

// ------------------------------------------------------------------ equipment
function checkEquipment(c: Collector, pack: Pack, tier: Tier): void {
  for (const e of pack.equipment) {
    const loc = { file: FILES.equipment, id: e.id };
    if (tier === "community" && e.cost_override != null) c.error("E_NOT_COMMUNITY_SAFE", "cost_override is official-only", { ...loc, path: "cost_override" });
    const allowed = SLOT_TAGS[e.slot] as readonly string[];
    e.tags.forEach((t, i) => {
      if (!allowed.includes(t)) c.error("E_SLOT_TAG", `tag '${t}' does not belong on a ${e.slot} (allowed: ${allowed.join(", ")})`, { ...loc, path: `tags[${i}]` });
    });
    e.eligible.characters.forEach((id, i) => {
      if (!pack.byId.characters.has(id)) c.error("E_REF_MISSING", `eligible character '${id}' does not exist`, { ...loc, path: `eligible.characters[${i}]` });
    });
    if (pack.characters.length > 0 && !pack.characters.some((h) => canEquip(h, e))) {
      c.warn("W_EQUIP_NOBODY", "no current hero can equip this item", loc);
    }
  }
}

// ------------------------------------------------------------------ soldiers
function checkSoldiers(c: Collector, pack: Pack): void {
  for (const s of pack.soldiers) {
    const loc = { file: FILES.soldiers, id: s.id };
    if (!s.allowed_soldier_rows.includes(s.default_soldier_row)) {
      c.error("E_SOLDIER_DEFAULT_ROW", `default_soldier_row '${s.default_soldier_row}' is not in allowed_soldier_rows`, { ...loc, path: "default_soldier_row" });
    }
    s.passive_effects.forEach((p, pi) =>
      p.effects.forEach((e, i) => {
        if (e.type === "modify_stat" && e.mode === "percent" && e.source_category !== "soldier") {
          c.error("E_SOLDIER_PASSIVE_CATEGORY", "a soldier skill's percent modifiers belong to the 'soldier' stacking category", { ...loc, path: `passive_effects[${pi}].effects[${i}].source_category` });
        }
      }),
    );
    s.eligible_heroes.forEach((id, i) => {
      if (!pack.byId.characters.has(id)) c.error("E_REF_MISSING", `eligible hero '${id}' does not exist`, { ...loc, path: `eligible_heroes[${i}]` });
    });
  }
}

// ------------------------------------------------------------------ characters
function checkCharacters(c: Collector, pack: Pack, tier: Tier): void {
  const { limits, pp } = pack.rules;
  for (const h of pack.characters) {
    const loc = { file: FILES.characters, id: h.id };
    h.factions.forEach((f, i) => {
      if (!pack.byId.factions.has(f)) c.error("E_REF_MISSING", `unknown faction '${f}'`, { ...loc, path: `factions[${i}]` });
    });
    const seen = new Set<string>();
    h.skills.forEach((sid, i) => {
      const skill = pack.byId.skills.get(sid);
      if (!skill) return void c.error("E_REF_MISSING", `unknown skill '${sid}'`, { ...loc, path: `skills[${i}]` });
      if (seen.has(sid)) c.error("E_DUP_SKILL", `skill '${sid}' is listed twice`, { ...loc, path: `skills[${i}]` });
      seen.add(sid);
      if (!skillEligible(h, skill)) c.error("E_SKILL_INELIGIBLE", `'${sid}' is not eligible for a ${h.class} (${h.id})`, { ...loc, path: `skills[${i}]` });
    });
    if (h.skills.length === 0) c.warn("W_NO_SKILLS", "the hero has no skills, so cannot act", loc);
    if (limits.max_skills_per_hero !== null && h.skills.length > limits.max_skills_per_hero) {
      c.error("E_TOO_MANY_SKILLS", `${h.skills.length} skills exceeds the limit of ${limits.max_skills_per_hero}`, { ...loc, path: "skills" });
    }
    if (h.pp.active > pp.max || h.pp.passive > pp.max) c.error("E_PP_RANGE", `base PP may not exceed ${pp.max}`, { ...loc, path: "pp" });
    if (limits.stat_ceiling !== null) {
      for (const [k, v] of Object.entries(h.base_stats)) {
        if (v > limits.stat_ceiling) c.error("E_STAT_CEILING", `${k} ${v} exceeds the ceiling of ${limits.stat_ceiling}`, { ...loc, path: `base_stats.${k}` });
      }
    }

    const a = h.leader_aura;
    const ap = "leader_aura";
    if (a.type === "faction_buff") {
      if (!a.faction_id) c.error("E_AURA_FACTION", "a faction_buff aura needs faction_id", { ...loc, path: `${ap}.faction_id` });
      else if (!pack.byId.factions.has(a.faction_id)) c.error("E_REF_MISSING", `unknown faction '${a.faction_id}'`, { ...loc, path: `${ap}.faction_id` });
    } else if (a.faction_id) c.error("E_AURA_FACTION", "faction_id is only for faction_buff auras", { ...loc, path: `${ap}.faction_id` });
    if (a.trigger === "on_event" && !a.trigger_event) c.error("E_AURA_EVENT", "an on_event aura needs trigger_event", { ...loc, path: `${ap}.trigger_event` });
    if (a.trigger === "always" && a.trigger_event) c.error("E_AURA_EVENT", "an always aura takes no trigger_event", { ...loc, path: `${ap}.trigger_event` });
    const side = a.type === "enemy_debuff" ? "enemy" : a.type === "field" ? "both" : "ally";
    if (a.target.side !== side) c.error("E_AURA_SIDE", `a ${a.type} aura targets '${side}', not '${a.target.side}'`, { ...loc, path: `${ap}.target.side` });
    if (tier === "community" && h.cost_override != null) c.error("E_NOT_COMMUNITY_SAFE", "cost_override is official-only", { ...loc, path: "cost_override" });
    if (tier === "community" && a.cost_adjustment !== undefined) c.error("E_NOT_COMMUNITY_SAFE", "cost_adjustment is official-only", { ...loc, path: `${ap}.cost_adjustment` });
  }
}

// ------------------------------------------------------------------ rules
function checkRules(c: Collector, pack: Pack): void {
  const { draft, board, rolls } = pack.rules;
  const loc = { file: FILES.rules };
  const cuts = draft.roster_size - draft.fielded;
  const challengerBans = draft.steps.filter((s) => s.actor === "challenger" && s.action === "ban").length;
  const defenderBans = draft.steps.filter((s) => s.actor === "defender" && s.action === "ban").length;
  if (draft.fielded > draft.roster_size) c.error("E_DRAFT_CONFIG", "fielded cannot exceed roster_size", { ...loc, path: "draft.fielded" });
  if (challengerBans !== cuts) c.error("E_DRAFT_CONFIG", `the challenger's bans (${challengerBans}) must equal roster_size - fielded (${cuts}), so the defender ends with ${draft.fielded} heroes`, { ...loc, path: "draft.steps" });
  if (defenderBans !== cuts) c.error("E_DRAFT_CONFIG", `the defender's bans (${defenderBans}) must equal roster_size - fielded (${cuts}), so the challenger ends with ${draft.fielded} heroes`, { ...loc, path: "draft.steps" });
  if (board.hero_rows * board.columns < draft.fielded) c.error("E_BOARD", `${draft.fielded} heroes cannot fit in ${board.hero_rows} rows of ${board.columns}`, { ...loc, path: "board" });
  for (const k of ["hit", "crit", "guard"] as const) {
    if (rolls[`${k}_min`] > rolls[`${k}_max`]) c.error("E_ROLLS", `rolls.${k}_min is above ${k}_max`, { ...loc, path: "rolls" });
  }
}

// ------------------------------------------------------------------ usage
function checkUsage(c: Collector, pack: Pack): void {
  const usedStatuses = new Set<string>();
  forEachEffect(pack, (e) => {
    if (e.type === "apply_status") usedStatuses.add(e.status_id);
  });
  for (const s of pack.statuses) {
    if (!usedStatuses.has(s.id)) c.warn("W_STATUS_UNUSED", "no skill, item or aura applies this status", { file: FILES.statuses, id: s.id });
  }
  const usedSkills = new Set(pack.characters.flatMap((h) => h.skills));
  for (const s of pack.skills) {
    if (!usedSkills.has(s.id)) c.warn("W_SKILL_UNUSED", "no hero has this skill", { file: FILES.skills, id: s.id });
  }
}
