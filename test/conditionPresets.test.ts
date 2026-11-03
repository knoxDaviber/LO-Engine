import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPresets } from "../editor/src/conditionPresets";
import { codes, fresh, roster } from "./helpers";

const raw0 = fresh();
const presets = buildPresets(raw0.statuses.map((s: any) => ({ id: s.id, name: s.name, category: s.category })));

test("preset ids are unique and labels exist", () => {
  assert.equal(new Set(presets.map((p) => p.id)).size, presets.length);
  assert.ok(presets.every((p) => p.label && p.tip && p.category));
});

test("every preset validates as a main and as a sub slot in tactic context", () => {
  for (const slot of ["main", "sub"] as const) {
    for (let i = 0; i < presets.length; i += 10) {
      const raw = fresh();
      const r: any = roster(raw);
      const skill = (raw.characters.find((c: any) => c.id === "char_001") as any).skills[0];
      r.heroes[0].tactic_sheet = presets.slice(i, i + 10).map((p, j) => ({ priority: j + 1, skill_id: skill, enabled: true, main: null, sub: null, [slot]: p.value }));
      raw.rosters = [{ name: "challenger.yaml", data: r }];
      assert.deepEqual(codes(raw), [], `${slot} presets ${presets[i]!.id}..`);
    }
  }
});
