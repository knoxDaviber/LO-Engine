# Session handover (updated 2026-11-04)

Read this first, then `CLAUDE.md` (working rules, commands, architecture). Design intent is in `docs/design_doc_v2.md`,
progress in `docs/roadmap.md`.

## Where things stand

- **Git:** work is committed per queue item (see `git log`); the supervisor commits each reviewed, green item. Nothing is pushed by Claude.
- **Checks at handover:** typecheck clean (root and editor), 379/379 tests pass, `npm run validate` 0 errors and 0 warnings,
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
   nearest / farthest / random selectors (not in the designer list). **Known limit:** at 768-1099px the boards stack and the
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
   **Designer calls:** (a) skill multipliers (planned) or cap/scale summed squad DEF against heroes; (b) whether the
   timeout tiebreak should stay defender-wins (Decision 115) or use HP%; (c) the Monster team's focus fire + back-row
   assassin may be fine as counterplay, but the generic challenger kit has no answer to it.
2. **Default PP** (designer: decide after the formula), then sweep PP 2-5 under the chosen formula.
3. **Two-sided blessings (designer notes, 2026-11-03).** Each god gets a DEF and an ATK enchantment; new 2-pieces:
   Mirror HP+20%, Full Moon DEF/MDEF+10%, Plate GUARD+10, Gift HP+20%, Breeze ATK/INT+10%, Meteor CRIT+10, Rush EVA+10.
   Given: Mirror DEF reflect 30% (single-target); Full Moon DEF: HP>80% DEF/MDEF+20%, ATK: HP>80% ATK/INT+20%; Plate DEF
   -10% damage taken; Gift DEF: when attacked, 50% chance to heal 30% max HP after the attack (once per enemy action);
   Breeze ATK: HP>80% SPD+20%; Meteor ATK: crit damage +30%; Rush ATK: ignore GUARD on single-target attacks. Blank in the
   short list (Mirror ATK, Plate ATK, Gift ATK, Breeze DEF, Meteor DEF, Rush DEF): the designer's long document proposes
   each (Mirror ATK: next attack +30% after being attacked; Plate ATK: +20% vs enemies with GUARD; Gift ATK: heal 20% on a
   kill; Breeze DEF: HP>80% EVA+20%; Meteor DEF: -30% crit damage taken; Rush DEF: counter for 50% ATK after a dodge);
   confirm before building. Soldier effects, AP/PP refunds and extra gods (Clock, Crystal, Ice, Tree of Life) are later.
   The sigil choice must record the side (schema change).
4. **Done:** `node_modules` is untracked (commit 55e141c); nothing left here.
5. **4.3 balance pass** after 1-2: cost weights (`rules.cost`, `effect_price` [DEFAULT]), Jasmine's aura `cost_adjustment`,
   roll constants, GUARD dual role, leader focus (back-row leaders now allowed), timeout tiebreak (Decision 115). The draft
   is identical every run (picks don't depend on the seed).
   Gear now dominates hero cost (Decision 135): axe + heavy armor + shield + bracelet prices ~333, about 70-80% of a bare
   hero's ~400-500, because ATK weighs 1.0 per point; recalibrate the cost weights before any cost caps are set.
6. **Editor follow-ups:** (done 2026-11-04: challenger between-phase `edits` and defender `ban_sheet` are editable,
   `editor/src/BattleExtras.tsx`; compound ban filters stay read-only, a new rule defaults to the first ban-context leaf) roster-form "new battle"
   template; skill / equipment / character editors (roadmap Step 5 order). Equipment flat stat lines were not rescaled by
   the rebalance (they are now relatively small).
7. **Batch sim nits (low):** two files with the same basename share seeds and header; a draft the validator missed throws a
   stack trace.

Blocked / later: Step 6 tower service needs the meta loop designed first (roadmap Step 6). Main game client (Decision 137:
the editor is a separate tool) and soldier skill points (Decision 138) are specced, not scheduled; open questions in design doc Section 18.

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
