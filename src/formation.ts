// Row/column resolution shared by the engine (buildUnits) and the battle validator, so both agree on who stands where.
import type { Battle, Character, Row, UnitClass } from "./schema";
import type { Pack } from "./validate/pack";

export interface Placement {
  /** Index into the side's hero list. */
  order: number;
  charId: string;
  row: Row;
  /** 1-based column inside the row, by roster order. Not clamped: it can exceed rules.board.columns (see rowOverflows). */
  column: number;
  /** Front-left to back-right across the side. */
  formationIndex: number;
}

/** Default hero row per class (design Section 10 [DEFAULT]): ranged and frail classes (archer, mage, holy) and assassin/flyer [DECIDED] stand back, the rest front. */
const BACK_CLASSES: readonly UnitClass[] = ["archer", "mage", "holy", "assassin", "flyer"];
export const classDefaultRow = (cls: UnitClass): Row => (BACK_CLASSES.includes(cls) ? "back" : "front");

/**
 * Row of one hero: the leader is always front; otherwise the roster entry's preferred_row (per-hero override), else the character's
 * preferred_row, else the class default.
 */
export function heroRow(pack: Pick<Pack, "byId">, side: Battle["challenger"], h: Battle["challenger"]["heroes"][number]): Row {
  if (h.char_id === side.leader) return "front";
  const ch = pack.byId.characters.get(h.char_id) as Character | undefined;
  return h.preferred_row ?? ch?.preferred_row ?? (ch ? classDefaultRow(ch.class) : "front");
}

/** Leader is forced to the front row; others use the entry's preferred_row, else the character's. Front row first, then back, roster order inside a row. */
export function resolvePlacements(pack: Pick<Pack, "byId">, side: Battle["challenger"]): Placement[] {
  const drafted = side.heroes.map((h, order) => {
    return { order, charId: h.char_id, row: heroRow(pack, side, h) };
  });
  drafted.sort((a, b) => (a.row === b.row ? a.order - b.order : a.row === "front" ? -1 : 1));
  const perRow: Record<Row, number> = { front: 0, back: 0 };
  return drafted.map((d, i) => ({ ...d, column: ++perRow[d.row], formationIndex: i }));
}

/** Rows that hold more heroes than the board has columns. */
export function rowOverflows(pack: Pick<Pack, "byId" | "rules">, side: Battle["challenger"]): Row[] {
  const counts: Record<Row, number> = { front: 0, back: 0 };
  for (const p of resolvePlacements(pack, side)) counts[p.row]++;
  return (["front", "back"] as const).filter((r) => counts[r] > pack.rules.board.columns);
}

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
