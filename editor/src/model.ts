// Plain-data helpers for the battle being edited. The editor keeps the battle as loose JSON (whatever form the file has) and lets the
// server's validator judge it; these helpers only build defaults and find things.
import type { CharacterInfo, ContentInfo } from "../apiTypes";

export type Json = any; // the battle is validated server-side; the UI edits it as plain data
export type SideKey = "challenger" | "defender";
export const SIDES: SideKey[] = ["challenger", "defender"];
export const SLOTS = [
  ["weapon", "weapon"],
  ["armor", "armor"],
  ["accessory_1", "accessory"],
  ["accessory_2", "accessory"],
] as const;

export const isRosterForm = (b: Json): boolean => !!b?.challenger && typeof b.challenger === "object" && "roster" in b.challenger;

/** Path (validator style) of a side's hero list: `challenger.heroes` or `challenger.roster.heroes`. */
export const heroesPath = (b: Json, side: SideKey) => (isRosterForm(b) ? `${side}.roster.heroes` : `${side}.heroes`);
export const heroesOf = (b: Json, side: SideKey): Json[] => (isRosterForm(b) ? b[side]?.roster?.heroes : b[side]?.heroes) ?? [];

export function defaultTactics(ch: CharacterInfo): Json[] {
  return ch.skills
    .filter((s) => s.kind === "active")
    .map((s, i) => ({ priority: i + 1, skill_id: s.id, enabled: true, main: null, sub: null }));
}

export function defaultHero(c: ContentInfo, ch: CharacterInfo): Json {
  const squad = c.soldiers.find((s) => (s.eligible_heroes.length === 0 || s.eligible_heroes.includes(ch.id)) && (s.eligible_classes.length === 0 || s.eligible_classes.includes(ch.class))) ?? c.soldiers[0];
  return {
    char_id: ch.id,
    squad_id: squad?.id ?? "",
    equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null },
    tactic_sheet: defaultTactics(ch),
  };
}

/** New fielded battle: the first two characters, one per side, each leading its side. */
export function newBattle(c: ContentInfo): Json {
  const [a, b] = c.characters;
  const side = (ch: CharacterInfo | undefined) => (ch ? { leader: ch.id, heroes: [defaultHero(c, ch)] } : { leader: "", heroes: [] });
  return { battle_id: "new_battle", version: "1", battlefield: null, seeds: [1, 2, 3], challenger: side(a), defender: side(b) };
}

/** Every char_id used anywhere in the battle (heroes are unique across both sides). */
export const usedHeroes = (b: Json): Set<string> => new Set(SIDES.flatMap((s) => heroesOf(b, s).map((h: Json) => h.char_id)));

/** The closest element for a validator path: exact `data-path`, else the longest data-path that is a prefix of it. */
export function elementForPath(path: string): HTMLElement | null {
  let best: HTMLElement | null = null;
  let len = -1;
  for (const el of document.querySelectorAll<HTMLElement>("[data-path]")) {
    const p = el.dataset.path!;
    if ((path === p || path.startsWith(p + ".") || path.startsWith(p + "[")) && p.length > len) {
      best = el;
      len = p.length;
    }
  }
  return best;
}
