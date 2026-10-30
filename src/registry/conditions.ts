// Condition-leaf registry. Adding a condition type = adding one entry here. Nothing else in the engine or editor changes.
//   fields        strict schema for the leaf's parameters (the `type` key is validated separately)
//   contexts      where the leaf may appear:
//                   tactic   : player-written tactic sheets (and skills' default activation/targeting)
//                   authored : official content (leader auras, equipment effects, stat penalties) , a superset of tactic
//                   ban      : defender ban sheets
//   communitySafe false = official content only (community packs are rejected at the community tier)
import { z } from "zod/v4";
import { AURA_TYPES, BOARD_ROWS, CLASSES, COMPARATORS, SKILL_TAGS, STATS } from "../schema/enums";

export type CondContext = "tactic" | "authored" | "ban";

export interface LeafSpec {
  fields: z.ZodType;
  contexts: readonly CondContext[];
  communitySafe: boolean;
  description: string;
}

const side = z.enum(["self", "ally", "enemy", "target"]);
const op = z.enum(COMPARATORS);
const num = z.number();
const idStr = z.string().min(1);
const none = z.strictObject({});

const PLAYER: readonly CondContext[] = ["tactic", "authored"];
const AUTHORED: readonly CondContext[] = ["authored"];
const BAN: readonly CondContext[] = ["ban"];

const cmp = (extra: z.ZodRawShape = {}) => z.strictObject({ side, op, value: num, ...extra });
const event = (description: string): LeafSpec => ({ fields: none, contexts: PLAYER, communitySafe: true, description });

export const LEAF_REGISTRY: Record<string, LeafSpec> = {
  // HP
  hp_percent: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "HP as a percentage of max" },
  hp_current: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Current HP" },
  hp_missing: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Missing HP" },
  // Unit type / role
  unit_kind: {
    fields: z
      .strictObject({ is: z.enum(["hero", "soldier"]).optional(), ignore: z.enum(["hero", "soldier"]).optional() })
      .refine((v) => (v.is !== undefined) !== (v.ignore !== undefined), { message: "give exactly one of 'is' or 'ignore'" }),
    contexts: PLAYER,
    communitySafe: true,
    description: "Hero or soldier filter",
  },
  is_leader: { fields: z.strictObject({ side }), contexts: PLAYER, communitySafe: true, description: "Is the party leader" },
  not_leader: { fields: z.strictObject({ side }), contexts: PLAYER, communitySafe: true, description: "Is not the party leader" },
  // Class / faction
  class_is: { fields: z.strictObject({ side, value: z.enum(CLASSES) }), contexts: PLAYER, communitySafe: true, description: "Unit class" },
  has_class_advantage: {
    fields: z.strictObject({ side, value: z.enum(CLASSES).optional() }),
    contexts: PLAYER,
    communitySafe: true,
    description: "Has class advantage",
  },
  faction_is: { fields: z.strictObject({ side, value: idStr }), contexts: PLAYER, communitySafe: true, description: "Faction membership (faction id)" },
  // Position
  row_is: {
    fields: z.strictObject({ side: side.optional(), value: z.enum(BOARD_ROWS) }),
    contexts: PLAYER,
    communitySafe: true,
    description: "Board row",
  },
  column_is: {
    fields: z.strictObject({ side: side.optional(), value: z.number().int().min(1).max(3) }),
    contexts: PLAYER,
    communitySafe: true,
    description: "Board column",
  },
  same_column_as: { fields: z.strictObject({ value: z.string().min(1) }), contexts: PLAYER, communitySafe: true, description: "Same column as a reference unit" },
  // Status
  has_status: { fields: z.strictObject({ side, status_id: idStr }), contexts: PLAYER, communitySafe: true, description: "Has a status" },
  lacks_status: { fields: z.strictObject({ side, status_id: idStr }), contexts: PLAYER, communitySafe: true, description: "Lacks a status" },
  has_any_debuff: { fields: z.strictObject({ side }), contexts: PLAYER, communitySafe: true, description: "Has any debuff" },
  // Stats / resources
  stat_compare: {
    fields: z.strictObject({ side: side.optional(), stat: z.enum(STATS), op, value: num }),
    contexts: ["tactic", "authored", "ban"],
    communitySafe: true,
    description: "Compare a stat",
  },
  active_pp: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Active PP" },
  passive_pp: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Passive PP" },
  // Counts
  enemies_alive: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Enemies alive" },
  allies_alive: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Allies alive" },
  enemy_soldiers_remaining: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Enemy soldiers remaining" },
  // Events
  was_attacked_since_last_action: event("Attacked since this unit's last action"),
  ally_attacked: event("An ally was attacked"),
  just_healed: event("Was just healed"),
  self_attacked: event("This unit was attacked"),
  unit_attacked: event("A unit was attacked"),
  self_targeted_by_physical_attack: event("This unit was targeted by a physical attack"),
  self_action_completed: event("This unit's action completed"),
  unit_hit_by_single_target_attack: event("A unit was hit by a single-target attack"),
  // Battle
  phase: { fields: z.strictObject({ op, value: z.number().int().min(1).max(3) }), contexts: PLAYER, communitySafe: true, description: "Current phase" },
  action_count: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Actions taken" },
  // Authored-only (may name heroes; forbidden in player tactic sheets and ban sheets)
  hero_is: { fields: z.strictObject({ side, value: idStr }), contexts: AUTHORED, communitySafe: false, description: "Is a specific hero (hero id)" },
  party_has_hero: { fields: z.strictObject({ side, value: idStr }), contexts: AUTHORED, communitySafe: false, description: "A specific hero is fielded (hero id)" },
  soldier_mounted: { fields: z.strictObject({ value: z.boolean() }), contexts: AUTHORED, communitySafe: true, description: "The paired soldier type is mounted" },
  // Ban-sheet leaves (matched against candidate heroes)
  hero_class: { fields: z.strictObject({ value: z.enum(CLASSES) }), contexts: BAN, communitySafe: true, description: "Candidate's class" },
  hero_faction: { fields: z.strictObject({ value: idStr }), contexts: BAN, communitySafe: true, description: "Candidate's faction (faction id)" },
  leader_aura_type: { fields: z.strictObject({ value: z.enum(AURA_TYPES) }), contexts: BAN, communitySafe: true, description: "Candidate's leader aura type" },
  has_skill_tag: { fields: z.strictObject({ value: z.enum(SKILL_TAGS) }), contexts: BAN, communitySafe: true, description: "Candidate has a skill with this tag" },
  cost: { fields: z.strictObject({ op, value: num }), contexts: BAN, communitySafe: true, description: "Candidate's computed cost" },
  is_official: { fields: z.strictObject({ value: z.boolean() }), contexts: BAN, communitySafe: true, description: "Candidate is official content" },
};

/** Leaf fields that hold references to other content, checked against the loaded pack. */
export const LEAF_REFS: Record<string, { field: string; kind: "status" | "faction" | "hero" }> = {
  has_status: { field: "status_id", kind: "status" },
  lacks_status: { field: "status_id", kind: "status" },
  faction_is: { field: "value", kind: "faction" },
  hero_faction: { field: "value", kind: "faction" },
  hero_is: { field: "value", kind: "hero" },
  party_has_hero: { field: "value", kind: "hero" },
};
