// Row/column resolution shared by the engine (buildUnits) and the battle validator, so both agree on who stands where.
import type { Battle, Character, Row, UnitClass } from "./schema";
import type { Pack } from "./validate/pack";

export interface Placement {
  /** Index into the side's hero list. */
  order: number;
  charId: string;
  row: Row;
  /** 1-based column inside the row: the entry's explicit `column`, else the lowest free one. Not clamped: it can exceed rules.board.columns (see rowOverflows). */
  column: number;
  /** Front-left to back-right across the side. */
  formationIndex: number;
}

/** Default hero row per class (design Section 10 [DEFAULT]): ranged and frail classes (archer, mage, holy) and assassin/flyer [DECIDED] stand back, the rest front. */
const BACK_CLASSES: readonly UnitClass[] = ["archer", "mage", "holy", "assassin", "flyer"];
export const classDefaultRow = (cls: UnitClass): Row => (BACK_CLASSES.includes(cls) ? "back" : "front");

/**
 * Row of one hero: the roster entry's preferred_row (per-hero override), else the character's preferred_row, else the class default.
 * The leader is not special: it may stand front or back (Decision 129).
 */
export function heroRow(pack: Pick<Pack, "byId">, _side: Battle["challenger"], h: Battle["challenger"]["heroes"][number]): Row {
  const ch = pack.byId.characters.get(h.char_id) as Character | undefined;
  return h.preferred_row ?? ch?.preferred_row ?? (ch ? classDefaultRow(ch.class) : "front");
}

/**
 * Slot-based placement (Decision 129): the hero grid is 2 rows x `rules.board.columns` separate slots. A hero with an explicit `column`
 * claims exactly (row, column); the others fill the lowest free column(s) of their row in roster order (omitted column = auto).
 * Two heroes claiming the same slot: resolvePlacements itself auto-places the later claimant; the validator reports it
 * (slotConflicts, E_BATTLE_SLOT) and the engine throws on it (state.ts). formationIndex runs front-left to back-right (front row first, then column ascending, then back row).
 */
export function resolvePlacements(pack: Pick<Pack, "byId">, side: Battle["challenger"]): Placement[] {
  const rows = side.heroes.map((h) => heroRow(pack, side, h));
  const taken: Record<Row, Set<number>> = { front: new Set(), back: new Set() };
  const col: (number | null)[] = side.heroes.map(() => null);
  side.heroes.forEach((h, i) => {
    const r = rows[i]!;
    if (h.column !== undefined && taken[r]?.has(h.column) === false) { taken[r].add(h.column); col[i] = h.column; }
  });
  side.heroes.forEach((_h, i) => {
    if (col[i] !== null) return;
    const set = taken[rows[i]!] ?? (taken[rows[i]!] = new Set());
    let c = 1;
    while (set.has(c)) c++;
    set.add(c);
    col[i] = c;
  });
  const placed = side.heroes.map((h, order) => ({ order, charId: h.char_id, row: rows[order]!, column: col[order]! }));
  placed.sort((a, b) => (a.row === b.row ? a.column - b.column || a.order - b.order : a.row === "front" ? -1 : 1));
  return placed.map((d, i) => ({ ...d, formationIndex: i }));
}

/** Slots inside the board claimed explicitly by more than one hero (the placement keeps the first claimant). A column beyond the board is
 * reported on its own (columnsOffBoard), not here, so one cause gives one error. */
export function slotConflicts(pack: Pick<Pack, "byId" | "rules">, side: Battle["challenger"]): { row: Row; column: number; charIds: string[] }[] {
  const claims = new Map<string, { row: Row; column: number; charIds: string[] }>();
  for (const h of side.heroes) {
    if (h.column === undefined || h.column > pack.rules.board.columns) continue;
    const row = heroRow(pack, side, h);
    const k = `${row}:${h.column}`;
    const e = claims.get(k) ?? { row, column: h.column, charIds: [] };
    e.charIds.push(h.char_id);
    claims.set(k, e);
  }
  return [...claims.values()].filter((e) => e.charIds.length > 1);
}

/** Rows holding more heroes than the board has columns (E_BATTLE_ROW_FULL). An explicit column past the end in a row that is not full is
 * E_BATTLE_SLOT only (columnsOffBoard). */
export function rowOverflows(pack: Pick<Pack, "byId" | "rules">, side: Battle["challenger"]): Row[] {
  const count: Record<Row, number> = { front: 0, back: 0 };
  for (const h of side.heroes) count[heroRow(pack, side, h)] = (count[heroRow(pack, side, h)] ?? 0) + 1;
  return (["front", "back"] as const).filter((r) => count[r] > pack.rules.board.columns);
}

/** Heroes whose explicit column is beyond rules.board.columns (E_BATTLE_SLOT; the validator reports it per entry, the engine throws). */
export const columnsOffBoard = (pack: Pick<Pack, "rules">, side: Battle["challenger"]): string[] =>
  side.heroes.filter((h) => h.column != null && h.column > pack.rules.board.columns).map((h) => h.char_id);

export interface SquadPlacement {
  /** Index of the leader in the side's hero list. */
  leaderOrder: number;
  leaderCharId: string;
  squadId: string;
  /** Resolved squad_row: the entry's squad_row, else the soldier type's default_soldier_row. Not checked against allowed_soldier_rows (the validator reports E_SQUAD_ROW, the engine throws). */
  row: Row;
  /** The board row the squad fills: the soldier row in front of or behind the hero rows. Heroes never stand in these. */
  boardRow: "soldier_front" | "soldier_back";
}

/** Only the leader's squad is deployed (design Section 2). Null when the leader or its soldier type is unknown. */
export function resolveSquadPlacement(pack: Pick<Pack, "byId">, side: Battle["challenger"]): SquadPlacement | null {
  const leaderOrder = side.heroes.findIndex((h) => h.char_id === side.leader);
  if (leaderOrder < 0) return null;
  const h = side.heroes[leaderOrder]!;
  const st = pack.byId.soldiers.get(h.squad_id);
  if (!st) return null;
  const row: Row = h.squad_row ?? st.default_soldier_row;
  return { leaderOrder, leaderCharId: h.char_id, squadId: h.squad_id, row, boardRow: row === "front" ? "soldier_front" : "soldier_back" };
}
