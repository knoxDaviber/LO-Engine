import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ContentInfo } from "../apiTypes";
import { BOARD_ROWS, dropKind, layoutSide, moveEdit, stepEdit, type BoardRow, type Cell, type DragItem, type StepDir, type Target } from "./formationLayout";
import type { Json, SideKey } from "./model";
import { Sprite } from "./Sprite";
import "./formation.css";

const LABEL: Record<BoardRow, string> = { soldier_front: "soldiers front", front: "front", back: "back", soldier_back: "soldiers back" };
const ARROW: Record<string, StepDir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const GLYPH: Record<StepDir, string> = { left: "◀", right: "▶", up: "▲", down: "▼" };

interface Props {
  c: ContentInfo;
  battle: Json;
  side: SideKey;
  edit: (fn: (b: Json) => void) => void;
  selected: string | null;
  select: (id: string) => void;
}

const same = (a: DragItem | null, cell: Cell) => !!a && !!cell && a.kind === cell.kind && a.index === cell.index;

/**
 * One side's board: a FIXED grid (hero lanes of `columns` separate slots each, plus the two soldier lanes), whatever is standing in it.
 * Challenger lanes run back -> front left to right, defender front -> back, so the two sides face each other; columns run top to bottom.
 * While a card is dragged (or held with Alt for keyboard moves) every valid empty slot shows a slowly fading "+", valid occupied slots a swap
 * highlight, everything else is dimmed. State lives in `battle` only: every move is an `edit` of the battle JSON (preferred_row + column).
 */
export function FormationBoard({ c, battle, side, edit, selected, select }: Props) {
  const layout = layoutSide(c, battle, side);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [picked, setPicked] = useState<DragItem | null>(null); // keyboard: Alt held on a focused card
  const [over, setOver] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const mirror = side === "defender";
  const order = mirror ? BOARD_ROWS : [...BOARD_ROWS].reverse();
  const active = drag ?? picked;

  // A moved card is a new element in another slot: give the keyboard focus back to it.
  useEffect(() => {
    if (!refocus.current) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-card="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const keyOf = (r: BoardRow, col: number | undefined) => `${r}:${col ?? 0}`;
  const kindAt = (t: Target) => (active ? dropKind(c, battle, side, active, t) : null);
  const drop = (t: Target) => {
    const fn = drag && moveEdit(c, battle, side, drag, t);
    setDrag(null);
    setOver(null);
    if (fn) edit(fn);
  };
  const step = (item: DragItem, id: string, dir: StepDir) => {
    const fn = stepEdit(c, battle, side, item, dir);
    if (fn) { refocus.current = `${item.kind}:${id}`; edit(fn); }
  };
  const key = (e: KeyboardEvent, item: DragItem, id: string) => {
    if (e.key === "Alt") { setPicked(item); return; }
    if (!e.altKey && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      select(id);
      return;
    }
    const dir = ARROW[e.key];
    if (!e.altKey || !dir) return;
    e.preventDefault();
    setPicked(item);
    step(item, id, dir);
  };

  const card = (cell: NonNullable<Cell>, row: BoardRow) => {
    const item: DragItem = { kind: cell.kind, index: cell.index };
    const isSquad = cell.kind === "squad";
    const id = isSquad ? cell.leaderId : cell.charId;
    const cls = ["fm-card", isSquad && "squad", !isSquad && cell.isLeader && "leader", !isSquad && cell.overflow && "overflow", selected === id && "selected", same(drag, cell) && "dragging"].filter(Boolean).join(" ");
    const dirs: StepDir[] = isSquad ? ["left", "right"] : ["left", "up", "down", "right"];
    return (
      <div
        className={cls}
        data-card={`${cell.kind}:${id}`}
        draggable
        tabIndex={0}
        title={`${isSquad ? "squad" : cell.cls}, ${LABEL[row]}${isSquad ? "" : ` column ${cell.column}`}${!isSquad && cell.overflow ? " (beyond the board)" : ""}. Drag to a slot, or Alt+arrows`}
        onClick={() => select(id)}
        onKeyDown={(e) => key(e, item, id)}
        onKeyUp={(e) => { if (e.key === "Alt") setPicked(null); }}
        onBlur={() => setPicked(null)}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); setDrag(item); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
      >
        <Sprite cls={cell.cls} name={cell.name} mirror={mirror} size={56} />
        <span className="fm-name">{cell.name}</span>
        <span className="fm-cls">{isSquad ? `squad, ${cell.cls}` : cell.cls}</span>
        {!isSquad && cell.isLeader && <span className="fm-badge">leader</span>}
        {!isSquad && cell.overflow && <span className="fm-warn">overflow</span>}
        <span className="fm-move">
          {dirs.map((d) => (
            <button key={d} type="button" disabled={!stepEdit(c, battle, side, item, d)} aria-label={`move ${d}`}
              onClick={(e) => { e.stopPropagation(); step(item, id, d); }}>{GLYPH[d]}</button>
          ))}
        </span>
      </div>
    );
  };

  const slot = (cell: Cell, row: BoardRow, column: number | undefined, i: number) => {
    const t: Target = { row, column };
    const kind = kindAt(t);
    const k = keyOf(row, column);
    const cls = ["fm-slot", column === undefined && "wide", kind === "empty" && "can-empty", kind === "swap" && "can-swap", active && !kind && !same(active, cell) && "invalid", over === k && kind && "over"].filter(Boolean).join(" ");
    return (
      <div
        key={i}
        className={cls}
        data-slot={k}
        onDragOver={(e) => { if (kind && drag) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== k) setOver(k); } }}
        onDragLeave={() => setOver((o) => (o === k ? null : o))}
        onDrop={(e) => { e.preventDefault(); drop(t); }}
      >
        {cell && card(cell, row)}
      </div>
    );
  };

  return (
    <div className={`fm-wrap ${side}`}>
      <div ref={boardRef} className={`fm-board ${side}${active ? " active" : ""}`} aria-label={`${side} formation`} style={{ "--cols": layout.columns } as CSSProperties}>
        {order.map((row) => {
          const rl = layout.rows.find((r) => r.row === row)!;
          const soldier = row.startsWith("soldier");
          return (
            <div key={row} className={`fm-lane${soldier ? " soldier" : ""}`}>
              <div className="fm-label">{LABEL[row]}</div>
              <div className="fm-cells">{rl.cells.map((cell, i) => slot(cell, row, soldier ? undefined : i + 1, i))}</div>
            </div>
          );
        })}
      </div>
      {layout.offGrid.length > 0 && (
        <div className="fm-offgrid" aria-label={`${side} heroes beyond the board`}>
          {layout.offGrid.map((cell) => <div key={cell.charId} className="fm-slot">{card(cell, cell.row)}</div>)}
        </div>
      )}
    </div>
  );
}
