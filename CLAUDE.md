# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Content schema, validator and a deterministic battle engine (Step 1 vertical slice) for a tactics auto-battler. Game content lives as YAML in `content/`; TypeScript (zod v4) defines the schema and a layered validator checks it. Design intent is in `docs/design_doc_v2.md` (tags: **[DECIDED]** / **[DEFAULT]** tunable / **[OPEN]**) and authoring templates in `docs/templates_v2.md`. When docs and `src/schema/` disagree, **the schema wins**. `docs/conversion_report.md` tracks designer decisions applied and questions still open.

## Commands

```bash
npm run validate                                   # validate ./content at official tier
npm run validate -- content --tier=community --strict   # community tier; --strict fails on warnings
npm run validate -- content --json                 # machine-readable report (--verbose shows info notes)
npm test                                           # node:test suite via tsx
node --import tsx --test --test-name-pattern="duplicate id" test/*.test.ts   # single test
npm run typecheck
npm run schema:export                              # regenerate schemas/*.schema.json from zod
npm run sim -- content/battles/sample.yaml [--json]  # validate a battle input, run up to 3 phases, print the log (or JSON events)
```

CLI exit codes: 0 ok, 1 errors (or warnings with `--strict`), 2 load failure (missing file / bad YAML). There is no build step (`noEmit`; everything runs through `tsx`). `schemas/` is generated output — regenerate with `schema:export` after schema changes rather than editing it.

## Architecture

Validation pipeline (`src/validate/index.ts`), each layer only sees what the previous accepted:

1. **Load** (`src/load.ts`): reads the fixed file set in `FILES` plus optional `content/rosters/*.yaml`. Roster files whose name starts with `defender` are validated as defenders (anchor + ban sheet required); others as challengers.
2. **Schema pass** (`validate/schemaPass.ts`): zod-parses each entry; failing entries are dropped, passing ones are indexed into a `Pack` (`validate/pack.ts`, with `byId` maps). If `rules.yaml` fails, later layers are skipped.
3. **Semantics** (`validate/semantics.ts` `checkPack`): duplicate ids across all collections, cross-references, per-type rules, and tier checks. `validate/walk.ts` (`forEachEffect` / `forEachCondition`) enumerates every effect and condition tree in the pack with its location and context — use it rather than hand-walking content.
4. **Rosters** (`validate/roster.ts`, with `cost.ts`, `eligibility.ts`, `tactics.ts`).

Issues go through a `Collector` (`src/types.ts`) with stable codes (`E_*` error, `W_*` warning, `I_*` info) and `file > id > path` locations; tests assert on these codes. Zod refinements can emit a specific code by prefixing the message with `[E_CODE] ` — `reportZod` strips it and uses that code instead of `E_SCHEMA`.

**Registries** (`src/registry/`) are the extension points:
- `conditions.ts` `LEAF_REGISTRY`: adding a condition leaf is one entry (param schema, allowed contexts `tactic` / `authored` / `ban`, `communitySafe`). Leaves referencing other content also go in `LEAF_REFS`. Hero-ID leaves are authored-only, never allowed in player tactic sheets or ban sheets.
- `effects.ts` `EFFECT_REGISTRY`: tier flag per effect type. A new effect type also needs its zod variant added to the discriminated union in `src/schema/effect.ts`. `OFFICIAL_ONLY_STATUS_FLAGS` lists status flags barred from community packs.

**Tiers**: `official` vs `community`. Community packs may only use `communitySafe` leaves/effects/status flags (design rule: anything that revives, delays/denies actions, strips buffs, changes PP, or hits the whole field is official-only).

Enums are in `src/schema/enums.ts`; tunable numeric constants (stun pushback, roll clamps, cost weights, etc.) belong in `content/rules.yaml`, not code. Cost is always computed, never authored.

## Engine

`src/engine/` runs a validated battle (`runBattle` in `phase.ts`); `src/formation.ts` holds row/column placement shared with the validator.
- `state.ts` builds units (stats, PP, rows, formation order) and throws on a full row; `stats.ts` effective stats (Section 9.1 stacking) plus `applyStatus` / `completeAction` (status ticks); `timeline.ts` the scheduler and tie order; `conditions.ts` and `tactics.ts` the condition evaluator and `decideTactic`; `damage.ts` damage, heal and effect execution; `phase.ts` the phase loop, end conditions and `runBattle`; `rng.ts` seeded streams; `log.ts` typed events and the text renderer.
- Per-action call order: `nextAction` -> `decideTactic` -> spend PP -> resolve effects -> `completeAction` -> `rescheduleOnSpdChange` -> `scheduleNext`.
- Determinism: every random roll goes through the phase rng (`phaseRng`, one stream per phase from `battle.seeds`). No `Date` or `Math.random` in the engine.
- Squads (2.0-2.2): `formation.ts` resolves hero rows (entry `preferred_row`, else the character's, else the class default; leader forced front) and the leader's `squad_row`. `createBattleState` adds ONE squad `Unit` (`kind: "squad"`, id `squad_<leader>`) per side, with per-soldier HP in `soldiers[]` (hp/maxHp are sums); `squad.ts` runs its 10-hit action on its own SPD schedule. Heroes-only helpers (`livingOf`, `alliesOf`) drive wipe/exhaustion/idle checks; `targetsOf` includes the squad. Soldier skills are `Unit.innate` modifiers (category `soldier`) read by `statBreakdown`.
- Events (2.3): `events.ts` is a synchronous bus (`state.bus`, one per phase): before_hit, after_hit (landed hits only), after_action, on_death (hero or squad wipe), phase_start. Handlers have an owner (null = engine) and an `order`; dispatch is by (order, registration). The bus enforces per-hit-once centrally: a handler fires once per attacking action (`bus.beginAction()`) per affected unit, and every fire is logged as a `trigger` event. Reactions never trigger reactions. `reactions.ts` holds the until_next_hit expiry (once per action per defender) and event-triggered soldier skills (`on_hit` = after_hit when the squad hit; `on_attack` = after_action of the squad), whose effects run through `runEffect` in `damage.ts`.
- Leader rules (2.4): `leader.ts`. `state.leaders[side]` = `{leaderId, auraActive}`. Leader death (`killUnit`) removes the squad and its leader/party soldier skills, sets auraActive false and logs `leader_down`; `applySuccession` (phase start) names the first living hero of the battle input's hero order (stand-in for the leader line, 3e) and restores the flag only (`leader_succession`), never the squad. `Unit.leaderUnit` makes a squad read its leader's status stat modifiers (`statBreakdown`). The leader's `stat_penalties` (Leon SPD -20) become innate modifiers when its paired soldier type matches; only the leader has a deployed squad, so only it is penalised. Soldier skills targeting `leader`/`party` (always-on `modify_stat`) become innate modifiers on those heroes. Aura content is in `prebattle.ts` (below).
- Pre-battle and auras (2.5): `prebattle.ts` holds `PREBATTLE_STEPS`, an ordered list of named steps (equipment, buff_grants, immunity, buff_removal, debuffs, event_auras, spd_finalization; equipment/immunity/buff_removal are no-ops until 3a/3b) that `beginPhase` runs after succession and before `scheduleInitial` (also for the phase-1 setup stats). Only a side's current leader with `leaders[side].auraActive` has an aura. Always-on `modify_stat` aura effects become `passive`-category `StatusInstance`s with `inline` modifiers (`aura:<leader>:<n>`, never ticked) on the targets chosen by aura side, faction and `filter` (hero_is / faction_is / party_has_hero leaves exist in the engine evaluator); `removeAuras` ends them on leader death. Event auras (Jasmine, `self_action_completed`) subscribe on the bus (order 50) and run their effects through `runEffect`. Logged as `aura_applied` / `aura_removed` / `trigger`; unsupported aura effects as `not implemented: aura ...`. Only hero actions count toward `max_actions_per_phase`; squad actions have a separate bound (10x). Battles: `sample.yaml` (2v2) and `full4v4.yaml` (2v2 with all four heroes; a true 4v4 is built from clones in `test/engine.fullbattle.test.ts`, content has only 4 heroes). Tests default to auras off (`loadReal({ auras: true })` keeps them).
- Slice scope: active own-turn skills of heroes with damage, heal and stat-modifier `apply_status` effects, up to 3 phases. Everything else (passives, non-stat/non-heal auras, stun pushback, instant statuses, unsupported conditions/selectors/effects, `while_condition` removal) is **not implemented**: it is logged as `not implemented: ...` and never silently dropped. Tunables stay in `content/rules.yaml`.

## Battle input

`content/battles/*.yaml` (schema `src/schema/battle.ts`, validated by `src/validate/battle.ts`): two fielded sides (heroes reuse roster entries, plus a `leader`) and three seeds (integers in [0, 2^32)). Stable codes: `E_BATTLE_SIZE`, `E_BATTLE_LEADER`, `E_BATTLE_DUP`, `E_BATTLE_SEEDS`, `E_BATTLE_ROW_FULL` (a row holds more heroes than `rules.board.columns`, after the leader is forced front and preferred rows are applied). Hero-level problems use the roster codes.

## Tests

`test/validate.test.ts` works by mutating a fresh copy of the real content: `fresh()` (structured clone of `content/`), mutate, then `codes(raw, tier)` returns error codes via `validateRaw`. `roster()` in `test/helpers.ts` builds a valid 6-hero roster (cloning extra heroes). The first test asserts the real content has zero errors, so content edits must keep it valid.

## Working guidelines

- Before changing anything, the main agent lists every file needed and reads them in one pass, then hands the edits to subagents, then runs the tests once.
- The agent the user talks to never writes code or builds anything itself. It is the supervisor, responsible and accountable for all work done by the subagents it spawns to execute.
- Treat all work as a todo queue. When the user proposes tweaks, changes or corrections, append them to the queue; don't break the queue to prioritize them. Exception: a correction to the task currently in progress is applied immediately, before moving on. Only stop when the queue is truly 100% clear.
- Mistakes aren't your fault; don't apologize. A mistake means a gap or issue in the instruction files. Describe which part of the instruction files caused it and suggest the fix. Be solution oriented.
- YAGNI: don't overengineer, and never expand scope without permission. Do suggest scope improvements when they make sense. All work must be justifiable. Judge where the project sits between "quick and dirty" and "production grade" and match the engineering effort to that.
- After making changes, always spin up a reviewer subagent on a cheap model with minimal context to look over them with fresh eyes for possible problems.

## Environment note

The original environment couldn't reach npm and used preinstalled zod/yaml/tsx/TypeScript; on a normal machine `npm install` works as is. There is no `node_modules` in the repo.
