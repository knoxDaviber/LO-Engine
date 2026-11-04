// Team sharing: a fielded side to a pasteable key (and back), for early PvP by import. The key text comes from strangers, so import checks everything. Pure: no DOM.
import type { BattleSide } from "../../src/schema";
import { battleSideSchema } from "../../src/schema/battle";
import { Collector } from "../../src/types";
import { validateBattle } from "../../src/validate/battle";
import type { Pack } from "../../src/validate/pack";
import { isCopy, isGeneric } from "./party";

export const KEY_VERSION = 1;
const PREFIX = `LO${KEY_VERSION}-`;
export const MAX_KEY_CHARS = 60_000;
export const MAX_NAME_CHARS = 40;
const BAD = "This is not a valid team key.";

export type Imported = { ok: true; side: BattleSide; name: string } | { ok: false; error: string };

const toB64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** The team as a key: `LO1-` then base64url of JSON. Wounds and between-phase edits never travel. */
export function exportTeam(side: BattleSide, name = ""): string {
  const heroes = side.heroes.map(({ start_hp_percent: _wound, ...h }) => h);
  return PREFIX + toB64(JSON.stringify({ n: name.trim().slice(0, MAX_NAME_CHARS), s: { leader: side.leader, heroes } }));
}

/** Reads a key (or a saved key file) into an enemy side of `_c1` copies, so the player may hold the same heroes. Never throws. */
export function importTeam(pack: Pack, text: string): Imported {
  const fail = (error: string): Imported => ({ ok: false, error });
  try {
    if (text.length > MAX_KEY_CHARS) return fail("That text is too long to be a team key.");
    const key = text.replace(/\s+/g, "");
    const ver = /^LO(\d+)-/.exec(key);
    if (!ver) return fail(BAD);
    if (Number(ver[1]) !== KEY_VERSION) return fail("This key is from another version of the game.");
    const body = key.slice(ver[0].length);
    if (!/^[A-Za-z0-9_-]+$/.test(body)) return fail(BAD);
    const raw = JSON.parse(fromB64(body)) as { n?: unknown; s?: unknown };
    if (typeof raw?.n !== "string" || raw.n.length > MAX_NAME_CHARS) return fail("The team name is missing or too long.");
    const parsed = battleSideSchema.safeParse(raw.s);
    if (!parsed.success) return fail(BAD);
    const side = parsed.data;
    if (side.edits || side.heroes.some((h) => h.start_hp_percent !== undefined)) return fail("This key carries wounds or edits, which teams cannot.");
    if (side.heroes.length === 0 || side.heroes.length > pack.rules.draft.fielded) return fail(`A team has 1 to ${pack.rules.draft.fielded} heroes.`);
    for (const h of side.heroes) {
      const c = pack.byId.characters.get(h.char_id);
      if (!c || isCopy(c) || isGeneric(c)) return fail("This team holds a hero that does not exist.");
    }
    const copy: BattleSide = { leader: `${side.leader}_c1`, heroes: side.heroes.map((h) => ({ ...h, char_id: `${h.char_id}_c1` })) };
    const c = new Collector();
    validateBattle({ battle_id: "versus_check", version: "1", time: "day", seeds: [1, 2, 3], challenger: side, defender: copy }, pack, c, { file: "share", tier: "official", defenderMax: pack.rules.draft.fielded });
    const bad = c.issues.find((i) => i.severity === "error");
    if (bad) return fail(`This team breaks the rules (${bad.code}: ${bad.message})`.slice(0, 120) + ".");
    return { ok: true, side: copy, name: raw.n.trim() || "Rival team" };
  } catch {
    return fail(BAD);
  }
}
