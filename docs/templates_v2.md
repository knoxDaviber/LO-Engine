# Content Templates v2 (structured)

Mechanics live in structured fields (YAML shown here; the engine loads the same shape as JSON). Free text is only for the schema's text fields (`name`, `description`, `role`, `lore`, `designer_notes`); everything the engine reads is an enum, number, ID or structured node. Copy a block, fill it in, keep the field names. Every reference to another entry is by **ID**, never by display name.

IDs are stable strings and are never reused. New content should use a type prefix and three digits (`char_###`, `skl_###`, `equip_###`, `status_###`, `soldier_###`, `faction_###`) and keep class names out of IDs. **Existing authored IDs (e.g. `skl_cav_active_001`, `buff_004`) are kept as they are**; the validator only warns. Any entry may carry a `meta` block (`provisional`, `flags`, `authored_notes`) used by the converter and stripped at release.

---

## 0. Allowed values (enums)

```yaml
stats: [HP, ATK, INT, DEF, MDEF, SPD, HIT, SKL, CRIT, GUARD, EVA]
races: [human, elf, beastfolk, dwarf, dragon, demon, angel]   # a character's `race`; squads count as human
times: [day, night]                                       # battle input `time` (default day)
selectors: [lowest, highest, nearest, farthest, random_seeded, prefer]
selector_metrics: [hp_percent, hp_current, hp_missing, max_hp, active_pp, passive_pp, max_active_pp, max_passive_pp]   # or any stat name
classes: [infantry, lancer, cavalry, archer, flyer, mage, assassin, holy, aquatic, monster]   # more classes will come
equipment_slots: [weapon, armor, accessory]        # accessory fills Accessory 1 or 2
equipment_tags: [sword, spear, axe, staff, tome, bow, dagger, hammer, light_armor, heavy_armor, robe, shield, gloves, boots, ring, amulet, charm, bracelet, earring, cloak, belt]   # one per item (Decision 133)
skill_category: [active, passive]
pp_pool: [active, passive]
passive_trigger: [pre_battle, own_turn, on_event, while_condition]
damage_type: [physical, magical, hybrid]
range: [melee, ranged]                  # required: declared on every damage effect and on each soldier type's basic attack
target_side: [self, ally, enemy, any]
target_shape: [single, row, column, all, self, event_unit, caster_row, attacker]   # a soldier squad is ONE target
duration_unit: [affected_unit_actions, source_unit_actions, until_next_hit, timeline_counts, while_condition, until_used, battle, instant]   # matches src/schema/enums.ts; `instant` needs no count; 1 turn = one active skill use by the affected unit
modifier_mode: [flat, percent]
source_category: [passive, active, equipment, soldier]     # for stacking; auras count as passive. Statuses may also use `inherit`. + prayer (devotion blessings)
aura_type: [field, faction_buff, ally_buff, enemy_debuff]
status_category: [buff, debuff, dot, hot, control, immunity, revival, other]
row: [front, back]
board_row: [soldier_front, front, back, soldier_back]   # used by the `row_is` condition (BOARD_ROWS)
soldier_row: [front, back]       # a squad fills an entire 1x3 soldier row on the 4x3 board, in front of or behind the hero rows
aura_trigger: [always, on_event]
trigger_timing: [before_hit, after_hit]   # on_event passives
skill_fallback: [re_evaluate, skip]         # skill `targeting.fallback`
terrain: []                                 # battlefield types (land, water, forest, mountains, cliffside, ...), TBD; schema change pending
draft_action: [ban, protect]
draft_source: [human, rule_sheet]
skill_tags: [revive, stun, aoe, heal, debuff, buff, dot, damage]    # extend as the registry grows
```

---

## 1. Character

```yaml
id: char_000
name: ""
class: ""              # one of classes (required)
race: human            # one of races (required)
factions: []           # faction IDs
role: ""               # tank / damage / support / other (informational)
lore: ""

base_stats:            # ALL 11 required. CRIT defaults to 30 in the editor. Size them with the stat guideline (design doc 3.3: factors x P).
  HP: 0
  ATK: 0
  INT: 0
  DEF: 0
  MDEF: 0
  SPD: 0
  HIT: 0
  SKL: 0
  CRIT: 30
  GUARD: 0
  EVA: 0

pp:
  active: 2
  passive: 2

skills: []             # skill IDs this hero may use (they must also be on the tactic sheet to run)

restrictions:
  equipment_tags: []   # from equipment_tags, e.g. [sword, heavy_armor]
  soldier:
    mounted_only: false
    stat_penalties: [] # structured, e.g. [{ when: { type: soldier_mounted, value: false }, stat: SPD, mode: flat, value: -20 }]

leader_aura:           # REQUIRED for every hero. Free, leader-only, no PP.
  name: ""
  type: ""             # aura_type
  faction_id: null     # required when type == faction_buff
  trigger: always      # aura_trigger: always (applies while the leader lives) | on_event
  trigger_event: null  # required when trigger == on_event, e.g. self_action_completed
  trigger_includes_idle_action: false   # true: an idle action counts as acting (Jasmine)
  condition: null      # optional condition node; may use hero_is / party_has_hero (authored content only)
  target:
    side: ally         # ally | enemy | both
    filter: null       # condition node over candidate units, e.g. { type: class_is, value: lancer }
    include_soldiers: false
  description: ""
  cost_adjustment: 0   # official content only: designer-set bump to the computed cost (a `cost_override` on the hero replaces the whole hero part: stats, aura price and this adjustment)
  effects: []          # see Effect blocks (Section 7). Source category is always passive.

preferred_row: front   # front | back; the leader is forced to front regardless.
                       # Default rule: ranged / low-DEF -> back (archer, mage, holy, assassin, flyer), melee / high-HP -> front (infantry, lancer, cavalry, monster, aquatic).
# Soldiers are NOT part of the character. The player pairs a hero with an eligible soldier type (Sections 5 and 11).

unique_effects: []     # other hero-specific data-defined effects (not leader-only)

designer_notes:
  strengths: ""
  weaknesses: ""
  synergies: ""
  balance: ""
```

---

## 2. Skill

```yaml
id: skl_000
name: ""
description: ""        # player-facing text
category: ""           # active | passive

tags: []               # skill_tags: revive, stun, aoe, heal, debuff, ... (used by ban rules and the gauntlet)

# --- Resource ---
pp_pool: ""            # active skills: active. Passive skills: passive. Must match category.
pp_cost: 1
pp_recovery: { allowed: false }
use_limit: null        # null = limited only by PP

# --- When it runs ---
trigger: own_turn      # actives: own_turn. Passives: pre_battle | on_event | while_condition
trigger_event: null    # required when trigger == on_event, e.g. self_targeted_by_physical
trigger_timing: null   # before_hit | after_hit (on_event passives only)
cooldown: null         # counts of the hero's own actions, or null


eligible:
  classes: []
  characters: []       # IDs; empty = no character restriction

# Default activation condition (the player edits this per tactic). See Section 6.
default_activation: null

# --- Effects (ordered) --- See Section 7.
effects:
  - type: damage
    damage_type: physical
    scaling:                        # replaces free-text like "100% ATK + 50% INT"
      - { stat: ATK, coef: 1.0 }
      - { stat: INT, coef: 0.5 }
    multiplier: 1.0
    range: melee                    # melee | ranged (required); Flyer evasion keys on it
    ignores_guard: false
    bonus_vs_class: []              # [{ class: cavalry, modifier_percent: 30 }]
    hit_bonus_percent: 0

# --- Targeting ---
targeting:
  side: enemy
  shape: single                     # single | row | column | all | self
  default_main: null                # condition node, see Section 6
  default_sub: null
  valid_rows: [front, back]
  max_targets: 1
  damage_distribution: per_target   # AoE damage is per target. A soldier squad is ONE target; soldiers cannot be targeted individually.
  fallback: re_evaluate             # skill-level: re_evaluate | skip (the tactic row has its own `fallback`: skip | next_valid_target, Section 8)

# --- Interactions ---
interactions:
  guard: standard                   # standard | ignores | guaranteed
  soldiers: standard                # standard | skip_soldiers | soldiers_only

cost_override: null    # optional authored cost replacing the computed one (official content only)
designer_notes: ""
```

---

## 3. Equipment

```yaml
id: equip_000
name: ""
description: ""
slot: ""                # weapon | armor | accessory
tags: []                # exactly ONE equipment type valid for the slot (E_EQUIP_TYPE):
                        #   weapon: sword | spear | axe | staff | tome | bow | dagger | hammer
                        #   armor: light_armor | heavy_armor | robe
                        #   accessory: shield | gloves | boots | ring | amulet | charm | bracelet | earring | cloak | belt
                        # The item's FLAT stat lines are its type's base (rules.yaml equipment_bases, Decision 133); items never author
                        # stat lines. What makes a named item special is pp_modifiers and effects.

pp_modifiers:
  active: 0
  passive: 0

effects: []             # conditional / percent / special effects. Source category = equipment.
                        # Each effect may carry a `condition` node (Section 6).

eligible:
  classes: []           # empty = all
  characters: []        # empty = all
  required_tags: []     # extra character equipment_tags the wearer needs. Weapon, armor and shield types always need the wearer to
                        # list that type; other accessory categories are open to every hero

rules:
  duplicate_allowed_in_both_accessory_slots: true   # Decision 19: duplicates allowed; flat stats add, identical effects do not stack

# devotion: items carry no sigil; the player picks a god per slot on the roster entry (`sigils`, Sections 11 and 17; Decision 125)
cost_override: null     # optional (official content only)
designer_notes: ""
```

---

## 4. Status effect

```yaml
id: status_000
name: ""
description: ""
category: ""            # status_category
source_category: inherit   # inherit | passive | active | equipment | soldier   (inherit = the category of whatever applied it)

modifiers:              # stat changes
  - { stat: DEF, mode: percent, value: 20 }     # negative = debuff

flags:
  blocks_debuffs: false             # Immunity
  intercepts_death:                 # Fairy's Grace
    enabled: false
    revive_hp_percent: 20
  overrides_targeting: null         # e.g. random_any   (Confusion)
  ignores_tactics: false            # Confusion
  prevents_action: false
  delays_pending_action: false                   # boolean. true = Stun: pending action pushed back by rules.stun_pushback_counts timeline counts, no action/PP lost (Section 16)
  removes_on_hit: false
  prevents_evasion: false           # Dark Dragon's Ire (cannot evade)
  heals_on_hit_percent_max_hp: 0    # Regen; triggers once per attacking action, not per hit

duration:
  unit: ""              # duration_unit
  count: 1
  counts_actions_of: affected   # affected | source   (only for *_unit_actions)
  applying_action_counts: false # does the action that applies it count as one?
  expires: after_action         # before_action | after_action

stacking:
  stackable: false      # default false
  unique: false         # unique statuses (Berserk, Dark Dragon's Ire) multiply with everything and are exempt from strongest-wins
  on_reapply: refresh   # refresh | extend | replace_if_stronger. Default refresh; Regen is the authored exception (extend)
  max_stacks: 1
  suppress_weaker: true # weaker effect is paused, not deleted (same category, same stat)

removal:
  removable_by_dispel: true
  removed_on_death: true

designer_notes: ""
```

---

## 5. Soldier squad

```yaml
id: soldier_000
name: ""
description: ""
role: ""
class: infantry              # one of classes; matchups apply to squads
default_soldier_row: front   # REQUIRED (schema): front | back; pre-fills the squad row, must be in allowed_soldier_rows
allowed_soldier_rows: [front, back]   # soldier_row values this type may stand in (first or last board row); the player picks one per squad via the optional `squad_row` (falls back to `default_soldier_row`)
count: 10
mounted: false

per_soldier_stats:          # all 11 required; ~0.15 x a P=100 hero of the class for HP/ATK/INT/DEF/MDEF/SKL (design doc 3.3)
  HP: 0
  ATK: 0
  INT: 0
  DEF: 0
  MDEF: 0
  SPD: 0
  HIT: 0
  SKL: 0
  CRIT: 0                   # NOT inherited from the hero baseline; set explicitly
  GUARD: 0
  EVA: 0

# Soldiers have no tactic sheet and no PP. They basic attack and carry soldier skills. A squad is selected as ONE target, but each soldier has its own HP. Soldiers attack and defend as one (Decision 130): a squad attack is one hit with the summed ATK (INT) of the living soldiers, and any hit on the squad is resolved once against their summed DEF (MDEF) and lands on the lowest-HP living soldier, overflowing to the next; healing is split evenly across all soldiers (dead revive at their share).
basic_attack:
  damage_type: physical
  scaling: [{ stat: ATK, coef: 1.0 }]
  targeting: nearest_front_first
  range: melee                # melee | ranged (required)

passive_effects: []         # soldier skills, always-on or event-triggered (effect `trigger`), no PP: [{ name, target: self_squad | leader | party, effects: [...] }]. Source category = soldier.
eligible_heroes: []         # empty = all. Soldier types are generic; the player pairs one with a hero.
eligible_classes: []        # empty = all
designer_notes: ""
```

---

## 6. Condition node (used for tactic conditions and skill defaults)

A condition is either a leaf or a group. Groups combine with `all` (AND), `any` (OR), `not`. **Authored content may use full trees.** A player tactic slot (`main`, `sub`, a `prefer` filter) holds exactly one leaf or a selector (Decision 136). Ban-sheet slots and skills' default_activation / default_main / default_sub are limited to one leaf, or `all` of exactly two leaves (no nesting, OR or NOT). The validator enforces both (E_TACTIC_SHAPE).

```yaml
# group
all:
  - { type: hp_percent, side: self, op: "<", value: 50 }
  - any:
      - { type: phase, op: ">=", value: 2 }
      - { type: enemies_alive, op: ">=", value: 3 }
```

Leaf `type` options for the prototype and beyond:

| Category | `type` | Fields |
|---|---|---|
| HP | `hp_percent`, `hp_current`, `hp_missing` | `side`, `op`, `value` |
| Unit type | `unit_kind` | `is: hero \| soldier`, or `ignore: soldier` |
| Role | `is_leader`, `not_leader` | `side` |
| Class | `class_is`, `has_class_advantage` | `side`, `value` |
| Faction | `faction_is` | `side`, `value` |
| Position | `row_is`, `column_is`, `same_column_as` | `value` (board rows: soldier_front, front, back, soldier_back; the registry uses BOARD_ROWS. A squad's `squad_row` choice `front` / `back` maps to `soldier_front` / `soldier_back`) |
| Position (counts) | `row_size` (`op`, `value`), `row_rank` (`value: most \| least`), `column_full` (none) | optional `side`; combatants = heroes plus soldiers one by one |
| Identity | `is_self`, `not_self` | none |
| Race | `race_is` | `side`, `value` (race) |
| Status | `has_status`, `lacks_status` | `side`, `status_id` |
| Status (any) | `has_any_debuff`, `lacks_any_debuff`, `has_any_buff`, `lacks_any_buff` | `side` |
| Stat | `stat_compare` | `side`, `stat`, `op`, `value` |
| Resource | `active_pp`, `passive_pp` | `side`, `op`, `value` |
| Counts | `enemies_alive`, `allies_alive`, `enemy_soldiers_remaining` | `op`, `value` |
| Counts (combatants) | `combatants` | `side: ally \| enemy`, `op`, `value` |
| Presence | `side_has` | `side: ally \| enemy`, exactly one of `class` / `race`, `present: true \| false` |
| Side HP | `average_hp_percent` | optional `side`, `op`, `value` |
| Attacked | `attacked_since_last_action` | optional `damage_type` (physical \| magical), `shape` (single \| row \| column \| all), `by_class`, `by_race` |
| Events | `was_attacked_since_last_action`, `ally_attacked`, `just_healed`, `self_attacked`, `unit_attacked`, `self_targeted_by_physical_attack`, `self_action_completed`, `unit_hit_by_single_target_attack` | none |
| Battle | `phase`, `action_count` | `op`, `value` (first action: `action_count = 0`) |
| Time | `time_is` | `value: day \| night` |
| Authored content only | `hero_is`, `party_has_hero` | `side`, `value` (hero ID) |

**Hero-ID leaves** (`hero_is`, `party_has_hero`) exist for authored content such as leader auras, faction effects and equipment (e.g. Leon's aura requires The Emperor in the party). They are **forbidden in player tactic sheets and ban sheets**; the validator rejects them there. Player conditions use class, faction, status and other attributes only.

Selectors (player slots; they order the candidates and never skip a tactic): `lowest` / `highest` with an optional `metric` (default `hp_percent`; selector_metrics or a stat name such as `ATK`), `nearest`, `farthest`, `random_seeded`, and `prefer` with a `filter` leaf (candidates satisfying it sort first: "Prioritise Front Row" = `{ select: prefer, filter: { type: row_is, value: front } }`).

---

## 7. Effect blocks

Allowed `type` values. Each effect is data; none require engine code.

```yaml
- type: damage        # damage_type, scaling[], multiplier, ignores_guard, bonus_vs_class[], hit_bonus_percent
- type: heal          # scaling[], multiplier, and/or percent_max_hp. On a squad the amount is split evenly across all soldiers, dead included (they revive at their share)
- type: apply_status  # status_id, chance_percent (default 100), target (self | targets | field | attacker | caster_row), include_soldiers (default false: area statuses skip soldiers unless the effect opts in)
- type: remove_buffs  # target: targets | attacker, or side: enemy | ally
- type: modify_stat   # stat, mode (flat|percent), value, condition (optional)
- type: modify_pp     # pool, amount, target
- type: reduce_damage # percent, applies_to (physical | magical | all), duration (this_attack | ...)
- type: delay_action  # counts
- type: advance_action # counts or percent
```

Per-hit effects (Regen, on-hit reactives, `modify_pp` on hit) fire once per attacking action regardless of hit count; a squad attack is one combined hit (Decision 130).

Any effect may also carry `trigger` (`always`, `pre_battle`, `on_event`, `on_hit`) and `condition` (a condition node). `target: field` means every unit on both sides.

`modify_stat`, `apply_status` and auras are what the stacking rule (Section 9.1 of the design doc) groups by `source_category`.

---

## 8. Tactic (one row of a hero's tactic sheet)

```yaml
priority: 1                 # 1 = highest; max 10 tactics per hero
skill_id: skl_000
enabled: true
main: null                  # one condition leaf or a selector; null = none
sub: null                   # the same; a sub selector breaks ties of main's
```

A leaf keeps the candidates (the skill's target pool) for which it is true with the candidate as `target`; a leaf about the hero itself or the board ("Own HP < 50%", `time_is`, `side_has`) is an "only if": false skips the tactic. A selector only orders. The skill's default_activation and default_main always apply too; default_sub only when neither slot is a selector. Example: `{ priority: 1, skill_id: skl_012, enabled: true, main: { type: hp_percent, side: target, op: "<", value: 70 }, sub: { select: lowest, metric: hp_percent } }`.

Rules the validator enforces: max 10 tactics; each player slot is one leaf or a selector (E_TACTIC_SHAPE); no duplicate `priority`; every `skill_id` must be on the hero's skill list; a skill's `pp_pool` must match its `category`.

---

## 9. Faction

```yaml
id: faction_000
name: ""
lore: ""
effects: []                 # a faction is a category only (lore + filter target); no global set bonuses, so leave empty. Synergy is hero-carried (auras, passives)
```

---

## 10. Class

```yaml
id: class_000
name: ""                    # one of classes
description: ""
matchups:
  - { vs: lancer, damage_modifier_percent: 25, hit_modifier: 10 }
  - { vs: cavalry, damage_modifier_percent: -15, hit_modifier: 0 }
# Mage, Assassin: no matchups for now (neutral). Holy > Monster. More classes will come.
# Flyer: EVA x(1 + flyer_melee_eva_bonus/100) against melee hits. Aquatic: SPD +aquatic_water_spd_bonus% on water terrain (Section 18). Both in rules.yaml `class_traits` (50 / 30, Decision 126).
skl_weights:                # DEFERRED: no per-class SKL weights for the prototype (flat coefficients, design doc Section 8)
  hit: 0
  evasion: 0
  guard: 0
  crit: 0
  crit_resist: 0
```

---

## 11. Roster (what a player registers)

```yaml
roster_id: ""
version: ""            # schema/content version, for tower season pinning
heroes:                # exactly 6
  - char_id: char_000
    squad_id: soldier_000   # the player's pairing: a soldier type eligible for this hero. Banned with the hero; deploys only if this hero is leader.
    squad_row: null         # OPTIONAL. Omit to use the soldier type's default_soldier_row; must be one of its allowed_soldier_rows
    equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null }
    sigils: { weapon: null, armor: null, accessory_1: null, accessory_2: null }   # OPTIONAL. A god id per slot (Section 17); counts only on a filled slot (W_SIGIL_EMPTY_SLOT)
    sigil_side: def       # OPTIONAL, def | atk. Which 4-piece 4 same-god sigils unlock: required then (E_SIGIL_SIDE_MISSING), else W_SIGIL_SIDE_UNUSED
    tactic_sheet: []   # up to 10 tactics (Section 8)
    preferred_row: front
leader_line: []        # ordered char_ids; highest-ranked fielded hero leads
anchor: null           # char_id; defender snapshots only. Unbannable and cost-capped.
ban_sheet: null        # Section 12; required for defender snapshots
battlefield: null      # terrain id; defender snapshots only; visible at reveal (Decision 111). E_BATTLE_TERRAIN if unknown
```

## 12. Ban sheet (defender)

```yaml
rules:
  - priority: 1
    filter:            # condition node over candidate hero attributes
      all:
        - { type: hero_class, value: mage }
        - { type: has_skill_tag, value: revive }
    select: highest    # highest | lowest | nearest
    metric: cost       # cost | stat:<STAT> | hp
# Two-slot limit: one filter, optionally a second ANDed (`all` of two leaves), plus the selector; no nesting, OR or NOT (enforced: E_TACTIC_SHAPE).
# Evaluated at each defender draft step, top to bottom; a rule fires at most once.
# Fallback (not authored): ban the highest-cost eligible hero, ties by cost then ID.
```

Allowed leaf types: `hero_class`, `hero_faction`, `leader_aura_type`, `has_skill_tag`, `cost`, `stat_compare`, `is_official`. Never a hero ID.

## 13. Draft config

```yaml
draft:
  roster_size: 6
  fielded: 4
  defender_anchor: true
  steps:
    - { actor: challenger, action: ban,     source: human }
    - { actor: defender,   action: ban,     source: rule_sheet }
    - { actor: challenger, action: protect, source: human }
    - { actor: challenger, action: ban,     source: human }
    - { actor: defender,   action: ban,     source: rule_sheet }
# A live PvP mode would reuse this with source: human for both actors.
```

## 14. Cost (computed by default, overridable)

Cost comes from a basic algorithm over raw stats, PP, skill multipliers, effect types, squad and devotion blessings. Any hero, skill or item may carry an authored `cost_override` that replaces its computed price (official content only; community packs get E_NOT_COMMUNITY_SAFE).

```yaml
cost:
  stat_weights: { HP: 0.1, ATK: 1.0, INT: 1.0, DEF: 0.8, MDEF: 0.8, SPD: 1.2, HIT: 0.5, SKL: 0.5, CRIT: 0.5, GUARD: 0.5, EVA: 0.5 }  # placeholders
  skill_price: 10
  aura_price: 10
  squad_price: 15
  # devotion blessings are priced by the same algorithm; per-effect-type prices TBD
caps:
  per_hero: null
  protected_or_anchor: null   # stricter than per_hero
  roster: null
# All numbers are placeholders until calibrated by the gauntlet.
```

## 15. Validation checklist (run before every battle)

- Unique IDs, valid references, enum values only.
- Every hero has all 11 stats, a class, and a `leader_aura`.
- Skill `pp_pool` matches `category`; `trigger_event` present when `trigger == on_event`.
- Equipment slot/tags/eligibility consistent with the hero's restrictions.
- Tactic sheets: at most 10; skills present on the hero's skill list.
- Leader is in the front row; exactly one leader per party; at most one soldier squad deployed.
- Percent effects carry a `source_category`.
- Roster has exactly 6 heroes, a leader line covering them, an assigned squad per hero, and (for defender snapshots) an anchor and a ban sheet.
- No tactic or ban-sheet condition references a hero ID. (Authored content such as leader auras and equipment effects may.)
- Cost caps pass: per hero, protected/anchor (tighter), and roster.
- Skill `tags` use values from `skill_tags`.
- Every roster entry's resolved squad row (`squad_row`, else the soldier type's `default_soldier_row`) is in its soldier type's `allowed_soldier_rows`; soldier types have a valid `class`.

---

## 16. Rules constants (tunable, one place)

```yaml
rules:
  damage:    { min_damage: 1, crit_multiplier: 1.5 }   # floor(max(1, power * multiplier * matchup - defense)); no variance
  guard:     { damage_reduction_percent: 50, total_reduction_cap_percent: 75 }
  matchup:   { advantage_damage_percent: 25, advantage_hit: 10, disadvantage_damage_percent: -15 }
  timeline:  { interval_constant: 1000, min_spd: 5 }
  pp:        { base_active: 2, base_passive: 2, max: 4 }
  board:     { rows: 4, columns: 3, hero_rows: 2 }
  stun_pushback_counts: 15     # [DEFAULT] Stun delays the target's pending action by this many timeline counts
  rolls:     { hit_min: 70, hit_max: 100, crit_min: 0, crit_max: 100, guard_min: 0, guard_max: 75, skl_divisor: 4 }
  # hit% = clamp(HIT + hit_bonus - EVA + (aSKL - dSKL)/skl_divisor, hit_min, hit_max); crit% = clamp(CRIT - defender GUARD + (aSKL - dSKL)/skl_divisor, crit_min, crit_max); guard% = clamp(GUARD + dSKL/skl_divisor, guard_min, guard_max)
  class_traits: { flyer_melee_eva_bonus: 50, aquatic_water_spd_bonus: 30 }   # percent (Decision 126)
  phase:     { max_actions_per_phase: null }   # TBD; hard last-resort cap, added with the engine
  # also: class_advantage, draft, limits, cost (stat_weights, skill_price, effect_price, aura_price, squad_price, caps)
```


## 17. Devotion (prayer): god

```yaml
# content/gods.yaml (open-ended list, Decision 113; placeholder pantheon: the Seven Lucky Gods, Decision 125)
- id: god_000
  name: ""
  virtue: ""
  vice: ""                # lore only
  description: ""
  blessing:
    name: ""
    two_piece: []         # effects (Section 7), unlocked by 2 sigils of this god on one hero
    four_piece_def: { name: "", effects: [] }   # unlocked by 4 sigils with sigil_side: def, on top of the two_piece; name OPTIONAL
    four_piece_atk: { name: "", effects: [] }   # the same with sigil_side: atk
# Sigils: the roster entry's `sigils` (Section 11), one god per filled equipment slot.
# Blessing effects use the `prayer` stacking category. Engine forms: modify_stat (optionally with a condition, e.g. action_is_single_target),
# ignore_guard / ignore_defense / damage_bonus / crit_damage (with a condition), reflect_damage / heal / damage / damage_bonus with `trigger: on_event`
# and an event-leaf condition judged per hit of the attacking action (e.g. unit_hit_by_single_target_attack, self_dodged; self_killed_enemy fires at the
# kill), reduce_damage with duration phase, battle or first_single_hit. Priced by the cost algorithm (Section 14).
```

## 18. Battlefield stub

```yaml
# content/terrains.yaml (Decision 122). The schema in src/schema/content.ts is authoritative.
- id: terrain_000
  name: ""
  description: ""
  water: false            # OPTIONAL. Water terrain: aquatic units get SPD +class_traits.aquatic_water_spd_bonus% (Decision 126)
  modifiers: []           # e.g. [{ classes: [cavalry], stat: SPD, mode: percent, value: -10 }] (terrain stacking category)
# The defender picks one per snapshot; visible at reveal (like the anchor).
```

## Notes added with the validator
- `default_soldier_row` is a required field on soldier types (pre-fill for the squad row).
- Duration units include `instant` (no count), used by Stun. `delays_pending_action` is a boolean: true means a fixed pushback in counts (`stun_pushback_counts`, Section 16).
- Stat penalties on soldiers use a structured `when` condition (for example `soldier_mounted`), not free text.
- The schema in `src/schema/` is authoritative; if this document and the schema disagree, the schema wins.
- `interactions.overflow_to_next_soldier` is removed from the skill template: no spill is a rule, not an option 
- `apply_status.include_soldiers` defaults to false (area statuses skip soldiers unless the effect opts in); the schema default is false.
