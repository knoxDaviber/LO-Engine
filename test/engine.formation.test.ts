// Formation resolution (roadmap 2.0, design Sections 10 and 17): hero rows from preferred_row (class default, per-hero override),
// slot placement (row + column), leader in either row, squad_row resolution, squad only in a soldier row, up to 4 fielded heroes per side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASSES, type Battle } from "../src/schema";
import { classDefaultRow, heroRow, resolvePlacements, resolveSquadPlacement, slotConflicts } from "../src/formation";
import { createBattleState, runBattle, boardRank } from "../src/engine";
import { validateRaw } from "../src/validate";
import { LEON, EMPEROR, JASMINE, LIEF, loadReal, tactic } from "./engineHelpers";
import { fresh, find } from "./helpers";

const FRONT = ["infantry", "lancer", "cavalry", "monster", "aquatic"];
const BACK = ["archer", "mage", "holy", "assassin", "flyer"];

const entry = (char_id: string, over: Record<string, unknown> = {}) => ({
  char_id, squad_id: "soldier_001", equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null }, tactic_sheet: [], ...over,
});
const side = (ids: string[], leader: string, over: Record<string, Record<string, unknown>> = {}) =>
  ({ leader, heroes: ids.map((id) => entry(id, over[id] ?? {})) }) as Battle["challenger"];

test("class default rows: ranged and frail classes, assassin and flyer stand back; the rest front", () => {
  for (const c of FRONT) assert.equal(classDefaultRow(c as any), "front", c);
  for (const c of BACK) assert.equal(classDefaultRow(c as any), "back", c);
  assert.deepEqual([...FRONT, ...BACK].sort(), [...CLASSES].sort()); // every class has a rule
});

test("authored heroes carry their class default as preferred_row", () => {
  const { pack } = loadReal();
  for (const ch of pack.characters) assert.equal(ch.preferred_row, classDefaultRow(ch.class), ch.id);
});

test("hero row: entry override, else the character's preferred_row, else the class default", () => {
  const { pack } = loadReal();
  const s = side([LEON, LIEF, JASMINE, EMPEROR], LEON);
  const row = (id: string, over?: Record<string, unknown>) => heroRow(pack, side([LEON, id], LEON, over ? { [id]: over } : {}), entry(id, over));
  assert.equal(row(JASMINE), "back"); // character's preferred_row
  assert.equal(row(LIEF), "front");
  assert.equal(row(JASMINE, { preferred_row: "front" }), "front"); // overrides are respected, both ways
  assert.equal(row(LIEF, { preferred_row: "back" }), "back");
  delete (pack.byId.characters.get(JASMINE) as any).preferred_row; // no authored value: the class default (holy -> back)
  assert.equal(row(JASMINE), "back");
  delete (pack.byId.characters.get(LIEF) as any).preferred_row; // lancer -> front
  assert.equal(row(LIEF), "front");
  void s;
});

test("the leader may stand in either row: its own row rules apply like everyone else's (Decision 129)", () => {
  const { pack } = loadReal();
  const jasLeads = side([LEON, JASMINE, EMPEROR, LIEF], JASMINE);
  assert.equal(resolvePlacements(pack, jasLeads).find((p) => p.charId === JASMINE)!.row, "back"); // holy: back, leader or not
  const leonBack = side([JASMINE, LEON, EMPEROR, LIEF], LEON, { [LEON]: { preferred_row: "back" } });
  assert.equal(resolvePlacements(pack, leonBack).find((p) => p.charId === LEON)!.row, "back");
  assert.equal(heroRow(pack, leonBack, leonBack.heroes[1]!), "back");
});

test("explicit columns claim exactly (row, column); auto heroes fill the lowest free column in roster order", () => {
  const { pack } = loadReal();
  const rows = (s: Battle["challenger"]) => resolvePlacements(pack, s).map((p) => [p.charId, p.row, p.column, p.formationIndex]);
  // Leon column 3, Emperor column 1 explicit; Lief auto takes the lowest free front column (2); Jasmine alone in back, column 2.
  const mixed = side([LEON, LIEF, JASMINE, EMPEROR], LEON, { [LEON]: { column: 3 }, [EMPEROR]: { column: 1 }, [JASMINE]: { column: 2 } });
  assert.deepEqual(rows(mixed), [[EMPEROR, "front", 1, 0], [LIEF, "front", 2, 1], [LEON, "front", 3, 2], [JASMINE, "back", 2, 3]]);
  // An auto hero listed BEFORE an explicit one still skips the claimed column.
  const early = side([LIEF, LEON], LEON, { [LEON]: { column: 1 } });
  assert.deepEqual(rows(early), [[LEON, "front", 1, 0], [LIEF, "front", 2, 1]]);
  // The leader in the back row at an explicit column.
  const back = side([LEON, JASMINE], JASMINE, { [JASMINE]: { column: 3 } });
  assert.deepEqual(rows(back), [[LEON, "front", 1, 0], [JASMINE, "back", 3, 1]]);
});

test("slotConflicts / E_BATTLE_SLOT: two heroes on one (row, column); the engine refuses; same column in different rows is fine", () => {
  const { pack, battle } = loadReal();
  const dup = side([LEON, LIEF], LEON, { [LEON]: { column: 2 }, [LIEF]: { column: 2 } });
  assert.deepEqual(slotConflicts(pack, dup), [{ row: "front", column: 2, charIds: [LEON, LIEF] }]);
  assert.equal(resolvePlacements(pack, dup).length, 2); // never throws; the later claimant is auto-placed
  assert.deepEqual(slotConflicts(pack, side([LEON, JASMINE], LEON, { [LEON]: { column: 2 }, [JASMINE]: { column: 2 } })), []);
  battle.challenger = dup;
  assert.throws(() => createBattleState(pack, battle), /E_BATTLE_SLOT/);
});

test("placement of 4 heroes: front row first, then back, columns by roster order; unit state agrees", () => {
  const { pack, battle } = loadReal({ squads: true });
  const s = side([JASMINE, LEON, LIEF, EMPEROR], LEON); // Jasmine listed first but stands back
  assert.deepEqual(resolvePlacements(pack, s).map((p) => [p.charId, p.row, p.column, p.formationIndex]), [
    [LEON, "front", 1, 0], [LIEF, "front", 2, 1], [EMPEROR, "front", 3, 2], [JASMINE, "back", 1, 3],
  ]);
  battle.challenger = s;
  const state = createBattleState(pack, battle);
  const heroes = state.units.filter((u) => u.side === "challenger" && u.kind === "hero");
  assert.deepEqual(heroes.map((u) => [u.id, u.row, u.column]), [[LEON, "front", 1], [LIEF, "front", 2], [EMPEROR, "front", 3], [JASMINE, "back", 1]]);
});

test("squad_row resolves to the entry's squad_row, else the soldier type's default_soldier_row", () => {
  const { pack } = loadReal();
  assert.deepEqual(
    [resolveSquadPlacement(pack, side([LEON, LIEF], LEON))!.row, resolveSquadPlacement(pack, side([LEON, LIEF], LEON))!.boardRow],
    ["front", "soldier_front"], // Heavy Infantry defaults to front
  );
  const back = resolveSquadPlacement(pack, side([LEON, LIEF], LEON, { [LEON]: { squad_row: "back" } }))!;
  assert.deepEqual([back.row, back.boardRow], ["back", "soldier_back"]);
  pack.byId.soldiers.get("soldier_001")!.default_soldier_row = "back";
  assert.equal(resolveSquadPlacement(pack, side([LEON, LIEF], LEON))!.row, "back");
  assert.equal(resolveSquadPlacement(pack, side([LEON, LIEF], LEON, { [LEON]: { squad_row: "front" } }))!.row, "front");
});

test("only the leader's squad_row applies; other heroes' squad rows do not place anything", () => {
  const { pack } = loadReal();
  const s = side([LEON, LIEF], LEON, { [LIEF]: { squad_row: "back" } });
  assert.equal(resolveSquadPlacement(pack, s)!.row, "front");
  assert.equal(resolveSquadPlacement(pack, s)!.leaderCharId, LEON);
});

test("a squad stands only in a soldier row (in front of or behind the hero rows) and never takes a hero slot", () => {
  const { pack, battle } = loadReal({ squads: true });
  battle.challenger.heroes[0]!.squad_row = "back";
  const state = createBattleState(pack, battle);
  const sqC = state.units.find((u) => u.id === `squad_${LEON}`)!;
  const sqD = state.units.find((u) => u.id === `squad_${EMPEROR}`)!;
  assert.deepEqual([sqC.row, boardRank(sqC)], ["back", 3]); // behind the hero rows
  assert.deepEqual([sqD.row, boardRank(sqD)], ["front", 0]); // in front of them
  for (const u of state.units.filter((v) => v.kind === "hero")) assert.ok([1, 2].includes(boardRank(u)), u.id); // heroes only in the middle two rows
  // a squad is not counted in any hero row's capacity
  const heroesPerRow = (sd: string) => state.units.filter((u) => u.side === sd && u.kind === "hero").length;
  assert.equal(heroesPerRow("challenger"), 2);
  assert.equal(sqC.column, 0); // it spans every column
  assert.equal(sqC.formationIndex, 2); // last in formation order when behind (2 heroes), first (-1) when in front
  assert.equal(sqD.formationIndex, -1);
});

test("a squad row the soldier type does not allow is rejected: E_SQUAD_ROW from the validator, a thrown error from the engine", () => {
  const { pack, battle } = loadReal({ squads: true });
  pack.byId.soldiers.get("soldier_001")!.allowed_soldier_rows = ["back"];
  pack.byId.soldiers.get("soldier_001")!.default_soldier_row = "back";
  battle.challenger.heroes[0]!.squad_row = "front";
  assert.throws(() => createBattleState(pack, battle), /E_SQUAD_ROW/);

  const raw = fresh();
  const soldier = find(raw.soldiers, "soldier_001");
  soldier.allowed_soldier_rows = ["back"];
  soldier.default_soldier_row = "back";
  const b = structuredClone(loadReal().battle) as any;
  b.challenger.heroes[0].squad_row = "front";
  raw.battles = [{ name: "bad.yaml", data: b }];
  assert.ok(validateRaw(raw).report.issues.some((i) => i.code === "E_SQUAD_ROW"));
});

test("the sample leaders' squads are legal (Leon is not mounted_only), and a mounted soldier type changes the squad's class", () => {
  const { report } = validateRaw(fresh());
  assert.deepEqual(report.issues.filter((i) => i.severity === "error"), []);
  const { pack, battle } = loadReal({ squads: true });
  const state = createBattleState(pack, battle);
  assert.equal(state.units.find((u) => u.id === `squad_${LEON}`)!.soldierTypeId, "soldier_001");
  battle.challenger.heroes[0]!.squad_id = "soldier_002";
  assert.equal(createBattleState(pack, battle).units.find((u) => u.id === `squad_${LEON}`)!.class, "cavalry");
});

// ------------------------------------------------------------------ 4 heroes per side

function fourVsFour() {
  const raw = fresh();
  const clone = (src: string, id: string) => {
    const c = structuredClone(find(raw.characters, src));
    c.id = id; c.name = `${c.name} (clone)`; c.skills = [];
    raw.characters.push(c);
    return id;
  };
  const def = [clone("char_002", "char_102"), clone("char_001", "char_101"), clone("char_003", "char_103"), clone("char_004", "char_104")];
  const b = {
    battle_id: "four_v_four", version: "1", seeds: [1, 2, 3],
    challenger: { leader: LEON, heroes: [LEON, LIEF, JASMINE, EMPEROR].map((id) => entry(id, id === LEON ? { tactic_sheet: [tactic("skl_cav_active_002")] } : {})) },
    defender: { leader: "char_102", heroes: def.map((id) => entry(id)) },
  };
  raw.battles = [{ name: "four.yaml", data: b }];
  return { raw, b };
}

test("battles of up to rules.draft.fielded (4) heroes per side validate and run deterministically", () => {
  const { raw } = fourVsFour();
  const { report, pack } = validateRaw(raw);
  assert.deepEqual(report.issues.filter((i) => i.severity === "error"), []);
  const battle = (raw.battles![0]!.data as unknown) as Battle;
  const a = runBattle(pack!, structuredClone(battle));
  const b = runBattle(pack!, structuredClone(battle));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.units.length, 8);
  assert.equal(a.squads.length, 2);
  const state = createBattleState(pack!, battle);
  assert.equal(state.units.filter((u) => u.side === "defender" && u.kind === "hero").length, 4);
  assert.deepEqual(state.units.filter((u) => u.side === "defender" && u.kind === "hero").map((u) => [u.id, u.row]), [
    ["char_102", "front"], ["char_101", "front"], ["char_104", "front"], ["char_103", "back"], // leader first in roster order, holy clone back
  ]);
});

test("a fifth hero is still rejected (E_BATTLE_SIZE)", () => {
  const { raw, b } = fourVsFour();
  b.challenger.heroes.push(entry("char_104"));
  assert.ok(validateRaw(raw).report.issues.some((i) => i.code === "E_BATTLE_SIZE"));
});
