// Pinned items (pure): the model, list operations, and a tolerant parser for what localStorage hands back (it may hold junk or an old shape).

export type PinKind = "page" | "unit" | "panel";
/** `id` is unique (`page:units`, `unit:char_001`, `panel:issues`); `ref` says what to render, `title` is the strip label. */
export interface Pin { id: string; kind: PinKind; ref: string; title: string }
export interface PinUi { height: number; collapsed: boolean }
export interface PinState extends PinUi { pins: Pin[] }

export const PIN_MIN_HEIGHT = 80;
export const PIN_MAX_HEIGHT = 700;
export const PIN_DEFAULT_HEIGHT = 240;
export const PIN_KEY = "editor.pins.v1";

export const clampHeight = (h: number): number =>
  Number.isFinite(h) ? Math.min(PIN_MAX_HEIGHT, Math.max(PIN_MIN_HEIGHT, Math.round(h))) : PIN_DEFAULT_HEIGHT;

/** Appends; a pin whose id is already present leaves the list unchanged (same array). */
export const addPin = (pins: Pin[], pin: Pin): Pin[] => (pins.some((p) => p.id === pin.id) ? pins : [...pins, pin]);

export const removePin = (pins: Pin[], id: string): Pin[] => (pins.some((p) => p.id === id) ? pins.filter((p) => p.id !== id) : pins);

/** Moves the pin to `index` (clamped to the list); an unknown id leaves the list unchanged. */
export function movePin(pins: Pin[], id: string, index: number): Pin[] {
  const from = pins.findIndex((p) => p.id === id);
  if (from < 0) return pins;
  const to = Math.min(pins.length - 1, Math.max(0, index));
  if (to === from) return pins;
  const next = pins.slice();
  const [p] = next.splice(from, 1);
  next.splice(to, 0, p!);
  return next;
}

/** One step left (-1) or right (+1): the keyboard version of dragging. */
export function shiftPin(pins: Pin[], id: string, delta: -1 | 1): Pin[] {
  const from = pins.findIndex((p) => p.id === id);
  return from < 0 ? pins : movePin(pins, id, from + delta);
}

export const togglePin = (pins: Pin[], pin: Pin): Pin[] => (pins.some((p) => p.id === pin.id) ? removePin(pins, pin.id) : addPin(pins, pin));

const KINDS: readonly string[] = ["page", "unit", "panel"];
const isPin = (x: unknown): x is Pin => {
  const p = x as Record<string, unknown> | null;
  return !!p && typeof p === "object" && typeof p.id === "string" && typeof p.ref === "string" && typeof p.title === "string" && typeof p.kind === "string" && KINDS.includes(p.kind);
};

/** Accepts a JSON string or an already parsed value; ignores anything that is not a valid pin and drops duplicate ids. Never throws. */
export function parsePins(raw: unknown): Pin[] {
  let v = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return []; }
  }
  const list = Array.isArray(v) ? v : [];
  let out: Pin[] = [];
  for (const x of list) if (isPin(x)) out = addPin(out, { id: x.id, kind: x.kind, ref: x.ref, title: x.title });
  return out;
}

/** Stored shape: `{ pins, height, collapsed }`; a bare array (older shape) is read as pins only. */
export function parseState(raw: unknown): PinState {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    pins: parsePins(Array.isArray(raw) ? raw : o.pins),
    height: typeof o.height === "number" ? clampHeight(o.height) : PIN_DEFAULT_HEIGHT,
    collapsed: o.collapsed === true,
  };
}

export const serializeState = (s: PinState): string => JSON.stringify({ pins: s.pins, height: clampHeight(s.height), collapsed: s.collapsed });
