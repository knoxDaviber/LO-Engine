// Pure board layout for ONE side (no DOM, no React, no Node). Reuses the engine's placement logic (src/formation.ts) so the board agrees with
// the validator and the simulator; the editor's ContentInfo is turned into a minimal stand-in pack.
// Placement is per slot (row + column, Decision 129): the grid is fixed, each hero sits in the cell the engine resolves for it.
// Roster form: the draft is NOT applied client-side, so every roster hero is shown (a side may list more heroes than are fielded); the leader
// is leader_line[0]. Fielded form: the leader is battle[side].leader.
import type { ContentInfo } from "../apiTypes";
import { classDefaultRow, resolvePlacements, resolveSquadPlacement, rowOverflows } from "../../src/formation";
import { heroesOf, isRosterForm, type Json, type SideKey } from "./model";

export type BoardRow = "soldier_front" | "front" | "back" | "soldier_back";
export type HeroRow = "front" | "back";
/** Display order, top (nearest the enemy for soldiers in front) to bottom. */
export const BOARD_ROWS: BoardRow[] = ["soldier_front", "front", "back", "soldier_back"];

export interface HeroCard { kind: "hero"; charId: string; name: string; cls: string; isLeader: boolean; index: number; row: HeroRow; column: number; overflow: boolean }
export interface SquadCard { kind: "squad"; squadId: string; name: string; cls: string; leaderId: string; index: number }
export type Cell = HeroCard | SquadCard | null;
export interface RowLayout { row: BoardRow; cells: Cell[] }
export interface SideLayout {
  /** BOARD_ROWS order. FIXED size: a hero row always has `columns` cells (cells[column - 1], null = empty slot); a soldier row has one cell (the squad spans the row). */
  rows: RowLayout[];
  columns: number;
  overflow: ("front" | "back")[]; // hero rows holding more heroes than columns (E_BATTLE_ROW_FULL)
  /** Heroes the engine resolves to a column beyond the grid (invalid input, the validator reports it): listed beside the board, still draggable into a slot. */
  offGrid: HeroCard[];
}

/** Stand-in for the engine's Pack: only what formation.ts reads. */
function standInPack(c: ContentInfo): any {
  return {
    byId: {
      characters: new Map(c.characters.map((ch) => [ch.id, { id: ch.id, class: ch.class, preferred_row: ch.preferred_row || undefined }])),
      soldiers: new Map(c.soldiers.map((s) => [s.id, { id: s.id, default_soldier_row: s.default_soldier_row }])),
    },
    rules: { board: { columns: c.rules.columns } },
  };
}

export const leaderOf = (battle: Json, side: SideKey): string | undefined =>
  isRosterForm(battle) ? battle[side]?.roster?.leader_line?.[0] : battle[side]?.leader;

/** The engine's view of one side. */
const engineSide = (battle: Json, side: SideKey): any => ({ leader: leaderOf(battle, side), heroes: heroesOf(battle, side) });

export function layoutSide(c: ContentInfo, battle: Json, side: SideKey): SideLayout {
  const pack = standInPack(c);
  const s = engineSide(battle, side);
  const columns = c.rules.columns;
  const cells: Record<BoardRow, Cell[]> = {
    soldier_front: [null], front: Array.from({ length: columns }, () => null), back: Array.from({ length: columns }, () => null), soldier_back: [null],
  };
  const offGrid: HeroCard[] = [];
  const chars = new Map(c.characters.map((ch) => [ch.id, ch]));
  for (const p of resolvePlacements(pack, s)) {
    if (p.row !== "front" && p.row !== "back") continue; // hand-edited row value the schema rejects: the validator reports it, the board skips the hero
    const ch = chars.get(p.charId);
    const inGrid = Number.isInteger(p.column) && p.column >= 1 && p.column <= columns;
    const card: HeroCard = { kind: "hero", charId: p.charId, name: ch?.name ?? p.charId, cls: ch?.class ?? "infantry", isLeader: p.charId === s.leader, index: p.order, row: p.row, column: p.column, overflow: !inGrid };
    if (inGrid) cells[p.row][p.column - 1] = card;
    else offGrid.push(card);
  }
  const sq = resolveSquadPlacement(pack, s);
  if (sq) {
    const st = c.soldiers.find((x) => x.id === sq.squadId);
    cells[sq.boardRow][0] = { kind: "squad", squadId: sq.squadId, name: st?.name ?? sq.squadId, cls: st?.class ?? "infantry", leaderId: sq.leaderCharId, index: sq.leaderOrder };
  }
  return { rows: BOARD_ROWS.map((row) => ({ row, cells: cells[row] })), columns, overflow: rowOverflows(pack, s), offGrid };
}

export type DragItem = { kind: "hero" | "squad"; index: number };
type Edit = (b: Json) => void;
/** A board slot: a hero row plus its column (1-based), or a whole soldier row (no column). */
export type Target = { row: BoardRow; column?: number };
export type StepDir = "left" | "right" | "up" | "down";

const resolved = (c: ContentInfo, battle: Json, side: SideKey) => resolvePlacements(standInPack(c), engineSide(battle, side));

/** Put a hero entry on an explicit slot. preferred_row is deleted only when it equals the character's default; the column always stays explicit. */
function setSlot(c: ContentInfo, h: Json, row: HeroRow, column: number) {
  const ch = c.characters.find((x) => x.id === h.char_id);
  const def = ch?.preferred_row || (ch ? classDefaultRow(ch.class as any) : "front");
  if (row === def) delete h.preferred_row;
  else h.preferred_row = row;
  if (column > c.rules.columns) delete h.column; // an off-grid stand-in position is not a slot
  else h.column = column;
}

/**
 * What dropping `item` on `target` would do: "empty" (moves there), "swap" (an occupied hero slot: the two heroes trade places), or null
 * (not allowed or changes nothing). Heroes only go to hero slots (any of the 2 x columns, leader included); the squad only to the other
 * soldier row (squad_row).
 */
export function dropKind(c: ContentInfo, battle: Json, side: SideKey, item: DragItem, target: Target): "empty" | "swap" | null {
  const entry = heroesOf(battle, side)[item.index];
  if (!entry) return null;
  if (item.kind === "squad") {
    if (target.row !== "soldier_front" && target.row !== "soldier_back") return null;
    if (entry.char_id !== leaderOf(battle, side)) return null; // only the leader's squad is deployed
    const sq = resolveSquadPlacement(standInPack(c), engineSide(battle, side));
    return sq && sq.boardRow !== target.row ? "empty" : null;
  }
  if (target.row !== "front" && target.row !== "back") return null;
  const col = target.column;
  if (col === undefined || !Number.isInteger(col) || col < 1 || col > c.rules.columns) return null;
  const ps = resolved(c, battle, side);
  const me = ps.find((p) => p.order === item.index);
  if (!me || (me.row === target.row && me.column === col)) return null;
  return ps.some((p) => p.order !== item.index && p.row === target.row && p.column === col) ? "swap" : "empty";
}

/**
 * The edit that drops a card on a board slot, or null when not allowed / a no-op (see dropKind). A hero move writes `preferred_row` + `column`
 * on that hero (an occupant is swapped: both get explicit row + column); heroes the move would shift through auto-fill are pinned to where
 * they stood, so only the dragged hero(es) change on screen. Squad: sets `squad_row`. Keys equal to the default are deleted (preferred_row, squad_row).
 */
export function moveEdit(c: ContentInfo, battle: Json, side: SideKey, item: DragItem, target: Target): Edit | null {
  const kind = dropKind(c, battle, side, item, target);
  if (!kind) return null;
  const entry = heroesOf(battle, side)[item.index];
  if (item.kind === "squad") {
    const want = target.row === "soldier_front" ? "front" : "back";
    const def = c.soldiers.find((x) => x.id === entry.squad_id)?.default_soldier_row;
    return (b) => {
      const h = heroesOf(b, side)[item.index];
      if (want === def) delete h.squad_row;
      else h.squad_row = want;
    };
  }
  const before = new Map(resolved(c, battle, side).map((p) => [p.order, p]));
  const mine = before.get(item.index)!;
  const col = target.column!;
  const occ = [...before.values()].find((p) => p.order !== item.index && p.row === target.row && p.column === col);
  return (b) => {
    const hs = heroesOf(b, side);
    setSlot(c, hs[item.index], target.row as HeroRow, col);
    if (occ) setSlot(c, hs[occ.order], mine.row as HeroRow, mine.column);
    for (const p of resolved(c, b, side)) {
      const was = before.get(p.order);
      if (p.order === item.index || p.order === occ?.order || !was) continue;
      if ((was.row !== p.row || was.column !== p.column) && was.column <= c.rules.columns) setSlot(c, hs[p.order], was.row as HeroRow, was.column);
    }
  };
}

/**
 * Keyboard move by one slot in screen terms (the board draws hero lanes left to right: challenger back -> front, defender front -> back;
 * columns run top to bottom). Left/right change the row (squad: to the other soldier row), up/down the column. Swaps when occupied.
 */
export function stepEdit(c: ContentInfo, battle: Json, side: SideKey, item: DragItem, dir: StepDir): Edit | null {
  const visual = side === "defender" ? BOARD_ROWS : [...BOARD_ROWS].reverse();
  if (item.kind === "squad") {
    if (dir === "up" || dir === "down") return null;
    const here = resolveSquadPlacement(standInPack(c), engineSide(battle, side))?.boardRow;
    if (!here) return null;
    const rest = dir === "right" ? visual.slice(visual.indexOf(here) + 1) : visual.slice(0, visual.indexOf(here)).reverse();
    const row = rest.find((r) => r.startsWith("soldier"));
    return row ? moveEdit(c, battle, side, item, { row }) : null;
  }
  const me = resolved(c, battle, side).find((p) => p.order === item.index);
  if (!me || (me.row !== "front" && me.row !== "back")) return null;
  if (dir === "up" || dir === "down") return moveEdit(c, battle, side, item, { row: me.row, column: me.column + (dir === "down" ? 1 : -1) });
  const lanes = visual.filter((r) => r === "front" || r === "back");
  const row = lanes[lanes.indexOf(me.row) + (dir === "right" ? 1 : -1)];
  return row ? moveEdit(c, battle, side, item, { row, column: me.column }) : null;
}
