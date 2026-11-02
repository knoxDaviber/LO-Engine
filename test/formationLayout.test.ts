import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { createApi } from "../editor/api";
import { dropKind, layoutSide, moveEdit, stepEdit, type DragItem } from "../editor/src/formationLayout";
import { resolvePlacements, resolveSquadPlacement } from "../src/formation";

const api = createApi("content");
const c = api.content();
const files = readdirSync("content/battles").filter((f) => f.endsWith(".yaml"));
const load = (f: string) => parse(readFileSync(`content/battles/${f}`, "utf-8"));
const fielded = files.map((f) => ({ f, b: load(f) })).filter((x) => x.b.challenger?.heroes);
const SIDES = ["challenger", "defender"] as const;

test("layout matches the engine on real fielded battles; grids are fixed size", () => {
  assert.ok(fielded.length > 0);
  for (const { f, b } of fielded)
    for (const side of SIDES) {
      const layout = layoutSide(c, b, side);
      for (const r of layout.rows) assert.equal(r.cells.length, r.row.startsWith("soldier") ? 1 : c.rules.columns, `${f} ${side} ${r.row} size`);
      for (const p of resolvePlacements(api.pack, b[side])) {
        const cell = layout.rows.find((r) => r.row === p.row)!.cells[p.column - 1];
        assert.ok(cell && cell.kind === "hero" && cell.charId === p.charId && cell.index === p.order && cell.row === p.row && cell.column === p.column, `${f} ${side} ${p.charId}`);
      }
      const sq = resolveSquadPlacement(api.pack, b[side]);
      const cell = layout.rows.find((r) => r.row === sq!.boardRow)!.cells[0];
      assert.ok(cell && cell.kind === "squad" && cell.leaderId === sq!.leaderCharId, `${f} ${side} squad`);
    }
});

test("roster-form battle does not throw", () => {
  const b = load("draft_city.yaml");
  for (const side of SIDES) assert.ok(layoutSide(c, b, side).rows.length === 4);
});

const sample = () => structuredClone(load("sample.yaml"));
const leaderIdx = (b: any, s: string) => b[s].heroes.findIndex((h: any) => h.char_id === b[s].leader);

const slotOf = (b: any, idx: number) => {
  const p = resolvePlacements(api.pack, b.challenger).find((x) => x.order === idx)!;
  return `${p.row}:${p.column}`;
};
const hero = (idx: number): DragItem => ({ kind: "hero", index: idx });

test("the leader may stand in the back row and may be dragged anywhere", () => {
  const b = sample();
  const li = leaderIdx(b, "challenger");
  b.challenger.heroes[li].preferred_row = "back";
  assert.ok(layoutSide(c, b, "challenger").rows.find((r) => r.row === "back")!.cells.some((x) => x?.kind === "hero" && x.isLeader));
  const fn = moveEdit(c, b, "challenger", hero(li), { row: "front", column: 3 });
  assert.ok(fn);
  fn(b);
  assert.equal(slotOf(b, li), "front:3");
  assert.equal(b.challenger.heroes[li].column, 3);
  b.challenger.heroes[li].preferred_row = "back"; // Decision 129: a back-row leader is valid input, not only a board state
  delete b.challenger.heroes[li].column;
  assert.deepEqual(api.validate(b).issues.filter((i) => i.severity === "error"), []);
});

test("overflow is flagged and listed beside the fixed grid", () => {
  const b = sample();
  const cols = c.rules.columns;
  const base = b.challenger.heroes[leaderIdx(b, "challenger")];
  for (let i = 0; i < cols; i++) b.challenger.heroes.push({ ...structuredClone(base), char_id: c.characters[i % c.characters.length]!.id, preferred_row: "front" });
  const l = layoutSide(c, b, "challenger");
  assert.ok(l.overflow.includes("front"));
  assert.equal(l.rows.find((r) => r.row === "front")!.cells.length, cols, "the grid does not grow");
  assert.ok(l.offGrid.length > 0 && l.offGrid.every((x) => x.overflow && x.column > cols));
});

test("drop on an empty slot: explicit row + column, preferred_row deleted only when it equals the default, others stay put", () => {
  const b = sample();
  const li = leaderIdx(b, "challenger");
  const oi = b.challenger.heroes.findIndex((_: any, i: number) => i !== li);
  const other = b.challenger.heroes[oi];
  const ch = c.characters.find((x) => x.id === other.char_id)!;
  delete other.preferred_row;
  const others = b.challenger.heroes.map((_: any, i: number) => slotOf(b, i));
  const row = ch.preferred_row === "back" ? "front" : "back";
  const col = c.rules.columns; // the last column of the other row: empty in a 2-hero side
  assert.equal(dropKind(c, b, "challenger", hero(oi), { row, column: col }), "empty");
  moveEdit(c, b, "challenger", hero(oi), { row, column: col })!(b);
  assert.equal(other.preferred_row, row);
  assert.equal(other.column, col);
  assert.equal(slotOf(b, oi), `${row}:${col}`);
  b.challenger.heroes.forEach((_: any, i: number) => { if (i !== oi) assert.equal(slotOf(b, i), others[i], "untouched heroes stay in their slot"); });
  // Back to the character's own row: the key goes, the column stays explicit.
  moveEdit(c, b, "challenger", hero(oi), { row: ch.preferred_row as any, column: 1 })?.(b);
  assert.equal("preferred_row" in other, false);
  assert.equal(other.column, 1);
});

test("drop on an occupied slot swaps; invalid targets and no-ops are null", () => {
  const b = sample();
  b.challenger.heroes.forEach((h: any) => { delete h.preferred_row; delete h.column; });
  const ps = resolvePlacements(api.pack, b.challenger);
  const [p0, p1] = [ps[0]!, ps[1]!];
  const t1 = { row: p1.row as any, column: p1.column };
  assert.equal(dropKind(c, b, "challenger", hero(p0.order), t1), "swap");
  moveEdit(c, b, "challenger", hero(p0.order), t1)!(b);
  assert.equal(slotOf(b, p0.order), `${p1.row}:${p1.column}`);
  assert.equal(slotOf(b, p1.order), `${p0.row}:${p0.column}`);
  for (const i of [p0.order, p1.order]) assert.ok(b.challenger.heroes[i].column >= 1, "both get an explicit column");
  assert.equal(moveEdit(c, b, "challenger", hero(p0.order), { row: "soldier_front" }), null, "heroes never go to soldier rows");
  assert.equal(moveEdit(c, b, "challenger", hero(p0.order), { row: "front", column: 0 }), null);
  assert.equal(moveEdit(c, b, "challenger", hero(p0.order), { row: "front", column: c.rules.columns + 1 }), null);
  const here = resolvePlacements(api.pack, b.challenger).find((p) => p.order === p0.order)!;
  assert.equal(moveEdit(c, b, "challenger", hero(p0.order), { row: here.row, column: here.column }), null, "same slot");
});

test("squad: only between the soldier rows (squad_row, key deleted at the default); heroes' slots are refused", () => {
  const b = sample();
  const li = leaderIdx(b, "challenger");
  const lead = b.challenger.heroes[li];
  const def = c.soldiers.find((s) => s.id === lead.squad_id)!.default_soldier_row;
  assert.equal(moveEdit(c, b, "challenger", { kind: "squad", index: li }, { row: "front", column: 1 }), null);
  const other_ = def === "front" ? "soldier_back" : "soldier_front";
  moveEdit(c, b, "challenger", { kind: "squad", index: li }, { row: other_ })!(b);
  assert.equal(lead.squad_row, def === "front" ? "back" : "front");
  moveEdit(c, b, "challenger", { kind: "squad", index: li }, { row: def === "front" ? "soldier_front" : "soldier_back" })!(b);
  assert.equal("squad_row" in lead, false);
  assert.equal(moveEdit(c, b, "challenger", { kind: "squad", index: li + 1 }, { row: other_ }), null, "only the leader's squad");
});

test("stepEdit: arrows move one slot in screen terms, swap when occupied, null at the edges", () => {
  const b = sample();
  b.challenger.heroes.forEach((h: any) => { delete h.preferred_row; delete h.column; });
  const li = leaderIdx(b, "challenger");
  const me = resolvePlacements(api.pack, b.challenger).find((p) => p.order === li)!;
  // Challenger lanes run back -> front left to right: right = toward the front; columns run top to bottom.
  const toward = (row: string) => (row === "back" ? "right" : "left");
  assert.ok(stepEdit(c, b, "challenger", hero(li), toward(me.row) as any));
  const away = toward(me.row) === "right" ? "left" : "right";
  assert.equal(stepEdit(c, b, "challenger", hero(li), away as any), null);
  const up = me.column === 1;
  assert.equal(stepEdit(c, b, "challenger", hero(li), "up") === null, up);
  stepEdit(c, b, "challenger", hero(li), "down")?.(b);
  if (me.column < c.rules.columns) assert.equal(slotOf(b, li), `${me.row}:${me.column + 1}`);
  // The defender board is mirrored: right = toward the back.
  const d = sample();
  d.defender.heroes.forEach((h: any) => { delete h.preferred_row; delete h.column; });
  const dl = d.defender.heroes.findIndex((h: any) => h.char_id === d.defender.leader);
  const dp = resolvePlacements(api.pack, d.defender).find((p) => p.order === dl)!;
  const dRight = stepEdit(c, d, "defender", hero(dl), "right");
  assert.equal(dRight !== null, dp.row === "front");
  const sqRight = stepEdit(c, b, "challenger", { kind: "squad", index: li }, "right");
  const sqLeft = stepEdit(c, b, "challenger", { kind: "squad", index: li }, "left");
  assert.ok((sqRight === null) !== (sqLeft === null), "exactly one direction reaches the other soldier row");
  assert.equal(stepEdit(c, b, "challenger", { kind: "squad", index: li }, "up"), null);
});

test("UI change = file change: dragged slots survive save -> file -> read, and the sim reads them", () => {
  const b = sample();
  b.challenger.heroes.forEach((h: any) => { delete h.preferred_row; delete h.column; });
  const li = leaderIdx(b, "challenger");
  moveEdit(c, b, "challenger", hero(li), { row: "back", column: 3 })!(b);
  const before = resolvePlacements(api.pack, b.challenger);
  const dir = mkdtempSync(join(tmpdir(), "editor-slot-"));
  try {
    cpSync("content", dir, { recursive: true });
    const tmp = createApi(dir);
    assert.equal(tmp.handle("POST", "/api/save", { path: "battles/slots.yaml", battle: b }).status, 200);
    const text = readFileSync(join(dir, "battles/slots.yaml"), "utf-8");
    assert.match(text, /column: 3/);
    const back = parse(text);
    assert.deepEqual(resolvePlacements(api.pack, back.challenger), before);
    assert.deepEqual(layoutSide(c, back, "challenger").rows, layoutSide(c, b, "challenger").rows);
    // The same file through the CLI path (validate + engine): setup places the hero where the board showed it, and the log is deterministic.
    const sim = tmp.sim(back);
    const setup = sim.events.find((e: any) => e.type === "battle_setup") as any;
    const u = setup.units.find((x: any) => x.id === b.challenger.leader);
    assert.deepEqual([u.row, u.column], ["back", 3]);
    assert.equal(JSON.stringify(sim.events), JSON.stringify(tmp.sim(back).events));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid row value in a hand-edited battle does not throw", () => {
  const b = sample();
  const oi = b.challenger.heroes.findIndex((_: any, i: number) => i !== leaderIdx(b, "challenger"));
  b.challenger.heroes[oi].preferred_row = "middle";
  const l = layoutSide(c, b, "challenger");
  assert.equal(l.rows.length, 4);
  const shown = l.rows.flatMap((r) => r.cells).filter((x) => x?.kind === "hero");
  assert.equal(shown.length, b.challenger.heroes.length - 1, "the hero with the bad row is skipped");
});
