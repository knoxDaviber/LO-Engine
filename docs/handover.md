# Session handover (2026-11-01)

Read this first, then `CLAUDE.md` (working rules, commands, architecture). Design intent is in `docs/design_doc_v2.md`,
progress in `docs/roadmap.md`.

## Where things stand

- **Last commit:** `7852bd2` (terrain). Everything below is **uncommitted** in the working tree. `git status` shows it all.
- **Checks at handover:** typecheck clean (root and editor), 303/303 tests pass, `npm run validate` 0 errors and 0 warnings,
  all four sims run (`sample`, `full4v4`, `city4v4`, `draft_city`) with no `not implemented` lines.
- **Node:** run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` first (Node 24). `npm install` works on this machine.

### Done this session (uncommitted)
| Roadmap | What | Notes |
|---|---|---|
| 3a | Passives, statuses, full condition library, cover, stun pushback 15 [DEFAULT] | Passives run only when enabled on the tactic sheet |
| 3b | Equipment effects | Equipment vs equipment never stacks |
| 3c | Devotion: `content/gods.yaml`, player-chosen sigils per gear slot, 7 blessings | Placeholder pantheon: the Seven Lucky Gods. Decision 125 |
| 3d | Flyer EVA x1.5 vs melee, Aquatic SPD +30% on water terrain (Swamp is water) | Decision 126 |
| 3e | Draft (6 to 4) and between-phase edits | Decision 124 |
| 4.2 | Batch simulator `npm run batch -- <files> [--runs=N] [--seed=S] [--json]` | `src/batch.ts`, `src/batchReport.ts`, `src/cliBattle.ts` |
| 5 (m1) | Local editor `npm run editor` -> http://127.0.0.1:5173 | Vite + React, Decision 127. Tactics board, roster, validation, stacking breakdown, run sim, save |

Designer decisions taken this session: Archer > Flyer and Holy > Monster are +50%; a god's own 2-piece and 4-piece **add**,
different gods follow strongest-wins (9.1 exception); blessings as written by the designer (Mirror, Full Moon, Plate, Gift,
Breeze, Meteor, Rush); Gift heals even on a miss; Rush overrides guaranteed guard; Mirror reflects 30% of HP actually lost,
including on the killing blow; editor = local web app, milestone 1 = tactics board + run sim.

## Todo queue (in order)

1. **Housekeeping before committing:** `node_modules` is tracked by git and now contains Vite/React. Add it to `.gitignore`,
   `git rm -r --cached node_modules`, and fix CLAUDE.md's Environment note ("no node_modules in the repo"). Then the user
   commits (commit only when asked).
2. **Editor visual overhaul (designer request, next big task).** See the brief below.
3. **4.3 balance pass**, from batch data (`npm run batch -- content/battles/*.yaml --runs=100`):
   - 3 of 4 matchups time out 100% (defender wins). Cause: ~2 Active PP per hero with 2-PP skills = few actions per phase,
     DEF high relative to ATK. Timeout tiebreak candidate is Decision 115.
   - Some squads never act (Infantry's Footmen in both City battles, Jasmine's squad in full4v4); Jasmine gets ~0.1
     actions/phase. Investigate: slow squad SPD vs phase ending on hero PP exhaustion, or a bug.
   - The draft is identical every run (human picks and rule-sheet bans don't depend on the seed), so banned rates are 0/100%.
   - Calibrate cost weights (`rules.cost`, incl. new `effect_price: 10` [DEFAULT] for non-stat blessing effects), Jasmine's
     aura `cost_adjustment`, roll constants, GUARD dual role, leader focus.
4. **Parked design items (designer to decide):**
   - "Flipped" vice sigils: each god gets an optional vice 4-piece; recommended a per-hero choice per god (not per sigil).
     Use vice faces to fill gaps (healing, AoE, PP, squads; HIT/SKL/GUARD/EVA unused) rather than mirror existing ones.
   - Distinct 2-pieces: currently only 4 unique 2-piece bonuses (HP+20% x2, ATK+10% x2, DEF+10% x2). Suggested: Mirror MDEF
     +10%, Breeze EVA +10, Rush HIT +10, Plate GUARD +10, Full Moon INT +10%.
5. **Editor follow-ups (smaller):** edit between-phase `edits` and the defender `ban_sheet` in the UI; roster-form "new
   battle" template; skill / equipment / character editors (roadmap Step 5 order).
6. **Batch sim nits (low):** two files with the same basename get the same seeds and header; a draft the validator missed
   throws a stack trace instead of a message.

Blocked / later: Step 6 tower service needs the meta loop designed first (roadmap Step 6).

## Brief: editor visual overhaul (todo 2)

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
