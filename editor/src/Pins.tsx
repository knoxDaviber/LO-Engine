// Pinning: a "pin" button for any panel/page/unit, and the strip shown above every page. The strip only lays pins out; what a pin shows is
// rendered by the caller (`render`), live from App state. The list operations are pure (pins.ts); the state is saved by the caller.
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { PIN_MAX_HEIGHT, PIN_MIN_HEIGHT, clampHeight, movePin, removePin, shiftPin, type Pin, type PinState } from "./pinStore";

interface PinApi { has: (id: string) => boolean; toggle: (pin: Pin) => void }
const PinCtx = createContext<PinApi>({ has: () => false, toggle: () => {} });
export const PinProvider = PinCtx.Provider;

export function PinButton({ pin }: { pin: Pin }) {
  const api = useContext(PinCtx);
  const on = api.has(pin.id);
  return (
    <button type="button" className="small pinbtn" aria-pressed={on} title={on ? `Unpin ${pin.title}` : `Pin ${pin.title} to the strip above every page`} onClick={() => api.toggle(pin)}>
      {on ? "unpin" : "pin"}
    </button>
  );
}

/** Panel title row with its pin button (and optional extra controls). */
export function PanelHead({ title, pin, children }: { title: ReactNode; pin: Pin; children?: ReactNode }) {
  return (
    <div className="panelhead">
      <h2>{title}</h2>
      <PinButton pin={pin} />
      {children}
    </div>
  );
}

interface StripProps { state: PinState; set: (fn: (s: PinState) => PinState) => void; render: (pin: Pin) => ReactNode }

export function PinStrip({ state, set, render }: StripProps) {
  const { pins, height, collapsed } = state;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  if (pins.length === 0) return null;

  const resize = (h: number) => set((s) => ({ ...s, height: clampHeight(h) }));
  const drop = (target: string) => {
    if (dragId && dragId !== target) set((s) => ({ ...s, pins: movePin(s.pins, dragId, s.pins.findIndex((p) => p.id === target)) }));
    setDragId(null);
    setOverId(null);
  };

  return (
    <section className="pins" aria-label="Pinned items">
      <div className="pins-bar">
        <button type="button" className="small ghost" aria-expanded={!collapsed} onClick={() => set((s) => ({ ...s, collapsed: !s.collapsed }))}>
          {collapsed ? "show" : "hide"} pinned
        </button>
        <span>{pins.length} pinned</span>
      </div>
      {!collapsed && (
        <>
          <div className="pins-body" style={{ height }}>
            {pins.map((p, i) => (
              <div
                key={p.id} className={`pinitem ${overId === p.id && dragId !== p.id ? "dragover" : ""}`}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(p.id); } }}
                onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); drop(p.id); }}
              >
                <div className="pinitem-head" draggable onDragStart={(e) => { setDragId(p.id); e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(null); setOverId(null); }}>
                  <span className="title" title={p.title}>{p.title}</span>
                  <button type="button" className="small ghost" aria-label={`Move ${p.title} left`} disabled={i === 0} onClick={() => set((s) => ({ ...s, pins: shiftPin(s.pins, p.id, -1) }))}>&larr;</button>
                  <button type="button" className="small ghost" aria-label={`Move ${p.title} right`} disabled={i === pins.length - 1} onClick={() => set((s) => ({ ...s, pins: shiftPin(s.pins, p.id, 1) }))}>&rarr;</button>
                  <button type="button" className="small" aria-label={`Unpin ${p.title}`} onClick={() => set((s) => ({ ...s, pins: removePin(s.pins, p.id) }))}>unpin</button>
                </div>
                <div className="pinitem-body">{render(p)}</div>
              </div>
            ))}
          </div>
          <div
            className="pins-handle" role="separator" tabIndex={0} aria-orientation="horizontal" aria-valuemin={PIN_MIN_HEIGHT} aria-valuemax={PIN_MAX_HEIGHT} aria-valuenow={height}
            aria-label="Resize pinned strip: arrow up and down"
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, h: height }; }}
            onPointerMove={(e) => { if (drag.current) resize(drag.current.h + e.clientY - drag.current.y); }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); resize(height + (e.key === "ArrowDown" ? 20 : -20)); }
              else if (e.key === "Home") { e.preventDefault(); resize(PIN_MIN_HEIGHT); }
              else if (e.key === "End") { e.preventDefault(); resize(PIN_MAX_HEIGHT); }
            }}
          />
        </>
      )}
    </section>
  );
}
