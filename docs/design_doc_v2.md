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

- A team is a **roster of 6 heroes** (players save several teams, Decision 108); the draft (Section 2A) cuts it to **4 fielded heroes** per battle [DECIDED]. The combat engine only ever sees the 4.
- Each hero: base stats, class, factions, Active PP pool, Passive PP pool. Each team entry for that hero adds equipment (Weapon, Armor, Accessory 1, Accessory 2), up to 10 tactics, squad and row (Decision 110).
- **Party leader:** the leader is the highest-ranked fielded hero in the player's ranked leader line, resolved after the draft (Section 2A) [DECIDED].
  - **Every hero is assigned their own squad by the player** [DECIDED]. Only the leader's squad is deployed (10 soldiers). If the leader is banned, their squad is banned with them and the next hero in the leader line leads and brings their own squad and aura.
  - **The leader may stand in the front or the back row** [DECIDED] (Decision 129, replaces the earlier "leader must be front" rule). A back-row leader is harder to reach with default front-row targeting, so watch leader-focus balance in the batch sim (Section 14). Other leader rules are kept [DECIDED]. Candidate to revisit after the batch sim, not decided: the squad guards the leader (single-target attacks on the leader are partly intercepted by soldiers while the squad lives).
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
- **Soldier types are generic content; squads are pairings** [DECIDED]. Special soldier types have eligibility (by hero and/or class), so certain heroes get certain varieties; generic types (one per class) are usable by any hero (Decision 111), and the player picks a hero plus an eligible soldier type to form that hero's squad. A pairing can carry penalties (e.g. Leon's SPD -20 with non-mounted soldiers).
- **Soldiers have no tactic sheet and no PP.** They basic attack and carry soldier skills [DECIDED].
- **Soldier skills** [DECIDED]: each soldier type carries its own passive skills, which can empower the soldiers, the leader, or the whole party. A soldier skill may be **always-on or event-triggered**; it costs no PP and is not on any tactic sheet [DECIDED]. They are a **separate stacking category** (`soldier`), so they stack with equipment, active and passive effects (Section 9.1). Soldiers have somewhat different stats per type and are weak one by one (about 0.15 of a hero, Section 3.3), but a squad attacks and defends as one (below). Projected examples (not yet content): heal power +20%; changes the leader to Flying (Flyer evasion against melee, Section 3.1); recover 20% HP after attacking; revive fallen soldiers at 1 HP after an attack (only while at least one soldier is still alive). These need new effect types. The earlier projected `ground_based` attack tag is subsumed by the skill and soldier-type `range: melee | ranged` declaration (Section 3.1).
- Default target: nearest unit, front row first [DECIDED].
- Soldiers act on the same SPD timeline as heroes, as one squad action per scheduled count [DEFAULT]. **Soldiers attack as one and defend as one** [DECIDED, Decision 130, overturns 70]: a squad action is ONE attack whose power is the sum of the living soldiers' effective ATK (INT for a magical soldier attack) x the basic attack multiplier (1; soldier types have no multiplier field) x matchup, with one hit, one crit and one guard roll. Rate stats (HIT, SKL, CRIT, EVA, GUARD, SPD) are the soldier type's effective values, never summed [DEFAULT]. Target selection is unchanged (nearest, front row first); a target that dies is not replaced within the action. Squads have no PP, so they act on their own SPD schedule until the phase ends, and for squads (unlike heroes) higher SPD does mean more attacks per phase (Section 6) [DECIDED]. Each soldier type declares the `range` (melee or ranged) of its basic attack [DECIDED].
- **Placement:** the squad occupies an entire 1x3 **soldier row** on the 4x3 board, either in front of the hero rows (body shield) or behind them (extra damage, protected by the party); see Section 10 [DECIDED].
- Each soldier type declares `allowed_soldier_rows`. Both current types allow either the first or the last board row [DECIDED].
- Damage to a squad [DECIDED, replaces the earlier shared HP pool]:
  - **Any hit, single-target or area** [DEFAULT, Decision 130]: resolved ONCE against the squad's defense = the sum of the living soldiers' effective DEF (MDEF for magical, hybrid = the average of the two sums); EVA and GUARD are the soldier type's values. The damage lands on the **lowest-HP living soldier**; when it kills a soldier, the leftover damage **overflows** to the next lowest-HP living soldier (ties lowest index), and so on until used up or the squad is wiped; it never spills onto the heroes (Decision 128, now for area hits too).
  - Sums use living soldiers only, so a weakened squad hits softer and defends worse. A flat line shared from the leader's statuses counts once for the squad's sum, not once per soldier [DEFAULT].
  - **Healing a squad is always treated as AoE**: the heal amount is split evenly across all 10 soldiers, dead ones included, and each soldier's share is added to its own HP, capped at its max HP. Dead soldiers revive at their share. Example: heal 60 on 10 soldiers = +6 each; a living soldier at 20 goes to 26, a dead soldier revives at 6.
  - **Per-hit effects trigger once per attacking action** regardless of hit count (Section 7); a squad attack is one hit, so soldier skills that fire on hit / on attack fire once per squad action [DECIDED].
- **Squads share their leader's buffs and debuffs** [DECIDED]: any stat buff or debuff applied to the leader also applies to the leader's squad, because they are one squad. Status and buff effects that hit "everyone in a row" or "the party" skip squads unless they say otherwise, so a squad is otherwise buffed only through its leader (Iron Fist's row guard reaches the squad only when the Emperor is leader). **Only stat modifiers propagate** [DECIDED]: death intercepts (Fairy's Grace), Regen and control statuses (Stun, Confusion) stay on the leader.
- Heroes can filter targeting to heroes only, ignoring soldiers [DECIDED] (see Section 4).
- Soldier squad wiped: the hero lives. Hero dead: squad removed.
- **Soldier skill points** [DECIDED, later] (Decision 138): each soldier type has 20 skill points, spent in skill trees with prerequisites, so that everyone's soldiers differ. Each category goes up to 5 levels (so at most 4 maxed categories). Points can be reallocated at season end, and spent points raise cost slightly. Example categories: more damage to the class triangle, less damage taken from the class triangle, more damage to buffed or debuffed units, more damage from the back row, less damage taken on certain battlefields. Not built yet; the tree contents are open (Section 18).

---

## 2A. Roster, Draft and Cost

### Roster [DECIDED]
- A team is one roster of **6 heroes**; players save several teams from their owned heroes (Section 11, Decision 108). Each roster hero carries their own equipment, tactic sheet, squad and preferred row.
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
- A list of ordered ban rules (filter + selector), matched against derived hero attributes (class, faction, leader aura type, skill tags, cost, stats, official/community). Two-slot limit [DECIDED]: one filter condition, optionally a second ANDed with it, plus the selector; no nesting, OR or NOT Enforced (E_TACTIC_SHAPE).
- At each defender step, rules are evaluated top to bottom against eligible heroes and the first rule that picks a hero bans it. A rule that has already fired is skipped. If no rule matches, the fallback bans the **highest-cost eligible hero**. Ties break by cost, then ID. Exactly one ban per step, always.
- Rule sheets are hidden until resolved, but expected to leak over many attempts, so balance rests on the counts, not on secrecy.

**Draft as data:** the sequence above is a config list of steps (`actor`, `action`, `source`), not code. Live PvP would swap `source` to `human` for both sides and add a protect step for the second player. The engine never assumes one side is the defender.

**After the draft** [DEFAULT]: formation is resolved per slot (Section 10, Decision 129): each hero's preferred row and optional `column`, the leader like everyone else, with row overflow resolved by leader-line rank. Both sides use the same rule. The challenger may still adjust formation between phases (Section 5.5).

### Cost [DEFAULT, to be calibrated]
Each hero's team entry has a **cost** that counts the hero's stats, skills and aura plus the entry's equipment, squad and devotion blessings. By default it is computed by a basic algorithm over raw stats, PP, skill multipliers, effect types and so on [DECIDED]; the algorithm and weights are placeholders replaced by gauntlet results once available. Any hero, skill or item may carry an authored `cost_override` that replaces its computed price [DECIDED] (official content only). Cost does three jobs: caps, the fallback-ban ordering, and tiebreaks.
- Per-hero cost cap, with a stricter cap on the **protected hero and the anchor** (they cannot be banned, so they get the tightest balance gate).
- Roster cost cap across all six.

### Skill tags
Skills carry authored `tags` (e.g. `revive`, `stun`, `aoe`, `heal`, `debuff`). Ban rules and the gauntlet match on them.

### Hero instances [DECIDED concept, values TBD]
- Heroes are **named templates** (base stats, class, factions, kit, aura) [DECIDED]. A player owns **copies**; each copy has its own stats.
- **Stat variance** [DECIDED concept]: each copy's base stats are the template's, shifted by a zero-sum variance. Points move between stats so every copy has the same score (computed with `cost.stat_weights`) but no two copies are identical (e.g. ATK 100 / SPD 8 vs ATK 90 / SPD 10). Variance size and per-stat point values are TBD after the batch simulator calibrates the stat weights.
- **Allocation** [DECIDED]: after confirming a roll, each copy has **15 stat points**, auto-assigned by default and reassignable by the player. Whether players can re-spec later is TBD.
- **Generic heroes** [DECIDED]: one generic, hand-authored hero per class; the base for player-made heroes later, and a test fixture now.
- **Generic soldiers** [DECIDED]: one generic soldier type per class. Any hero may use a generic soldier type [DECIDED, Decision 111]; special soldier types (Heavy Infantry, Heavy Cavalry) keep their hero/class eligibility. A Mage soldier needs a damage type on soldier basic attacks (schema change pending).
- **Class branches** [DECIDED, optional, Decision 117]: a hero may have up to 2 branches (a different class plus at most one swapped skill), chosen per team entry; the active branch's class counts for all class checks. Built in roadmap 4.1 only if the pool feels narrow (details in Decision 117).
- Schema change pending: roster entries need per-copy variance and allocation; rolls are server-seeded and frozen into snapshots.

---

## 3. Classes, Factions, Stats

### 3.1 Classes and matchups [DECIDED structure, DEFAULT values]
Classes: Infantry, Lancer, Cavalry, Archer, Flyer, Aquatic, Mage, Assassin, Holy, Monster. More classes will come [DECIDED]; the class list is data (`enums.ts`), so adding one is a data change.
Triangle: Infantry > Lancer > Cavalry > Infantry. Archer > Flyer. Holy > Monster. **Mage and Assassin stay neutral (no matchups) for now** [DECIDED].
- **Monster and Holy** [DECIDED]: Monster units generally have higher base stats than other classes (a content guideline; the cost algorithm prices the extra stats), and Holy is their counter (Holy > Monster). Generic Monster heroes carry a +15% stat-score lead (391 vs 340) and Holy > Monster deals +50% damage instead of +25% (Decision 118; Archer > Flyer is +50% too). Lore: a Monster is a hero who fell into madness or accepted evil for power; Monster-class soldiers are Undead ("Risen"), replacing Beasts (Decision 119).
- **Flyer** [DECIDED]: much higher evasion against **melee** attacks: a flyer defender's EVA is multiplied by 1 + `rules.class_traits.flyer_melee_eva_bonus`/100 (**50**, Decision 126) for the hit chance of a melee hit, as one more multiplier after the Section 9.1 stacking [DEFAULT]; bounded by the hit% floor. A squad of flyer soldiers gets it too.
- **Aquatic** [DECIDED]: SPD +`aquatic_water_spd_bonus`% (**30**, Decision 126, terrain category) on water battlefields (terrains with `water: true`; Swamp), heroes and squads by their own class (Section 10A).
- **Melee / ranged** [DECIDED]: every damage skill declares `range: melee | ranged`, and each soldier type declares the range of its basic attack. Range is what Flyer evasion keys on
Matchups are a data table (attacker class, defender class, modifier). Default advantage: **+25% damage and +10 HIT** (HIT enters the formula as `hit_bonus`, Section 8). A `class_advantage` entry may carry its own `damage_percent` (>= 0) that replaces the +25% for that pair only; HIT and the disadvantage side are unchanged (Decision 118). Holy > Monster and Archer > Flyer are +50%; the other pairs keep +25%. Disadvantage mirrors it at −15% damage. Skill-specific bonuses (e.g. Vine Stab +30% vs Cavalry) are separate modifiers [DECIDED: it multiplies with the class advantage]. Class advantage and skill bonuses apply to `power x multiplier` **before** defense is subtracted [DECIDED], so advantage matters most against high-DEF targets. Soldier types keep their own class (Heavy Infantry: infantry, Heavy Cavalry: cavalry), so matchups also apply to and from squads [DECIDED].

### 3.2 Factions [DECIDED]
A hero can have several factions. A faction is a **category only**: lore, and a filter target for effects (faction auras, `faction_is` conditions). **No global set bonuses**, neither faction nor class sets [DECIDED]. Combination play is hero-carried: auras, passives and partner rules (e.g. Leon's aura requires The Emperor) live on the hero, so the synergy is banned with its hero and priced by that hero's cost.

### 3.3 Stats
HP, ATK, INT, DEF, MDEF, SPD, HIT, SKL, CRIT, GUARD, EVA.
- **Heroes deal damage only through skills** [DECIDED]: there is no hero basic attack, so a hero with no damage skill (Jasmine) cannot deal damage whatever her ATK. ATK stays a required stat, for lore and future skills.
- **CRIT** is the single source of truth for crit chance; the defender's **GUARD** is crit's opposed stat, the way EVA opposes HIT (Section 8) [DECIDED]. New heroes default to 30 in the editor [DECIDED baseline]. Sheets without a CRIT value (Leon) are a validation error, not a silent default.
- **SKL** (hidden reliability) feeds hit, evasion, guard and crit through one centralized function, with class-dependent weights [DECIDED concept]. [DEFAULT for prototype] no per-class SKL weights: SKL feeds the Section 8 formulas at flat coefficients; per-class weights deferred. The party-pooled redistribution idea is deferred until the basics balance.
- **SPD bands** [DEFAULT] (Decision 121): walking classes ~38-42, Monster 47, Cavalry/Flyer 55; soldiers walking 30-35, mounted 50, Risen 40.
- **Stat guideline** [DECIDED rules, DEFAULT factors] (Decision 131), relative to a hero's primary stat **P** (ATK, or INT for casters): HP 5-10 x P by class (tanky melee high, casters and assassins low); ATK 1 x P (casters keep a low ATK); INT 1 x P if the hero uses it, else low; DEF and MDEF 0.4-0.8 x P; SKL 0.1-0.3 x P; SPD foot 30-50, mounted (cavalry, flyer) 50-70; HIT 100; CRIT / GUARD / EVA keep their baselines (CRIT 30; class GUARD/EVA leanings). Generic heroes have P = 100. Per-class factors [DEFAULT, tunable]:

  | class | P stat | HP | DEF | MDEF | SKL | SPD | low stat |
  |---|---|---|---|---|---|---|---|
  | Infantry | ATK | 9 | 0.8 | 0.4 | 0.15 | 38 | INT 20 |
  | Lancer | ATK | 7.5 | 0.7 | 0.5 | 0.2 | 40 | INT 30 |
  | Cavalry | ATK | 7 | 0.6 | 0.4 | 0.2 | 55 | INT 20 |
  | Archer | ATK | 5.5 | 0.45 | 0.45 | 0.25 | 41 | INT 25 |
  | Flyer | ATK | 6 | 0.4 | 0.55 | 0.2 | 55 | INT 25 |
  | Mage | INT | 5 | 0.4 | 0.8 | 0.2 | 39 | ATK 15 |
  | Assassin | ATK | 5 | 0.4 | 0.4 | 0.3 | 42 | INT 20 |
  | Holy | INT | 5.5 | 0.45 | 0.75 | 0.15 | 38 | ATK 20 |
  | Aquatic | ATK | 8 | 0.6 | 0.6 | 0.2 | 40 | INT 30 |
  | Monster | ATK | 10 | 0.8 | 0.45 | 0.2 | 47 | INT 30 |

  Infantry and Monster are the tankiest, Archer / Assassin / Mage the frailest; Monster's lead (Decision 118) now comes from HP, DEF/MDEF and SPD, since ATK is fixed at 1 x P. CRIT, GUARD and EVA kept from the earlier sheets (Assassin CRIT 45).
  Named heroes keep their relative identity: **Leon P 115** (HP 800, ATK 115, DEF 70, MDEF 46, SKL 35, SPD 50), **The Emperor P 100** (HP 950, ATK 100, DEF 70, MDEF 40, SKL 22, SPD 30), **Jasmine P 100 on INT** (HP 550, INT 100, ATK 20, DEF 40, MDEF 70, SKL 15), **Lief P 90** (HP 800, ATK 90, INT 40, DEF 70, MDEF 46, SKL 22); SPD, CRIT, GUARD and EVA unchanged.
  Soldiers: per-soldier HP/ATK/INT/DEF/MDEF/SKL = round(0.15 x the P=100 hero of the soldier's class) [DEFAULT]; the two Heavy types use 0.17 for HP/ATK/DEF (they also keep their ATK/DEF +30% skill). SPD, CRIT, GUARD, EVA stay rate-like (unchanged); HIT 90 (Bowmen 95).
- **Modifier order** [DEFAULT]: base → flat → percentage (strongest wins within a source category, multiplied across categories, Section 9.1) → conditional → floor/cap.

---

## 4. The Tactics Board (core system)

Each hero has an ordered list of up to **10 tactics** [DECIDED]. Active and passive skills are both displayed and configured here. A skill that is not on the sheet and enabled never executes [DECIDED].

### 4.1 A tactic is
1. Priority (position in the list)
2. Skill reference (ID)
3. Enabled flag
4. **Main** condition
5. **Sub** condition

A tactic is a skill plus two conditions [DECIDED, Decision 136]. Each of Main and Sub is either **one condition leaf** (no AND, OR, NOT or nesting) or a **selector**; either may be empty. There is no separate activation slot and no tactic-level fallback. Authored content keeps full condition trees; skills' default_activation / default_main / default_sub stay limited to one leaf or two ANDed leaves. The validator enforces both (E_TACTIC_SHAPE).

### 4.2 Evaluation when a hero acts
For each tactic top to bottom: enabled? skill eligible and ready? the skill's default activation true? PP sufficient? a candidate left after the conditions? If all yes, execute it and stop. Otherwise log the skip reason and continue. If none qualify, the hero does nothing this action [DECIDED]. Only one tactic executes per scheduled action.

### 4.3 Condition library
Conditions are typed nodes. Authored content may combine them with AND / OR / NOT and nest them; a player slot holds one leaf or one selector (Section 4.1). Comparators: >, <, ≥, ≤, =, ≠. Selectors: lowest / highest (by HP %, current / missing / max HP, current / max Active and Passive PP, or a stat), nearest, farthest, random with seed, and **prefer** (candidates that satisfy a leaf first: "Prioritise Front Row", "Prioritise Infantry", "Prioritise Buffed").

| Category | Examples |
|---|---|
| HP-based | HP % > 80, HP % < 50, lowest HP, highest HP, current HP absolute, missing HP |
| Unit type | hero only, soldier only, ignore soldiers, leader only, not leader |
| Class / race | is Cavalry, class has advantage over me, race is Elf, Infantry enemies present / no Infantry enemies |
| Faction | member of Empire |
| Position | front row, back row, soldier row (front or back), same column as X, row size, row with most / least units, column full (both hero rows) |
| Identity | is me, is not me |
| Status | has buff/debuff X, has any debuff / buff, has no debuff / buff, missing buff X |
| Stat-based | highest ATK, lowest DEF, SPD < X |
| Resource | my Active PP ≥ N, target has Passive PP |
| Counts | enemies alive ≥ N, allies alive ≤ N, enemy soldiers remaining, combatants (heroes plus soldiers) on a side, average HP % of a side |
| Self/events | I was attacked since my last action (optionally: physically / magically, by a row / column / all attack, by a class or race), ally was attacked, I was just healed |
| Battle | **current phase = N**, action count (first action = 0), daytime / night-time |

Main/sub semantics [DECIDED, Decision 136]: the candidates are the skill's target pool (side, valid rows, soldier mode). A leaf in Main or Sub keeps a candidate iff it is true with the caster as self and the candidate as target; a leaf that reads only the caster or the board ("Own HP < 50%", "Daytime", "Infantry enemies present") is therefore an "only if": when false no candidate passes and the tactic is skipped ("condition false: ..."). A selector never skips; it only orders: Main's selector first, Sub's breaks ties, then the default order. The first candidate anchors the skill's shape. The skill's authored default_activation and default_main always apply as well (ANDed); default_sub applies only when neither slot is a selector. Default order: nearest valid target, front row first, ties broken by column index then unit ID (never database order) [DECIDED]. Passives use the two leaves (ANDed with the default activation) and ignore selectors.

Filters to support from day one (they carry the soldier-vs-hero strategy): *heroes only*, *soldiers only*, *front row first / back row first*, *leader*.

### 4.4 Passives on the sheet
A passive has a **trigger** (`pre_battle`, `own_turn`, `on_event:<name>`, `while_condition`) that is independent of its **PP pool**. "Reactive", "always-on" and "conditional" are labels derived from the trigger. When one event triggers several reactive passives, they resolve in sheet priority order [DEFAULT]. When one event triggers reactions on both sides, the attacked side's reactions resolve first (the defender's side for a hit, the dead unit's side for a death, the target's side for a heal, the side opposite the actor for an action), then the other side's, so neither seat gets the first word [DECIDED]. An `on_event` passive also declares a **timing**: `before_hit` resolves before the triggering attack's combat resolution (Hegemony strips the attacker's buffs first, Quick Guard guards the hit), `after_hit` resolves after it (Quick Heal) [DECIDED].

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
Survivors after phase 3 with no side wiped: **the side with the higher remaining HP% (heroes and soldiers together) wins** [DECIDED, Decision 139, built]; an exact tie goes to the defender. In PvE the player is always the challenger.
- **Known risk: turtling** [DECIDED to keep the rule and rely on bans]. Defenders can build walls that run out the clock. The anchor is unbannable, so defenders will make their best wall the anchor. The batch simulator must report the timeout rate (Section 14). The timeout tiebreak by remaining HP % is built (Decision 139).

### 5.5 Challenger edits between phases [DECIDED]
The challenger may adjust between phases. [DEFAULT scope]:
- Allowed: tactic sheets (order, conditions, targeting, enable/disable), soldier squad row, hero slots (row and column; the leader may stand anywhere), naming a new leader if the old one died.
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
- **Stun = pushback** [DECIDED]: Stun delays the target's pending action by a **fixed number of timeline counts**, a `rules.yaml` constant (`stun_pushback_counts`, [DEFAULT] 15: a typical interval is ~20-27 counts, so a stun costs a bit over half an action). No action and no PP is lost; the stunned unit simply acts later (and may be killed first). This replaces the earlier configurable sqrt/linear curve that made the delay rise with SPD. (`delays_pending_action` is a boolean; `stun_pushback_counts` is 15 [DEFAULT].)
- **SPD UP** [DECIDED]: Thousand Azure Hooves gives its caster SPD +15% for 1 turn after the action, so the next action comes earlier in the order. The earlier "cast faster" idea (a bonus on the casting action itself) was dropped.

---

## 7. PP [DECIDED]

- Active PP base 3, Passive PP base 3 [DEFAULT, not locked, Decision 140]; max 4 with equipment [DECIDED]. Dragon Scale (+1 Active PP) is a valid test.
- Separate pools. Active skills spend Active, passives spend Passive.
- PP is spent per use (a 1-PP skill can be used twice at 2 PP).
- **Passives spend PP when their condition triggers them, and the passive then becomes *used*** [DECIDED]. If there is not enough Passive PP when the condition is met, the passive does not fire (logged).
- **"Used" means** [DECIDED]: each trigger spends the skill's PP cost once. A one-event passive (Quick Guard) guards one attack per spend. A state passive (Berserk) spends on activation and stays on until its condition ends; if the condition ends and returns, it spends again.
- Leader auras are exempt from all of the above: free, no PP, no "used" state.
- **What-if PP for simulation** [DEFAULT tooling, not a rule]: the engine takes an optional PP override (`runBattle(pack, input, { pp: { active?, passive? } })`, `npm run sim -- --pp-active=N --pp-passive=N`, `npm run batch -- --pp-active=2,3,4 --pp-passive=2,3` for a sweep, and a PP control on the editor's battle page). It replaces every hero's base PP before gear PP is added; the cap becomes max(`rules.pp.max`, override + gear). It is never part of a battle file.
- **Per-hit effects trigger once per attacking action**, regardless of hit count [DECIDED]. This covers Regen ("per hit taken"), on-hit reactive passives, and PP reduction such as Longinus (-1 Passive PP to the unit hit). A multi-hit attack (a row skill hitting one unit twice) still deals damage per hit, but these effects fire once per attacking action per affected unit.

---

## 8. Damage Resolution [DEFAULT formulas, all constants tunable]

Order: select target (a hit on a squad is resolved once against the summed defense of its living soldiers and lands on its lowest-HP living soldier, Section 2.1) → hit check (HIT vs EVA, SKL-adjusted) → crit check → guard check → damage (`pool`: `(ATK_total − DEF_total) × (1 + bonus% − reduction%) × crit × hero_hits`, minimum 1) → apply to HP/soldiers → statuses/reactions → rescheduling.

- **Damage is floored to an integer** [DECIDED], consistent with the worked examples below (157.5 - 100 -> 57; 157.5 - 50 -> 107).
- **Minimum damage** [DECIDED]: any hit that lands deals at least 1 damage, even when the attacker's power is below the target's defense. The tick matters for on-hit mechanics.
- **Damage formula** [DEFAULT `pool`, designer 2026-11: "ATK (from all sources) - DEF (from all sources) x (DMG bonus - DMG reduction)"]: `amount = max(1, floor(core × pool × crit))`, then × `hero_hits` for heroes (below).
  - `core = max(1, ATK_total − DEF_total)`. ATK_total = the skill's scaled stat after every buff, debuff, aura, equipment and terrain modifier (Section 9.1) × skill multiplier; DEF_total = the target's DEF / MDEF (hybrid: their average) after all modifiers. Squads: both sums over the living soldiers.
  - `pool = 1 + (sum of damage bonus %) − (sum of damage reduction %)`, never below `1 − total_reduction_cap_percent/100` (0.25). **Bonuses** (added): class advantage `advantage_damage_percent` (+25, or the pair's own `damage_percent`, e.g. archer → flyer +50) or disadvantage `disadvantage_damage_percent` (−15); every `bonus_vs_class` modifier for the target's class; every `bonus_on_terrain` modifier for the battlefield. **Reductions** (added): GUARD's `damage_reduction_percent` (50) when the guard activates; every `reduce_damage` effect in force on the target (Plate, Quick Guard, any duration). Bonuses and reductions are additive with each other (+25 and a 50% guard give ×0.75), not multiplicative.
  - Crit stays a separate multiplier (`crit_multiplier` 1.5) after the pool. The class-advantage HIT bonus is unchanged.
  - The combat log shows each hit's bonus %, reduction % and pool factor.
  - Worked example (bare Leon, ATK 115, vs bare Emperor, DEF 70, hero_hits 1): Charging Assault core = 115 × 1.2 − 70 = 68, pool 1.25 (cavalry > infantry), 85 damage; guarded, pool 0.75, 51. Against a Dragon-Scale Emperor (heavy armor, DEF 140 after Decision 135) the core is negative, so the hit does the minimum 1: a bare hero cannot dent a tank build.
- **Hero hits** [DEFAULT 4, `rules.damage.hero_hits`]: Langrisser heroes and 10-soldier squads hit for comparable totals; here a hero's damage (actives, passives, reactions, item effects; every formula) is multiplied by `hero_hits` as the last step (floored, minimum 1). Squads are unaffected (they already sum 10 soldiers); heals are unaffected; Mirror's reflect uses the HP lost, so it follows. What-if: `--hero-hits=N` on the sim, `--hero-hits=1,2,4,6,10` on the batch simulator (combines with `--formula` and `--pp-*`, same seeds), and an editor select; never saved.
- **Formula choice**: `pool` (above) is the default; the older formulas stay selectable in `rules.yaml` (`damage.formula`) and as a what-if (`--formula=pool,subtract,ratio:150,scaled_subtract:20`; the editor has a matching select). They multiply the matchup into power (`power × multiplier × matchup`, class factor × each bonus factor), floor, crit, then guard and reductions **multiplicatively** (0.5 × 0.5 = 0.25, capped at 75%). `subtract`: `max(1, power − defense)`. `ratio`: `power × K / (K + defense)`, K = `ratio_k` (default 100; defense K halves the damage). `scaled_subtract`: `max(power × floor_pct/100, power − defense × def_weight)` (defaults 20 and 1). Squads use the same formula with their summed defense.
- **Squads** [DEFAULT, Decision 130]: a squad's power is the sum over its living soldiers (attacking), its defense the sum over its living soldiers (defending); see Section 2.1.
- **GUARD is the chance to guard** [DECIDED]: when a guard activates it reduces damage by 50%. GUARD UP adds 50 to the GUARD stat.
- Defense stat follows the skill's damage type (physical → DEF, magical → MDEF). Skills may override.
- Crit multiplier 1.5×.
- **Probabilities** [DEFAULT, prototype placeholders; constants go in `rules.yaml`; no per-class SKL weights]:
  - `hit% = clamp(HIT + hit_bonus - EVA + (attacker SKL - defender SKL)/4, 70, 100)` [DECIDED narrow band]. `hit_bonus` = the skill's `hit_bonus_percent` + the class-advantage HIT. EVA includes the Flyer's melee evasion bonus when the attack is melee (Section 3.1).
  - `crit% = clamp(CRIT - defender GUARD + (attacker SKL - defender SKL)/4, 0, 100)` [DECIDED]. Cap 100 is deliberately hard to reach and build-altering. CRIT default 30 stays.
  - `guard% = clamp(GUARD + defender SKL/4, 0, 75)` (unchanged; a guard halves damage). **GUARD therefore has a dual role** (lowers enemy crit chance and feeds its own guard roll) [DECIDED]: kept for now, to be re-checked in the batch simulator.
- **Guard and damage reduction** [DEFAULT]: under `pool` they add into the reduction part of the pool (50% + 30% = 80%, capped at 75% net of bonuses); under the older formulas they stack multiplicatively (0.5 × 0.5 = 0.25), same 75% cap. "Ignores guard" skips only the GUARD stat roll, not other reductions, unless the skill says otherwise.
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

Every percentage modifier carries a **source category**: **Passive** (includes leader auras), **Active** (skill effects), **Equipment**, **Soldier** (soldier skills), or **Prayer** (devotion blessings, Section 9A) [DECIDED], plus **Terrain** (battlefield class modifiers, Section 10A, Decision 122). (`prayer` and `terrain` are in `SOURCE_CATEGORIES`.)

- **Within the same category, effects do not stack.** For the same stat, the strongest wins (a 20% passive and a 30% passive give 30%). Exception: one god's 2-piece and 4-piece blessing lines on the same stat add into one prayer contribution (Decision 125); different gods still compete.
- **Across categories, each is its own multiplier.** A 20% passive and a 20% active give ×1.2 × 1.2 = ×1.44.
- This applies to every pair: passive vs passive, active vs active, equipment vs equipment and soldier vs soldier never stack; passive, active, equipment, soldier and prayer effects all stack with each other [DECIDED]. Stacking is uncapped [DECIDED], so the combat log and the editor must show a per-stat breakdown (which effect won, which was suppressed) [DECIDED].
- **Unique statuses stack** [DECIDED]: a status flagged `unique` (Berserk, Dark Dragon's Ire) is exempt from the same-category strongest-wins rule and multiplies with everything. Unique is authored per status; it is usually, not always, set.
- A status that several skills apply is the same status id, but each application carries its applier's category (Defense Down from Hegemony is passive, from Dark Dragon's Dirge it is active), so a passive-applied and an active-applied copy coexist and multiply. Reapplying within one category refreshes it.
- **Duplicate accessories are allowed** [DECIDED]: flat stat lines add (two Spiky Gloves = ATK +24), but identical effects from the same category do not stack.
- A skill or effect can opt out with an explicit `stacks_with` / `stackable` flag ("unless mentioned otherwise").
- [DEFAULT] The suppressed weaker effect is not deleted. It resumes if the stronger one expires or is removed.
- [DEFAULT] "Strongest wins" is evaluated per stat, so a skill that buffs ATK and DEF is not cancelled in full by a bigger ATK-only buff.
- [DEFAULT] Flat stat lines on equipment (the item type's base, Section 12.1) are added to base stats before any of this. Only conditional or percentage equipment effects (e.g. Queen's Scepter +20% INT) count as an "equipment buff".
- **INT/MDEF pairing** [DEFAULT meaning of a designer rule, Decision 132]: "skills or auras boosting ATK or DEF should also apply to INT and MDEF". A `modify_stat` on ATK from a skill (an active or passive status, i.e. a status in the active / passive / soldier source category), a leader aura or a soldier skill also applies the same mode and value to INT; one on DEF also to MDEF. Buffs and debuffs alike. Not for equipment stat lines, item effects, blessings or terrain (they name their stats explicitly). When the same source already has a line on the paired stat (Berserk), no second one is added. The paired line is a normal breakdown entry of the same source and category, so the strongest-wins rule above handles overlaps.
- **Known [DEFAULT], squads:** a leader's status shared with its squad keeps its source category, so a leader-shared `soldier`-category status competes (strongest wins) with the squad's own soldier skills in the soldier group. Leader auras are not shared with the squad: an aura reaches the squad only through its own targeting (`include_soldiers`, faction, filter). Flat lines shared from the leader count once for the squad's summed ATK/INT/DEF/MDEF (Decision 130), not once per soldier.
- **Debuffs follow the same rule** [DECIDED]: passive, active, equipment, soldier and prayer debuff categories, strongest wins within each, multiplied across. Buffs and debuffs on the same stat multiply together (Berserk +50% ATK against an ATK debuff).

---

## 9A. Devotion (prayer) [DECIDED]

- **Lore:** the world is governed by **7 base gods**, each embodying a virtue (with a shadow vice for story), and everyone prays to them [DECIDED concept, Decision 113]. More gods (ascended heroes, man-made or false gods) may be added later as new sigil sets, so the schema never assumes exactly 7 gods. God-race links are lore only: any hero may choose any patron, and gods give no racial bonus.
- **Placeholder pantheon** (Decision 125): the Japanese Seven Lucky Gods, content type `content/gods.yaml` (id, name, virtue, vice, description, `blessing: { name, two_piece, four_piece_def, four_piece_atk }`, each 4-piece `{ name?, effects }`, effects reuse the effect schema).
- **Sigils are chosen by the player per slot** (Decision 125, revises Decision 74's fixed sigil): a roster hero entry carries `sigils: { weapon, armor, accessory_1, accessory_2 }` (a god id or null each). A sigil counts only while its slot holds an item (an empty slot: warning `W_SIGIL_EMPTY_SLOT`). Sigils are locked between phases like equipment.
- **Two-sided enchantments** (Decision 141, built): each god has a DEF and an ATK 4-piece. A hero has 4 slots, so at most one 4-piece; the entry's `sigil_side` (`def` or `atk`, locked between phases like `sigils`) picks it. 4 counted same-god sigils with no side: error `E_SIGIL_SIDE_MISSING`; a side with no 4-piece unlocked: warning `W_SIGIL_SIDE_UNUSED`.
- **2 sigils of one god** unlock its 2-piece, **4** unlock the 2-piece and the 4-piece of the chosen side; two gods at 2 + 2 each give their 2-piece.
- Blessings use the stacking category **`prayer`** (Section 9.1): they multiply with every other category; within prayer the strongest wins between different gods (Benzaiten and Daikokuten HP +20% each give +20%), but one god's 2-piece and 4-piece lines on one stat add [DECIDED] (Full Moon DEF active: DEF/MDEF +30%; Rush DEF: EVA +25). Max HP follows the same rule. Not shared with the wearer's squad [DEFAULT].
- Blessing effects must take a form the engine runs (`E_EFFECT_TRIGGER` otherwise). Blessings are priced by the cost algorithm (Section 2A): an unconditional stat line like a stat (flat: value x weight; percent: value% of the base stat x weight), any other blessing effect a flat `rules.cost.effect_price` [DEFAULT].

| God | Virtue / vice | Blessing | 2-piece | DEF 4-piece | ATK 4-piece |
|---|---|---|---|---|---|
| Benzaiten | Amiability / Lust | Mirror | HP +20% | reflect 30% of single-target damage taken | **Retaliate:** after being attacked, next attack +30% (one charge, does not stack) |
| Jurojin | Longevity / Sloth | Full Moon | DEF/MDEF +10% | HP > 80%: DEF/MDEF +20% | HP > 80%: ATK/INT +20% |
| Bishamonten | Dignity / Wrath | Plate | GUARD +10 | damage taken -10% (whole battle) | **Sunder:** attacks ignore 20% of the target's DEF/MDEF |
| Daikokuten | Fortune / Greed | Gift | HP +20% | when attacked, 50% chance to heal 20% max HP after the attack (once per enemy action) | on a hero kill or squad wipe, heal the lowest-HP ally 20% (self included) |
| Hotei | Magnanimity / Gluttony | Breeze | ATK/INT +10% | **Sidestep:** the first single-target hit each phase deals 50% less | **Second Wind:** HP < 50%: SPD +30% |
| Fukurokuju | Wisdom / Pride | Meteor | CRIT +10 | crit damage taken -50% | crit damage +30% |
| Ebisu | Candor / Envy | Rush | EVA +10 | EVA +15; after a dodge, counter for 75% ATK | single-target attacks ignore GUARD and deal +15% damage |

Rules [DEFAULT] (Decision 125):
- A blessing HP +20% (unconditional) raises max HP; no other status HP modifier changes max HP.
- **Single-target attack** = the hero's own active damage skill of shape single (the same `single` flag as `unit_hit_by_single_target_attack`); condition leaf `action_is_single_target` (authored only). Conditional lines on it are on for every roll of that attack and off after it.
- **Reflect** (`reflect_damage`): floor(percent of the HP the wearer lost to the attacking unit's hits in that action (overkill and a Fairy's Grace save count only the HP it had), summed over every hit of that action), dealt to the attacker after the action, once. No hit/crit/guard roll, ignores DEF, not a hit (fires no events), can kill (Fairy's Grace still intercepts); on a squad it lands on the lowest-HP living soldier. Only hits whose own event satisfies the condition count; the action that kills the wearer is still reflected; less than 1 damage is dropped.
- **Gift DEF**: after an attacking action of another unit that targeted the wearer (any shape, landed or not), one roll of the phase rng (`heal.chance_percent`), then the heal. A dead wearer heals no more.
- **Gift ATK** (`heal.target: lowest_hp_ally`, leaf `self_killed_enemy`) [DEFAULT]: fires at the kill, once per dead enemy hero or wiped squad (a kill by a hero's own hit only: a kill by a reaction fires nothing, its squad's kills do not count, a leader's squad removed with it is not a wipe). Lowest HP means lowest HP%, ties in unit order; it heals 20% of the recipient's max HP.
- **Retaliate** (`damage_bonus` with `trigger: on_event`) [DEFAULT]: "+30%" is damage, a bonus in the formula's bonus sum. Any attack aimed at the wearer charges it, dodged or not. The charge covers every hit of the wearer's next damage skill and is spent by it even on a miss; a non-damage skill keeps it; it ends with the phase.
- **Rush ATK** (`ignore_guard` + `damage_bonus`, leaf `action_is_single_target`) [DEFAULT]: the wearer's own active skills only. `damage_bonus` joins the bonus sum: additive under `pool`, in the matchup before defense under the older formulas.
- **Sunder** (`ignore_defense`): scales the defense of every hit before any formula uses it, including a squad's summed DEF / MDEF and hybrid's average.
- **Sidestep** (`reduce_damage` duration `first_single_hit`): one charge per phase, spent by the first landed single-target hit alone (a second hit of that action is not reduced); a miss or an area hit leaves it. It counts toward the reduction cap. [DEFAULT]
- **Second Wind**: an ordinary conditional SPD line; the usual SPD-change rescheduling applies at the end of the action.
- **Meteor** (`crit_damage`) [DECIDED, designer 2026-11-04]: multiplies `crit_multiplier` on that hit, in every formula and outside the reduction cap, so a crit on Meteor DEF deals less than a normal hit while `crit_multiplier` is below 2.
- **Rush DEF counter** (`damage` with `trigger: on_event`, leaf `self_dodged`) [DEFAULT]: a dodge is any missed hit roll. After the attacking action, one counter per dodge at the attacker (a squad too), physical melee, rolled like any hit, with `hero_hits`; none if the attacker or the wearer is dead. Reactions never trigger reactions, so a counter cannot be countered, reflected or healed from.
- **Ignore GUARD** (`ignore_guard`): while active, the wearer's hits skip the guard roll, also over a skill's guaranteed guard.

---

## 10. Formation

- **The board is 4 rows x 3 columns** [DECIDED]. Heroes can only stand in the middle 2x3: a front hero row and a back hero row (4 fielded heroes in 6 slots). The outer two rows are **soldier rows**: a squad fills an entire 1x3 soldier row, either in front of the hero rows or behind them, never both. Top to bottom: [soldier row, front] / hero front / hero back / [soldier row, back].
- Because a squad fills its whole row, it sits in every column. A column skill passes through it and a row skill aimed at that row hits it; a squad is selected as one target but every living soldier is hit separately [DECIDED] (Section 2.1).
- **The player defines the squad's row when building the squad** [DECIDED]: `squad_row` (front or back) is an optional field on the roster entry; if omitted it falls back to the soldier type's `default_soldier_row` (same defaults as heroes: melee/tanky front, ranged/frail back). Either way it must be one of the soldier type's allowed rows. The leader's `squad_row` applies. If the leader is banned, the next leader's squad and its row are used [DEFAULT].
- **Slots, not just rows** [DECIDED] (Decision 129): the hero grid is 2 rows x 3 columns = **6 separate slots** (3 front, 3 back). Any hero, the leader included, may stand in any of them. A roster entry may carry an optional `column` (1..`rules.board.columns`) next to `preferred_row`: with a `column` the hero claims exactly that (row, column); without one (**auto**) it fills the lowest free column of its row in roster order. Two heroes on the same slot are an error (`E_BATTLE_SLOT`), as is a column beyond the board. `preferred_row` and `column` are editable between phases (Section 5.5). Formation order (timeline tie-break) runs front-left to right-back: front row by column, then back row by column. The soldier rows stay separate from this grid.
- **Default preferred row** [DEFAULT, per-hero override]: ranged and low-DEF units (Archer, Mage, Holy) default to the back row; melee and high-HP units (Infantry, Lancer, Cavalry, Monster, Aquatic [DECIDED]) default to the front row [DEFAULT]. Assassin and Flyer also default to the back row [DECIDED]. The editor pre-fills `preferred_row` from this rule and the author can change it.
- Default targeting: front row first, then back when the front has no valid targets [DECIDED].
- Column and row skills must declare shape and damage distribution as separate fields.

### 10A. Battlefield [DECIDED concept, DEFAULT values]
- A content category: **terrain types** (`content/terrains.yaml`), each giving **buffs and debuffs to classes** [DECIDED].
- The **defender picks the battlefield** as part of their snapshot [DECIDED]. It is visible at reveal, like the anchor (Section 11). The battle input carries it as `battlefield`.
- Terrains [DEFAULT values] (Decision 122): Plains (no effect, the generic field), Forest, Mountains, Swamp, City (cavalry SPD -10%, assassin CRIT +10, infantry GUARD +10).
- Terrain modifiers are their own stacking category `terrain` (Section 9.1), applied in a pre-battle step to heroes and squads of the listed classes; a squad uses its own soldier class. Damage effects may carry `bonus_on_terrain` (Dive: mountains +20, Backstab: forest +20, Tidal Crash: swamp +30).
- **Water** (Decision 126): a terrain may be `water: true` (default false); Swamp is water. On water terrain every aquatic hero and squad gets SPD +`rules.class_traits.aquatic_water_spd_bonus`% (30) in the terrain category, in the same pre-battle step (replacing Swamp's former aquatic +15% line).

---

## 11. The Tower (long-term) [DECIDED concept]

- Players climb a tower of floors, each floor a **defender snapshot** (a saved player party).
- **Heroes and teams** [DECIDED concept, Decisions 103-108, 110-111]: players acquire named heroes by rolling, with unlimited rerolls and locks (keep some heroes, reroll the rest); a reroll can be previewed before it replaces the current heroes. Each owned hero has its own stat variance and 15 allocation points (Section 2A, Hero instances). Players save **several teams** (each a 6-hero roster, drafted to 4 per fight, Section 2A) built from their owned heroes, and mix and match between runs; teams may share heroes. Teams can be planned with any hero, but only owned heroes can be fielded that season. At a season reset the player keeps their heroes and teams, or resets and rolls again. **Owned pool** [DECIDED, Decision 110]: each roll shows 12 heroes and the player keeps 10; once confirmed, the pool is frozen for the season. With 10 heroes and 6-hero teams, any two teams share at least 2 heroes, so teams are variations on one core rather than separate armies. **Loadouts** [DECIDED]: gear, tactics, squad and row are per team entry; the 15 allocated points belong to the hero copy and are the same in every team. Saved teams are unlimited [DEFAULT] (the pool is the constraint). **No duplicates** [DECIDED, Decision 111]: the 10 owned heroes are 10 distinct named heroes. **Defender** [DECIDED, Decision 111]: on reaching the top, the player picks one saved team (default: the team that cleared it), adds its anchor, ban sheet and battlefield, and it is frozen as their floor for the season.
  - HP/death persistence between floors: DEFERRED to implementation step 6. Working default: full restore at the start of each floor fight. Attempt limits per day are DEFERRED (see below).
- The player who reaches the top becomes a floor. A season resets weekly or monthly; the top 10 become the new bottom floors [DECIDED].
- **Defender snapshot:** the saved team the player picked on reaching the top (Decision 111): the full party, gear, formation, leader, tactic sheets, **chosen battlefield** (Section 10A), anchor and ban sheet, frozen at submission, with the content/rules version.
- Challengers can see the defender party, anchor and battlefield [DEFAULT]. This is intentional: defenders win by guessing the challenger's counter-strategy; challengers win by predicting the defender and adapting between phases.
- **Server authority:** every challenge is re-simulated on the server with a server-chosen hidden seed; client results are never trusted.
- **Versioning:** content and rules are pinned per season. Balance patches only land at resets.
- Anti-degenerate measures: DEFERRED to implementation step 6 (limits on attempts, protection against re-attempting a floor with the same seed).

---

## 12. Authoring and the Editor

- **The editor and the main game are two separate products** [DECIDED] (Decision 137). The **editor** (`editor/`) is a tool: battle simulation, testing and balance, plus a character creator, with import and export into the main game. It is not what players play, and its UI can stay technical. The **main game** is a separate client, not built yet: it ships with all default heroes, weapons, soldiers and other content, and has a much more user-friendly, visual-first UI inspired by Unicorn Overlord. Both share the same content schema and engine. Import and export use the same YAML files as `content/` [DEFAULT], checked by the same validator on import.
- Mechanics are stored as structured data (JSON/YAML). Markdown is for lore only. Free-text fields like "1.2x" or "Armour/Armor" are what produce validation errors.
- Enumerated tags for equipment types: weapons `sword`, `spear`, `axe`, `staff`, `tome`, `bow`, `dagger`, `hammer`; armor `light_armor`, `heavy_armor`, `robe`; accessory categories `shield`, `gloves`, `boots`, `ring`, `amulet`, `charm`, `bracelet`, `earring`, `cloak`, `belt`. A class can use several weapon types (Decision 120). Every item has exactly one type valid for its slot (`E_EQUIP_TYPE`). A hero must list weapon, armor and shield types in `restrictions.equipment_tags` to wear them; the other accessory categories are open to every hero.
- The editor shows the per-stat stacking breakdown (Section 9.1) alongside the tactics board.

### 12.1 Equipment type standard [DECIDED rule, DEFAULT values] (Decision 133)
Designer rule: all equipment of one type has the same base stats; types differ from each other (all swords share a base and differ only by their effects; swords differ from daggers; heavy armor differs from light armor). Accessories come in categories, one category = one stat block. Inspiration: Unicorn Overlord, Langrisser. Basic stat-increase items for now; damage is balanced later through skills.
- An item's flat stat lines are its type's base, `rules.yaml equipment_bases` (every type required). Items never author stat lines; what makes a named item special is its `pp_modifiers` and `effects`. Cost prices the base like any stat line.
- **Exception rule**: bases stay on HP, ATK, INT, DEF and MDEF. Another stat appears only as a type identity that balances against a smaller primary line: dagger CRIT (assassin crit), heavy armor SPD -5 (weight), shield GUARD (guard), boots SPD (mobility).
- Table [DEFAULT], scaled to a P = 100 hero (Section 3.3), retuned by Decision 135:
- **Retune rationale** (designer 2026-11, Decision 135): the designer asked for weapons "roughly 3x" with the sword anchored at ATK 150 / DEF 24; the anchor set weapon ATK at 5x the previous base table (sword ATK 30), secondary weapon lines about 3x. ATK is the strongest stat under the `pool` formula. Defensive gear's main line is about 1/3 to 1/2 of a weapon's main line (light armor DEF 50 vs sword ATK 150) while its raw stat total is a bit higher (light armor 220 vs sword 174), because ATK is worth more than DEF and HP. Defensive accessories (shield, bracelet, belt, cloak, amulet) are about 2x, kept modest, so a high DEF is a deliberate build: a P = 100 infantry with heavy armor + shield + bracelet reaches DEF 200, a normal kit (light armor) about 120, both below a P = 100 attacker's sword ATK 250. Offensive accessories scale with weapons (gloves ATK 50 = 1/3 of a sword). CRIT / GUARD / SPD identities unchanged.

| type | base | type | base |
|---|---|---|---|
| sword | ATK 150, DEF 24 | heavy_armor | HP 220, DEF 70, MDEF 15, SPD -5 |
| axe | ATK 200 | light_armor | HP 150, DEF 50, MDEF 20 |
| spear | ATK 160, HP 150 | robe | HP 100, DEF 20, MDEF 60 |
| hammer | ATK 170, DEF 18, MDEF 18 | shield | HP 60, DEF 25, GUARD 5 |
| bow | ATK 160 | gloves | ATK 50 |
| dagger | ATK 120, CRIT 10 | boots | HP 60, SPD 5 |
| staff | INT 120, MDEF 36, HP 90 | ring | INT 50 |
| tome | INT 170 | amulet | MDEF 30, HP 40 |
| | | charm | HP 120 |
| | | bracelet | DEF 25 |
| | | earring | ATK 25, INT 25 |
| | | cloak | DEF 12, MDEF 25 |
| | | belt | HP 80, DEF 12 |
- The schema-driven editor generates dropdowns for stats, tags, conditions and references, and validates IDs, duplicates and missing fields before a battle.
- Build order for the editor: **tactics board first**, then skills, equipment, characters.

Example tactic (illustrative structure, not content). A player tactic is a skill plus Main and Sub, each one leaf or one selector (Decision 136); here Main is an "only if" on the board and Sub picks the most wounded candidate:

```json
{
  "priority": 1,
  "skill_id": "skl_heal_active_001",
  "enabled": true,
  "main": { "type": "phase", "op": ">=", "value": 2 },
  "sub":  { "select": "lowest", "metric": "hp_percent" }
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
   - Done = tests for the Section 17 subset (exhaustion phase end, idle safety, phase-3 timeout by HP%, HP persistence and PP refresh, phase condition, same-seed determinism, min damage, the bare Leon-vs-Emperor example: bare Leon vs bare Emperor (DEF 50), Charging Assault 70 x 1.2 x 1.25 = 105 - 50 = 55, Thousand Azure Hooves 157.5 - 50 = 107.5 -> 107) plus `npm run sim` on a sample battle.
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
| 6 | Teams per player (tower) | SUPERSEDED | Was: single 6-hero roster. Superseded by 108 (several saved teams) |
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
| 34 | Post-draft formation | DEFAULT | Preferred rows (plus `column`, Decision 129), same rule both sides; the leader is no longer forced front |
| 35 | Live PvP | DEFERRED | Left possible; draft is a config step list |
| 36 | Bans scope | DECIDED | Apply to the tower, and to PvP if/when it is built |
| 37 | Soldier placement | DECIDED | 4x3 board; heroes only in the middle 2x3; a squad fills a whole 1x3 row at the front or back |
| 38 | Default hero row | DEFAULT | Ranged / low-DEF back (Archer, Mage, Holy, Assassin, Flyer), melee / high-HP front (incl. Monster, Aquatic); per-hero override. Assassin and Flyer back, Aquatic front: DECIDED |
| 39 | Squad pairing | DECIDED | Generic soldier types; the player pairs a hero with an eligible type; pairings can carry stat penalties |
| 40 | Leader auras authored | DECIDED | Emperor: Empire +20% ATK/DEF. Lief: Lancers +20% ATK/DEF. Jasmine: all allies recover 30% max HP after she acts. Leon: with The Emperor fielded, +30% ATK/DEF/SPD to both |
| 41 | Hero-ID conditions in authored content | DEFAULT | Allowed in auras, faction and equipment effects; forbidden in tactics and ban sheets |
| 42 | Squad targeting | DECIDED | A squad is selected as one target; no individual soldier targeting by players. A single-target hit lands on the lowest-HP living soldier; row/column/all hit every living soldier separately (see 43; revised by 130: any hit on a squad is resolved once) |
| 43 | Squad HP | DECIDED | Each soldier has its own HP (overturns the shared pool). Single-target excess damage no longer discarded: revised by Decision 128 (overflow). Healing is always AoE: split evenly across all 10 soldiers including dead ones, which revive at their share, capped at max HP |
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
| 69 | Per-hit effects | DECIDED | Regen, on-hit reactives and PP reduction (Longinus) trigger once per attacking action regardless of hit count; squads still deal 10 hits of damage (revised by 130: a squad attack is one hit) |
| 70 | Squad attack | DECIDED (overturned by 130) | Each living soldier attacks (10 real hits) |
| 71 | Player tactic and ban rows | DECIDED (player part superseded by 136) | One activation condition and one targeting condition, each optionally with a second ANDed; no nesting, OR or NOT in player sheets. Ban rules: one filter, optional second ANDed, plus selector. Authored content keeps full trees (enforced) |
| 72 | Cost override | DECIDED | `cost_override` on a hero, skill or item replaces the computed cost (official only) |
| 73 | Squad healing | DECIDED | Always treated as AoE; see 43 |
| 74 | Devotion (prayer) | DECIDED concept | 7 base gods (open-ended, 113); each gear piece carries one fixed sigil; 2 and 4 same-god sigils unlock that god's blessing; new stacking category `prayer`; priced by cost; built in step 3; god names and blessings TBD (Section 9A). Revised by 125: sigils are chosen by the player per slot, not fixed on the item |
| 75 | Meta loop | DEFERRED | Gear acquisition, progression, rewards, defender rewards, onboarding: known gap (Section 18). Hero acquisition is now 103-108 |
| 76 | Classes | DECIDED | Mage, Assassin neutral for now; Holy > Monster; Flyer much higher EVA vs melee (value TBD); new class Aquatic (SPD bonus on water); more classes will come |
| 77 | Melee / ranged | DECIDED | Damage skills declare `range: melee \| ranged`; soldier types declare their basic attack's range; subsumes `ground_based` |
| 78 | Battlefield | DECIDED concept | Terrain category buffing/debuffing classes; chosen by the defender in the snapshot; visible at reveal (Section 10A) |
| 79 | Leader focus | DECIDED (keep) | Current leader rules kept; candidates to revisit after the batch sim: squad guards the leader; back-row leaders |
| 80 | Stacking | DECIDED | Uncapped; combat log and editor show a per-stat breakdown (winner, suppressed) |
| 81 | Batch simulator reports | DECIDED | Challenger win rate and timeout rate |
| 82 | Regen reapply | DECIDED | Authored exception to the default refresh rule: reapplication extends |
| 83 | GUARD dual role | DECIDED (re-check) | GUARD opposes crit (CRIT - GUARD) and keeps its own guard roll; both kept for now, to be re-checked in the batch simulator. Crit cap 100, CRIT default 30, hit 70..100, no damage variance |
| 84 | Holy and Monster classes | DECIDED | Healer renamed Holy; new Monster class (generally higher base stats, priced by the cost algorithm); Holy > Monster. Default row: Holy back, Monster front (high-HP rule) [DEFAULT] |
| 85 | Phase action cap | DEFAULT | `max_actions_per_phase` = 200 (engine fallback when the rules constant is null) [DEFAULT] |
| 86 | Battle seeds | DEFAULT | One seed per phase in the battle input; seeds are integers in [0, 2^32) (`E_BATTLE_SEEDS`) [DEFAULT] |
| 87 | Hybrid defense | DEFAULT | Hybrid damage is reduced by the average of DEF and MDEF [DEFAULT] |
| 88 | Crit order | DEFAULT | Crit multiplier applies to the already floored post-defense damage, then floors again [DEFAULT] |
| 89 | Guard stacking | DEFAULT | Guard reductions stack as max(1 - cap/100, product of (1 - reduction/100)) [DEFAULT] |
| 90 | Roll order | DEFAULT | Rolls draw in the order hit, crit, guard; a miss draws no further rolls [DEFAULT] |
| 91 | Status count ticks | DEFAULT | Status counts tick only on an active skill use. A status the unit applies to itself skips that action's tick unless `applying_action_counts`; a status applied to another unit ticks on that unit's next own action [DEFAULT] |
| 92 | Exhaustion | DEFAULT | Exhaustion counts only tactics whose skills the slice can run, so unrunnable skills cannot keep a phase alive [DEFAULT] |
| 93 | Action cap counts heroes only | DEFAULT | Only hero actions count toward `max_actions_per_phase`; squad actions are still logged (`squad_actions`) but never end a phase while heroes have PP. Squads have their own safety bound of 10x the cap against endless loops [DEFAULT] |
| 94 | Succession pick | DEFAULT | The successor is the first living hero of the leader line (a drafted side's heroes are in leader-line order; a hand-written fielded input's hero order stands in), unless a challenger edit for that phase names a living hero (Section 5.5); it keeps its row; the aura returns, the squad does not |
| 95 | Leon's pairing penalty | DEFAULT | Stat penalties (SPD -20 with non-mounted soldiers) apply only when the hero is the leader, because only the leader's squad is deployed |
| 96 | Squads and leader statuses | DEFAULT | A squad reads its leader's status stat modifiers only (design 53/54), so a leader's aura buff (a passive status) reaches the squad too; innate soldier skills do not propagate to heroes except through `leader`/`party` targets |
| 97 | Soldier skill triggers | DEFAULT | Effects carry a trigger but no event name: `on_hit` fires on after_hit when the squad landed a hit (target: the unit hit), `on_attack` fires on after_action of the squad (targets: every unit it hit); anything else is logged as not implemented |
| 98 | Aura statuses | DEFAULT | Always-on aura modifiers are status instances in the `passive` category (`aura:<leader>:<n>`, no duration). Never ticked or cleared mid-phase; they end only with the leader's death (`aura_removed`); the next phase re-applies the aura of the current leader in the pre-battle step |
| 99 | Aura conditions | DEFAULT | An always aura's `condition` is checked at phase start, an event aura's when its event fires. "Fielded" (`party_has_hero`) means a living hero of the side at that moment, so Leon's aura is off in a phase where The Emperor is dead |
| 100 | Pre-battle step order | DEFAULT | `src/engine/prebattle.ts`: equipment (item effects, 3b), terrain, buff_grants, immunity, buff_removal, debuffs, event_auras, spd_finalization; a modify_stat with a negative value, or any effect of an enemy_debuff aura, is a debuff |
| 101 | Aura effects supported | DEFAULT | Always auras: `modify_stat`; event auras: `heal` (trigger event `self_action_completed` only, idle counts per `trigger_includes_idle_action`), run through the event bus at order 50 and logged as `trigger`; everything else is logged `not implemented: aura ...` |
| 102 | Full battle input | DEFAULT | Content has 4 heroes and a hero cannot be on both sides, so `content/battles/full4v4.yaml` is 2v2 (all heroes, all squads); the 4v4 test builds four clone heroes in memory. A real 4v4 file waits for roadmap 4.1 |
| 103 | Hero model | DECIDED | Rolled heroes are named templates with their own kit and aura; each owned copy has per-copy stats. Player-made heroes come later |
| 104 | Stat variance and allocation | DECIDED concept | Zero-sum per-copy variance at equal score (via `cost.stat_weights`), no two copies identical; plus 15 allocation points, auto-assigned by default, reassignable after confirming a roll. Values TBD after the batch sim |
| 105 | Generic heroes | DECIDED | One generic, hand-authored hero per class: base for player-made heroes, test fixture now |
| 106 | Generic soldiers | DECIDED | One generic soldier type per class; usable by any hero (see 111) |
| 107 | Rolling | DECIDED | Unlimited rerolls with locks; rerolls can be previewed; at season reset keep heroes and teams or reset. Roll size and pool: see 110 |
| 108 | Saved teams | DECIDED | Several saved teams (6-hero rosters) from owned heroes, mix and match per run, heroes may be shared; any hero can be planned but only owned heroes fielded. Supersedes "one roster per player". Which team defends a floor: see 111 |
| 109 | Races | OPEN (list) | Working list: Humans, Werebeasts, Rabbit-folk, Demons, High-Elf, Dark-Elf, Dragons (inspired by Etrian Odyssey V). Final list and lore still open; design rules are in 112 |
| 110 | Owned pool and loadouts | DECIDED | Roll 12, keep 10, unlimited rerolls with locks; pool frozen for the season once confirmed. Gear, tactics, squad and row per team entry; 15 allocated points per hero copy (same in every team). Saved teams unlimited [DEFAULT]. Duplicate copies: none (see 111) |
| 111 | Defender, duplicates, generic soldier use | DECIDED | On reaching the top the player picks one saved team (default: the clearing team), adds anchor, ban sheet and battlefield; frozen as their floor for the season. Owned pool holds 10 distinct named heroes (no duplicates). Generic soldier types are usable by any hero; special types keep their eligibility |
| 112 | Race design | DECIDED | Race shapes a hero, not their total: race sets where stat variance and the default 15-point allocation lean (equal score kept). Each race has a racial soldier type and/or a racial class (an extra option only that race can take; all base classes stay open to every race). A short racial passive list (pick one per hero) is a later option; no racial traits before the batch sim. Race-god link is lore only. Any race can be any class, including Monster (a fallen or uncontrollable form) and Aquatic (sailors) |
| 113 | Pantheon | DECIDED concept | 7 base gods based on the virtues (shadow vices for story); more gods (ascended, man-made) may be added later as new sigil sets; schema must not assume 7 |
| 114 | Hero progression | DECIDED (none for now) | Endgame first: no levels, class change or progression grind before the sim; may come later |
| 115 | Timeout tiebreak | CANDIDATE | If the batch sim shows a high timeout rate, replace "survivors after phase 3 = challenger loss" with a tiebreak: higher remaining HP %, or most total damage dealt (inspired by Unicorn Overlord) |
| 116 | Cover | DECIDED concept | Cover (a unit intercepts single-target attacks aimed at allies) will exist; needs a new effect type. Iron Fist was meant as a cover skill and is currently a row GUARD UP buff |
| 117 | Class branches | DECIDED (optional, roadmap 4.1) | A hero may have 0-2 branches; each branch = a different class plus at most one swapped skill, optionally a different stat lean; name, aura and core kit unchanged (e.g. Leon: Cavalry, or Flyer "Dragoon" swapping Charging Assault for a dive attack). Chosen per team entry like gear; bans target the hero; priced by the cost algorithm. Schema: optional `branches` on characters, `branch` on roster entries. Built in 4.1 only if the 10-hero pool feels narrow (revisited after the batch sim). The active branch's class is the hero's class for every class check: matchups, conditions, ban filters, class-filtered auras, default row |
| 118 | Per-pair class advantage | DECIDED (DEFAULT values) | A `class_advantage` entry may carry its own `damage_percent` (>= 0); Holy > Monster and Archer > Flyer are +50%, all other pairs keep the global +25% / +10 HIT. Counterweight: generic Monster heroes get a +15% stat-score lead (391 vs 340) |
| 119 | Monster class lore and soldiers | DECIDED | A Monster is a hero who fell into madness or accepted evil for power. Monster-class soldiers are Undead ("Risen"), replacing Beasts |
| 120 | Weapon tags | DECIDED | Weapon tags: sword, spear, axe, staff, tome, bow, dagger, hammer; shields are accessories (tag `shield`). A class can use several weapon types; the per-class table lives with the generic heroes in `characters.yaml` |
| 121 | SPD bands | DEFAULT | Heroes: walking classes ~38-42, Monster 47, Cavalry/Flyer 55. Soldiers: walking 30-35, mounted 50, Risen 40 |
| 122 | Terrain | DECIDED (DEFAULT values) | Battlefield chosen by the defender. Terrains: Plains (no effect, generic field), Forest, Mountains, Swamp, City (cavalry SPD -10%, assassin CRIT +10, infantry GUARD +10). Modifiers are a `terrain` stacking category applied pre-battle to heroes and squads of the listed classes (squads use their own soldier class). Damage effects may carry `bonus_on_terrain` (Dive mountains +20, Backstab forest +20, Tidal Crash swamp +30) |
| 123 | New passives | DECIDED (content) | Follow-Up, Pursuit, Counter and Frenzy are authored; they run in roadmap 3a (logged as not implemented until then) |
| 124 | Draft and edits as implemented (3e) | DEFAULT | `src/draft.ts`, `src/edits.ts`. Battle input may be two 6-hero rosters plus human picks (`draft.bans` / `draft.protects`, consumed in step order); the battlefield comes from the defender roster. Ban-rule and fallback ties: cost (highest), then id; ban metric `cost`, `hp` or `stat:<STAT>` (base plus equipment lines); `nearest` = front row first, then roster order; a `rule_sheet` protect (not in variant C) protects the highest-cost eligible hero. Fielded heroes are ordered by leader-line rank; row overflow moves the lowest-ranked non-leader to the other row. Edits name a phase (2 or 3) and apply from it on; editable: tactic_sheet, preferred_row, squad_row, and `leader` (only when the current leader is dead) |
| 125 | Devotion (3c) | DECIDED (placeholder content), DEFAULT rules | Placeholder pantheon: the Seven Lucky Gods (`content/gods.yaml`). Sigils chosen by the player per equipment slot (`sigils` on the roster entry; counts only on a filled slot, W_SIGIL_EMPTY_SLOT). The 7 blessings of Section 9A. [DEFAULT]: reflect = floor(percent of the HP lost to the attacking unit's hits in that action), after the action (also when it killed the wearer), no rolls, ignores DEF, not a hit, can kill, on a squad the lowest-HP soldier; Gift heals once per attacking action that targeted the wearer single-target; single-target = own active damage skill of shape single (`action_is_single_target`); a god's two tiers add on the same stat (designer decision), different gods follow strongest-wins; blessing HP percent raises max HP; pricing per effect (`effect_price` for non-stat effects) |
| 126 | Class traits (3d) | DECIDED values, DEFAULT placement | Flyer EVA x1.5 (`flyer_melee_eva_bonus: 50`) against melee hits only, applied after 9.1 stacking; Aquatic SPD +30% (`aquatic_water_spd_bonus: 30`, terrain category) on water terrain; terrains get a `water` flag (default false), Swamp is water and loses its aquatic +15% line |
| 127 | Editor tech stack (Step 5) | DECIDED | Local web app: Vite + React + TypeScript, plain CSS, served locally by `npm run editor`; no hosting, no accounts. A Vite plugin mounts a JSON API (`editor/api.ts`) that runs the repo's zod schema, validator and engine in Node (the server is authoritative, the browser never runs the engine). Milestone 1 = tactics board + run sim; skills, equipment and character editors come later |
| 128 | Soldier damage overflow | DECIDED | Overturns the no-spill part of Decision 43. A single-target hit that kills a soldier carries its raw leftover (no new rolls or defense) to the next lowest-HP living soldier (ties lowest index), repeating until the damage is used up or the squad is wiped; it never reaches the leader or heroes. Area hits are unchanged (each soldier separate, no carry; revised by 130: area hits are resolved once and overflow too). A Fairy's Grace save on the last soldier ends the overflow. Log: one `damage` event per soldier (`spill` on carried ones), one `after_hit` per hit with the total HP removed |
| 129 | Slot-based formation | DECIDED | The hero grid is 2x3 separate slots, not just front/back rows. Optional roster-entry field `column` (1..`rules.board.columns`, omitted = auto: lowest free column of the row in roster order); explicit columns claim exactly (row, column); duplicate slot = `E_BATTLE_SLOT`; `column` is editable between phases. Leaders may stand in either row (overturns "leader must be front"; `heroRow` no longer forces it). Squads stay in the separate soldier rows. Draft row overflow moves the lowest-ranked non-leader to the other row and drops its explicit column. The editor board shows the fixed 2x3 grid and writes `preferred_row` + `column` on drag (swap on an occupied slot) |
| 130 | Squads attack and defend as one | DECIDED (DEFAULT details) | Overturns 70 and the area-hit part of 43/128. "Soldiers attack as one and defend as one: combine their ATK when attacking and their defence when defending." A squad action is ONE attack: power = sum of the living soldiers' effective ATK (INT for a magical attack) x basic attack multiplier (1) x matchup; one hit, crit and guard roll with the soldier type's rate stats (never summed). Any hit on a squad (single or area) is resolved once against the sum of the living soldiers' DEF (MDEF; hybrid = average of the two sums), EVA/GUARD are the soldier type's, and the damage goes through the overflow chain (lowest-HP soldier first, never to heroes). Sums use living soldiers only; flat lines shared from the leader's statuses count once for the sum, not per soldier [DEFAULT]. Heals unchanged. Soldier on-hit / on-attack skills fire once per squad action. Batch report: one squad action per squad turn |
| 131 | Stat guideline (rebalance) | DECIDED rules, DEFAULT factors | Stats relative to a primary stat P (ATK, INT for casters): HP 5-10 x P, ATK 1 x P, INT 1 x P if used, DEF/MDEF 0.4-0.8 x P, SKL 0.1-0.3 x P, SPD foot 30-50 / mounted 50-70, HIT 100, CRIT/GUARD/EVA baselines kept. Generic heroes P = 100 (factor table in Section 3.3); Leon P 115, The Emperor P 100, Jasmine P 100 (INT), Lief P 90. Soldiers ~0.15 x a P=100 hero of their class (Heavy types 0.17 for HP/ATK/DEF), rate stats unchanged, HIT 90 (Bowmen 95). Damage formula, skills, equipment and rules constants unchanged |
| 132 | INT/MDEF pairing | DEFAULT (meaning of a designer rule) | "Skills or auras boosting ATK or DEF should also apply to INT and MDEF": a modify_stat on ATK (DEF) from a skill status (active / passive / soldier category), a leader aura or a soldier skill also applies to INT (MDEF), same mode and value, buffs and debuffs alike, unless that source already names the paired stat. Not for equipment lines, item effects, blessings or terrain. Shown as a normal breakdown entry of the same category (Section 9.1) |
| 133 | Equipment type standard | DECIDED rule, DEFAULT values | "All equipment of one type has the same base stats; types differ from each other." An item has exactly one type (weapon type, armor type or accessory category: shield, gloves, boots, ring, amulet, charm, bracelet, earring, cloak, belt; replaces `none`); its flat stat lines are `rules.equipment_bases[type]` and items no longer author `stat_modifiers`. Named items differ by pp_modifiers and effects. Bases stay on HP/ATK/INT/DEF/MDEF except type identities (dagger CRIT, heavy armor SPD -5, shield GUARD, boots SPD). Table in Section 12.1. Existing items re-typed; their old stat lines dropped (kept in `meta.pre_standard_stats`) |
| 134 | Additive-pool damage, hero hits, Speed Boots | DECIDED formula shape, DEFAULT values | "ATK (from all sources) - DEF (from all sources) x (DMG bonus - DMG reduction)": `pool` formula, `(ATK_total - DEF_total) x (1 + bonus% - reduction%)`, class advantage / pair / bonus_vs_class / bonus_on_terrain in the bonus part, guard and reduce_damage in the reduction part, cap 75%, crit after (Section 8). "Heroes hit for 4x to begin with": `rules.damage.hero_hits` 4 multiplies hero damage (not squads, not heals), sweepable. Older formulas kept selectable. equip_006 Speed Ring re-typed to boots as Speed Boots |
| 135 | Equipment base retune | DEFAULT values (designer guide) | "Increase weapon stats by roughly 3x, then defence gear roughly 1/3 - 1/2 of weapons; sword ATK 150 DEF 24, Leather Armour (light_armor) DEF 50 HP 150. Armour should give a better stat total, ATK is just very powerful. Building up a high defence should be an intentional build." The designer asked "roughly 3x" with the sword anchored at ATK 150 / DEF 24; the anchor set weapon ATK at 5x the previous base table (sword ATK 30), weapon secondary lines ~3x; armor main defensive line 1/3-1/2 of a weapon line with a slightly higher raw total; offensive accessories scale with weapons; defensive accessories about 2x, kept modest, so stacking DEF is deliberate; CRIT / GUARD / SPD identities unchanged. Table in Section 12.1 |
| 136 | Tactic = skill + Main + Sub | DECIDED (DEFAULT details) | Player tactics drop `activation`, `targeting` and `fallback`: `{ priority, skill_id, enabled, main, sub }`, each slot one condition leaf or a selector (Section 4.1-4.3). Leaves filter the candidates (self / board leaves act as "only if"), selectors only order (Main first, Sub tie-break; new `prefer` with a `filter` leaf, metrics max_hp / max_active_pp / max_passive_pp; selector `side` dropped). Skill default_activation and default_main always apply; default_sub only without a selector. Races (`race` on characters: human, elf, beastfolk, dwarf, dragon, demon, angel; [DEFAULT] squads human), battle `time: day / night` (default day; no race day/night bonuses yet) and new leaves: time_is, race_is, has_any_buff / lacks_any_buff / lacks_any_debuff, row_size, row_rank (ties count as both, among occupied rows), column_full, average_hp_percent ([DEFAULT] every living hero and soldier counts once), combatants, side_has, is_self / not_self, attacked_since_last_action with damage_type / shape / by_class / by_race filters |
| 137 | Editor and main game are separate | DECIDED | The editor is the simulation, testing and character creation tool, with import and export into the main game. The main game is a separate client with all default content built in and a much more user-friendly, visual-first UI inspired by Unicorn Overlord. Same schema and engine; import/export uses the `content/` YAML files, validated on import [DEFAULT] (Section 12) |
| 138 | Soldier skill points | DECIDED, later | 20 points per soldier type, spent in skill trees with prerequisites, up to 5 levels per category; reallocated at season end; slight cost increase. Differentiates players' soldiers (class triangle damage dealt/taken, vs buffed or debuffed units, back-row damage, damage taken by battlefield). Separate from hero progression (Decision 114). Tree contents open (Section 18) |
| 139 | Timeout result | DECIDED (built) | Replaces "survivors after phase 3 = challenger loss" (Decisions 68, 115): a phase-3 timeout goes to the side with the higher remaining HP%, counted over the whole side (heroes and soldiers together); an exact tie goes to the defender [DEFAULT] |
| 140 | Default PP 3/3 | DEFAULT, not locked | Active 3, Passive 3 for now, max still 4; still being decided after the PP sweep |
| 141 | Two-sided enchantments | DECIDED for now (built) | Each god has a DEF and an ATK 4-piece (Section 9A, `four_piece_def` / `four_piece_atk`); the hero entry's `sigil_side` records the choice. The 2-pieces changed with them. Values untested until simmed |
| 142 | Cross-side reaction order | DECIDED (built) | When one event triggers reactions on both sides, the attacked side's reactions resolve first, then the other side's; within a side, sheet priority order. Engine handlers (order 0) and soldier skills (order 100) keep their order tiers. Ends the challenger-seat first-word bias (`EventBus.emit`) |

---

## 17. Test Requirements (additions to v1)
- Phase ends exactly when all living heroes are exhausted; soldiers alone never extend a phase.
- Idle-cycle safety ends a stalled phase.
- Phase 3 ending with both sides alive resolves by remaining HP% (Decision 139).
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
- A hero's `preferred_row` default follows the class rule; overrides are respected; the leader may stand in either row; an explicit `column` claims that exact slot, and no column fills the lowest free one (Decision 129).
- Leon's SPD -20 applies when paired with a non-mounted soldier type and not with a mounted one.
- A squad is selected as one target and individual soldiers cannot be selected; a row, column or all skill hits every living soldier separately.
- A landed hit never deals less than 1 damage, and damage follows floor(max(1, power x multiplier x matchup - DEF)) with no variance (same inputs, same hit and crit outcome: identical damage).
- 1 turn ends only on an active skill use by the affected unit; an idle action does not end it.
- Unique statuses multiply with same-category effects; non-unique same-category effects use the strongest only.
- Soldier-category effects multiply with passive, active and equipment effects.
- Hegemony resolves before the triggering attack and removes only the attacker's buffs; Quick Heal resolves after a single-target hit.
- Confusion from the Strange Box affects every unit including the wearer, and ends after each unit's first active attack.
- Thousand Azure Hooves gives the caster SPD UP (+15%) for 1 turn after the action, and the next action is scheduled sooner.
- Squad HP is per soldier: a single-target hit lands on the lowest-HP living soldier and a kill overflows the leftover to the next lowest-HP soldier (never to the heroes, Decision 128); ties go to the lowest soldier index.
- Healing a squad splits the amount evenly across all 10 soldiers, dead included: heal 60 gives +6 each, a living soldier at 20 goes to 26, a dead soldier revives at 6, and every soldier is capped at max HP.
- Stat buffs and debuffs on the leader also apply to the leader's squad; a row-wide or party-wide effect skips the squad unless the skill says otherwise.
- Stun delays the target's pending action by the fixed `stun_pushback_counts`, independent of SPD; the stunned unit loses no action and no PP.
- SPD does not give a hero more skill uses per phase (two parties with different SPD and equal PP spend the same PP), it only decides order; a squad with higher SPD makes more attacks per phase.
- A unit killed before its scheduled action loses its unspent PP (kill race).
- A column skill hits every living soldier of a squad separately, whichever column it is in.
- Per-hit effects (Regen, on-hit reactives, Longinus PP reduction) trigger once per attacking action; a squad attack is one combined hit (Decision 130).
- A player tactic slot holding anything but one leaf or one selector is rejected (E_TACTIC_SHAPE, Decision 136); a defender ban rule likewise allows one filter, an optional second ANDed, plus the selector.
- A Flyer has much higher EVA against melee attacks than ranged ones; hit% stays within 70..100 and crit% within 0..100.
- Skill and soldier `range` (melee / ranged) is required on damage skills and soldier types.
- Prayer-category effects multiply with passive, active, equipment and soldier effects; 2 and 4 same-god sigils unlock the 2-piece and 4-piece blessing tiers (when devotion is built).
- The combat log shows a per-stat breakdown naming the winning and suppressed effects.
- The batch simulator output includes challenger win rate and timeout rate.
- Class advantage and skill bonuses apply to power x multiplier before defense is subtracted. Slice test (bare Leon vs bare Emperor, DEF 50): Charging Assault 70 x 1.2 x 1.25 = 105 - 50 = 55; Thousand Azure Hooves 157.5 - 50 -> 107. Step-3 test (Section 3.3 stats, Leon ATK 115 vs a Dragon-Scale Emperor, DEF 140 with the Decision 135 heavy armor base): 32 and 118; as leader with Empire's Dominion (DEF 168): 4 and 90.
- crit% = clamp(CRIT - defender GUARD + (attacker SKL - defender SKL)/4, 0, 100): raising the defender's GUARD lowers crit chance; GUARD still rolls its own guard (clamp 0..75) independently.
- Area statuses (row, party, field) skip soldiers unless the effect sets `include_soldiers: true`.
- `squad_row` is optional on a roster entry (falls back to the soldier type's `default_soldier_row`) and the resolved row must be one of the soldier type's allowed rows.
- A squad's class follows its soldier type, so Heavy Cavalry has the advantage over infantry targets.


## 18. Known gaps [DEFERRED]
- **Known gap for 3a:** state-passive statuses with a `while_condition` duration (Berserk) are not removed when the condition ends; the engine only applies them.
- **Meta loop:** gear acquisition (hero acquisition is Decisions 103-108, 110-111), progression, rewards, defender rewards for holding a floor, and new-player onboarding are not designed yet [DEFERRED]. Hero progression is deliberately out for now (Decision 114).
- Tower attempt limits, HP persistence between floors, and anti-degenerate measures (Section 11).
- Devotion: the pantheon and blessings are placeholders (Decision 125); final gods and blessing balance come with the batch sim.
- **Races** (Decisions 109, 112): final race list and lore; each race's stat lean and racial soldier type or class option; whether to add a racial passive list after the batch sim. Factions (Evil, Light, Forest-folk) may need recasting as political allegiances so they do not overlap races.
- **Soldier skill points** (Decision 138): how points are earned (or all 20 from the start), the tree layout, prerequisites and per-level values, and the cost weight (Section 2A).
- **Editor import/export** (Decision 137): which content can move between the editor and the main game (official tier vs community content).


## Implementation note: schema is the source of truth

The machine-readable definition of every template lives in `src/schema/` (Zod) and `src/registry/` (condition leaves and effect types, each flagged with the contexts they are allowed in and whether they are community-safe). `npm run schema:export` writes JSON Schemas to `schemas/`; `npm run validate` checks a content folder. Global tunables (damage floor, guard caps, class advantage, stun pushback, draft steps, limits, cost weights) live in `content/rules.yaml`, not in code. Structured conditions are used wherever a rule is checked by machine, for example Leon's soldier penalty is `stat_penalties: [{ when: { type: soldier_mounted, value: false }, stat: SPD, mode: flat, value: -20 }]`. Status durations accept the unit `instant` (consumed immediately, no count), used by Stun. Stun is a fixed pushback in timeline counts (Section 6): `delays_pending_action` is a boolean and `rules.stun_pushback_counts` ([DEFAULT] 15) holds the count. Also implemented: `aquatic` class, `prayer` source category, required `range` on damage effects and soldier basic attacks, `overflow_to_next_soldier` removed, `apply_status.include_soldiers` defaulting to false, `cost_override` (official only), two-condition player-slot limits, and the `rolls`, `class_traits` and `phase` rules constants. Also implemented since: devotion (`content/gods.yaml`, roster `sigils`, Decision 125), battlefield content (Decision 122) and the Flyer and Aquatic trait mechanics (Decision 126). The `cover` effect type (Decision 116) exists in the schema and engine but no content uses it yet.
