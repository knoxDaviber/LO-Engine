import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng, decideTactic, skillSupport } from "../src/engine";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, sampleState, tactic, unit } from "./engineHelpers";

const HOOVES = "skl_cav_active_002", ASSAULT = "skl_cav_active_001", DIRGE = "skl_inf_active_002", IRON = "skl_inf_active_001";
const VINE = "skl_lancer_active_001", STRIKE = "skl_lancer_active_002", LASTCHANCE = "skl_heal_active_001";
const ids = (d: { targets: { id: string }[] }) => d.targets.map((t) => t.id);
const rng = () => createRng(1);

test("sample sheets: first tactic wins; default target is nearest, front row first", () => {
  const s = sampleState();
  const d = decideTactic(s, unit(s, LEON), rng());
  assert.equal(d.skillId, HOOVES);
  assert.deepEqual(ids(d), [EMPEROR]);
  assert.equal(d.evaluations.length, 1);
  assert.equal(d.evaluations[0]!.outcome, "chosen");
  assert.equal(decideTactic(s, unit(s, LIEF), rng()).skillId, STRIKE);
});

test("insufficient Active PP skips with a reason, then the next tactic is tried; no PP at all idles", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.pp.active.cur = 1;
  const d = decideTactic(s, leon, rng());
  assert.equal(d.skillId, ASSAULT);
  assert.equal(d.evaluations[0]!.outcome, "skipped");
  assert.match(d.evaluations[0]!.reason, /Active PP \(1 < 2\)/);
  leon.pp.active.cur = 0;
  const idle = decideTactic(s, leon, rng());
  assert.equal(idle.tactic, null);
  assert.equal(idle.skillId, null);
  assert.deepEqual(idle.targets, []);
  assert.equal(idle.evaluations.length, 2);
  assert.ok(idle.evaluations.every((e) => e.outcome === "skipped" && e.reason.length > 0));
});

test("priority order is lowest number first, not array order", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.tactics = [tactic(ASSAULT, { priority: 2 }), tactic(HOOVES, { priority: 1 })];
  assert.equal(decideTactic(s, leon, rng()).skillId, HOOVES);
});

test("disabled tactic and skill not in the hero's list", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.tactics = [tactic(HOOVES, { priority: 1, enabled: false }), tactic(DIRGE, { priority: 2 }), tactic(ASSAULT, { priority: 3 })];
  const d = decideTactic(s, leon, rng());
  assert.equal(d.skillId, ASSAULT);
  assert.deepEqual(d.evaluations.map((e) => e.reason.split(" ")[0]), ["tactic", "skill", "targets"]);
  assert.match(d.evaluations[1]!.reason, /not in the hero's skill list/);
});

test("unsupported skills are skipped with 'not implemented' (Last Chance has a status without stat modifiers)", () => {
  const s = sampleState();
  const { pack } = loadReal();
  assert.match(skillSupport(pack.byId.skills.get(LASTCHANCE)!, pack)!, /^not implemented/);
  assert.match(skillSupport(pack.byId.skills.get("skl_passive_001")!, pack)!, /^not implemented/);
  for (const id of [HOOVES, ASSAULT, DIRGE, IRON, VINE, STRIKE]) assert.equal(skillSupport(pack.byId.skills.get(id)!, pack), null, id);
  const d = decideTactic(s, unit(s, JASMINE), rng());
  assert.equal(d.tactic, null);
  assert.match(d.evaluations[0]!.reason, /^not implemented/);
});

test("activation: phase condition gates a tactic; skill default activation is used when the tactic has none", () => {
  const s1 = sampleState(1), s2 = sampleState(2);
  const act = { type: "phase", op: ">=", value: 2 };
  for (const [s, want] of [[s1, ASSAULT], [s2, HOOVES]] as const) {
    unit(s, LEON).tactics = [tactic(HOOVES, { priority: 1, activation: act }), tactic(ASSAULT, { priority: 2 })];
    const d = decideTactic(s, unit(s, LEON), rng());
    assert.equal(d.skillId, want);
  }
  assert.match(decideTactic(s1, unit(s1, LEON), rng()).evaluations[0]!.reason, /activation condition false/);
  // unknown leaf in activation: false + reason
  const leon = unit(s1, LEON);
  leon.tactics = [tactic(HOOVES, { activation: { type: "enemies_alive", op: ">", value: 0 } })];
  const d = decideTactic(s1, leon, rng());
  assert.equal(d.tactic, null);
  assert.match(d.evaluations[0]!.reason, /not implemented: enemies_alive/);
});

test("phase in targeting: main condition filters candidates", () => {
  const s = sampleState(2);
  const leon = unit(s, LEON);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: { all: [{ type: "phase", op: "=", value: 1 }] }, sub: null } })];
  const d = decideTactic(s, leon, rng());
  assert.equal(d.tactic, null);
  assert.match(d.evaluations[0]!.reason, /no valid target/);
  s.phase = 1;
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [EMPEROR]);
});

test("main condition on row picks the back row; sub selector lowest hp_percent", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: { type: "row_is", value: "back" }, sub: null } })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [JASMINE]);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "lowest", metric: "hp_percent" } } })];
  unit(s, JASMINE).hp = 30;
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [JASMINE]);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "highest", metric: "hp_current" } } })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [EMPEROR]); // 200 vs 30
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "farthest" } } })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [JASMINE]);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "lowest", stat: "DEF", metric: "stat" } } })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [JASMINE]); // DEF 20 vs 50
});

test("selector ties go to column index then unit id", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "lowest", metric: "hp_percent" } } })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [EMPEROR]); // both 100%: front row, column 1
  unit(s, JASMINE).row = "front";
  unit(s, JASMINE).column = 1; // same row and column as the Emperor: unit id decides (char_002 < char_003)
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [EMPEROR]);
});

test("random_seeded draws from the rng: same seed same pick, and it consumes the stream", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  leon.tactics = [tactic(ASSAULT, { targeting: { main: null, sub: { select: "random_seeded" } } })];
  const picks = (seed: number) => { const r = createRng(seed); return Array.from({ length: 30 }, () => ids(decideTactic(s, leon, r))[0]); };
  assert.deepEqual(picks(5), picks(5));
  assert.ok(new Set(picks(5)).size === 2); // both enemies get picked over 30 draws
  const r = createRng(5);
  decideTactic(s, leon, r);
  assert.equal(r.draws, 1);
  const r2 = createRng(5);
  decideTactic(s, unit(s, LIEF), r2); // default targeting never rolls
  assert.equal(r2.draws, 0);
});

test("shapes: row (Dirge), column (Vine Stab), caster_row (Iron Fist), self side", () => {
  const s = sampleState();
  const emp = unit(s, EMPEROR);
  emp.tactics = [tactic(DIRGE)];
  assert.deepEqual(ids(decideTactic(s, emp, rng())), [LEON, LIEF]); // front row of the challenger
  emp.tactics = [tactic(DIRGE, { targeting: { main: { type: "class_is", side: "target", value: "lancer" }, sub: null } })];
  assert.deepEqual(ids(decideTactic(s, emp, rng())), [LEON, LIEF]); // Lief anchors the row
  const lief = unit(s, LIEF);
  lief.tactics = [tactic(VINE)];
  assert.deepEqual(ids(decideTactic(s, lief, rng())), [EMPEROR, JASMINE]); // column 1 of the defenders, front and back
  lief.tactics = [tactic(VINE, { targeting: { main: { type: "row_is", value: "back" }, sub: null } })];
  assert.deepEqual(ids(decideTactic(s, lief, rng())), [EMPEROR, JASMINE]); // anchor Jasmine, same column
  emp.tactics = [tactic(IRON)];
  assert.deepEqual(ids(decideTactic(s, emp, rng())), [EMPEROR]); // caster row, no other defender in front
  unit(s, JASMINE).row = "front";
  assert.deepEqual(ids(decideTactic(s, emp, rng())), [EMPEROR, JASMINE]);
});

test("dead units are never candidates", () => {
  const s = sampleState();
  unit(s, EMPEROR).alive = false;
  const d = decideTactic(s, unit(s, LEON), rng());
  assert.deepEqual(ids(d), [JASMINE]);
  unit(s, JASMINE).alive = false;
  assert.equal(decideTactic(s, unit(s, LEON), rng()).tactic, null);
});

test("fallback: skip skips the tactic, next_valid_target takes the next candidate", () => {
  const s = sampleState();
  const leon = unit(s, LEON);
  const sub = { type: "hp_percent", side: "target", op: "<", value: 50 }; // nobody qualifies
  leon.tactics = [tactic(HOOVES, { priority: 1, targeting: { main: null, sub }, fallback: "skip" }), tactic(ASSAULT, { priority: 2 })];
  const d = decideTactic(s, leon, rng());
  assert.equal(d.skillId, ASSAULT);
  assert.match(d.evaluations[0]!.reason, /no valid target.*fallback skip/);
  leon.tactics = [tactic(HOOVES, { targeting: { main: null, sub }, fallback: "next_valid_target" })];
  const d2 = decideTactic(s, leon, rng());
  assert.equal(d2.skillId, HOOVES);
  assert.deepEqual(ids(d2), [EMPEROR]);
  assert.match(d2.evaluations[0]!.reason, /next valid target/);
  unit(s, JASMINE).hp = 10;
  leon.tactics = [tactic(HOOVES, { targeting: { main: null, sub }, fallback: "skip" })];
  assert.deepEqual(ids(decideTactic(s, leon, rng())), [JASMINE]); // now someone satisfies the sub condition
});

test("every skip carries a reason string and decisions are deterministic", () => {
  const s = sampleState();
  const emp = unit(s, EMPEROR);
  emp.pp.active.cur = 0;
  const a = decideTactic(s, emp, createRng(9)), b = decideTactic(s, emp, createRng(9));
  assert.deepEqual(a, b);
  assert.ok(a.evaluations.every((e) => e.reason.length > 0));
});
