// Per-viewer conveniences only: localStorage may be missing, full, blocked or throw, so every access is wrapped and the UI works without it.
// Also the tiny pure bits that need no React (hash route parsing), so node:test can load them.

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the setting just does not persist */
  }
}

export const ROUTES = ["battle", "units", "log"] as const;
export type Route = (typeof ROUTES)[number];

/** `#/units` -> "units"; anything unknown or empty falls back to the battle page. */
export function parseRoute(hash: string): Route {
  const m = /^#\/([a-z]+)/.exec(hash);
  return m && (ROUTES as readonly string[]).includes(m[1]!) ? (m[1] as Route) : "battle";
}

export type Theme = "auto" | "light" | "dark";
export const THEMES: Theme[] = ["auto", "light", "dark"];
