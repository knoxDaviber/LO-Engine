# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Content schema and validator for a tactics auto-battler (no battle engine yet). Game content lives as YAML in `content/`; TypeScript (zod v4) defines the schema and a layered validator checks it. Design intent is in `docs/design_doc_v2.md` (tags: **[DECIDED]** / **[DEFAULT]** tunable / **[OPEN]**) and authoring templates in `docs/templates_v2.md`. When docs and `src/schema/` disagree, **the schema wins**. `docs/conversion_report.md` tracks designer decisions applied and questions still open.

## Commands

```bash
npm run validate                                   # validate ./content at official tier
npm run validate -- content --tier=community --strict   # community tier; --strict fails on warnings
npm run validate -- content --json                 # machine-readable report (--verbose shows info notes)
npm test                                           # node:test suite via tsx
node --import tsx --test --test-name-pattern="duplicate id" test/*.test.ts   # single test
npm run typecheck
npm run schema:export                              # regenerate schemas/*.schema.json from zod
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
