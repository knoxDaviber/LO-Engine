// Condition-leaf registry. Adding a condition type = adding one entry here. Nothing else in the engine or editor changes.
//   fields        strict schema for the leaf's parameters (the `type` key is validated separately)
//   contexts      where the leaf may appear:
//                   tactic   : player-written tactic sheets (and skills' default activation/targeting)
//                   authored : official content (leader auras, equipment effects, stat penalties) , a superset of tactic
//                   ban      : defender ban sheets
//   communitySafe false = official content only (community packs are rejected at the community tier)
import { z } from "zod/v4";
import { AURA_TYPES, BOARD_ROWS, CLASSES, COMPARATORS, RACES, SKILL_TAGS, STATS, SUB_RACES, TIMES } from "../schema/enums";

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

const allyEnemy = z.enum(["ally", "enemy"]);
const player = (fields: z.ZodType, description: string): LeafSpec => ({ fields, contexts: PLAYER, communitySafe: true, description });

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
  row_size: player(z.strictObject({ side: side.optional(), op, value: num }), "Number of living combatants (heroes, and soldiers one by one) in the unit's board row on its side"),
  row_rank: player(z.strictObject({ side: side.optional(), value: z.enum(["most", "least"]) }), "The unit's board row holds the most / least combatants of its side's occupied rows (ties count as both)"),
  column_full: player(z.strictObject({ side: side.optional() }), "The unit's column holds a living hero in both the front and the back hero row"),
  is_self: player(none, "The unit is the acting hero itself"),
  always: player(none, "Always true (a check that never skips)"),
  not_self: player(none, "The unit is not the acting hero"),
  race_is: player(z.strictObject({ side, value: z.enum(RACES) }), "Unit race (squads count as human)"),
  sub_race_is: player(z.strictObject({ side, value: z.enum(SUB_RACES) }), "Unit sub-race (squads have none)"),
  // Status
  has_status: { fields: z.strictObject({ side, status_id: idStr }), contexts: PLAYER, communitySafe: true, description: "Has a status" },
  lacks_status: { fields: z.strictObject({ side, status_id: idStr }), contexts: PLAYER, communitySafe: true, description: "Lacks a status" },
  has_any_debuff: { fields: z.strictObject({ side }), contexts: PLAYER, communitySafe: true, description: "Has any debuff" },
  lacks_any_debuff: player(z.strictObject({ side }), "Has no debuff"),
  has_any_buff: player(z.strictObject({ side }), "Has any buff (a buff-category status or a positive aura)"),
  lacks_any_buff: player(z.strictObject({ side }), "Has no buff"),
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
  soldiers_alive: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Living soldiers in a squad (false for a hero)" },
  soldiers_percent: { fields: cmp(), contexts: PLAYER, communitySafe: true, description: "Living soldiers in a squad as a percent of its starting size (false for a hero)" },
  enemies_alive: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Enemies alive" },
  allies_alive: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Allies alive" },
  enemy_soldiers_remaining: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Enemy soldiers remaining" },
  combatants: player(z.strictObject({ side: allyEnemy, op, value: num }), "Living combatants on a side (heroes, and soldiers one by one)"),
  side_has: player(
    z.strictObject({ side: allyEnemy, class: z.enum(CLASSES).optional(), race: z.enum(RACES).optional(), present: z.boolean() })
      .refine((v) => (v.class !== undefined) !== (v.race !== undefined), { message: "give exactly one of 'class' or 'race'" }),
    "A side has (present: true) or has no (present: false) living unit of a class or race, squads included",
  ),
  average_hp_percent: player(z.strictObject({ side: side.optional(), op, value: num }), "Average HP % of the unit's side (every living hero and soldier counts once)"),
  // Events
  was_attacked_since_last_action: event("Attacked since this unit's last action"),
  attacked_since_last_action: player(
    z.strictObject({
      damage_type: z.enum(["physical", "magical"]).optional(),
      shape: z.enum(["single", "row", "column", "all"]).optional(),
      by_class: z.enum(CLASSES).optional(),
      by_race: z.enum(RACES).optional(),
    }),
    "This hero was attacked since its last action by an attack matching every given filter (damage type, attack shape, attacker class / race)",
  ),
  ally_attacked: event("An ally was attacked"),
  just_healed: event("Was just healed"),
  self_attacked: event("This unit was attacked"),
  unit_attacked: event("A unit was attacked"),
  self_targeted_by_physical_attack: event("This unit was targeted by a physical attack"),
  self_action_completed: event("This unit's action completed"),
  unit_hit_by_single_target_attack: event("A unit was hit by a single-target attack"),
  self_landed_single_target_hit: event("This unit landed a single-target hit"),
  ally_landed_single_target_hit: event("An ally landed a single-target hit"),
  self_hit_by_melee: event("This unit was hit by a melee attack"),
  // Battle
  phase: { fields: z.strictObject({ op, value: z.number().int().min(1).max(3) }), contexts: PLAYER, communitySafe: true, description: "Current phase" },
  action_count: { fields: z.strictObject({ op, value: num }), contexts: PLAYER, communitySafe: true, description: "Own actions taken this phase (first action: action_count = 0)" },
  time_is: player(z.strictObject({ value: z.enum(TIMES) }), "Time of day of the battle"),
  // Authored-only (may name heroes; forbidden in player tactic sheets and ban sheets)
  hero_is: { fields: z.strictObject({ side, value: idStr }), contexts: AUTHORED, communitySafe: false, description: "Is a specific hero (hero id)" },
  party_has_hero: { fields: z.strictObject({ side, value: idStr }), contexts: AUTHORED, communitySafe: false, description: "A specific hero is fielded (hero id)" },
  action_is_single_target: { fields: none, contexts: AUTHORED, communitySafe: true, description: "This unit is resolving a single-target attack (its own active skill)" },
  self_dodged: { fields: none, contexts: AUTHORED, communitySafe: true, description: "This unit dodged an attack" },
  self_killed_enemy: { fields: none, contexts: AUTHORED, communitySafe: true, description: "This unit killed an enemy hero or wiped out a squad" },
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
