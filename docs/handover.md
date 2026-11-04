# Session handover (updated 2026-11-04, late; items 23-29 deployed, 30 local)

Read this first, then `CLAUDE.md` (working rules, commands, architecture). Design intent is in `docs/design_doc_v2.md`,
progress in `docs/roadmap.md`.

## Where things stand

- **Git:** work is committed per queue item (see `git log`); the supervisor commits each reviewed, green item. Claude pushes only when the designer says to.
- **Checks at handover:** typecheck clean (root and editor), 451/451 tests pass, `npm run validate` 0 errors and 0 warnings,
  all five sims in `content/battles/` run with no `not implemented` lines.
- **Node:** run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` first (Node 24). `npm install` works on this machine.
- **Editor:** `npm run editor` (port 5173, or `EDITOR_PORT=5180 npm run editor` when another local project holds 5173).

### Done
| Roadmap / decision | What |
|---|---|
| 3a-3e | Passives, statuses, condition library, equipment, devotion (gods.yaml, sigils), Flyer/Aquatic traits, draft and edits |
| 4.2 | Batch simulator, now with what-if sweeps: `--pp-active=2,3,4 --pp-passive=2 --formula=subtract,ratio:100,...` |
| 5 (m1) + overhaul | Editor (designer's zip applied): Battle / Units / Log pages, sprite formation board, 2x3 slot drag with fading "+", hover hints, pins, themes, PP and formula what-if controls |
| Sprites | 10 class sheets in `editor/public/sprites/` (`npm run sprites`, originals in gitignored `art/raw/`) |
| 128 | Soldier damage overflow (never to heroes) |
| 129 | 2x3 slot formation, optional `column`, leader in either row |
| 130 | Squads attack and defend as one (summed ATK / summed DEF of living soldiers) |
| 131 | Stat rebalance around primary stat P (generic P = 100; HP 5-10x, DEF/MDEF 0.4-0.8x, SKL 0.1-0.3x, HIT 100; soldiers ~0.15x) |
| 132 | ATK/DEF modifiers from skills, auras, soldier skills also apply to INT/MDEF |
| Section 8 / 134 | Damage formula selectable in `rules.yaml`: `pool` default (`(ATK - DEF) x (1 + bonus% - reduction%)`), `subtract`, `ratio`, `scaled_subtract`; `rules.damage.hero_hits` 4 multiplies hero damage (Decision 134; sweep with `--hero-hits=1,2,4,6,10`) |
| 133 | Equipment type standard: one type tag per item, flat stats from `rules.equipment_bases` (design doc 12.1); items keep only effects/PP. Speed Ring resolved as Speed Boots (boots type, Decision 134). Open calls: Prayer's Guardian has no effect left; Chainmail stays light armour |
| 135 | Equipment bases retuned (design doc 12.1): designer asked "roughly 3x", the sword anchor (ATK 150 / DEF 24) set weapon ATK at 5x the old table, armor main line 1/3-1/2 of a weapon's (light armor HP 150 / DEF 50 / MDEF 20), defensive accessories about 2x, kept modest, so high DEF is a deliberate build |
| Pages | Hosted editor: `npm run editor:build` builds a static editor (pure `editor/core.ts` run in the browser over bundled content; save downloads, open local file loads back) into `editor/dist`; `pages.yml` runs `npm ci` + the build and deploys `editor/dist`. `npm run editor` unchanged |

## Todo queue (in order)

0. **Done 2026-11-04 (Decision 136):** tactic = skill + `main` + `sub` (leaf filters/checks, selector orders, `prefer`
   selector; skill defaults always apply; tactic `fallback` removed), `race` on characters (all human for now, designer 2026-11-04),
   battle `time: day | night`, 14 new leaves. Editor: party board sticky on every page, click a hero for a drawer (tactics
   first, then stats/gear/skills), "Advanced" section for dev controls, Main/Sub preset picker (`editor/src/conditionPresets.ts`,
   ~238 presets in 13 categories), sample battle opens on first load.
   **Open calls:** day/night race bonuses (which races, stats, amounts); no presets for
   farthest / random selectors (not in the designer list). **Known limit:** at 768-1099px the boards stack and the
   drawer covers the defender board (own side stays visible).

1. **Done 2026-11-04: why defenders win (diagnosis, no code change).** Swap test (challenger/defender blocks exchanged,
   100 runs): city4v4 flips to 88% for the new challenger, so there is **no engine side bias**; the winner follows the team.
   - city4v4 / draft_city: the Monster + Lancer + Assassin + Mage team is simply stronger. It acts first (SPD 24-29 vs
     22-30), all four focus the nearest target (the challenger's front squad is wiped before it acts), then the Assassin
     one-shots a back-row hero each phase (Archer dies 97%, Holy 91%). The challenger brings a healer and spreads damage
     (Cleave on Monster + Lancer, Charge on the other squad).
   - sample / full4v4: 88-100% timeouts, and timeouts go to the defender (Decision 115), so "defender wins" there is the
     tiebreak, not combat. Cause is the damage wall: summed squad DEF (Decision 130) meets hero ATK, e.g. the Emperor's 180
     ATK vs the Heavy Infantry squad's 182 DEF = min damage (4 per hit) every action; `nearest, front row first` keeps him
     on the squad. full4v4 swapped: the Leon team wins 12% by wipe on either side.
   **Correction (designer 2026-11-04):** always assume heroes have weapons and gear. The sample / full4v4 wall above comes
   from their bare heroes, so it is not a finding yet.
1a. **Done 2026-11-04: `sample` and `full4v4` geared** (plain shop gear, no signature items; `stripGear` in `test/engineHelpers.ts`
   keeps engine tests on bare heroes). 100 runs: the wall is gone. sample 100% challenger by wipe, full4v4 94%, 0% timeouts
   (bare: sample 98% timeouts). No squad DEF change needed at `hero_hits` 4; at `hero_hits` 1 timeouts return (80-89%).
   Both matchups are lopsided (the defender side's Jasmine only heals), so they say nothing about skill multipliers yet.
1b. **Done 2026-11-04 (Decision 139):** a phase-3 timeout goes to the higher pooled HP% (heroes and squads, `timeoutWinner` in
   `src/engine/phase.ts`), exact tie to the defender. The batch report needed no change (it counts `battle_end` winners).
2. **Default PP:** 3/3 for now (Decision 140, not locked; max still 4). Tests read PP from content. **Swept 2026-11-04** (active/passive 2-5, 100 runs,
   geared battles): active 2 leaves 20-57% timeouts on the three city battles, active 3+ drops them to 0-8%, so 2 is too low. Passive above 3
   changes nothing much (sample/full4v4 have no passives on sheets, so they are flat by construction). Challenger win is not monotonic in active PP
   (city4v4-edit 95% at 3, 60% at 4, 85% at 5), so active PP swings matchups. No reason found to move off 3/3. **Locked at 3/3 for now (designer 2026-11-04);** Recorded in Decision 140 and design doc Section 7 (item 8 done).
3. **Done 2026-11-04 (Decision 141):** two-sided enchantments built per `docs/enchantments_proposal.md`: `sigil_side: def | atk` on the hero entry
   (`E_SIGIL_SIDE_MISSING`, `W_SIGIL_SIDE_UNUSED`), `four_piece_def` / `four_piece_atk` in `gods.yaml`, effects `ignore_defense`, `damage_bonus`, `crit_damage`.
   2-pieces follow the proposal table, not the old `gods.yaml` (Full Moon, Plate, Gift, Breeze changed). Editor side picker clicked through.
   First sim (city4v4, all 4 heroes of one side on one god, gear slots filled, 300 runs; baseline 75.3% challenger win). Challenger win with it on the defender:
   Full Moon ATK 6, Full Moon DEF 8, Gift DEF 9, Breeze ATK 9, Breeze DEF 11, Plate ATK 20, Rush ATK 24, Mirror ATK 29, Rush DEF 33, Mirror DEF 45, Plate DEF 46,
   Gift ATK 54, Meteor ATK 63, Meteor DEF 71. One matchup only, so a ranking hint, not a verdict: Full Moon looks strongest, Meteor weakest.
   Meteor DEF cuts the whole crit hit by its percent, so a crit can land below a normal hit: as planned (designer 2026-11-04). **Open call:** battle `sigil_side` picks are placeholders.
   `self_killed_enemy` works only as a top-level condition.
3a. **Side check 2026-11-04 (300 runs, swap test, after gear, HP% timeout and blessings):** challenger win / same battle with sides swapped: sample 100 / 0,
   full4v4 93 / 7, city4v4 35 / 69, city4v4-edit 98 / 8; draft_city 0 (not swapped). The winner follows the team, not the side: no defender penalty in the engine.
3b. **Done 2026-11-04: balance series.** `npx tsx tools/balance-series.ts [--runs=N] [--seed=S] [--only=T0,T3]` (about 3 minutes; T0-T5, each changes one thing). `city4v4`, `city4v4-edit`
   and `draft_city` now use one kit per class on both sides (table `KIT` in the script), 16 sigils a side in the two city files. The gear changed the `draft_city` fallback ban (Aquatic, was Cavalry). Results, gear on:
   - **Real seat bias found: reaction order.** Bus handlers run in registration order, challenger units first, and the design doc sets no cross-side order. T1 side effect (1000 runs, stable over seeds): city4v4 +7, city4v4-edit +20 for the
     challenger. Log diff of both seats on the same seeds: the first divergence is always Holy's Quick Heal against an enemy Pursuit / Follow-Up on the same hit. Flipping the order gives -7 / -20; any seat-neutral rule gives 0. This corrects 3a ("no side bias").
   - Mirrors (T0) sit off 50% for two decided reasons, not bugs: first move on every tie (Decision 64: 59-63% challenger; +1 SKL on the defender flips it to 35-40%), and exact HP ties at timeout go to the defender (29-34% of runs for healer teams; without them the split is even). Real matchups rarely tie.
   - Accessories (T2): the old `city4v4` had accessories on 2 defender heroes and 1 challenger hero, so filling closed a gear gap: challenger only +28, defender only -10, both +14. Archer alone +19 (death 79% to 57%). Old 35% vs 75% used a different fill, not reproduced exactly.
   - Sigils (T3, 4-piece on all 4 heroes vs none, seats averaged): every set wins, Meteor barely (56-58), the rest 78-95. Gift DEF top (95). Team A's mirror column saturates (it times out, so any edge wins); Team B's column is the better read: Gift DEF 90, Breeze DEF 86, Breeze ATK and Mirror ATK 84, Full Moon 73-77. Full Moon is not the strongest as the item 3 hint said.
   - Team comp (T4) outweighs side: 3-backline 78% overall, no-healer 57, A 52, B 40, melee 23.
   - Defender advantages (T5, `draft_city`, one scripted draft): as is 54% challenger; terrain (55 without) and challenger edits (53 without) are inside the margin. No draft: 4% challenger, but that also changes the line-ups. Swapped rosters 45. So the draft swings it far more than anything else, and with these picks it favours the challenger. Anchor not isolated.
   T1 and T4 still include the reaction-order bias; rerun after 3c. `sample` / `full4v4` stay lopsided (100 / 99% for the Leon team from both seats).
3c. **Done 2026-11-04 (Decision 142):** when one event triggers reactions on both sides, the attacked side resolves first (`EventBus.emit`, `attackedSide` in `src/engine/events.ts`; phase_start has no attacked side, order unchanged).
   `test/engine.seats.test.ts`: city4v4 with sides exchanged gives the same log, labels swapped (one battle, 4 seeds; on_death / after_heal order not directly covered). Series rerun: T1 side effect 0.3 / -0.3 (was 10 / 19). The healer team gains: A's win average over both seats city4v4 74 (was 69), city4v4-edit 78.5 (was 69).
   T4 overall now: 3-backline 74, no-healer 60, A 52, B 39, melee 24. Remaining seat rules are the decided ties only (Decisions 64, 139). The numbers in 3b for T1, T4 predate this.
4. **Done:** `node_modules` is untracked (commit 55e141c); nothing left here.
5. **4.3 balance pass, in progress.** **Done 2026-11-04 (Decision 150):** T6 in `tools/balance-series.ts` (`--only=T6`, about 8 minutes) measures stat and PP value on real matchups (city4v4 A vs B, 3-backline vs no-healer; 8 cells, mean noise about 1.2 points). Mirrors don't work for this: exact HP ties flip about 17 points on any edge. Weights set from it, leans re-tuned to score 0 (no battle uses non-human heroes, so sims are unaffected), item effects and PP priced. ATK 1.0 was confirmed, so gear dominating cost is real, not a weight error.
   **SPD diagnosed 2026-11-04, no bug:** SPD is a step function, as Section 6 implies (heroes get no extra actions, so it only changes order). T6 steps, mean / spread over 8 cells: +1 1.4, +2 -3.6, +5 -3.9, +10 3.3 (-19 to +26), +20 12.6 (+2 to +28), +50 16.9 (+7 to +30). Small boosts flip only a few pairs and either way; identical results at +10 and +20 on city4v4 show nothing changes between crossings. Once the team clearly moves first it is always good, then it levels off. Why one given flip hurts was not traced. So no per-point weight fits: in the useful range +20 equals about ATK +14, about 0.7 per point at ATK 1.0 against the current 1.2. **Open call:** lower SPD to about 0.7 (re-tunes the leans again) or keep 1.2. SKL +5 reads -2.4, +10 reads 3.4, not followed up. Two matchups on one setup only; +1 Active is 26 ATK points pooled but cells run -10 to +50 points, so PP weights are rough.
   **Left in item 5:** skill pricing (flat `skill_price`, so skills are still unpriced by power), Jasmine's `cost_adjustment`, caps, `stat_ceiling`, roll constants, GUARD dual role (T6: GUARD +10 = 9 points, as much as ATK +10), leader focus. Original notes: cost weights (`rules.cost`, `effect_price` [DEFAULT]), Jasmine's aura `cost_adjustment`,
   roll constants, GUARD dual role, leader focus (back-row leaders now allowed), The draft
   is identical every run (picks don't depend on the seed).
   Gear now dominates hero cost (Decision 135): axe + heavy armor + shield + bracelet prices ~333, about 70-80% of a bare
   hero's ~400-500, because ATK weighs 1.0 per point; recalibrate the cost weights before any cost caps are set.
   **Cost ignores skill power (found 2026-11-04 scoping item 15; the item half is fixed by Decision 150):** every skill costs the flat
   `skill_price`, so computed cost can't reflect real power; cost-based balance conclusions inherit this. `effectPrice` (blessings) could be reused. `stat_ceiling` and `rules.cost.caps` are still null.
6. **Editor follow-ups:** (done 2026-11-04: challenger between-phase `edits` and defender `ban_sheet` are editable,
   `editor/src/BattleExtras.tsx`; compound ban filters stay read-only, a new rule defaults to the first ban-context leaf) roster-form "new battle"
   template; skill / equipment / character editors (shelved with item 15). Equipment flat stat lines were not rescaled by
   the rebalance (they are now relatively small).
7. **Batch sim nits (low):** two files with the same basename share seeds and header; a draft the validator missed throws a
   stack trace.

**Designer requests 2026-11-04 (in this order).** Next: item 22 (game animations, reroll, UI rating loop), then item 20 cost scenario tests, then the rest of item 5. Waiting on the designer: the meta loop design for item 16.

8. **Done 2026-11-04:** PP 3/3 recorded as locked for now in Decision 140 and the design doc.
9. **Done 2026-11-04:** every `draft_city` hero has sigils, 24 a side (4-piece or 2+2, same pattern as `city4v4`). Draft picks unchanged; 100 runs: 64% challenger, 6% timeouts. Picks and `sigil_side` are placeholders.
10. **Done 2026-11-04 (Decision 143):** the hit roll comes first; `before_hit` reactions (Quick Guard, Hegemony, cover) fire only on a landed hit, so a defender spends no Passive PP on a miss. The attacker's Active PP is still spent on a miss (designer). A miss leaves only `dodge`, which still counts as targeted (Gift DEF). Hegemony's strip no longer changes that hit's HIT chance. A covered hit keeps the original target's hit roll, so the covering unit gets no evade (accepted by the designer, item 18).
11. **Done 2026-11-04 (Decision 144):** `counts_as_guard` on `reduce_damage` (Quick Guard only). A hit that ignores guard skips it; Quick Guard still triggers, spends PP and logs `damage_reduction`, with no line saying it was bypassed. Plate and Sidestep still apply. Assault already ignores guard in content, so it now beats Quick Guard. Blessing `ignore_guard` shares the tested path, no test of its own.
11a. **Done 2026-11-04: series rerun after items 9-11** (default runs). Side effect still 0 in T1. The healer team fell: A's win average city4v4 44 (was 74), city4v4-edit 67 (was 78.5). T4 overall: 3-backline 69, B 57.5, no-healer 55, A 44.5, melee 24 (was 74 / 39 / 60 / 52 / 24). T3 mean: Gift DEF 91 top, Meteor 53-55 last. T5 as is 35% challenger (was 54); no terrain 38, no edits 33, swapped rosters 46, no draft 4. T1, T4 and T5 run without sigils, so items 10-11 caused these shifts, not item 9; which of the two was not isolated. The numbers in 3b / 3c predate this.
12. **Done 2026-11-04 (Decision 145, revises 136):** effective Main = `tactic.main ?? skill.targeting.default_main`; a player Main replaces the default, and `main: null` on a sheet means use the default. `default_main` may be a selector. No effective Main: an active tactic is skipped ("no condition", `W_TACTIC_NO_CONDITION`); passives are exempt and keep `default_activation`. New `always` leaf. All 24 active skills have a neutral default (`nearest`, `lowest` hp_percent for single-ally heals, `always` for self / row / all), so sim targets and outcomes did not change. A default selector in Main orders before a player Sub selector. Editor shows it in the Main slot (clicked through); `nearest` now has a preset.
13. **Done 2026-11-04:** banned heroes show greyed at 50% opacity with a "Banned" label on the formation board (`banned` on the breakdown result from `resolveDraft`, also in the hosted build). Checked in the browser on `draft_city`. Not covered: the Units page still lists them unmarked, and old labels linger for under half a second after a battle switch.
14. **Done 2026-11-04 (Decision 147):** `docs/pp_gear_proposal.md` built: equip_028-032 and a tank-only Dragon Scale. New `stacks` flag on `modify_stat` (lines add, exception to 9.1); gear HP% now changes Max HP; PP floors at 0. No battle uses these items yet, so nothing is simmed. PP is priced (Decision 150). 3 and 4 PP skills are planned.
15. **Shelved 2026-11-04 (designer):** creation system for heroes, skills and gear, nothing built. There is no game or audience yet, cost and caps can't limit created content (item 5), and items 14 and 18 may change the shapes. Community skills and gear aren't wanted for now: players of this genre build from a balanced set, and a shared pool is what makes rosters and bans readable. Player-made heroes stay a game feature for later (Decision 105: generic heroes are their base), Etrian-style choices from tuned lists, with no community tier; open question in design doc Section 18. If community content ever comes back: `pp_modifiers` on gear has no tier check, and the real content fails community tier (11 errors), so created entries would need checking apart from official ones.
16. **Start the actual game (answered 2026-11-04):** Vite + React for now, to be ported to Godot later, so keep game logic out of React components. First playable slice was going to be a tower run; item 21 (tutorial slice) came first. **Blocked on design:** the tower needs the meta loop (Step 6), so that design comes first. Design doc Section 18 has the open questions.
17. **Done 2026-11-04 (Decision 146):** leaves `soldiers_alive` and `soldiers_percent` (false on a hero), selector metric `soldiers_alive` (heroes sort after every squad, lowest and highest), a "Soldiers" preset category. `hp_percent`, `class_is` and `unit_kind` already worked on squads. A player slot holds one leaf, so "cavalry squads only" can't be written; class presets match heroes too.
18. **Done 2026-11-04 (Decision 148):** `docs/skills_heroes_races_proposal.md` built: 12 skills (skl_022-033), 6 heroes (char_015-020), races and sub-races (`rules.races`, `rules.sub_races`, `src/race.ts`), 6 skills re-gated to heroes, leaf `sub_race_is`, effects `self_hp_cost` and `remove_debuffs` (respects `removable_by_dispel`), `bonus_if_target_full_hp_percent`, `cover` fields `same_row` / `damage_type`. No battle uses the new heroes or skills, so nothing is simmed; sim logs unchanged.
   **Done 2026-11-04 (Decision 149):** Unbroken is once per battle: a save by a status from a pre_battle passive records the skill in `Unit.spentSaves` (carried by `beginPhase`), and the passive then stops firing and spends no PP (`passive_blocked`). No schema field; the rule follows from the trigger. **Open calls:** a stripped or unused grace spends nothing, so Unbroken fires and pays PP again next phase [DEFAULT]; with Last Chance also on the hero, the Unbroken grace saves first and is the one spent. **Known limit:** a pre_battle passive from another hero refreshing the same grace would move the spent record to that hero; none exists (Unbroken is self only). Squad save path and a stripped grace have no test of their own. **Open call:** First Cut, Shieldbreaker and Blood Price are melee, even on the back-row archer Sylwen. **Known gap:** `editor/src/Units.tsx:140` shows authored `base_stats`, without race lean.
19. **Done 2026-11-04:** `docs/reference_skills.md`: 21 mechanic families with fit ratings, plus indexes for Etrian Odyssey X, Unicorn Overlord actives, Langrisser Mobile (9 pages) and EON weapon skills. Indexes are keyword-tagged, so some tags are wrong. Unicorn passive, brave and leader skills not collected. DeepSeek use was approved for this item only.
20. **Queued 2026-11-04 (designer): cost scenario tests, for next session.** Many small scenarios that each target one specific thing about cost, to balance hero stats. Suggested shape, not yet agreed: build them as scenarios in `tools/` that print a report, not `npm test` assertions on win rates (those break on every balance change); keep `npm test` to rules that always hold (more stat never costs less, cost_override wins). Core check: two builds at equal cost should win about 50%, and cost should predict wins across all 20 heroes. That prediction was never checked for the Decision 150 weights. Isolated scenarios overstate a stat (MDEF against all mages), so results need a stated mix of matchups. Use real matchups, not mirrors, and steps large enough to cross turn order for SPD.
21. **Done 2026-11-04 (Decision 151): tutorial vertical slice, the first main-game client.** `game/` (`npm run game`, port 5174): title, hero pool reveal, prep board, animated battle replay, result, guided walkthrough on battle 1. Three battles vs 2 / 3 / 4 enemies; the rolled pool grows 4 / 5 / 6 and you field up to `rules.draft.fielded` (designer: the heroes are a pool to select from). Logic is pure in `game/logic/`, for the Godot port. No engine or validator change. Balance, `npx tsx tools/tutorial-balance.ts`, auto-fielded 4, default tactics: 100 / 88 / 78% wins (targets 95+ / 80-90 / 65-80), stage 3 near the top of its band.
   **Not checked in the browser:** the phase-change caption on screen, keyboard-only play, `game/dist` when served, the UI review fixes (stale picker, tutorial hero, drag flag). **Open calls:** title is a placeholder (`GAME_TITLE`, now "Lightbearer's Oath"); how many heroes to field (4 assumed); pool stays between battles, recruits join benched; no between-phase edits, draft, sigils, saves or audio; stage 3 needed weakened enemies (no accessories, no healer) to reach its band, about 45% at full strength.
22. **Queued 2026-11-04 (designer), do this next, in `game/`:**
   - **Action animations: done 2026-11-04.** `motionOf` in `game/logic/replay.ts` picks melee / shot / cast / support / squad / stun per beat; the skill banner became a tag over the actor. Stun animation and reduced motion not seen in the browser.
   - **Reroll: done 2026-11-04.** Free and unlimited, starting pool only (`rerollStart`). Open call: limit rerolls, or allow them on recruits? Not browser-tested in tutorial mode.
   - **Art and music: done 2026-11-04 (designer assets).** `game/art/` (committed), `game/music/` (.ogg, committed), scene table in `game/src/scenes.ts`, `game/src/music.tsx`. The city scene uses `city2.ogg`; `city.ogg` and `forest-calm.ogg` are not in the repo. Stages do not set a `battlefield` terrain, so art is cosmetic: open call whether Saltmarsh should really be Swamp terrain (changes balance).
   - **UI rating loop (5 of 5 passes done, stopped for designer review; scores and what 10s need in `docs/ui_rating.md`):** rate the UI 1-10 on a set of categories a strategy RPG player would use (fans of Final Fantasy Tactics, Langrisser Mobile, Unicorn Overlord, Etrian Odyssey), e.g. readability of the board, tactics setup, battle feedback, information access, menu flow, art direction, onboarding. Iterate until every category is 10/10, but **stop after 5 passes for the designer's review**, even if not at 10. Judge from real screenshots at 1280x720 (the browser pane needs `resize_window`), and keep the score table per pass so the designer can see what changed. Rate honestly: don't raise a score without a visible change.

   **Item 22 result:** all passes committed, final scores 8-9, no 10s; `docs/ui_rating.md` lists what each category still needs. **Not checked:** music by ear (only load and switch), the lake victory and defeat screens, the battle action card with the final tile glow, reduced motion, the narrator height fix on screen. **Open calls:** limit rerolls or allow them on recruits; real stage terrain (changes balance); `city2` or `city` on Ember Gate (`city2` used; `city.ogg` and `forest-calm.ogg` are not in the repo). Dev server: restart `npm run game` if the page goes blank (it can cache the old `music.ts` path).
23. **Done 2026-11-04:** game deployed at `https://knoxdaviber.github.io/LO-Engine/game/`, editor unchanged at the root, one Pages artifact (`pages.yml`). Mute key is now `lo-muted`. Local build served from a subfolder: full 3-battle run with Skip, all stage art and music requested, no console errors, mute survives a reload. **Not checked:** tutorial path, defeat screen, music by ear. **Open calls:** final URL (`/game/` assumed; swapping game and editor is a designer call), editor link to the game skipped (plan step 4).
24. **Done 2026-11-04:** named heroes only in the player pool (`rollOrder`), generics are enemy-only. Faces in the turn-order circles. Side effect: tutorial win rates rose to 98-100% on all three stages. **Open call:** retune the tutorial.
25. **Done 2026-11-04:** Rogue Mode (title button, `mode` on RunState, `ROGUE_STAGES`, `tools/rogue-balance.ts`). 20 waves; enemy heroes 2, then 3 from wave 3, 4 from wave 5, generics only; start with 2; dead heroes leave the run, win or lose; a loss retries the wave with survivors (assumed, not stated by the designer); nobody left ends the run. Balance, auto line-up: about 40% of runs clear, wave 1 win 80%, late waves 87-96%. Gear tops out at wave 5, so difficulty is flat after that. **Open calls:** a real late-game ramp; a loss retrying rather than ending the run.
26. **Done 2026-11-04:** battle replay: `covers` on a beat (coverer dashes in front of the ally, numbers follow), reactions that deal damage become `followup` beats.
27. **Done 2026-11-04:** animated backdrops (slow pan, haze, per-scene particles in `.backdrop.scene-*`). Reduced motion not seen.
28. **Done 2026-11-04:** rogue recruit is a choice of two (`offers`, `pickRecruit`); passed-over heroes can return. Bench-only survivors are auto-fielded.
29. **Done 2026-11-04:** phase banner moved off the top tile row (it made the 2x3 grid look 2x2). No class duplicates on the player's side, already guaranteed: each named hero has a unique class and owned or fallen heroes are never offered. Enemies are unrestricted (designer). UI pass 6 in `docs/ui_rating.md`.
30. **Done 2026-11-04:** placeholder battle sounds, synthesized in `game/src/sfx.ts` (no audio files); `beatCues` in `game/logic/replay.ts` maps each beat to cues. The mute button covers them. Checked in the browser by counting audio nodes: they fire, stop on pause and mute, Skip plays only the end sting. **Not checked:** how they sound by ear. A cue already playing runs out its tail (under 1s) after Mute. UI clicks have no sound.
   **Sigils:** not in the game client. The engine and `content/gods.yaml` (7 gods) support them, but no hero gets any and no screen shows them. **Open call:** add them, for example as rogue rewards. Deployed 2026-11-04 (commit 95e90ba), first 5 rogue waves checked on the live site.

**Open from the 2026-11-04 critique (designer to decide):** project CLAUDE.md ("the supervisor never writes code") conflicts with the global "make small changes directly"; should the supervisor edit small code itself? This file is 27KB and loads every session: trim it (the finished editor brief at the end can go)? Suggested: a single playable battle, which needs no meta loop, to test the tactics board before more balance work.

Blocked / later: Step 6 tower service needs the meta loop designed first (roadmap Step 6). Main game client: now queued as item 16 (Decision 137: the editor is a separate tool). Soldier skill points (Decision 138: 20 per soldier type, trees with prerequisites, 5 levels per category, season-end
reallocation, slight cost) are specced, not scheduled; open questions in design doc Section 18.

## Brief: editor visual overhaul (done via the designer zip, applied 2026-11-03; kept for reference)

Goal: the editor should be far more visual and helpful. Keep the existing API (`editor/api.ts`) and engine untouched unless
a new read-only endpoint is genuinely needed; the server stays authoritative.

1. **Formation board.** Show each side as a grid of `rules.board` rows x columns with a placeholder card per unit (hero
   portraits can be initials/class icons for now), placed where the engine would put them (`src/formation.ts`: preferred
   row, leader forced front, overflow), including the leader's squad at its `squad_row`. Changing a row in the roster panel
   moves the card; ideally drag a card between rows.
2. **Unit overview page.** A separate page (client-side route, no reload, no loading spinner: use data already fetched from
   `/api/content` and `/api/breakdown`, cache it) with a clean breakdown of every unit on both teams: final stats with the
   Section 9.1 breakdown, equipment (and sigils, active blessings), skills (PP, shape, effects), squad and soldier skills,
   aura, terrain modifiers.
3. **Pinning.** Any page or panel can be pinned; pinned items show in a strip at the top of every page until unpinned. The
   strip is adjustable (resizable height, reorder, collapse). Remember pins per viewer (localStorage, wrapped in try/catch).
4. **Hover explanations.** Every effect, skill, equipment item, status, blessing, aura and condition leaf shows what it does
   on hover (tooltip in plain words generated from the structured data: e.g. "Deals 1.2x ATK physical damage to one enemy;
   +25% vs cavalry"). One shared formatter, used everywhere, so wording stays consistent.
5. **Placeholder class sprites (art done).** Art direction: cute, slightly pixelated anime chibis in the spirit of classic
   tactics RPGs. All 10 sheets exist at `editor/public/sprites/<class>.png`: a horizontal strip of 4 idle frames, each cell
   256x256 (sheet 1024x256), transparent, facing right, feet anchored at the bottom centre. Rebuilt from the originals in
   `art/raw/` (gitignored) with `npm run sprites` (`tools/sprites.mjs` + `tools/clean-art.mjs`); `art/preview.html` shows
   them animated. Known source quirks: flyer bobs slightly (no shadow), holy's glow flickers, lancer reads a bit small. Animate with CSS `steps(4)` on the formation board and unit cards; mirror for the
   defender side; fall back to initials when a sheet is missing.
6. **Modernise the GUI.** Clean, elegant, consistent: design tokens (colors, spacing, type) in CSS variables, light/dark
   theme, side navigation between Battle / Units / Log pages, readable log (colour by side, collapsible per action),
   keyboard friendly. Plain CSS (no UI framework) unless the designer agrees otherwise; keep it a solid prototype.

Done when: a player can see both formations at a glance, open the unit overview instantly, pin it, and hover anything to
learn what it does. Tests: formatter unit tests (node:test) over real content; existing API tests stay green.

### Files to give an AI model for this task

Must-have (editor itself):
- `editor/src/main.tsx`, `editor/src/Roster.tsx`, `editor/src/Tactics.tsx`, `editor/src/Panels.tsx`,
  `editor/src/model.ts`, `editor/src/client.ts`, `editor/src/style.css`, `editor/src/env.d.ts`
- `editor/api.ts`, `editor/apiTypes.ts`, `editor/vite.config.ts`, `editor/index.html`, `editor/tsconfig.json`
- `test/editor.api.test.ts`

Needed for formation, breakdown and hover text:
- `src/formation.ts` (row/column placement)
- `src/schema/enums.ts`, `src/schema/effect.ts`, `src/schema/content.ts`, `src/schema/roster.ts`, `src/schema/battle.ts`
  (shapes of everything a tooltip describes)
- `src/registry/conditions.ts` (leaf descriptions for condition tooltips)
- `src/engine/stats.ts` (`statBreakdown`, the 9.1 breakdown and `parts`)
- `src/engine/phase.ts` (`preBattleState`)

Context:
- `CLAUDE.md`, this file (`docs/handover.md`), `package.json`
- `content/rules.yaml` (board size, limits), plus `content/characters.yaml`, `content/skills.yaml`,
  `content/equipment.yaml`, `content/gods.yaml`, `content/statuses.yaml` as sample data for the tooltip formatter
- `content/battles/draft_city.yaml` (richest example battle: draft, sigils, terrain)
- Optional: `docs/design_doc_v2.md` Sections 4 (tactic sheets), 9.1 (stacking), 10 (formation), 12 (editor), 13 (combat log)

If the model works directly in the repo (e.g. Claude Code), just point it at this file and CLAUDE.md; it can read the rest.
