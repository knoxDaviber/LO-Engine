# Session handover (updated 2026-11-03)

Read this first, then `CLAUDE.md` (working rules, commands, architecture). Design intent is in `docs/design_doc_v2.md`,
progress in `docs/roadmap.md`.

## Where things stand

- **Last commit:** `7852bd2` (terrain). Everything below is **uncommitted** in the working tree. `git status` shows it all.
- **Checks at handover:** typecheck clean (root and editor), 356/356 tests pass, `npm run validate` 0 errors and 0 warnings,
  all five sims in `content/battles/` run with no `not implemented` lines.
- **Node:** run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` first (Node 24). `npm install` works on this machine.
- **Editor:** `npm run editor` (port 5173, or `EDITOR_PORT=5180 npm run editor` when another local project holds 5173).

### Done (uncommitted)
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
| Section 8 | Damage formula selectable in `rules.yaml` (`subtract` default, `ratio`, `scaled_subtract`) |
| 133 | Equipment type standard: one type tag per item, flat stats from `rules.equipment_bases` (design doc 12.1); items keep only effects/PP. Open calls: Speed Ring is now an INT ring (rename, re-type to boots, or add a SPD effect?); Prayer's Guardian has no effect left; Chainmail stays light armour |

## Todo queue (in order)

1. **Pick the damage model (designer).** After the rebalance every battle times out under every formula and PP 2-4.
   Formula comparison (full kits, engine stats): when power is well above defense all formulas agree within ~15%; in close
   matchups `subtract` gives 1-7 damage (hundreds of hits), `ratio:100` 15-35 hits, `scaled_subtract` in between. Even
   `ratio` kills too slowly for ~6-12 skill uses per battle, so damage per hit must also rise (skill multipliers and/or HP
   factors). Battle files are lightly kitted (`sample`, `full4v4` bare; City battles 2-3 sigil wearers per side): consider
   fully kitted test battles before judging. Rerun:
   `npm run batch -- content/battles/*.yaml --runs=100 --formula=subtract,ratio:100,ratio:150,scaled_subtract:20,scaled_subtract:35 --pp-active=2,3,4`.
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
4. **Housekeeping before committing:** `node_modules` is still tracked by git even though `.gitignore` lists it:
   `git rm -r --cached node_modules`; fix CLAUDE.md's Environment note. `.claude/launch.json` has local editor entries.
   Then the user commits (commit only when asked).
5. **4.3 balance pass** after 1-2: cost weights (`rules.cost`, `effect_price` [DEFAULT]), Jasmine's aura `cost_adjustment`,
   roll constants, GUARD dual role, leader focus (back-row leaders now allowed), timeout tiebreak (Decision 115). The draft
   is identical every run (picks don't depend on the seed).
6. **Editor follow-ups:** edit between-phase `edits` and the defender `ban_sheet` in the UI; roster-form "new battle"
   template; skill / equipment / character editors (roadmap Step 5 order). Equipment flat stat lines were not rescaled by
   the rebalance (they are now relatively small).
7. **Batch sim nits (low):** two files with the same basename share seeds and header; a draft the validator missed throws a
   stack trace.

Blocked / later: Step 6 tower service needs the meta loop designed first (roadmap Step 6).

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
