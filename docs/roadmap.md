# Roadmap

Working plan from the current state (validator done, 0 errors, 28/28 tests) to the tower. It follows design doc Section 15 and breaks each step into milestones with a definition of done. Design details live in `design_doc_v2.md`; this file only orders the work and lists what blocks it.

**Engineering level:** solid prototype. Correctness and determinism are tested; performance, UI polish and infra wait until the batch simulator or editor needs them.

## Process per milestone

1. Read every file the milestone touches in one pass (main agent).
2. Subagents implement; the main agent supervises and never writes code.
3. Gate: `npm run typecheck`, `npm run validate`, `npm test` all clean, run once at the end.
4. Cheap reviewer subagent (haiku, minimal context) reviews the diff.
5. Update the design doc decision log and `CLAUDE.md` if the milestone changes architecture or commands.

Designer decisions marked **[NEEDS DECISION]** are asked before the milestone that needs them starts, never mid-way. Where a working default is proposed, it goes into `rules.yaml` as [DEFAULT] so work is never blocked.

---

## Step 0: Housekeeping (small, do first)

| # | Task | Why |
|---|---|---|
| 0.1 | `git init` and an initial commit | The repo has no version control; the engine is a large change and needs history and diffs for review. |
| 0.2 | Fix the `CLAUDE.md` environment note: Node 24 via nvm is required (system Node 18 lacks tsx), `node_modules` is installed | The current note is stale and caused a failed first run. |
| 0.3 | Optional: `.nvmrc` containing `24` | One line; lets `nvm use` pick the right Node automatically. |
| 0.4 | Optional: add a "trivial edits (a few doc lines) may skip the reviewer subagent" exception to the working guidelines | The always-review rule is heavier than the change for one-line doc fixes. |

## Step 1: Engine vertical slice (design doc Section 15, step 1)

Scope as agreed: 2v2 (Leon/Lief vs Emperor/Jasmine), no soldiers, auras, passives, draft or between-phase edits; only `own_turn` active skills with damage, heal and stat-mod statuses; 6 condition leaves; unsupported things are skipped with a logged "not implemented" reason. Code lives in `src/engine/` and consumes the validated `Pack`.

**Blocking decisions before 1.1:**
- [NEEDS DECISION] `max_actions_per_phase` value. Proposed [DEFAULT]: 200.
- [NEEDS DECISION] Per-phase seed. Proposed [DEFAULT]: the battle YAML carries one seed per phase (matches "server assigns the seed per phase"); the slice sample can derive them from one base seed.

| # | Milestone | Done when |
|---|---|---|
| 1.1 | **Battle input**: `src/schema/battle.ts` (two sides of roster-style hero entries, challenger/defender, seeds) + `content/battles/sample.yaml`; validated with the existing roster checks that apply | Sample battle validates; a bad battle file gives stable error codes; schema exported. |
| 1.2 | **Seeded RNG** `src/engine/rng.ts`: small deterministic PRNG, one stream per phase, every roll goes through it | Same seed gives the same sequence; test. |
| 1.3 | **Battle state and effective stats**: units, HP, PP pools, rows; effective stat = base, then status stat-mods with the Section 9.1 rules (source category, strongest wins within a category, multiply across, unique statuses exempt, suppressed effects resume) and a per-stat breakdown object. In the slice every applied status is Active category (only active skills run) | Active 20% vs active 30% on the same stat = 30%; a unique status multiplies with a same-category one; suppressed effect resumes. Cross-category tests (passive x active = 1.44) move to 2.6. |
| 1.4 | **Timeline scheduler**: `interval = round(1000 / max(SPD, 5))`, clock jumps to earliest action, one pending entry per actor, reschedule on SPD change preserving elapsed fraction, tie rules (FILO for speed-change ties, higher average SKL, challenger, formation order, unit ID) | Order and tiebreak tests; SPD UP (Thousand Azure Hooves) schedules the next action sooner. |
| 1.5 | **Condition evaluator** for the 6 slice leaves (HP %, `unit_kind`, row, class, status, phase); all other leaves evaluate false with a reason | `phase` works in activation and targeting; unknown leaf logs "not implemented". |
| 1.6 | **Tactic evaluator**: priority order, enabled flag, Active PP check, activation, targeting main + sub selector, fallback; every skip has a logged reason; hero with no usable tactic idles | Skip-reason tests; idle does not end a "1 turn" status. |
| 1.7 | **Damage and heal pipeline** (Section 8): hit/crit/guard rolls from `rules.rolls`, class advantage on power x multiplier before defense, floor, minimum 1, crit 1.5x, guard 50%, multiplicative reductions capped at 75%, DEF vs MDEF by damage type | Bare Leon vs bare Emperor: Charging Assault 55, Thousand Azure Hooves 107; min damage 1; no variance given the same roll outcomes. |
| 1.8 | **Phase controller**: pre-battle stats, scheduling, exhaustion phase end, idle safety (full cycle without a skill), hard action cap, 3 phases, HP/deaths persist, PP refresh, statuses clear, timeline reset, battle ends on wipe, phase-3 survivors = challenger loss | Section 17 slice tests: exhaustion, idle safety, phase-3 challenger loss, HP persistence and PP refresh, kill race loses unspent PP. |
| 1.9 | **Combat log + sim CLI**: typed JSON events (setup, stat breakdowns, schedule, tactic evaluations with skip reasons, targets, rolls, damage, PP, statuses, deaths, phase boundaries, seed) + text renderer; `npm run sim -- <battle.yaml> [--json]` | `npm run sim` on the sample prints a readable battle; same seed twice gives byte-identical JSON logs (determinism test). |

Exit criteria for Step 1: all of the above tests pass, `CLAUDE.md` gains an engine architecture section and the `sim` command.

## Step 2: Soldiers, leader rules, auras (Section 15, step 2)

| # | Milestone | Done when |
|---|---|---|
| 2.0 | **Formation resolution** (fixed 4 heroes, no draft yet): hero rows from `preferred_row` (class default, per-hero override), leader forced front, `squad_row` resolution (fallback to the soldier type's `default_soldier_row`, must be in `allowed_soldier_rows`). Overflow by leader-line rank comes with the draft in 3e | Section 17 formation tests: class-default rows, overrides respected, leader always front, squad only in a soldier row. |
| 2.1 | **Squads**: one squad per side (leader's), 1x3 soldier row, per-soldier HP, selected as one target, single-target hit on lowest-HP soldier (ties lowest index, excess discarded), row/column/all hit each soldier separately, heal split over all 10 (dead revive at share, capped), squad acts on own SPD schedule with 10 real hits, never keeps a phase alive; soldier skills (always-on or event-triggered, no PP, `soldier` stacking category) | Section 17 squad tests; soldier-category effects multiply with active ones. |
| 2.2 | **Area shapes**: row, column, all, with separate shape and distribution fields; area statuses skip soldiers unless `include_soldiers` | Column through a squad hits every soldier; area status skips squad by default. |
| 2.3 | **Event system** (design Section 14): typed battle events (before_hit, after_hit, after_action, on_death, phase_start) that auras, soldier skills and later passives subscribe to; the per-hit-once rule is enforced here (one trigger per attacking action per affected unit) | Event-triggered soldier skill fires once per 10-hit squad attack. Regen, on-hit reactives and Longinus are tested against it in 3a. |
| 2.4 | **Leader rules**: leader front row, leader stat-mods propagate to squad (stat modifiers only), soft leader rule (death removes squad and aura), succession between phases restores aura only, Leon's SPD -20 with non-mounted soldiers | Section 17 leader tests. |
| 2.5 | **Auras**: field, faction, ally (class/hero filters, event-triggered), enemy debuff; only when leader, no PP, Passive category. Includes the pre-battle priority order skeleton (equipment slot empty until 3b; buff grants before debuffs); Immunity and buff removal slot into it in 3a | Lief buffs only Lancers; Leon's aura needs Emperor fielded and Leon leader; Jasmine heals after acting; each aura type targets the right side. |
| 2.6 | **Full 4v4 battles** with soldiers in the sample battle | Sample 4v4 battle runs and is deterministic; passive (aura) 20% x active 20% = 1.44. |

## Step 3: Full systems (Section 15, step 3, plus draft and edits)

Split into independent tracks; 3a first, the rest in any order. Section 15 does not place the draft or between-phase edits; the roadmap adds them here (3e) because the batch simulator in Step 4 needs 6-hero rosters drafted to 4.

**Blocking decisions:**
- [NEEDS DECISION] `stun_pushback_counts` value (before 3a).
- [NEEDS DECISION] Flyer melee EVA bonus and Aquatic water SPD bonus values (before 3d).
- [NEEDS DECISION] 7 god names and their 2-piece / 4-piece blessings (before 3c).
- [NEEDS DECISION] Terrain list, per-class modifiers, and terrain's stacking category (before 3d).

| # | Milestone | Done when |
|---|---|---|
| 3a | **Full condition library, passives and statuses**: all registry leaves; per-hit-once tests for Regen, on-hit reactives and Longinus; passives spend Passive PP on trigger with "used" semantics (one-event vs state passives) and log when PP is short; Stun pushback, Confusion, Regen (extend on reapply), Fairy's Grace, Immunity, buff removal; pre-battle priority order (equipment, buff grants, buff removal, debuffs, SPD finalization); Hegemony before the triggering attack, Quick Heal after | Section 17 status, passive and pre-battle tests. |
| 3b | **Equipment in the engine**: flat lines into base, conditional/percentage effects as Equipment category (fills the equipment step of the pre-battle order), PP bonuses (Dragon Scale), duplicate accessories | Dragon Scale example: 5 and 57; with Empire's Dominion: 1 and 37; equipment vs equipment does not stack; two Speed Rings = SPD +40. |
| 3c | **Devotion**: sigil field on equipment, blessing content type (god, 2-piece, 4-piece), `prayer` category in the engine, blessings priced by the cost algorithm | 2 and 4 same-god sigils unlock the tiers; prayer multiplies with other categories. |
| 3d | **Battlefield and class traits**: terrain content type, defender's battlefield in the snapshot/battle input, terrain class modifiers, Flyer melee EVA and Aquatic water SPD | Flyer EVA higher vs melee only; Aquatic SPD up on water only. |
| 3e | **Draft and between-phase edits**: battle input grows from two fielded sides to two 6-hero rosters (challenger, and defender with anchor, ban sheet and battlefield), validated by the existing roster layer (which already enforces cost caps); draft sequence (variant C) with anchor/protected/ban sheet/fallback ban, leader line resolution, formation overflow by leader-line rank; challenger edits between phases (allowed vs locked fields, Section 5.5) | Draft tests (4 heroes each, anchor never banned, deterministic, fallback rule); locked-field edits rejected. |

## Step 4: Content expansion + batch simulator (Section 15, step 4)

Balance numbers from 4 heroes are meaningless, so content grows alongside the simulator.

| # | Milestone | Done when |
|---|---|---|
| 4.1 | **Content expansion** (designer-led): heroes for the classes with none yet (archer, flyer, mage, assassin, aquatic, monster), enough for several distinct 6-hero rosters; more soldier types | Validator clean; at least ~12 heroes covering every class. |
| 4.2 | **Batch simulator** `npm run batch`: N seeded battles per matchup (including the draft), reports challenger win rate, timeout rate, average phases, per-hero damage/healing | Report includes challenger win rate and timeout rate. |
| 4.3 | **Balance pass**: calibrate cost weights, Jasmine's aura `cost_adjustment` (+10 proposed in the conversion report, deferred to calibration), roll constants; re-check GUARD dual role, turtling/timeout rate, and the leader-focus candidates (squad guards leader, back-row leaders) | Decisions recorded in the decision log; constants updated in `rules.yaml`. |

## Step 5: Editor (Section 15, step 5)

- [NEEDS DECISION] Tech stack (e.g. web app reusing the zod schema; decide at the start of Step 5, not before).
- Order: tactics board first (schema-driven dropdowns, slot-shape limits, per-stat stacking breakdown), then skills, equipment, characters.
- Done when a player can build a roster, write tactic sheets, run a sim and read the log without touching YAML.

## Step 6: Tower service (Section 15, step 6)

- **Blocking design work:** the meta loop (acquisition, progression, rewards, defender rewards, onboarding) is an undesigned known gap and must be designed before this step. Also: tower attempt limits, HP persistence between floors, anti-degenerate measures.
- Snapshots (party, gear, formation, leader, tactics, battlefield, anchor, ban sheet, content/rules version), server re-simulation with hidden per-phase seeds, seasons with pinned content versions, top-10 rollover.

---

## Decision queue (in the order they block work)

| When | Decision | Proposed default |
|---|---|---|
| Before 1.1 | `max_actions_per_phase` | 200 |
| Before 1.1 | Per-phase seed handling | One seed per phase in the battle input |
| Before 3a | `stun_pushback_counts` | none proposed |
| Before 3c | 7 gods and blessings | none |
| Before 3d | Flyer melee EVA, Aquatic water SPD, terrain list and stacking category | none |
| Before 4.1 | Which new heroes and soldier types | designer content |
| Step 4.3 | Cost weights, GUARD dual role, leader focus | from batch sim data |
| Before 5 | Editor tech stack | web, reusing zod |
| Before 6 | Meta loop, tower limits | none |

## Possible scope improvements (not committed)

- A `--trace <unitId>` filter on the sim log once logs get long (Step 2+).
- Golden-log snapshot tests (store one JSON log per sample battle) to catch unintended engine changes; cheap once 1.9 exists.
- Fuzzing the engine with random valid rosters during Step 4 to catch crashes and infinite loops.
