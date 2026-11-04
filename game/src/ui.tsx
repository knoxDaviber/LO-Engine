// Shared pieces: scenery, class crests, popup behaviour and the field geometry that prep and battle share.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCENES, type Scene } from "./scenes";

/** Keeps a popup mounted while it animates out. */
export function useExit<T>(value: T | null, ms = 220): { shown: T | null; leaving: boolean } {
  const [shown, setShown] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setShown(value); return; }
    const t = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return { shown: value ?? shown, leaving: value === null && shown !== null };
}

export function useEsc(active: boolean, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); ref.current(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active]);
}

/** Size multiplier against the 1280x720 design size, for sprites (their size is in pixels). */
export function useScale(): number {
  const read = () => Math.min(window.innerHeight / 720, window.innerWidth / 1280);
  const [s, setS] = useState(read);
  useEffect(() => {
    const on = () => setS(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return Math.max(0.72, Math.min(s, 1.6));
}

// ------------------------------------------------------------------ field geometry
export type Lane = "soldier_back" | "back" | "front" | "soldier_front";
const LANE_X: Record<Lane, number> = { soldier_back: 7, back: 19, front: 33, soldier_front: 44.5 };
const COL_Y = [40, 60, 80];

/** Where a unit stands, in percent of the field. Columns slant a little so the lines read as depth. The enemy side mirrors the player's. */
export function fieldPos(side: "challenger" | "defender", lane: Lane, column: number): { x: number; y: number } {
  const c = column === 0 ? 2 : column;
  const x = LANE_X[lane] + (c - 2) * 1.6;
  return { x: side === "challenger" ? x : 100 - x, y: COL_Y[c - 1]! };
}

// ------------------------------------------------------------------ class crests
const CREST: Record<string, string> = {
  infantry: "M12 2l7 3v6c0 5-3 9-7 11-4-2-7-6-7-11V5z",
  lancer: "M12 1l3 7h-2v15h-2V8H9z",
  cavalry: "M5 21c0-6 2-9 5-11l-1-4 4 2c4 0 7 3 7 8h-3c0-2-1-3-3-4-1 3-2 6-2 9z",
  archer: "M6 2c8 2 12 8 12 20l-2-1C16 12 12 7 5 5zM3 20L17 6l1-3 3-1-1 3-3 1L5 21z",
  flyer: "M2 7c4 0 8 2 10 6 2-4 6-6 10-6-1 6-5 10-10 12C7 17 3 13 2 7z",
  mage: "M12 2l2.6 6.4L21 11l-6.4 2.6L12 20l-2.6-6.4L3 11l6.4-2.6z",
  holy: "M10 2h4v6h6v4h-6v10h-4V12H4V8h6z",
  assassin: "M19 2l3 3L8 19l2 2-2 1-2-2-3 2 2-3-2-2 1-2 2 2z",
  aquatic: "M12 2c4 6 7 9 7 13a7 7 0 01-14 0c0-4 3-7 7-13z",
  monster: "M3 3l5 5c3-1 5-1 8 0l5-5-1 10c0 5-4 9-8 9s-8-4-8-9z",
};

export function Crest({ cls, size = 18 }: { cls: string; size?: number }) {
  return (
    <span className={`crest crest-${cls}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66}><path d={CREST[cls] ?? CREST.infantry} fill="currentColor" /></svg>
    </span>
  );
}

export const cap = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export function Pips({ n, max, kind }: { n: number; max: number; kind: "active" | "passive" }) {
  return (
    <span className={`pips pips-${kind}`} role="img" aria-label={`${n} of ${max} ${kind} PP`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}

// ------------------------------------------------------------------ scenery
export function Backdrop({ scene, dim, embers = 22 }: { scene: Scene; dim?: boolean; embers?: number }) {
  return (
    <div className={`backdrop scene-${scene}`} aria-hidden>
      <img src={SCENES[scene].bg} alt="" />
      <div className="backdrop-haze" />
      {dim && <div className="backdrop-dim" />}
      <div className="embers">
        {Array.from({ length: embers }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-((i * 1.7) % 11)}s`, animationDuration: `${8 + (i % 6) * 1.6}s`, ["--drift" as string]: `${((i % 5) - 2) * 40}px` }} />
        ))}
      </div>
    </div>
  );
}

export function Screen({ name, children }: { name: string; children: ReactNode }) {
  return <main className={`screen screen-${name}`}>{children}</main>;
}
