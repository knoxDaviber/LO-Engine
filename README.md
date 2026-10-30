# Tactics sim: content schema and validator

```
npm run validate                      # check ./content (official tier)
npm run validate -- content --tier=community --strict
npm test                              # node:test suite (19 tests)
npm run typecheck
npm run schema:export                 # JSON Schemas -> schemas/
```

Layers: schema pass -> cross-references and semantic rules -> tier (community-safe) checks -> rosters (`content/rosters/*.yaml`; files starting with `defender` are checked as defenders: anchor + ban sheet).

Add a new condition leaf or effect type in `src/registry/` (one entry: parameters, allowed contexts, community-safe flag). Enums live in `src/schema/enums.ts`. Tunables live in `content/rules.yaml`.

Setup note: this environment could not reach the npm registry, so it uses preinstalled zod, yaml, tsx and TypeScript and Node's built-in test runner. On a normal machine `npm install` works with the package.json as is.
