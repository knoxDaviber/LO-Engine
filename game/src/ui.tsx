// Shared pieces: scenery, class crests, popup behaviour and the field geometry that prep and battle share.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
const COL_Y = [36, 58, 80];

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
/** A jagged ridge line as an SVG path, seeded so it never changes between renders. */
function ridge(seed: number, base: number, height: number, rough: number): string {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts: string[] = [];
  let y = base;
  for (let x = -20; x <= 1620; x += 40) {
    const big = Math.sin((x + seed) / 230) * height + Math.sin((x + seed * 3) / 97) * height * 0.4;
    y = base - big - r() * rough;
    pts.push(`${x},${y.toFixed(0)}`);
  }
  return `M-20,900 L${pts.join(" L")} L1620,900 Z`;
}

function pines(seed: number, base: number, n: number): string {
  let s = seed, d = "";
  const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const x = r() * 1640 - 20, h = 34 + r() * 56, w = h * 0.36, y = base + Math.sin(x / 180) * 16 + r() * 18;
    d += `M${x - w},${y} L${x},${y - h} L${x + w},${y} Z`;
  }
  return d;
}

const SCENES = {
  dawn: { sky: ["#1b2a52", "#7d4b73", "#f0a35e"], sun: "#ffd9a0", sunY: 470, far: "#4d3f6f", mid: "#2f2a50", near: "#191a33", haze: "#ffb37a" },
  dusk: { sky: ["#141a3c", "#6a2c5e", "#e8603c"], sun: "#ff9a5c", sunY: 500, far: "#46285a", mid: "#2a1a42", near: "#140f28", haze: "#ff7a48" },
  night: { sky: ["#05070f", "#111a3a", "#2a2f63"], sun: "#dfe6ff", sunY: 200, far: "#1b2147", mid: "#121633", near: "#080a1c", haze: "#7f8fe0" },
} as const;
export type Scene = keyof typeof SCENES;

export function Backdrop({ scene, castle, embers = 22 }: { scene: Scene; castle?: boolean; embers?: number }) {
  const c = SCENES[scene];
  const paths = useMemo(() => ({ far: ridge(11, 560, 70, 34), mid: ridge(29, 640, 46, 20), near: ridge(47, 730, 26, 8), pines: pines(5, 700, 70), pines2: pines(9, 780, 44) }), []);
  return (
    <div className="backdrop" aria-hidden>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id={`sky-${scene}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.sky[0]} /><stop offset="0.55" stopColor={c.sky[1]} /><stop offset="0.8" stopColor={c.sky[2]} />
          </linearGradient>
          <radialGradient id={`sun-${scene}`}><stop offset="0" stopColor={c.sun} stopOpacity="1" /><stop offset="0.22" stopColor={c.sun} stopOpacity="0.9" /><stop offset="1" stopColor={c.sun} stopOpacity="0" /></radialGradient>
          <linearGradient id={`haze-${scene}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.haze} stopOpacity="0" /><stop offset="1" stopColor={c.haze} stopOpacity="0.28" /></linearGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="26" /></filter>
        </defs>
        <rect width="1600" height="900" fill={`url(#sky-${scene})`} />
        {scene === "night" && Array.from({ length: 90 }, (_, i) => (
          <circle key={i} className="star" style={{ animationDelay: `${(i % 9) * 0.5}s` }} cx={(i * 197) % 1600} cy={(i * 89) % 430} r={i % 7 === 0 ? 1.8 : 1} fill="#dfe6ff" />
        ))}
        <circle cx="1120" cy={c.sunY} r="300" fill={`url(#sun-${scene})`} />
        <g className="clouds" filter="url(#soft)" opacity="0.35">
          <ellipse cx="320" cy="250" rx="300" ry="30" fill={c.sun} />
          <ellipse cx="1000" cy="170" rx="360" ry="26" fill={c.sun} />
          <ellipse cx="1400" cy="330" rx="260" ry="22" fill={c.sun} />
        </g>
        <path d={paths.far} fill={c.far} />
        <rect y="400" width="1600" height="300" fill={`url(#haze-${scene})`} />
        {castle && (
          <g fill={c.mid} transform="translate(980 340)">
            <path d="M0 260V120h24v-20h16v20h24v-20h16v20h24V60l-10 0 30-58 30 58h-10v60h30V90h16v14h16V90h16v14h16V90h16v170z" />
            <path d="M260 260V150l26-50 26 50v110z" />
            <path d="M-160 420 C-60 300 20 262 60 258 H300 C350 262 430 320 520 420 Z" />
            <g fill="#ffcf7a" opacity="0.85"><rect x="126" y="100" width="6" height="14" rx="3" /><rect x="150" y="140" width="6" height="14" rx="3" /><rect x="284" y="160" width="5" height="12" rx="2.5" /><rect x="44" y="170" width="6" height="12" rx="3" /></g>
          </g>
        )}
        <path d={paths.mid} fill={c.mid} />
        <path d={paths.pines} fill={c.mid} />
        <path d={paths.near} fill={c.near} />
        <path d={paths.pines2} fill={c.near} />
      </svg>
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
