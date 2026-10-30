import { loadPack, type RawPack } from "../src/load";
import { validateRaw } from "../src/validate";
import type { Tier } from "../src/types";

export const fresh = (): RawPack => structuredClone(loadPack("content"));
export const codes = (raw: RawPack, tier: Tier = "official") => validateRaw(raw, { tier }).report.issues.filter((i) => i.severity === "error").map((i) => i.code);
export const find = <T extends { id: string }>(xs: unknown[], id: string) => (xs as T[]).find((x) => x.id === id) as any;

/** A valid 6-hero roster: the 4 real heroes plus 2 clones with fresh ids. */
export function roster(raw: RawPack, over: Record<string, unknown> = {}) {
  const ids = ["char_001", "char_002", "char_003", "char_004"];
  const heroes = ids.map((id) => ({
    char_id: id, squad_id: "soldier_001",
    equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null },
    tactic_sheet: [],
  }));
  for (const n of ["char_101", "char_102"]) {
    const src = structuredClone(find(raw.characters, "char_004"));
    src.id = n; src.name = n; src.skills = [];
    raw.characters.push(src);
    heroes.push({ ...heroes[3]!, char_id: n });
  }
  const all = heroes.map((h) => h.char_id);
  return { roster_id: "t", version: "1", heroes, leader_line: all, anchor: null, ban_sheet: null, ...over };
}
