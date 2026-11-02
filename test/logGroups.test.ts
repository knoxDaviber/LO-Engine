import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { createApi } from "../editor/api";
import { actionMatches, groupLog } from "../editor/src/logGroups";

const api = createApi("content");
const simOf = (file: string) => api.sim(parse(readFileSync(`content/battles/${file}`, "utf-8")));

for (const file of ["sample.yaml", "draft_city.yaml"]) {
  test(`logGroups: ${file} groups into phases and actions without losing lines`, () => {
    const r = simOf(file);
    const g = groupLog(r);
    const starts = r.events.filter((e) => ["tactic_evaluation", "squad_attack", "action_prevented", "idle"].includes(e.type)).length;
    assert.equal(g.phases.length, r.events.filter((e) => e.type === "phase_start").length);
    assert.equal(g.phases.flatMap((p) => p.actions).length, starts);
    assert.ok(g.banner?.startsWith("Battle over"), String(g.banner));
    assert.ok(g.phases.every((p) => p.footer?.startsWith("Phase")));

    const kept = [...g.header, ...g.phases.flatMap((p) => [p.title, ...p.intro, ...p.actions.flatMap((a) => a.lines), ...(p.footer ? [p.footer] : [])])].length + 1; // + banner
    const total = r.log.split("\n").filter((l) => l.trim() !== "").length;
    // phase header and footer lines are stored without their === / --- marks, the banner too: the counts still match line for line
    assert.equal(kept, total);

    for (const p of g.phases) for (const a of p.actions) {
      assert.ok(a.side === "challenger" || a.side === "defender", `${a.unit} has a side`);
      assert.equal(a.phase, p.phase);
      assert.ok(a.lines.length >= 1 && a.lines[0]!.includes(a.unit));
    }
  });
}

test("logGroups: hero actions carry the chosen skill summary and the unit filter keeps whole actions", () => {
  const r = simOf("sample.yaml");
  const g = groupLog(r);
  const acts = g.phases.flatMap((p) => p.actions);
  const hero = acts.find((a) => a.kind === "acts")!;
  assert.match(hero.summary, / uses .+ on /);
  assert.ok(acts.some((a) => a.kind === "attacks"), "squad attacks are actions too");
  const name = hero.unit;
  const kept = acts.filter((a) => actionMatches(a, name));
  assert.ok(kept.length > 0 && kept.length <= acts.length);
  assert.equal(acts.filter((a) => actionMatches(a, "")).length, acts.length);
});
