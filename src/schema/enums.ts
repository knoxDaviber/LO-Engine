// Single source of truth for every allowed value. The schemas, validator, JSON Schema export and (later) the editor's
// dropdowns all read from here. Adding a value here is the only step needed to allow it everywhere.

export const STATS = ["HP", "ATK", "INT", "DEF", "MDEF", "SPD", "HIT", "SKL", "CRIT", "GUARD", "EVA"] as const;
export type Stat = (typeof STATS)[number];

export const RACES = ["human", "elf", "beastfolk", "dwarf", "dragon", "demon", "angel"] as const;
export type Race = (typeof RACES)[number];

/** Time of day of a battle (battle input `time`, default day). */
export const TIMES = ["day", "night"] as const;

export const CLASSES = ["infantry", "lancer", "cavalry", "archer", "flyer", "mage", "assassin", "holy", "aquatic", "monster"] as const;
export type UnitClass = (typeof CLASSES)[number];

export const EQUIPMENT_SLOTS = ["weapon", "armor", "accessory"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Equipment types: every item has exactly one, valid for its slot, and takes its flat stat lines from `rules.equipment_bases[type]` (Decision 133). */
export const EQUIPMENT_TAGS = [
  "sword", "spear", "staff", "bow", "dagger", "tome", "hammer", "axe",
  "light_armor", "heavy_armor", "robe",
  "shield", "gloves", "boots", "ring", "amulet", "charm", "bracelet", "earring", "cloak", "belt",
] as const;
export type EquipmentTag = (typeof EQUIPMENT_TAGS)[number];

/** Which types may appear on an item of each slot. Catches an armor tagged "sword" and similar slips. */
export const SLOT_TAGS: Record<EquipmentSlot, readonly EquipmentTag[]> = {
  weapon: ["sword", "spear", "staff", "bow", "dagger", "tome", "hammer", "axe"],
  armor: ["light_armor", "heavy_armor", "robe"],
  accessory: ["shield", "gloves", "boots", "ring", "amulet", "charm", "bracelet", "earring", "cloak", "belt"],
};

/** Types a hero must list in `restrictions.equipment_tags` to wear: weapons, armor and shields. Other accessory categories are open to everyone. */
export const HERO_GATED_TAGS: readonly EquipmentTag[] = [...SLOT_TAGS.weapon, ...SLOT_TAGS.armor, "shield"];

export const SKILL_CATEGORIES = ["active", "passive"] as const;
export const PP_POOLS = ["active", "passive"] as const;
export const SKILL_TRIGGERS = ["own_turn", "pre_battle", "on_event", "while_condition"] as const;
export const TRIGGER_TIMING = ["before_hit", "after_hit"] as const;
export const RANGES = ["melee", "ranged"] as const;
export const DAMAGE_TYPES = ["physical", "magical", "hybrid"] as const;
export const TARGET_SIDES = ["self", "ally", "enemy", "any"] as const;
export const TARGET_SHAPES = ["single", "row", "column", "all", "self", "event_unit", "caster_row", "attacker"] as const;
export const DAMAGE_DISTRIBUTIONS = ["per_target"] as const; // AoE damage is per target; a squad is one target and any hit on it is resolved once (Decision 130)
export const SKILL_FALLBACKS = ["re_evaluate", "skip"] as const;
export const GUARD_MODES = ["standard", "ignores", "guaranteed"] as const;
export const SOLDIER_MODES = ["standard", "skip_soldiers", "soldiers_only"] as const;

export const MODIFIER_MODES = ["flat", "percent"] as const;
export const SIGIL_SIDES = ["def", "atk"] as const; // the two 4-piece enchantments of a god (Decision 141)
export type SigilSide = (typeof SIGIL_SIDES)[number];
export const SOURCE_CATEGORIES = ["passive", "active", "equipment", "soldier", "prayer", "terrain"] as const; // stacking categories
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
export const STATUS_SOURCE = ["inherit", ...SOURCE_CATEGORIES] as const;

export const STATUS_CATEGORIES = ["buff", "debuff", "dot", "hot", "control", "immunity", "revival", "other"] as const;
export const DURATION_UNITS = [
  "affected_unit_actions", // 1 turn = one active skill use by the affected unit
  "source_unit_actions",
  "until_next_hit",
  "timeline_counts",
  "while_condition",
  "until_used",
  "battle",
  "instant",
] as const;
/** Duration units that need a positive count. */
export const COUNTED_DURATIONS = ["affected_unit_actions", "source_unit_actions", "until_next_hit", "timeline_counts"] as const;
export const COUNTS_ACTIONS_OF = ["affected", "source"] as const;
export const EXPIRES = ["before_action", "after_action"] as const;
export const ON_REAPPLY = ["refresh", "extend", "replace_if_stronger"] as const;

export const AURA_TYPES = ["field", "faction_buff", "ally_buff", "enemy_debuff"] as const;
export const AURA_TRIGGERS = ["always", "on_event"] as const;
export const AURA_TARGET_SIDES = ["ally", "enemy", "both"] as const;

export const ROWS = ["front", "back"] as const; // hero rows, and the soldier-row choice
export type Row = (typeof ROWS)[number];
export const BOARD_ROWS = ["soldier_front", "front", "back", "soldier_back"] as const;

export const SKILL_TAGS = ["revive", "stun", "aoe", "heal", "debuff", "buff", "dot", "damage"] as const;

/** Events a passive may trigger on. */
export const EVENT_NAMES = [
  "self_targeted_by_physical_attack",
  "self_attacked",
  "unit_attacked",
  "unit_hit_by_single_target_attack",
  "ally_attacked",
  "just_healed",
  "self_action_completed",
  "self_landed_single_target_hit",
  "ally_landed_single_target_hit",
  "self_hit_by_melee",
] as const;

export const EFFECT_TARGETS = ["self", "targets", "field", "attacker", "caster_row", "hit_unit"] as const;
export const EFFECT_TRIGGERS = ["always", "pre_battle", "on_event", "on_hit", "on_attack"] as const;
export const APPLIES_TO = ["physical", "magical", "all"] as const;
export const COMPARATORS = [">", "<", ">=", "<=", "=", "!="] as const;
export const SELECTORS = ["lowest", "highest", "nearest", "farthest", "random_seeded", "prefer"] as const;
/** lowest / highest selector metrics (plus any STATS name). */
export const SELECTOR_METRICS = ["hp_percent", "hp_current", "hp_missing", "max_hp", "active_pp", "passive_pp", "max_active_pp", "max_passive_pp"] as const;
export const SOLDIER_PASSIVE_TARGETS = ["self_squad", "leader", "party"] as const;

export const DRAFT_ACTORS = ["challenger", "defender"] as const;
export const DRAFT_ACTIONS = ["ban", "protect"] as const;
export const DRAFT_SOURCES = ["human", "rule_sheet"] as const;
export const BAN_SELECTS = ["highest", "lowest", "nearest"] as const;

export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Canonical new-content id: type prefix + three digits. Older authored ids are kept and only noted. */
export const CANONICAL_ID = /^(char|skl|equip|status|soldier|faction|terrain|god)_\d{3}$/;
