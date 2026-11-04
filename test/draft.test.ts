import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../src/load";
import { validateContent, validateRaw } from "../src/validate";
import type { Pack } from "../src/validate/pack";
import { resolveDraft } from "../src/draft";
import { beginPhase, EventLog, nullSink, renderLog, runBattle } from "../src/engine";
import { rosterBattleSchema, type RosterBattle } from "../src/schema";
import { fresh } from "./helpers";
import { loadReal } from "./engineHelpers";

const draftRaw = () => structuredClone((loadPack("content").battles ?? []).find((b) => b.name === "draft_city.yaml")!.data) as any;
const realPack = (): Pack => {
  const { pack } = validateContent("content");
  assert.ok(pack);
  return pack;
};
const parse = (raw: unknown): RosterBattle => rosterBattleSchema.parse(raw);
/** Error codes of a mutated draft_city battle. */
const codes = (mutate: (b: any) => void) => {
  const raw = fresh();
  const b = draftRaw();
  mutate(b);
  raw.battles = [{ name: "d.yaml", data: b }];
  return validateRaw(raw).report.issues.filter((i) => i.severity === "error").map((i) => i.code);
};

test("draft_city validates and drafts each side to exactly 4 heroes (rules.draft.fielded)", () => {
  assert.deepEqual(codes(() => {}), []);
  const pack = realPack();
  const d = resolveDraft(pack, parse(draftRaw()));
  assert.deepEqual(d.issues, []);
  for (const side of ["challenger", "defender"] as const) {
    assert.equal(d.sides![side].fielded.length, pack.rules.draft.fielded);
    assert.equal(d.battle![side].heroes.length, 4);
    assert.equal(d.sides![side].banned.length, 2);
  }
  assert.deepEqual(d.steps.map((s) => [s.actor, s.action, s.hero, s.by]), [
    ["challenger", "ban", "char_004", "human"],
    ["defender", "ban", "char_012", "rule 1"],
    ["challenger", "protect", "char_005", "human"],
    ["challenger", "ban", "char_010", "human"],
    ["defender", "ban", "char_013", "fallback"],
  ]);
  assert.equal(d.battle!.battlefield, "terrain_005");
});

test("the anchor is never banned: a human pick of it is rejected, rule-sheet bans skip it", () => {
  assert.ok(codes((b) => { b.challenger.draft.bans = ["char_014", "char_010"]; }).includes("E_DRAFT_PICK"));
  // Challenger bans by rule sheet aimed at the anchor's class: the anchor stays, the next match / fallback is banned instead.
  const pack = realPack();
  pack.rules.draft.steps = pack.rules.draft.steps.map((s) => (s.actor === "challenger" && s.action === "ban" ? { ...s, source: "rule_sheet" as const } : s));
  const raw = draftRaw();
  raw.challenger.draft = { protects: ["char_005"] };
  raw.challenger.roster.ban_sheet = { rules: [{ priority: 1, filter: { type: "hero_class", value: "monster" }, select: "highest", metric: "cost" }] };
  const d = resolveDraft(pack, parse(raw));
  assert.deepEqual(d.issues, []);
  assert.ok(!d.sides!.defender.banned.includes("char_014"));
  assert.ok(d.sides!.defender.fielded.includes("char_014"));
  assert.deepEqual(d.steps.filter((s) => s.actor === "challenger" && s.action === "ban").map((s) => s.by), ["fallback", "fallback"]);
});

test("the protected hero is never banned: a later rule matching it falls through to the fallback", () => {
  const pack = realPack();
  const raw = draftRaw();
  raw.challenger.draft.protects = ["char_008"]; // Archer
  raw.defender.roster.ban_sheet.rules[1] = { priority: 2, filter: { type: "hero_class", value: "archer" }, select: "highest", metric: "cost" };
  const d = resolveDraft(pack, parse(raw));
  assert.deepEqual(d.issues, []);
  assert.ok(!d.sides!.challenger.banned.includes("char_008"));
  assert.equal(d.steps[4]!.by, "fallback");
  // A human ban of a protected hero is rejected (PvP-style config: the defender bans by hand after the challenger protects).
  pack.rules.draft.steps = pack.rules.draft.steps.map((s, i) => (i === 4 ? { ...s, source: "human" as const } : s));
  raw.defender.draft = { bans: ["char_008"] };
  const d2 = resolveDraft(pack, parse(raw));
  assert.equal(d2.battle, null);
  assert.deepEqual(d2.issues.map((i) => i.code), ["E_DRAFT_PICK"]);
  assert.match(d2.issues[0]!.message, /protected/);
});

test("fallback bans the highest-cost eligible hero; ties break by cost, then id", () => {
  const pack = realPack();
  // Clone the Cavalry as char_101 with the same entry: identical cost. Both get a top cost_override, so the tie goes to the lower id.
  const cav = pack.byId.characters.get("char_007")!;
  const clone = { ...structuredClone(cav), id: "char_101", name: "Cavalry II" };
  pack.byId.characters.set("char_101", clone);
  cav.cost_override = 999;
  clone.cost_override = 999;
  const raw = draftRaw();
  const entry = raw.challenger.roster.heroes.find((h: any) => h.char_id === "char_009");
  Object.assign(entry, structuredClone(raw.challenger.roster.heroes.find((h: any) => h.char_id === "char_007")), { char_id: "char_101" });
  raw.challenger.roster.leader_line = raw.challenger.roster.leader_line.map((id: string) => (id === "char_009" ? "char_101" : id));
  let d = resolveDraft(pack, parse(raw));
  assert.deepEqual([d.steps[4]!.hero, d.steps[4]!.by], ["char_007", "fallback"]);
  clone.cost_override = 1000; // now strictly higher
  d = resolveDraft(pack, parse(raw));
  assert.deepEqual([d.steps[4]!.hero, d.steps[4]!.by], ["char_101", "fallback"]);
});

test("same inputs give the same draft and the same battle log", () => {
  const pack = realPack();
  assert.deepEqual(resolveDraft(pack, parse(draftRaw())), resolveDraft(pack, parse(draftRaw())));
  const a = runBattle(realPack(), parse(draftRaw()));
  const b = runBattle(realPack(), parse(draftRaw()));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.deepEqual(a.draft!.steps, resolveDraft(pack, parse(draftRaw())).steps);
});

test("a banned leader's squad and aura are replaced by the next hero in the leader line", () => {
  const r = runBattle(realPack(), parse(draftRaw()));
  const setup = r.events.find((e) => e.type === "battle_setup")!;
  assert.ok(setup.type === "battle_setup");
  // Lief tops the defender's leader line but is banned: the Monster (next) leads with its own squad and aura.
  assert.equal(setup.units.find((u) => u.leader && u.side === "defender")!.id, "char_014");
  assert.deepEqual(setup.squads.filter((q) => q.side === "defender").map((q) => q.id), ["squad_char_014"]);
  const auras = r.events.filter((e) => e.type === "aura_applied");
  assert.ok(auras.some((e) => e.type === "aura_applied" && e.leader === "char_014"));
  assert.ok(!auras.some((e) => e.type === "aura_applied" && e.leader === "char_004"));
  assert.ok(!setup.units.some((u) => u.id === "char_004"));
});

test("formation overflow is resolved by leader-line rank (lowest-ranked non-leader moves)", () => {
  const raw = draftRaw();
  for (const h of raw.challenger.roster.heroes) h.preferred_row = "front";
  const d = resolveDraft(realPack(), parse(raw));
  assert.deepEqual(d.sides!.challenger.moved, ["char_009"]); // fielded in line order: 005, 007, 008, 009
  assert.deepEqual(d.battle!.challenger.heroes.map((h) => h.char_id), ["char_005", "char_007", "char_008", "char_009"]);
  assert.deepEqual(codes((b) => { for (const h of b.challenger.roster.heroes) h.preferred_row = "front"; }), []);
  const r = runBattle(realPack(), parse(raw));
  const setup = r.events.find((e) => e.type === "battle_setup")!;
  assert.ok(setup.type === "battle_setup");
  assert.equal(setup.units.find((u) => u.id === "char_009")!.row, "back");
});

test("overflow move drops the moved hero's explicit column; edits can set columns", () => {
  const raw = draftRaw();
  for (const h of raw.challenger.roster.heroes) h.preferred_row = "front";
  raw.challenger.roster.heroes.find((h: any) => h.char_id === "char_009").column = 3;
  const d = resolveDraft(realPack(), parse(raw));
  assert.deepEqual(d.sides!.challenger.moved, ["char_009"]);
  assert.equal("column" in d.battle!.challenger.heroes.find((h) => h.char_id === "char_009")!, false);
  assert.deepEqual(codes((b) => { for (const h of b.challenger.roster.heroes) h.preferred_row = "front"; b.challenger.roster.heroes.find((h: any) => h.char_id === "char_009").column = 3; }), []);
  const edit = (e: unknown) => (b: any) => { b.challenger.edits = [e]; };
  assert.deepEqual(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", column: 3 }] })), []);
  assert.deepEqual(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", column: 9 }] })), ["E_BATTLE_SLOT"]);
  assert.deepEqual(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", column: null }] })), [], "column: null = back to auto");
  assert.deepEqual(codes((b) => { b.challenger.roster.heroes.find((h: any) => h.char_id === "char_005").column = 9; }), ["E_BATTLE_SLOT"], "roster form: one error, no E_BATTLE_ROW_FULL");
});

test("draft input errors: pick counts, ineligible picks, roster layer, duplicates, battlefield, ban metric", () => {
  assert.ok(codes((b) => { b.challenger.draft.bans = ["char_004"]; }).includes("E_DRAFT_PICKS"));
  assert.ok(codes((b) => { delete b.challenger.draft; }).includes("E_DRAFT_PICKS"));
  assert.ok(codes((b) => { b.challenger.draft.bans = ["char_005", "char_010"]; }).includes("E_DRAFT_PICK")); // own hero
  assert.ok(codes((b) => { b.challenger.draft.bans = ["char_004", "char_004"]; }).includes("E_DRAFT_PICK")); // already banned
  assert.ok(codes((b) => { b.challenger.draft.protects = ["char_012"]; }).includes("E_DRAFT_PICK")); // banned at step 2
  assert.ok(codes((b) => { b.defender.roster.anchor = null; }).includes("E_ANCHOR"));
  assert.ok(codes((b) => { b.defender.roster.ban_sheet = null; }).includes("E_BAN_SHEET"));
  assert.ok(codes((b) => { b.challenger.roster.heroes.pop(); b.challenger.roster.leader_line.pop(); }).includes("E_ROSTER_SIZE"));
  assert.ok(codes((b) => { b.defender.roster.heroes[5].char_id = "char_013"; b.defender.roster.heroes[5].tactic_sheet = []; b.defender.roster.leader_line[5] = "char_013"; }).includes("E_BATTLE_DUP"));
  assert.ok(codes((b) => { b.defender.roster.battlefield = "terrain_999"; }).includes("E_BATTLE_TERRAIN"));
  assert.ok(codes((b) => { b.defender.roster.ban_sheet.rules[0].metric = "speed"; }).includes("E_BAN_METRIC"));
  assert.ok(codes((b) => { b.challenger.roster.ban_sheet = null; b.battlefield = "terrain_005"; }).includes("E_SCHEMA")); // no top-level battlefield in the roster form
});

test("challenger edits: locked fields rejected with E_EDIT_LOCKED; bad phase / hero; defenders frozen", () => {
  const edit = (e: unknown) => (b: any) => { b.challenger.edits = [e]; };
  assert.ok(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null } }] })).includes("E_EDIT_LOCKED"));
  assert.ok(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", squad_id: "soldier_001" }] })).includes("E_EDIT_LOCKED"));
  assert.ok(codes(edit({ phase: 2, roster: {} })).includes("E_EDIT_LOCKED"));
  assert.ok(codes((b) => { b.defender.edits = [{ phase: 2, heroes: [{ char_id: "char_014", preferred_row: "front" }] }]; }).includes("E_EDIT_LOCKED"));
  assert.ok(codes(edit({ phase: 1, heroes: [] })).includes("E_EDIT_PHASE"));
  assert.ok(codes((b) => { b.challenger.edits.push({ phase: 2 }); }).includes("E_EDIT_PHASE"));
  assert.ok(codes(edit({ phase: 2, heroes: [{ char_id: "char_012", preferred_row: "back" }] })).includes("E_EDIT_HERO")); // banned
  assert.ok(codes(edit({ phase: 3, leader: "char_013" })).includes("E_EDIT_HERO"));
  assert.ok(codes(edit({ phase: 2, heroes: [{ char_id: "char_005", squad_row: "middle" }] })).includes("E_SCHEMA"));
  assert.ok(codes(edit({ phase: 2, heroes: [{ char_id: "char_008", preferred_row: "front" }, { char_id: "char_009", preferred_row: "front" }] })).includes("E_BATTLE_ROW_FULL"));
  assert.deepEqual(codes(edit({ phase: 3, heroes: [{ char_id: "char_008", preferred_row: "front", tactic_sheet: [] }] })), []);
  // The fielded form takes the same edit list.
  const fielded = (e: unknown) => {
    const raw = fresh();
    const b = structuredClone((loadPack("content").battles ?? []).find((x) => x.name === "sample.yaml")!.data) as any;
    b.challenger.edits = [e];
    raw.battles = [{ name: "f.yaml", data: b }];
    return validateRaw(raw).report.issues.filter((i) => i.severity === "error").map((i) => i.code);
  };
  assert.deepEqual(fielded({ phase: 2, heroes: [{ char_id: "char_004", preferred_row: "back" }] }), []);
  assert.deepEqual(fielded({ phase: 2, heroes: [{ char_id: "char_004", armor: "equip_018" }] }), ["E_EDIT_LOCKED"]);
});

test("edits apply from their phase on; a named leader replaces a dead leader only", () => {
  const soft = realPack();
  // Pin hero_hits to 1: under the content formula (hero_hits 4) with the Decision 135 equipment bases, the Infantry (char_005) dies in
  // phase 1 of draft_city, before its phase-2 edited sheet applies, so there would be no phase-2/3 tactic evaluation to check.
  soft.rules.damage.hero_hits = 1;
  const r = runBattle(soft, parse(draftRaw()));
  const firstEval = (phase: number) => r.events.find((e) => e.type === "tactic_evaluation" && e.unit === "char_005" && e.phase === phase);
  const ev = (p: number) => { const e = firstEval(p); return e && e.type === "tactic_evaluation" ? e.evaluations[0]!.skill : null; };
  assert.equal(ev(1), "skl_004");
  assert.equal(ev(2), "skl_001");
  assert.equal(ev(3), "skl_001"); // carries over
  assert.ok(r.events.some((e) => e.type === "edit" && e.phase === 2 && e.hero === "char_005" && e.applied));

  const { pack, battle } = loadReal();
  battle.challenger.edits = [{ phase: 2, leader: "char_004" }];
  const p1 = beginPhase(pack, battle, 1, null, nullSink).state;
  const leon = p1.units.find((u) => u.id === "char_001")!;
  leon.alive = false; leon.hp = 0;
  const log = new EventLog();
  const p2 = beginPhase(pack, battle, 2, p1, log).state;
  assert.equal(p2.leaders.challenger.leaderId, "char_004");
  assert.ok(log.events.some((e) => e.type === "edit" && e.hero === "char_004" && e.applied));
  // Leader alive: the edit is logged as not applied.
  const q1 = beginPhase(pack, battle, 1, null, nullSink).state;
  const log2 = new EventLog();
  const q2 = beginPhase(pack, battle, 2, q1, log2).state;
  assert.equal(q2.leaders.challenger.leaderId, "char_001");
  assert.ok(log2.events.some((e) => e.type === "edit" && !e.applied && e.note.includes("alive")));
});

test("the engine ignores defender edits even in an unvalidated battle", () => {
  const { pack, battle } = loadReal();
  battle.defender.edits = [{ phase: 2, leader: "char_003", heroes: [{ char_id: "char_002", tactic_sheet: [] }] }];
  const p1 = beginPhase(pack, battle, 1, null, nullSink).state;
  const emperor = p1.units.find((u) => u.id === "char_002")!;
  emperor.alive = false; emperor.hp = 0;
  const log = new EventLog();
  const p2 = beginPhase(pack, battle, 2, p1, log).state;
  assert.ok(p2.units.find((u) => u.id === "char_002")!.tactics.length > 0); // tactic sheet not wiped
  assert.ok(!log.events.some((e) => e.type === "edit"));
  assert.equal(p2.leaders.defender.leaderId, "char_003"); // by the leader line (the only living hero), not by the edit
});

test("text log renders the draft and the edits", () => {
  const text = renderLog(runBattle(realPack(), parse(draftRaw())).events);
  assert.match(text, /=== Draft ===\n {2}step 1: challenger bans Lief \(defender\) \[human\]/);
  assert.match(text, /defender fields Monster, Lancer, The Emperor, Assassin; leader Monster; anchor Monster; banned Lief, Mage/);
  assert.match(text, /challenger edit: Infantry tactic_sheet, squad_row/);
});

test("roster battle: two fielded heroes claiming the same slot is E_BATTLE_SLOT from validation", () => {
  const found = codes((b) => {
    delete b.challenger.edits;
    const fielded = resolveDraft(realPack(), parse(b)).battle!.challenger.heroes.map((h) => h.char_id);
    for (const id of fielded.slice(0, 2)) {
      const h = b.challenger.roster.heroes.find((x: any) => x.char_id === id);
      h.preferred_row = "front";
      h.column = 1;
    }
  });
  assert.ok(found.includes("E_BATTLE_SLOT"), found.join(","));
});
