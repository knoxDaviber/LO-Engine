# Tactics Auto-Battler: Design Document v2

**Status:** Prototype specification (supersedes "Design Doc - beta")
**One-line pitch:** Unicorn Overlord's gambit system with Langrisser-style soldier squads. The player's skill is building a party and writing its tactics board; combat is a deterministic simulation they watch. Long-term, players climb and defend a weekly tower of other players' parties.

Legend used throughout: **[DECIDED]** = confirmed by the designer. **[DEFAULT]** = proposed value, stored as a tunable constant, change freely. **[OPEN]** = needs a designer decision before it is final.

---

## 1. Design Pillars

1. **The tactics board is the product.** Everything else exists to give it interesting things to decide between.
2. **Preparation over execution.** No manual control in combat. The player is judged on party, gear, formation and tactics.
3. **Readable simulation.** Every action can be explained: why this tactic, why this target, why the others were skipped. Stacking is uncapped, so the log and the editor must show a per-stat breakdown: which effect won and which was suppressed (Section 9.1) [DECIDED].
4. **Deterministic and re-runnable.** Same inputs plus same seed give the same battle. The server can always re-run a fight.
5. **Data-driven.** New heroes, skills, gear and conditions are authored as data, not code.
6. **Counter-play through information.** Defenders are visible snapshots, so players win by predicting and countering, not by hidden power.

---

## 2. Party Structure

- A player registers a **roster of 6 heroes**; the draft (Section 2A) cuts it to **4 fielded heroes** per battle [DECIDED]. The combat engine only ever sees the 4.
- Each hero: base stats, class, factions, equipment (Weapon, Armor, Accessory 1, Accessory 2), up to 10 tactics, Active PP pool, Passive PP pool.
- **Party leader:** the leader is the highest-ranked fielded hero in the player's ranked leader line, resolved after the draft (Section 2A) [DECIDED].
  - **Every hero is assigned their own squad by the player** [DECIDED]. Only the leader's squad is deployed (10 soldiers). If the leader is banned, their squad is banned with them and the next hero in the leader line leads and brings their own squad and aura.
  - **Leader must be in the front row** [DECIDED]. This puts the leader in reach of default front-row targeting, so defenders can counter-build for a leader-focus challenger, and challengers can focus the leader to remove the squad and the aura. Current leader rules are kept [DECIDED]. Two candidates to revisit after the batch sim (Section 14), not decided: (a) the squad guards the leader (single-target attacks on the leader are partly intercepted by soldiers while the squad lives); (b) allowing back-row leaders.
  - **Soft leader rule** [DECIDED]: if the leader dies, the squad is removed immediately and the leader's aura ends. The party keeps fighting. Soldiers are never a victory condition.
  - **Leader aura** [DECIDED]: every hero has exactly one unique aura, authored on the hero. It triggers **only when that hero is the party leader**, costs **no PP**, and ends when the leader dies. It is treated as a secondary pre-battle passive. Aura types:
    - **Field:** affects both allies and enemies.
    - **Faction buff:** affects only allies who belong to the named faction (e.g. The Emperor's +20% ATK/DEF to Empire units).
    - **Ally buff:** a buff to allies, optionally filtered (by class, or by specific heroes in authored content) and optionally triggered by an event instead of always-on (e.g. "after the leader acts"). Examples: Lief buffs Lancers; Jasmine heals allies after she acts; Leon buffs himself and The Emperor when both are fielded.
    - **Enemy debuff:** a debuff applied to enemies.
    - Auras count as the **Passive** source category for stacking (Section 9.1). They do not use or require Passive PP.
    - Auras may be filtered (by class or faction) and may be event-triggered (e.g. "after the leader acts"; an idle action counts as acting) [DECIDED]. Official auras may carry a designer-set `cost_adjustment` on top of the computed cost (Jasmine's, because she deals no damage).
    - This replaces the earlier "while alive" wording on The Emperor: his buff now applies only while he is both alive and leader.
  - **Leader succession** [DEFAULT]: between phases, if the leader is dead, the player may name a new leader from survivors. The aura returns; the squad does not (no respawn).
- **Victory:** a party wins the battle when every opposing hero is defeated.

### 2.1 Soldiers

- 10 soldiers, each with their **own HP**; same stats for all in a squad. **A squad is selected as ONE target** [DECIDED]: players and tactics cannot target individual soldiers, and a squad counts as a single target for target selection (single-target, row, column, all). How damage and heals then land on the soldiers is below.
- **Soldier types are generic content; squads are pairings** [DECIDED]. Each soldier type has eligibility (by hero and/or class), so certain heroes get certain varieties, and the player picks a hero plus an eligible soldier type to form that hero's squad. A pairing can carry penalties (e.g. Leon's SPD -20 with non-mounted soldiers).
- **Soldiers have no tactic sheet and no PP.** They basic attack and carry soldier skills [DECIDED].
- **Soldier skills** [DECIDED]: each soldier type carries its own passive skills, which can empower the soldiers, the leader, or the whole party. A soldier skill may be **always-on or event-triggered**; it costs no PP and is not on any tactic sheet [DECIDED]. They are a **separate stacking category** (`soldier`), so they stack with equipment, active and passive effects (Section 9.1). Soldiers have somewhat different stats per type but are all relatively weak. Projected examples (not yet content): heal power +20%; changes the leader to Flying (Flyer evasion against melee, Section 3.1); recover 20% HP after attacking; revive fallen soldiers at 1 HP after an attack (only while at least one soldier is still alive). These need new effect types. The earlier projected `ground_based` attack tag is subsumed by the skill and soldier-type `range: melee | ranged` declaration (Section 3.1).
- Default target: nearest unit, front row first [DECIDED].
- Soldiers act on the same SPD timeline as heroes, as one squad action per scheduled count, with each living soldier attacking [DEFAULT]. **A squad's attack is each living soldier attacking**: 10 real hits, each with its own hit, crit and guard rolls [DECIDED]. Squads have no PP, so they act on their own SPD schedule until the phase ends, and for squads (unlike heroes) higher SPD does mean more attacks per phase (Section 6) [DECIDED]. Each soldier type declares the `range` (melee or ranged) of its basic attack [DECIDED].
- **Placement:** the squad occupies an entire 1x3 **soldier row** on the 4x3 board, either in front of the hero rows (body shield) or behind them (extra damage, protected by the party); see Section 10 [DECIDED].
- Each soldier type declares `allowed_soldier_rows`. Both current types allow either the first or the last board row [DECIDED].
- Damage to a squad [DECIDED, replaces the earlier shared HP pool]:
  - **Single-target hit:** lands on the **lowest-HP living soldier**. Excess damage on a killed soldier is discarded (no spill to other soldiers or to the heroes).
  - **Row, column and all skills** hit every living soldier separately (each soldier is its own damage recipient, with its own hit and guard rolls).
  - **Healing a squad is always treated as AoE**: the heal amount is split evenly across all 10 soldiers, dead ones included, and each soldier's share is added to its own HP, capped at its max HP. Dead soldiers revive at their share. Example: heal 60 on 10 soldiers = +6 each; a living soldier at 20 goes to 26, a dead soldier revives at 6.
  - **Per-hit effects trigger once per attacking action** regardless of hit count (Section 7), so a 10-hit squad attack applies Regen, on-hit reactives and PP reduction once, while still dealing 10 hits of damage [DECIDED].
- **Squads share their leader's buffs and debuffs** [DECIDED]: any stat buff or debuff applied to the leader also applies to the leader's squad, because they are one squad. Status and buff effects that hit "everyone in a row" or "the party" skip squads unless they say otherwise, so a squad is otherwise buffed only through its leader (Iron Fist's row guard reaches the squad only when the Emperor is leader). **Only stat modifiers propagate** [DECIDED]: death intercepts (Fairy's Grace), Regen and control statuses (Stun, Confusion) stay on the leader.
- Heroes can filter targeting to heroes only, ignoring soldiers [DECIDED] (see Section 4).
- Soldier squad wiped: the hero lives. Hero dead: squad removed.

---

## 2A. Roster, Draft and Cost

### Roster [DECIDED]
- One roster of **6 heroes** per player (the tower's earlier "1-3 teams" idea is deferred). Each roster hero carries their own equipment, tactic sheet, squad and preferred row.
- The roster stores a **leader line**: a ranked list. After the draft, the highest-ranked fielded hero is leader. Leaders are not automatically protected.
- **Tactics cannot reference specific heroes.** Conditions may use class, faction, status, position and so on, but never a hero ID, and the validator rejects any that do. A condition that depends on a class or faction that isn't present simply fails and the tactic is skipped (a player skill issue, not an engine problem).
- **Authored content may reference specific heroes** (leader auras, faction and equipment effects, e.g. Leon's aura requires The Emperor in the party). Only player-written tactic sheets and ban sheets may not [DEFAULT].

### Draft sequence [DECIDED: variant C]
The defender's snapshot designates one **anchor** hero, visible at reveal and unbannable for the whole draft. Steps resolve in this order:

| Step | Actor | Action | Source | Restriction |
|---|---|---|---|---|
| 1 | Challenger | Ban 1 of defender's 6 | Human | Cannot ban the anchor |
| 2 | Defender | Ban 1 of challenger's 6 | Rule sheet | None yet |
| 3 | Challenger | Protect 1 hero | Human | Protected hero can no longer be banned |
| 4 | Challenger | Ban 1 more of defender's remaining | Human | Cannot ban the anchor |
| 5 | Defender | Ban 1 more | Rule sheet | Cannot ban the protected hero |

Result: each side loses exactly 2 and fields exactly 4. There is no self-cut.

**Defender rule sheet** [DEFAULT]:
- A list of ordered ban rules (filter + selector), matched against derived hero attributes (class, faction, leader aura type, skill tags, cost, stats, official/community). Same two-slot limit as player tactics [DECIDED]: one filter condition, optionally a second ANDed with it, plus the selector; no nesting, OR or NOT Enforced (E_TACTIC_SHAPE).
- At each defender step, rules are evaluated top to bottom against eligible heroes and the first rule that picks a hero bans it. A rule that has already fired is skipped. If no rule matches, the fallback bans the **highest-cost eligible hero**. Ties break by cost, then ID. Exactly one ban per step, always.
- Rule sheets are hidden until resolved, but expected to leak over many attempts, so balance rests on the counts, not on secrecy.

**Draft as data:** the sequence above is a config list of steps (`actor`, `action`, `source`), not code. Live PvP would swap `source` to `human` for both sides and add a protect step for the second player. The engine never assumes one side is the defender.

**After the draft** [DEFAULT]: formation is resolved from each hero's preferred row, leader forced to front, with row overflow resolved by leader-line rank. Both sides use the same rule. The challenger may still adjust formation between phases (Section 5.5).

### Cost [DEFAULT, to be calibrated]
Each hero has a **cost** that counts their stats, skills, aura, equipment, squad and devotion blessings. By default it is computed by a basic algorithm over raw stats, PP, skill multipliers, effect types and so on [DECIDED]; the algorithm and weights are placeholders replaced by gauntlet results once available. Any hero, skill or item may carry an authored `cost_override` that replaces its computed price [DECIDED] (official content only). Cost does three jobs: caps, the fallback-ban ordering, and tiebreaks.
- Per-hero cost cap, with a stricter cap on the **protected hero and the anchor** (they cannot be banned, so they get the tightest balance gate).
- Roster cost cap across all six.

### Skill tags
Skills carry authored `tags` (e.g. `revive`, `stun`, `aoe`, `heal`, `debuff`). Ban rules and the gauntlet match on them.

---

## 3. Classes, Factions, Stats

### 3.1 Classes and matchups [DECIDED structure, DEFAULT values]
Classes: Infantry, Lancer, Cavalry, Archer, Flyer, Aquatic, Mage, Assassin, Holy, Monster. More classes will come [DECIDED]; the class list is data (`enums.ts`), so adding one is a data change.
Triangle: Infantry > Lancer > Cavalry > Infantry. Archer > Flyer. Holy > Monster. **Mage and Assassin stay neutral (no matchups) for now** [DECIDED].
- **Monster and Holy** [DECIDED]: Monster units generally have higher base stats than other classes (a content guideline; the cost algorithm prices the extra stats), and Holy is their counter (Holy > Monster).
- **Flyer** [DECIDED]: much higher evasion against **melee** attacks (value TBD in `rules.yaml`, e.g. `flyer_melee_eva_bonus`). It is added to the defender's EVA in the hit formula (Section 8) and is bounded by the hit% floor.
- **Aquatic** [DECIDED]: gets an SPD bonus on water battlefields (value TBD; see Battlefield, Section 10A).
- (`aquatic` is in `CLASSES` and `rules.class_traits` holds the Flyer and Aquatic constants, value TBD; the trait mechanics are not implemented yet.)
- **Melee / ranged** [DECIDED]: every damage skill declares `range: melee | ranged`, and each soldier type declares the range of its basic attack. Range is what Flyer evasion keys on
Matchups are a data table (attacker class, defender class, modifier). Default advantage: **+25% damage and +10 HIT** (HIT enters the formula as `hit_bonus`, Section 8). Disadvantage mirrors it at −15% damage. Skill-specific bonuses (e.g. Vine Stab +30% vs Cavalry) are separate modifiers [DECIDED: it multiplies with the class advantage]. Class advantage and skill bonuses apply to `power x multiplier` **before** defense is subtracted [DECIDED], so advantage matters most against high-DEF targets. Soldier types keep their own class (Heavy Infantry: infantry, Heavy Cavalry: cavalry), so matchups also apply to and from squads [DECIDED].

### 3.2 Factions [DECIDED]
A hero can have several factions. A faction is a **category only**: lore, and a filter target for effects (faction auras, `faction_is` conditions). **No global set bonuses**, neither faction nor class sets [DECIDED]. Combination play is hero-carried: auras, passives and partner rules (e.g. Leon's aura requires The Emperor) live on the hero, so the synergy is banned with its hero and priced by that hero's cost.

### 3.3 Stats
HP, ATK, INT, DEF, MDEF, SPD, HIT, SKL, CRIT, GUARD, EVA.
- **Heroes deal damage only through skills** [DECIDED]: there is no hero basic attack, so a hero with no damage skill (Jasmine) cannot deal damage whatever her ATK. ATK stays a required stat, for lore and future skills.
- **CRIT** is the single source of truth for crit chance; the defender's **GUARD** is crit's opposed stat, the way EVA opposes HIT (Section 8) [DECIDED]. New heroes default to 30 in the editor [DECIDED baseline]. Sheets without a CRIT value (Leon) are a validation error, not a silent default.
- **SKL** (hidden reliability) feeds hit, evasion, guard and crit through one centralized function, with class-dependent weights [DECIDED concept]. [DEFAULT for prototype] no per-class SKL weights: SKL feeds the Section 8 formulas at flat coefficients; per-class weights deferred. The party-pooled redistribution idea is deferred until the basics balance.
- **Modifier order** [DEFAULT]: base → flat → percentage (strongest wins within a source category, multiplied across categories, Section 9.1) → conditional → floor/cap.

---

## 4. The Tactics Board (core system)

Each hero has an ordered list of up to **10 tactics** [DECIDED]. Active and passive skills are both displayed and configured here. A skill that is not on the sheet and enabled never executes [DECIDED].

### 4.1 A tactic is
1. Priority (position in the list)
2. Skill reference (ID)
3. Enabled flag
4. **Activation condition** (whether to attempt): **one condition, optionally with a second ANDed** [DECIDED]
5. **Targeting:** a main condition (who to consider; again one condition, optionally with a second ANDed) plus a sub selector or condition (how to choose among them)
6. Optional tactic-level fallback: `skip` or `next_valid_target` (distinct from the skill-level `re_evaluate | skip`)

Activation and targeting are separate systems [DECIDED]. **Player-written sheets use at most two ANDed conditions per slot, with no nesting, OR or NOT** [DECIDED]; authored content keeps full condition trees The validator enforces this (E_TACTIC_SHAPE), also on skills' default activation and targeting.

### 4.2 Evaluation when a hero acts
For each tactic top to bottom: enabled? skill eligible? activation condition true? PP sufficient? valid target found? If all yes, execute it and stop. Otherwise log the skip reason and continue. If none qualify, the hero does nothing this action [DECIDED]. Only one tactic executes per scheduled action.

### 4.3 Condition library
Conditions are typed nodes. Authored content may combine them with AND / OR / NOT and nest them; player sheets are limited to two ANDed conditions per slot (Section 4.1). Every condition supports comparators (>, <, ≥, ≤ =, ≠) and, for targeting, selectors (lowest, highest, nearest, farthest, random with seed).

| Category | Examples |
|---|---|
| HP-based | HP % > 80, HP % < 50, lowest HP, highest HP, current HP absolute, missing HP |
| Unit type | hero only, soldier only, ignore soldiers, leader only, not leader |
| Class | is Cavalry, class has advantage over me |
| Faction | member of Empire |
| Position | front row, back row, soldier row (front or back), same column as X, row empty |
| Status | has buff/debuff X, has any debuff, missing buff X |
| Stat-based | highest ATK, lowest DEF, SPD < X |
| Resource | my Active PP ≥ N, target has Passive PP |
| Counts | enemies alive ≥ N, allies alive ≤ N, enemy soldiers remaining |
| Self/events | I was attacked since my last action, ally was attacked, I was just healed |
| Battle | **current phase = N**, action count ≥ N |

Main/sub semantics [DEFAULT]: the main condition filters the candidate set and picks a group; the sub-condition sorts or tie-breaks within it. A missing sub-condition never invalidates the main condition. Default with nothing set: nearest valid target, front row first, ties broken by column index then unit ID (never database order) [DECIDED].

Filters to support from day one (they carry the soldier-vs-hero strategy): *heroes only*, *soldiers only*, *front row first / back row first*, *leader*.

### 4.4 Passives on the sheet
A passive has a **trigger** (`pre_battle`, `own_turn`, `on_event:<name>`, `while_condition`) that is independent of its **PP pool**. "Reactive", "always-on" and "conditional" are labels derived from the trigger. When one event triggers several reactive passives, they resolve in sheet priority order [DEFAULT]. An `on_event` passive also declares a **timing**: `before_hit` resolves before the triggering attack's combat resolution (Hegemony strips the attacker's buffs first, Quick Guard guards the hit), `after_hit` resolves after it (Quick Heal) [DECIDED].

---

## 5. Combat Flow: Phases [DECIDED]

A battle is up to **3 phases**.

### 5.1 Phase loop
1. Pre-battle resolution (equipment, faction/aura, pre-battle passives, final stats).
2. Schedule first actions. Count starts at 0, nobody acts at 0, the clock jumps to the earliest action.
3. Heroes and soldiers act on the timeline.
4. After each action (including its reactions) check end conditions.

### 5.2 Phase end [DECIDED]
- **Battle ends immediately** if all heroes on one side are defeated.
- **Phase ends** when every living hero on both sides is *exhausted*: Active PP is below the cost of every enabled active skill on their sheet.
- **Idle safety:** if a full cycle passes in which no skill was executed and nobody is exhausted (conditions waiting on something that never happens), the phase ends. **A full cycle = every living unit has had a scheduled action since the last skill was executed.** A hard action cap exists as a last resort: constant `max_actions_per_phase` in `rules.yaml` (to be added with the engine; value TBD) [DEFAULT].
- Soldier basic attacks never keep a phase alive. When the phase ends, remaining soldier attacks do not happen.
- Passive PP does not keep a phase alive; a passive only matters when something triggers it.

### 5.3 Between phases
- **HP and deaths persist. Soldiers do not respawn** [DECIDED].
- **Active and Passive PP refresh fully** [DECIDED].
- Statuses clear. Timeline resets to count 0 [DEFAULT].
- Pre-battle passives re-fire each phase, spending refreshed Passive PP [DEFAULT].
- No free action: a hero with no PP does nothing [DECIDED].

### 5.4 Result
Survivors after phase 3 with no side wiped: **the challenger loses** [DECIDED]. In PvE the player is always the challenger.
- **Known risk: turtling** [DECIDED to keep the rule and rely on bans]. Defenders can build walls that run out the clock. The anchor is unbannable, so defenders will make their best wall the anchor. The batch simulator must report the timeout rate (Section 14).

### 5.5 Challenger edits between phases [DECIDED]
The challenger may adjust between phases. [DEFAULT scope]:
- Allowed: tactic sheets (order, conditions, targeting, enable/disable), soldier squad row, hero rows (leader stays front), naming a new leader if the old one died.
- Not allowed: roster, equipment, skill pool, base stats.
- Defenders are frozen snapshots. To give defenders a way to adapt, the `current phase` condition exists for everyone, so a defender can pre-commit phase-dependent tactics.
- The server assigns the seed per phase and does not reveal it, so the challenger cannot pre-simulate the next phase.

---

## 6. Speed and Timeline

- **SPD is initiative** [DECIDED]. Heroes have a fixed PP budget and the phase ends when every hero is exhausted (Section 5.2), so SPD does not give a hero more skill uses per phase; it decides the **order** of actions. Higher effective SPD acts earlier, and acting first can deny the enemy's actions by killing them before they spend their PP.
- SPD's value for heroes is therefore: (1) kill races (a unit killed before it acts loses its unspent PP), and (2) landing effects first (stun, debuffs, buffs, heals).
- **Squads are the exception** [DECIDED]: squads have no PP and act on their own SPD schedule until the phase ends, so for squads higher SPD does mean more attacks per phase.
- Conversion [DEFAULT]: `interval = round(1000 / max(SPD, 5))`. One centralized function; the designer's earlier "1 SPD = 1 count" is superseded. The interval sets scheduling order (and squad attack frequency).
- Pending actions are rescheduled when SPD changes: preserve the fraction of the interval already elapsed [DEFAULT]. One pending entry per actor.
- Ties: FILO for speed-change ties; truly simultaneous actions go to the party with higher **average SKL of living heroes** [DECIDED]. **Final tiebreak** [DECIDED]: equal average SKL goes to the challenger; within a side, formation order (front-left to back-right), then unit ID.
- Skills may delay the actor's next action. Interrupted actions are rescheduled if still valid [DECIDED].
- **Stun = pushback** [DECIDED]: Stun delays the target's pending action by a **fixed number of timeline counts**, a `rules.yaml` constant (e.g. `stun_pushback_counts`, value TBD). No action and no PP is lost; the stunned unit simply acts later (and may be killed first). This replaces the earlier configurable sqrt/linear curve that made the delay rise with SPD. (`delays_pending_action` is a boolean; `stun_pushback_counts` is null/TBD.)
- **SPD UP** [DECIDED]: Thousand Azure Hooves gives its caster SPD +15% for 1 turn after the action, so the next action comes earlier in the order. The earlier "cast faster" idea (a bonus on the casting action itself) was dropped.

---

## 7. PP [DECIDED]

- Active PP base 2, Passive PP base 2; max 4 with equipment [DECIDED]. Dragon Scale (+1 Active PP) is a valid test.
- Separate pools. Active skills spend Active, passives spend Passive.
- PP is spent per use (a 1-PP skill can be used twice at 2 PP).
- **Passives spend PP when their condition triggers them, and the passive then becomes *used*** [DECIDED]. If there is not enough Passive PP when the condition is met, the passive does not fire (logged).
- **"Used" means** [DECIDED]: each trigger spends the skill's PP cost once. A one-event passive (Quick Guard) guards one attack per spend. A state passive (Berserk) spends on activation and stays on until its condition ends; if the condition ends and returns, it spends again.
- Leader auras are exempt from all of the above: free, no PP, no "used" state.
- **Per-hit effects trigger once per attacking action**, regardless of hit count [DECIDED]. This covers Regen ("per hit taken"), on-hit reactive passives, and PP reduction such as Longinus (-1 Passive PP to the unit hit). A multi-hit attack (a squad's 10 hits, a row skill hitting one unit twice) still deals damage per hit, but these effects fire once per attacking action per affected unit.

---

## 8. Damage Resolution [DEFAULT formulas, all constants tunable]

Order: select target (a single-target hit on a squad resolves to its lowest-HP living soldier, Section 2.1) → hit check (HIT vs EVA, SKL-adjusted) → damage (`power × multiplier × matchup − defense`, minimum 1) → crit check → guard/reductions → apply to HP/soldiers → statuses/reactions → rescheduling.

- **Damage is floored to an integer** [DECIDED], consistent with the worked examples below (157.5 - 100 -> 57; 157.5 - 50 -> 107).
- **Minimum damage** [DECIDED]: any hit that lands deals at least 1 damage, even when the attacker's power is below the target's defense. The tick matters for on-hit mechanics.
- **Damage formula** [DEFAULT, still being tuned]: `max(1, power x skill_multiplier x matchup - defense)`. Power is the skill's scaled stat value after all buffs, debuffs and stat conversions. The matchup factor combines the class advantage and skill bonuses (they multiply). Defense is the target's relevant defense after all modifiers. A high-DEF unit can only be hurt by high-power, high-multiplier or class-advantaged skills. Worked example, a bare Leon (cavalry) attacking a Dragon-Scale Emperor (infantry, DEF 50 + 50 = 100): Charging Assault is 70 x 1.2 x 1.25 = 105, so 5 damage; Thousand Azure Hooves is 70 x 1.8 x 1.25 = 157, so 57. If the Emperor is also the leader (Empire's Dominion, DEF x 1.2 = 120), Charging Assault falls back to 1 and Hooves to 37.
- **GUARD is the chance to guard** [DECIDED]: when a guard activates it reduces damage by 50%. GUARD UP adds 50 to the GUARD stat.
- Defense stat follows the skill's damage type (physical → DEF, magical → MDEF). Skills may override.
- Crit multiplier 1.5×.
- **Probabilities** [DEFAULT, prototype placeholders; constants go in `rules.yaml`; no per-class SKL weights]:
  - `hit% = clamp(HIT + hit_bonus - EVA + (attacker SKL - defender SKL)/4, 70, 100)` [DECIDED narrow band]. `hit_bonus` = the skill's `hit_bonus_percent` + the class-advantage HIT. EVA includes the Flyer's melee evasion bonus when the attack is melee (Section 3.1).
  - `crit% = clamp(CRIT - defender GUARD + (attacker SKL - defender SKL)/4, 0, 100)` [DECIDED]. Cap 100 is deliberately hard to reach and build-altering. CRIT default 30 stays.
  - `guard% = clamp(GUARD + defender SKL/4, 0, 75)` (unchanged; a guard halves damage). **GUARD therefore has a dual role** (lowers enemy crit chance and feeds its own guard roll) [DECIDED]: kept for now, to be re-checked in the batch simulator.
- **Guard and damage reduction stack multiplicatively** (0.5 × 0.5 = 0.25) with a total-reduction cap of 75% [DEFAULT]. "Ignores guard" skips only the GUARD stat roll, not other reductions, unless the skill says otherwise.
- **No damage variance** [DECIDED]: damage is deterministic given a hit and a crit; randomness comes only from the hit, crit, guard and evasion rolls (seeded), which are intentional variance.

---

## 9. Status Effects

- Data-defined. Default: no stacking; reapplication refreshes duration [DECIDED].
- Durations are explicit and match the schema's `DURATION_UNITS`: `affected_unit_actions`, `source_unit_actions`, `until_next_hit`, `timeline_counts`, `while_condition`, `until_used`, `battle`, `instant` (consumed immediately, no count; used by Stun). **1 turn = one active skill use by the affected unit** [DECIDED]; idle actions and passives do not count.
- A pre-battle buff lasting 1 turn therefore lasts until that unit's first active skill, which removes the earlier worry that such buffs could expire before mattering.
- Death and revival: Fairy's Grace lasts until used, is an ordinary buff (buff removal can strip it), intercepts death before removal, and revives at 20% HP with the unit's pending action preserved [DECIDED].
- **Confusion** [DECIDED]: a confused unit ignores its tactics and attacks a random valid target, lasting until that unit's first active attack. The Strange Box applies it once at pre-battle to every unit on both sides, including the wearer. Two boxes do not stack.
- **Regen** [DECIDED]: heals once per attacking action that hits the target (Section 7), lasts until the target uses an active skill, has no max stacks (PP is the natural cap), and reapplication extends it by 1 turn. This is an **authored exception** to the default refresh rule (`on_reapply: extend`).
- Pre-battle order conflicts (buff removal vs buff grant vs immunity vs Confusion) are resolved by a fixed pre-battle priority list [DEFAULT]: (1) equipment effects → (2) buff grants: pre-battle passives (spend PP) and ally/faction/field-ally leader auras, including Immunity → (3) pre-battle buff removal (any effect that strips buffs before the first action) → (4) debuffs: enemy-debuff auras, debuff passives, field effects such as Confusion, each blocked by Immunity if still present → (5) SPD finalization and initial scheduling [DECIDED]. Immunity therefore resolves before debuff auras, so a healer can counter an enemy-debuff leader. A buff-removal effect that resolves in step 3 can still strip Immunity before step 4.

### 9.1 Buff stacking [DECIDED]

Every percentage modifier carries a **source category**: **Passive** (includes leader auras), **Active** (skill effects), **Equipment**, **Soldier** (soldier skills), or **Prayer** (devotion blessings, Section 9A) [DECIDED]. (`prayer` is in `SOURCE_CATEGORIES`.)

- **Within the same category, effects do not stack.** For the same stat, the strongest wins (a 20% passive and a 30% passive give 30%).
- **Across categories, each is its own multiplier.** A 20% passive and a 20% active give ×1.2 × 1.2 = ×1.44.
- This applies to every pair: passive vs passive, active vs active, equipment vs equipment and soldier vs soldier never stack; passive, active, equipment, soldier and prayer effects all stack with each other [DECIDED]. Stacking is uncapped [DECIDED], so the combat log and the editor must show a per-stat breakdown (which effect won, which was suppressed) [DECIDED].
- **Unique statuses stack** [DECIDED]: a status flagged `unique` (Berserk, Dark Dragon's Ire) is exempt from the same-category strongest-wins rule and multiplies with everything. Unique is authored per status; it is usually, not always, set.
- A status that several skills apply is the same status id, but each application carries its applier's category (Defense Down from Hegemony is passive, from Dark Dragon's Dirge it is active), so a passive-applied and an active-applied copy coexist and multiply. Reapplying within one category refreshes it.
- **Duplicate accessories are allowed** [DECIDED]: flat stat lines add (two Speed Rings = SPD +40), but identical effects from the same category do not stack.
- A skill or effect can opt out with an explicit `stacks_with` / `stackable` flag ("unless mentioned otherwise").
- [DEFAULT] The suppressed weaker effect is not deleted. It resumes if the stronger one expires or is removed.
- [DEFAULT] "Strongest wins" is evaluated per stat, so a skill that buffs ATK and DEF is not cancelled in full by a bigger ATK-only buff.
- [DEFAULT] Flat stat lines on equipment (HP +40, ATK +20) are added to base stats before any of this. Only conditional or percentage equipment effects (e.g. Queen's Scepter +20% INT) count as an "equipment buff".
- **Debuffs follow the same rule** [DECIDED]: passive, active, equipment, soldier and prayer debuff categories, strongest wins within each, multiplied across. Buffs and debuffs on the same stat multiply together (Berserk +50% ATK against an ATK debuff).

---

## 9A. Devotion (prayer) [DECIDED concept, details TBD]

- **Lore:** the world is governed by **7 gods** and everyone prays to them.
- Each **gear piece carries one god's sigil**, fixed on the item (no random substats) [DECIDED].
- **2 and 4 sigils of the same god** on one hero unlock that god's **blessing**, in two tiers (2-piece and 4-piece) [DECIDED]. Examples: Thorns = reflect part of the damage taken; Breeze = SPD up after acting. (Inspired by Langrisser Mobile enchant sets.)
- Blessings are a new stacking category **`prayer`**, the fifth multiplier alongside passive, active, equipment and soldier (Section 9.1) [DECIDED].
- Blessings are priced by the cost algorithm (Section 2A) [DECIDED].
- God names and the blessing list are TBD. Built in implementation step 3, with equipment (Section 15) [DECIDED].
- (schema change pending: gear has no sigil field and there is no blessing content type; `prayer` is already a source category.)

---

## 10. Formation

- **The board is 4 rows x 3 columns** [DECIDED]. Heroes can only stand in the middle 2x3: a front hero row and a back hero row (4 fielded heroes in 6 slots). The outer two rows are **soldier rows**: a squad fills an entire 1x3 soldier row, either in front of the hero rows or behind them, never both. Top to bottom: [soldier row, front] / hero front / hero back / [soldier row, back].
- Because a squad fills its whole row, it sits in every column. A column skill passes through it and a row skill aimed at that row hits it; a squad is selected as one target but every living soldier is hit separately [DECIDED] (Section 2.1).
- **The player defines the squad's row when building the squad** [DECIDED]: `squad_row` (front or back) is an optional field on the roster entry; if omitted it falls back to the soldier type's `default_soldier_row` (same defaults as heroes: melee/tanky front, ranged/frail back). Either way it must be one of the soldier type's allowed rows. The leader's `squad_row` applies. If the leader is banned, the next leader's squad and its row are used [DEFAULT].
- Any hero in any row (except the leader: front) [DECIDED].
- **Default preferred row** [DEFAULT, per-hero override]: ranged and low-DEF units (Archer, Mage, Holy) default to the back row; melee and high-HP units (Infantry, Lancer, Cavalry, Monster, Aquatic [DECIDED]) default to the front row [DEFAULT]. Assassin and Flyer also default to the back row [DECIDED]. The editor pre-fills `preferred_row` from this rule and the author can change it.
- Default targeting: front row first, then back when the front has no valid targets [DECIDED].
- Column and row skills must declare shape and damage distribution as separate fields.

### 10A. Battlefield [DECIDED concept, details TBD]
- A new content category: **terrain types** (land, sea/water, forest, mountains, cliffside, ...), each giving **buffs and debuffs to classes** (e.g. Aquatic SPD bonus on water, Section 3.1) [DECIDED].
- The **defender picks the battlefield** as part of their snapshot [DECIDED]. It is visible at reveal, like the anchor (Section 11).
- Terrain list and per-class modifiers are TBD. Terrain effects use the existing effect system; stacking category TBD. (schema change pending: no battlefield content type yet.)

---

## 11. The Tower (long-term) [DECIDED concept]

- Players climb a tower of floors, each floor a **defender snapshot** (a saved player party).
- **Roster:** one 6-hero roster per player, drafted down to 4 per fight (Section 2A). The earlier "1-3 teams" idea is deferred.
  - HP/death persistence between floors: DEFERRED to implementation step 6. Working default: full restore at the start of each floor fight. Attempt limits per day are DEFERRED (see below).
- The player who reaches the top becomes a floor. A season resets weekly or monthly; the top 10 become the new bottom floors [DECIDED].
- **Defender snapshot:** the full party, gear, formation, leader, tactic sheets, **chosen battlefield** (Section 10A), anchor and ban sheet, frozen at submission, with the content/rules version.
- Challengers can see the defender party, anchor and battlefield [DEFAULT]. This is intentional: defenders win by guessing the challenger's counter-strategy; challengers win by predicting the defender and adapting between phases.
- **Server authority:** every challenge is re-simulated on the server with a server-chosen hidden seed; client results are never trusted.
- **Versioning:** content and rules are pinned per season. Balance patches only land at resets.
- Anti-degenerate measures: DEFERRED to implementation step 6 (limits on attempts, protection against re-attempting a floor with the same seed).

---

## 12. Authoring and the Editor

- Mechanics are stored as structured data (JSON/YAML). Markdown is for lore only. Free-text fields like "1.2x" or "Armour/Armor" are what produce validation errors.
- Enumerated tags for equipment types: `sword`, `spear`, `staff`, `light_armor`, `heavy_armor`, `robe`.
- The editor shows the per-stat stacking breakdown (Section 9.1) alongside the tactics board.
- A schema-driven in-game editor generates dropdowns for stats, tags, conditions and references, and validates IDs, duplicates and missing fields before a battle.
- Build order for the editor: **tactics board first**, then skills, equipment, characters.

Example tactic (illustrative structure, not content). A player sheet allows one activation condition plus an optional second ANDed (here two ANDed leaves), one targeting condition plus an optional second, and a sub selector; no nesting, OR or NOT:

```json
{
  "priority": 1,
  "skill_id": "skl_heal_active_001",
  "enabled": true,
  "activation": { "all": [
    { "type": "phase", "op": ">=", "value": 2 },
    { "type": "active_pp", "side": "self", "op": ">=", "value": 2 }
  ]},
  "targeting": {
    "main": { "type": "unit_kind", "is": "hero" },
    "sub":  { "select": "lowest", "metric": "hp_percent" }
  },
  "fallback": "skip"
}
```

---

## 13. Combat Log and Debugging
Log: setup and effective stats, pre-battle order, scheduled counts, timeline changes, every tactic evaluated with its skip reason, target selection and why, hit/miss/guard/crit, damage numbers, PP spend, status changes, soldier deaths, hero defeat/revival, phase boundaries, and the seed. For every stat, the **per-stat breakdown** (base, flat lines, and each percentage effect by source category, marking which effect won and which was suppressed) [DECIDED].

---

## 14. Architecture
Content loader/validator · Battle state · Timeline scheduler · Tactic evaluator · Condition evaluator (shared by activation and targeting) · Skill/effect resolver · Event system · Phase controller · Batch simulator · Editor UI · (later) tower service.

The **phase controller** and **batch simulator** are new relative to v1. The batch simulator runs N seeded battles per matchup and reports win rates and average phases; it is the main balance tool. It **must report the challenger win rate and the timeout rate** [DECIDED], because draft/edit asymmetry and turtling (Section 5.4) are unverified. It is also where the leader-focus candidates (Section 2) are evaluated.

---

## 15. Implementation Order

1. **Vertical slice:** 2v2 heroes (an explicit exception to Section 2's "the engine only ever sees 4"; the slice is a reduced test, not the real party size), no soldiers, 6 condition types (HP %, hero/soldier filter, row, class, status, phase), one 3-phase loop, exhaustion rule, combat log. Agreed plan [DECIDED]:
   - Engine lives in `src/engine/` and consumes the validated Pack. Uses the real heroes (Leon/Lief vs Emperor/Jasmine).
   - Only `own_turn` active skills with damage, heal and stat-mod statuses run. Unsupported skills, effects and condition leaves are skipped (leaves evaluate false) with a logged "not implemented" reason.
   - The 6 slice leaves: HP %, `unit_kind`, row, class, status, phase. Full seeded damage pipeline.
   - Input: a new battle YAML (two sides, each a list of roster-style hero entries, plus a seed) that the draft will later produce.
   - Log: typed JSON events plus a separate text renderer.
   - Out of scope: soldiers, auras, passives, draft, between-phase edits.
   - Done = tests for the Section 17 subset (exhaustion phase end, idle safety, phase-3 challenger loss, HP persistence and PP refresh, phase condition, same-seed determinism, min damage, the bare Leon-vs-Emperor example: bare Leon vs bare Emperor (DEF 50), Charging Assault 70 x 1.2 x 1.25 = 105 - 50 = 55, Thousand Azure Hooves 157.5 - 50 = 107.5 -> 107) plus `npm run sim` on a sample battle.
2. Add soldiers, AoE distribution, leader rules, auras.
3. Full condition library, statuses, equipment (test: the full Dragon-Scale / Empire's-Dominion worked example, Section 8), devotion (Section 9A), battlefield (Section 10A, [DEFAULT] placement), timeline rescheduling.
4. Batch simulator and balance pass.
5. Editor (tactics board first).
6. Tower service: snapshots, server re-simulation, seasons.

---

## 16. Decision Log

| # | Question | Status | Value |
|---|---|---|---|
| 1 | PP between phases | DECIDED | Full refresh |
| 2 | Who edits between phases | DECIDED | Challenger only |
| 3 | Leader death | DECIDED | Soft: squad and aura lost |
| 4 | Leader position | DECIDED | Front row only |
| 5 | Free hero action | DECIDED | None |
| 6 | Teams per player (tower) | DEFERRED | Single 6-hero roster for now (see 27) |
| 7 | Soldier tactics | DECIDED | None, basic attack only |
| 8 | Phase end rule | DECIDED | All heroes exhausted, or idle cycle (a full cycle = every living unit has had a scheduled action since the last skill was executed); hard cap `max_actions_per_phase` in rules.yaml, value TBD. Squads never keep a phase alive |
| 9 | SPD interval | DEFAULT | round(1000 / max(SPD,5)); sets action order (see 67) |
| 10 | Damage formula | DEFAULT | floor(max(1, power x multiplier x matchup - DEF)); still being tuned |
| 11 | Reduction stacking | DEFAULT | Multiplicative, 75% cap |
| 12 | Crit multiplier | DEFAULT | 1.5× |
| 13 | Class advantage | DEFAULT | +25% dmg, +10 HIT (HIT enters as hit_bonus, see 65) |
| 14 | Variance | DECIDED | None (removed) |
| 15 | Phase 2+ pre-battle | DEFAULT | Re-fires |
| 16 | Phase 2+ statuses | DEFAULT | Cleared |
| 17 | Party SKL | DECIDED | Average SKL of living heroes |
| 18 | Confusion | DECIDED | Random valid target, ignores tactics, lasts until the unit's first active attack; Strange Box field includes the wearer |
| 19 | Duplicate accessories | DECIDED | Allowed; flat stats add, identical effects do not stack |
| 20 | Soldier mounted restriction | DECIDED | Not enforced; a player can pair Leon with infantry and take the SPD penalty. Heavy Cavalry exists for him |
| 21 | Passive PP timing | DECIDED | Spends cost once per trigger; state passives re-spend if their condition ends and returns |
| 22 | Leader aura | DECIDED | One free unique aura per hero, leader-only, types: field / faction / ally / enemy debuff |
| 23 | Buff stacking | DECIDED | Same category: strongest wins. Cross-category: multiply |
| 24 | Debuff stacking | DECIDED | Mirror of buffs |
| 25 | Immunity vs enemy-debuff aura order | DECIDED | Immunity resolves first (Section 9) |
| 26 | Emperor's buff condition | DECIDED | Alive and leader (previously "alive") |
| 27 | Roster size | DECIDED | 6 registered, 4 fielded |
| 28 | Draft sequence | DECIDED | Variant C: C bans, D bans, C protects, C bans, D bans; defender has an anchor |
| 29 | Squads | DECIDED | One per hero, banned with their hero; leader's squad deploys |
| 30 | Leader after bans | DECIDED | Ranked leader line |
| 31 | Hero-ID conditions in tactics | DECIDED | Forbidden; class/faction conditions only |
| 32 | Defender ban rules | DEFAULT | Hidden rule sheet (two-slot limit, see 71), fallback bans highest cost, ties by cost then ID |
| 33 | Cost | DEFAULT | Computed by a basic algorithm (raw stats, PP, skill multipliers, effect types, ...); per-hero/skill/item `cost_override`; cap on hero, roster, and tighter on protected/anchor (see 72) |
| 34 | Post-draft formation | DEFAULT | Preferred rows, leader forced front, same rule both sides |
| 35 | Live PvP | DEFERRED | Left possible; draft is a config step list |
| 36 | Bans scope | DECIDED | Apply to the tower, and to PvP if/when it is built |
| 37 | Soldier placement | DECIDED | 4x3 board; heroes only in the middle 2x3; a squad fills a whole 1x3 row at the front or back |
| 38 | Default hero row | DEFAULT | Ranged / low-DEF back (Archer, Mage, Holy, Assassin, Flyer), melee / high-HP front (incl. Monster, Aquatic); per-hero override. Assassin and Flyer back, Aquatic front: DECIDED |
| 39 | Squad pairing | DECIDED | Generic soldier types; the player pairs a hero with an eligible type; pairings can carry stat penalties |
| 40 | Leader auras authored | DECIDED | Emperor: Empire +20% ATK/DEF. Lief: Lancers +20% ATK/DEF. Jasmine: all allies recover 30% max HP after she acts. Leon: with The Emperor fielded, +30% ATK/DEF/SPD to both |
| 41 | Hero-ID conditions in authored content | DEFAULT | Allowed in auras, faction and equipment effects; forbidden in tactics and ban sheets |
| 42 | Squad targeting | DECIDED | A squad is selected as one target; no individual soldier targeting by players. A single-target hit lands on the lowest-HP living soldier; row/column/all hit every living soldier separately (see 43) |
| 43 | Squad HP | DECIDED | Each soldier has its own HP (overturns the shared pool). Single-target excess damage is discarded (no spill). Healing is always AoE: split evenly across all 10 soldiers including dead ones, which revive at their share, capped at max HP |
| 44 | Soldier skills | DECIDED | Own passive skills, always-on or event-triggered, no PP, no tactic sheet; separate stacking category `soldier` |
| 45 | Turn | DECIDED | One active skill use by the affected unit |
| 46 | Unique statuses | DECIDED | Stack and multiply (Berserk, Dark Dragon's Ire) |
| 47 | Minimum damage | DECIDED | Any landed hit deals at least 1 |
| 48 | Stun | DECIDED shape, DEFAULT constant | Pushback: delays the target's pending action by a fixed number of timeline counts (`rules.yaml` constant, value TBD); no action or PP lost. Replaces the sqrt/linear curve (see Section 6) |
| 49 | Thousand Azure Hooves speed | DECIDED | Cast bonus dropped; the caster gets SPD UP (+15%, 1 turn) after the action |
| 50 | Reactive timing | DECIDED | `before_hit` / `after_hit` on on_event passives |
| 51 | Heroes deal damage only through skills | DECIDED | No hero basic attack |
| 52 | Leader aura cost | DECIDED | Official auras can carry a designer cost adjustment (Jasmine) |
| 53 | Squad and leader buffs and debuffs | DECIDED | Stat buffs and debuffs on the leader also apply to the leader's squad; row and party effects skip squads unless stated |
| 54 | Which leader statuses propagate to the squad | DECIDED | Stat modifiers only; death intercepts, Regen and control statuses (Stun, Confusion) stay on the leader |
| 55 | Guard | DECIDED | GUARD is the chance; a guard reduces damage by 50%; GUARD UP is +50 GUARD. GUARD also opposes crit (see 65, 83) |
| 56 | Factions | DECIDED | A category only (lore and a filter target for effects); no global set bonuses; synergy is hero-carried (see 63) |
| 57 | Vine Stab | DECIDED | Physical (DEF); its +30% vs Cavalry multiplies with the class advantage |
| 58 | Class advantage in the formula | DECIDED | Applies to power x multiplier before defense is subtracted |
| 59 | Soldier class | DECIDED | Soldier types keep their own class (infantry / cavalry), so matchups apply to squads |
| 60 | Squad row | DECIDED | Player defines it when building the squad; `squad_row` is optional and falls back to the soldier type's `default_soldier_row`; the resolved row must be in `allowed_soldier_rows` (both types: first or last) |
| 61 | Column skills and squads | DECIDED | A column skill hits every living soldier of the squad separately (see 43) |
| 62 | Heavy Cavalry | DECIDED | HP 40, ATK 30, INT 10, DEF 30, MDEF 10, SPD 50, CRIT 15, GUARD 0, EVA 10 (HIT 60 and SKL 30 not given, kept from Heavy Infantry) |
| 63 | Set bonuses | DECIDED | None (no faction or class sets); synergy is hero-carried (auras, passives, partner rules), so it is banned with its hero and priced by cost |
| 64 | Final tiebreak | DECIDED | Equal party SKL goes to the challenger; within a side, formation order (front-left to back-right), then unit ID |
| 65 | Hit / crit / guard formulas | DECIDED (narrow bands) | hit% = clamp(HIT + hit_bonus - EVA + (atk SKL - def SKL)/4, 70, 100); crit% = clamp(CRIT - def GUARD + (atk SKL - def SKL)/4, 0, 100); guard% = clamp(GUARD + def SKL/4, 0, 75). hit_bonus = skill hit_bonus_percent + class-advantage HIT. Constants for rules.yaml; no per-class SKL weights (deferred) |
| 66 | Damage rounding | DECIDED | Damage is floored to an integer |
| 67 | SPD role | DECIDED | SPD = initiative: changes hero action order, not count (fixed PP, phase ends when all exhausted). Value is kill races and landing effects first. Squads act on their own SPD schedule, so for squads SPD means more attacks |
| 68 | Turtling | DECIDED (known risk) | Keep "survivors after phase 3 = challenger loss" and rely on bans. The anchor is unbannable, so defenders will make their best wall the anchor. Batch simulator must report timeout rate |
| 69 | Per-hit effects | DECIDED | Regen, on-hit reactives and PP reduction (Longinus) trigger once per attacking action regardless of hit count; squads still deal 10 hits of damage |
| 70 | Squad attack | DECIDED | Each living soldier attacks (10 real hits) |
| 71 | Player tactic and ban rows | DECIDED | One activation condition and one targeting condition, each optionally with a second ANDed; no nesting, OR or NOT in player sheets. Ban rules: one filter, optional second ANDed, plus selector. Authored content keeps full trees (enforced) |
| 72 | Cost override | DECIDED | `cost_override` on a hero, skill or item replaces the computed cost (official only) |
| 73 | Squad healing | DECIDED | Always treated as AoE; see 43 |
| 74 | Devotion (prayer) | DECIDED concept | 7 gods; each gear piece carries one fixed sigil; 2 and 4 same-god sigils unlock that god's blessing; new stacking category `prayer`; priced by cost; built in step 3; god names and blessings TBD (Section 9A) |
| 75 | Meta loop | DEFERRED | Hero/gear acquisition, progression, rewards, defender rewards, onboarding: known gap (Section 18) |
| 76 | Classes | DECIDED | Mage, Assassin neutral for now; Holy > Monster; Flyer much higher EVA vs melee (value TBD); new class Aquatic (SPD bonus on water); more classes will come |
| 77 | Melee / ranged | DECIDED | Damage skills declare `range: melee \| ranged`; soldier types declare their basic attack's range; subsumes `ground_based` |
| 78 | Battlefield | DECIDED concept | Terrain category buffing/debuffing classes; chosen by the defender in the snapshot; visible at reveal (Section 10A) |
| 79 | Leader focus | DECIDED (keep) | Current leader rules kept; candidates to revisit after the batch sim: squad guards the leader; back-row leaders |
| 80 | Stacking | DECIDED | Uncapped; combat log and editor show a per-stat breakdown (winner, suppressed) |
| 81 | Batch simulator reports | DECIDED | Challenger win rate and timeout rate |
| 82 | Regen reapply | DECIDED | Authored exception to the default refresh rule: reapplication extends |
| 83 | GUARD dual role | DECIDED (re-check) | GUARD opposes crit (CRIT - GUARD) and keeps its own guard roll; both kept for now, to be re-checked in the batch simulator. Crit cap 100, CRIT default 30, hit 70..100, no damage variance |
| 84 | Holy and Monster classes | DECIDED | Healer renamed Holy; new Monster class (generally higher base stats, priced by the cost algorithm); Holy > Monster. Default row: Holy back, Monster front (high-HP rule) [DEFAULT] |

---

## 17. Test Requirements (additions to v1)
- Phase ends exactly when all living heroes are exhausted; soldiers alone never extend a phase.
- Idle-cycle safety ends a stalled phase.
- Phase 3 ending with both sides alive resolves as a challenger loss.
- HP/deaths persist across phases; soldiers do not respawn; PP fully refreshes.
- Leader death removes the squad and aura, and the party continues.
- A new leader can be named between phases and restores the aura only.
- Leader cannot be placed in the back row.
- `phase` condition evaluates correctly in activation and targeting.
- Challenger edits are rejected if they touch locked fields.
- Same seed and inputs reproduce the same battle; server re-sim matches client log.
- Leader aura applies only to the leader, costs no PP, and ends on leader death; a non-leader hero's aura never applies.
- Each aura type targets the right side (field: both; faction: allies in faction; ally: all allies; enemy debuff: enemies).
- Passive 20% vs passive 30% on the same stat resolves to 30%. Passive 20% with active 20% resolves to ×1.44. Equipment vs equipment does not stack.
- A suppressed weaker effect resumes when the stronger one expires.
- A passive without enough Passive PP does not fire and logs why.
- Draft: each side ends with exactly 4 heroes; the anchor and protected hero are never banned; the fallback bans the highest-cost eligible hero with ties by cost then ID; the same inputs and seed produce the same draft.
- A banned leader's squad and aura are removed and the next hero in the leader line takes over with their own squad.
- The validator rejects any tactic condition that references a hero ID.
- Cost caps: roster cost, per-hero cost, and the tighter protected/anchor cap are enforced at submission.
- Class-filtered aura (Lief) buffs only Lancers; Leon's aura applies only when The Emperor is fielded, and only when Leon is leader.
- Event-triggered aura (Jasmine) fires after her action completes, costs no PP, and stops when she is no longer leader.
- A squad fills a whole 1x3 soldier row and never a hero slot; heroes cannot be placed in the soldier rows; a banned hero's squad leaves the board with them.
- A hero's `preferred_row` default follows the class rule; overrides are respected; the leader is always front.
- Leon's SPD -20 applies when paired with a non-mounted soldier type and not with a mounted one.
- A squad is selected as one target and individual soldiers cannot be selected; a row, column or all skill hits every living soldier separately.
- A landed hit never deals less than 1 damage, and damage follows floor(max(1, power x multiplier x matchup - DEF)) with no variance (same inputs, same hit and crit outcome: identical damage).
- 1 turn ends only on an active skill use by the affected unit; an idle action does not end it.
- Unique statuses multiply with same-category effects; non-unique same-category effects use the strongest only.
- Soldier-category effects multiply with passive, active and equipment effects.
- Hegemony resolves before the triggering attack and removes only the attacker's buffs; Quick Heal resolves after a single-target hit.
- Confusion from the Strange Box affects every unit including the wearer, and ends after each unit's first active attack.
- Thousand Azure Hooves gives the caster SPD UP (+15%) for 1 turn after the action, and the next action is scheduled sooner.
- Squad HP is per soldier: a single-target hit lands on the lowest-HP living soldier and excess damage is discarded (no spill to other soldiers or heroes); ties go to the lowest soldier index.
- Healing a squad splits the amount evenly across all 10 soldiers, dead included: heal 60 gives +6 each, a living soldier at 20 goes to 26, a dead soldier revives at 6, and every soldier is capped at max HP.
- Stat buffs and debuffs on the leader also apply to the leader's squad; a row-wide or party-wide effect skips the squad unless the skill says otherwise.
- Stun delays the target's pending action by the fixed `stun_pushback_counts`, independent of SPD; the stunned unit loses no action and no PP.
- SPD does not give a hero more skill uses per phase (two parties with different SPD and equal PP spend the same PP), it only decides order; a squad with higher SPD makes more attacks per phase.
- A unit killed before its scheduled action loses its unspent PP (kill race).
- A column skill hits every living soldier of a squad separately, whichever column it is in.
- Per-hit effects (Regen, on-hit reactives, Longinus PP reduction) trigger once per attacking action: a squad's 10-hit attack applies them once but deals 10 hits of damage.
- A player tactic row with nesting, OR, NOT or more than two ANDed conditions per slot is rejected (E_TACTIC_SHAPE); a defender ban rule likewise allows one filter, an optional second ANDed, plus the selector.
- A Flyer has much higher EVA against melee attacks than ranged ones; hit% stays within 70..100 and crit% within 0..100.
- Skill and soldier `range` (melee / ranged) is required on damage skills and soldier types.
- Prayer-category effects multiply with passive, active, equipment and soldier effects; 2 and 4 same-god sigils unlock the 2-piece and 4-piece blessing tiers (when devotion is built).
- The combat log shows a per-stat breakdown naming the winning and suppressed effects.
- The batch simulator output includes challenger win rate and timeout rate.
- Class advantage and skill bonuses apply to power x multiplier before defense is subtracted. Slice test (bare Leon vs bare Emperor, DEF 50): Charging Assault 70 x 1.2 x 1.25 = 105 - 50 = 55; Thousand Azure Hooves 157.5 - 50 -> 107. Step-3 test (Dragon Scale, DEF 100): 5 and 57; as leader with Empire's Dominion (DEF 120): 1 and 37.
- crit% = clamp(CRIT - defender GUARD + (attacker SKL - defender SKL)/4, 0, 100): raising the defender's GUARD lowers crit chance; GUARD still rolls its own guard (clamp 0..75) independently.
- Area statuses (row, party, field) skip soldiers unless the effect sets `include_soldiers: true`.
- `squad_row` is optional on a roster entry (falls back to the soldier type's `default_soldier_row`) and the resolved row must be one of the soldier type's allowed rows.
- A squad's class follows its soldier type, so Heavy Cavalry has the advantage over infantry targets.


## 18. Known gaps [DEFERRED]
- **Meta loop:** hero and gear acquisition, progression, rewards, defender rewards for holding a floor, and new-player onboarding are not designed yet [DEFERRED].
- Tower attempt limits, HP persistence between floors, and anti-degenerate measures (Section 11).
- Devotion god names and blessings, battlefield terrain list, class values (Flyer melee EVA, Aquatic water SPD), stun pushback counts: TBD in `rules.yaml` / content.


## Implementation note: schema is the source of truth

The machine-readable definition of every template lives in `src/schema/` (Zod) and `src/registry/` (condition leaves and effect types, each flagged with the contexts they are allowed in and whether they are community-safe). `npm run schema:export` writes JSON Schemas to `schemas/`; `npm run validate` checks a content folder. Global tunables (damage floor, guard caps, class advantage, stun pushback, draft steps, limits, cost weights) live in `content/rules.yaml`, not in code. Structured conditions are used wherever a rule is checked by machine, for example Leon's soldier penalty is `stat_penalties: [{ when: { type: soldier_mounted, value: false }, stat: SPD, mode: flat, value: -20 }]`. Status durations accept the unit `instant` (consumed immediately, no count), used by Stun. Stun is a fixed pushback in timeline counts (Section 6): `delays_pending_action` is a boolean and `rules.stun_pushback_counts` (null, TBD) holds the count. Also implemented: `aquatic` class, `prayer` source category, required `range` on damage effects and soldier basic attacks, `overflow_to_next_soldier` removed, `apply_status.include_soldiers` defaulting to false, `cost_override` (official only), two-condition player-slot limits, and the `rolls`, `class_traits` and `phase` rules constants. Still pending: gear sigils and god content, battlefield content, and the Flyer and Aquatic trait mechanics beyond their rules constants.
