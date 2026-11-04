// Content bootstrap: builds the validated pack from content file texts (path relative to content/ -> YAML). The browser passes the texts
// bundled by Vite (game/src/pack.ts), the tests and tools pass readContentTexts. Pure: no DOM, no Node.
import { rawFromTexts } from "../../src/content";
import { validateRaw } from "../../src/validate/raw";
import type { Character } from "../../src/schema";
import type { Pack } from "../../src/validate/pack";

export function bootPack(texts: Record<string, string>): Pack {
  const { pack, report } = validateRaw(rawFromTexts(texts));
  const errors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/") && !i.file?.startsWith("rosters/"));
  if (!pack || errors.length > 0) throw new Error(`content has validation errors: ${errors.map((i) => i.code).join(", ")}`);
  addEnemyCopies(pack);
  return pack;
}

/**
 * Copies of every character per enemy slot (id `char_0NN_ck`), so one side can field the same hero or class twice (unit ids must be unique). Built from the source at boot, so they never drift.
 * Every hero id inside a copy (its own, and partners in aura leaves) takes the same suffix: a team of `_c1` copies keeps its synergies. Skills are shared, so they must never name a hero (a test holds this).
 */
export const ENEMY_COPIES = 5;
function addEnemyCopies(pack: Pack): void {
  const extend = (l: string[], from: string, to: string) => (l.includes(from) ? [...l, to] : l);
  for (const ch of [...pack.characters]) {
    for (let k = 1; k <= ENEMY_COPIES; k++) {
      const id = `${ch.id}_c${k}`;
      const c: Character = JSON.parse(JSON.stringify(ch).replace(/"(char_\d+)"/g, `"$1_c${k}"`));
      pack.characters.push(c);
      pack.byId.characters.set(id, c);
      for (const s of pack.skills) s.eligible.characters = extend(s.eligible.characters, ch.id, id);
      for (const e of pack.equipment) e.eligible.characters = extend(e.eligible.characters, ch.id, id);
      for (const s of pack.soldiers) s.eligible_heroes = extend(s.eligible_heroes, ch.id, id);
    }
  }
}
