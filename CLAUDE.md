# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Detailed engine, battle-input and editor notes: docs/engine_notes.md. Running state and todo queue: docs/handover.md.

## What this is

Content schema, validator and a deterministic battle engine (Step 1 vertical slice) for a tactics auto-battler. Game content is YAML in `content/`; TypeScript (zod v4) defines the schema and a layered validator checks it. Design intent: `docs/design_doc_v2.md` (tags **[DECIDED]** / **[DEFAULT]** tunable / **[OPEN]**); authoring templates: `docs/templates_v2.md`. When docs and `src/schema/` disagree, **the schema wins**. `docs/conversion_report.md` tracks designer decisions applied and questions still open.

`editor/` is a separate tool (simulation, testing, character creator, import/export), not the main game (Decision 137). The main game is `game/`: all logic is pure TS in `game/logic/` (no React, no DOM, to port to Godot later), `game/src/` only renders.

## Commands

Full flags and descriptions: docs/engine_notes.md.

```bash
npm run validate [-- content --tier=community --strict --json --verbose]   # validate ./content (official tier default)
npm test                                           # node:test suite via tsx
node --import tsx --test --test-name-pattern="duplicate id" test/*.test.ts   # single test
npm run typecheck                                  # engine + editor (tsc -p editor)
npm run schema:export                              # regenerate schemas/*.schema.json from zod (never edit by hand)
npm run sim -- content/battles/sample.yaml [--json] [--pp-active=N] [--pp-passive=N] [--formula=ratio:150]   # run a battle, print log
npm run batch -- content/battles/*.yaml [--runs=100] [--seed=1] [--json] [--pp-active=..] [--pp-passive=..] [--formula=..]   # seeded balance report
npm run editor                                     # local editor, http://127.0.0.1:5173 (EDITOR_PORT=N for another port)
npm run editor:build                               # static editor into editor/dist (gitignored), deployed to GitHub Pages
npm run game                                       # main game client, http://127.0.0.1:5174 (GAME_PORT=N); npm run game:build into game/dist (gitignored); balance: npx tsx tools/tutorial-balance.ts, tools/rogue-balance.ts [--late]
```

CLI exit codes: 0 ok, 1 errors (or warnings with `--strict`), 2 load failure. No engine build step (`noEmit`, runs through `tsx`); only the hosted editor is built.

## Architecture

Validation pipeline (`src/validate/index.ts`), each layer only sees what the previous accepted:

1. **Load** (`src/load.ts`): fixed file set in `FILES` (`terrains.yaml`, `gods.yaml` optional) plus optional `content/rosters/*.yaml` (names starting `defender` validate as defenders: anchor + ban sheet required; others as challengers).
2. **Schema pass** (`validate/schemaPass.ts`): zod-parses each entry; failures are dropped, passes indexed into a `Pack` (`validate/pack.ts`, `byId` maps). If `rules.yaml` fails, later layers are skipped.
3. **Semantics** (`validate/semantics.ts` `checkPack`): duplicate ids, cross-references, per-type rules, tier checks. `validate/walk.ts` (`forEachEffect` / `forEachCondition`) enumerates every effect/condition tree with location and context; use it instead of hand-walking content.
4. **Rosters** (`validate/roster.ts`, with `cost.ts`, `eligibility.ts`, `tactics.ts`).

Issues go through a `Collector` (`src/types.ts`) with stable codes (`E_*` error, `W_*` warning, `I_*` info) and `file > id > path` locations; tests assert on codes. A zod refinement can emit a specific code by prefixing its message with `[E_CODE] ` (`reportZod` strips it).

**Registries** (`src/registry/`): `conditions.ts` `LEAF_REGISTRY` (one entry per condition leaf: param schema, contexts `tactic` / `authored` / `ban`, `communitySafe`; leaves referencing content also go in `LEAF_REFS`; hero-ID leaves are authored-only) and `effects.ts` `EFFECT_REGISTRY` (tier flag per effect type; a new type also needs its zod variant in `src/schema/effect.ts`; `OFFICIAL_ONLY_STATUS_FLAGS`).

**Tiers**: `official` vs `community`. Community packs may only use `communitySafe` leaves/effects/status flags (anything that revives, delays/denies actions, strips buffs, changes PP, or hits the whole field is official-only).

Enums: `src/schema/enums.ts`. Tunable numbers (stun pushback, roll clamps, cost weights, ...) belong in `content/rules.yaml`, not code. Cost is always computed, never authored. Base stats follow design doc 3.3 (Decision 131).

## Engine map

`src/engine/` runs a validated battle (`runBattle` in `phase.ts`); `src/formation.ts`, `src/draft.ts`, `src/edits.ts` are shared with the validator.
- `state.ts` builds units; `stats.ts` effective stats and statuses; `timeline.ts` scheduler; `conditions.ts` / `tactics.ts` conditions and `decideTactic`; `damage.ts` damage, heal, `runEffect`; `phase.ts` phase loop; `squad.ts` soldier squads; `events.ts` / `reactions.ts` event bus and reactions; `leader.ts` leader and succession; `prebattle.ts` pre-battle steps and auras; `passives.ts`; `equipment.ts`; `rng.ts`; `log.ts`. Also `src/devotion.ts`, `src/batch.ts` / `src/batchReport.ts`, `editor/` (Vite + React; `editor/core.ts` browser-safe API core, `editor/api.ts` local middleware).
- Per-action call order: `nextAction` -> (a `prevents_action` status: `executePrevented` instead) -> `decideTactic` -> spend PP -> resolve effects (on_hit / on_attack effects last) -> `completeAction` -> `rescheduleOnSpdChange` -> `scheduleNext` -> `Unit.actions++`.
- Determinism: every random roll goes through the phase rng (`phaseRng`, one stream per phase from `battle.seeds`), pre-battle rolls included. No `Date` or `Math.random` in the engine.
- Anything unsupported is logged as `not implemented: ...`, never silently dropped.
- Battle input: `content/battles/*.yaml` (`src/schema/battle.ts`, `src/validate/battle.ts`), fielded or roster form. Codes and edit rules: docs/engine_notes.md.

## Tests

`test/validate.test.ts` mutates a fresh copy of the real content: `fresh()` (structured clone of `content/`), mutate, then `codes(raw, tier)` returns error codes via `validateRaw`. `roster()` in `test/helpers.ts` builds a valid 6-hero roster. The first test asserts the real content has zero errors, so content edits must keep it valid.
Never hardcode to pass a test: read tunable values (PP, costs, caps) from content or rules, so a balance change doesn't break tests.

## Working guidelines

- Before changing anything, the main agent lists every file needed and reads them in one pass, then hands the edits to subagents, then runs the tests once.
- The agent the user talks to never writes code or builds anything itself. It is the supervisor, responsible and accountable for all work done by the subagents it spawns. Exception: it makes small edits itself (docs, handover, one-line content or rules values) without a subagent or review.
- Subagents run on Sonnet by default; use the strongest model only for design-heavy or engine-wide work, and Haiku for reviews.
- Treat all work as a todo queue. When the user proposes tweaks, changes or corrections, append them to the queue; don't break the queue to prioritize them. Exception: a correction to the task currently in progress is applied immediately, before moving on. Only stop when the queue is truly 100% clear.
- Mistakes aren't your fault; don't apologize. A mistake means a gap or issue in the instruction files. Describe which part of the instruction files caused it and suggest the fix. Be solution oriented.
- Balance conclusions assume heroes have weapons and gear equipped; never draw them from bare heroes.
- YAGNI: don't overengineer, and never expand scope without permission. Do suggest scope improvements when they make sense. All work must be justifiable. Judge where the project sits between "quick and dirty" and "production grade" and match the engineering effort to that.
- After making changes, the supervisor (not the implementing subagent) spins up a reviewer subagent on a cheap model with minimal context to look over them with fresh eyes for possible problems. Implementing subagents are told not to spawn subagents or commit.
- Commits: once a queue item is implemented, reviewed, its review findings fixed and all checks are green (typecheck, test, validate, sims), the supervisor commits it on its own with a short message. Never push, never commit a red tree, never mix two queue items in one commit.
- Session continuity: `docs/handover.md` is the running state (done, todo queue, open designer calls). Update it at the end of every queue item so a fresh session can start from it.

## Environment note

Node 24 via nvm (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`); `npm install` works. `node_modules` is gitignored (untracked since commit 55e141c; after merging an older branch, run `npm ci` if packages vanish). The editor needs a free port (`EDITOR_PORT`).
