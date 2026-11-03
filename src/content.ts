// Pure content loading (no Node imports, so the browser build of the editor can use it): the content file set and a RawPack built from file
// texts. src/load.ts reads the texts from disk and calls rawFromTexts.
import { parse } from "yaml";

export const FILES = {
  characters: "characters.yaml",
  skills: "skills.yaml",
  equipment: "equipment.yaml",
  statuses: "statuses.yaml",
  soldiers: "soldiers.yaml",
  factions: "factions.yaml",
  terrains: "terrains.yaml", // optional: a missing file is an empty list
  gods: "gods.yaml", // optional, like terrains
  rules: "rules.yaml",
} as const;

export const OPTIONAL_FILES: readonly string[] = [FILES.terrains, FILES.gods];

export interface RawPack {
  characters: unknown[];
  skills: unknown[];
  equipment: unknown[];
  statuses: unknown[];
  soldiers: unknown[];
  factions: unknown[];
  terrains?: unknown[];
  gods?: unknown[];
  rules: unknown;
  rosters: { name: string; data: unknown }[];
  battles?: { name: string; data: unknown }[];
}

function listOf(value: unknown, file: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${file} must be a YAML list of entries`);
  return value;
}

/**
 * A RawPack from content file texts keyed by path relative to the content folder (`rules.yaml`, `battles/x.yaml`, `rosters/x.yaml`; other keys
 * are ignored). Throws on a missing required file or bad YAML; `where` names a file in those messages (default: its key).
 */
export function rawFromTexts(texts: Record<string, string>, where: (key: string) => string = (k) => k): RawPack {
  const yaml = (key: string): unknown => {
    const text = texts[key];
    if (text === undefined) throw new Error(`cannot read ${where(key)}: missing`);
    try {
      return parse(text);
    } catch (e) {
      throw new Error(`${where(key)} is not valid YAML: ${(e as Error).message}`);
    }
  };
  const list = (key: keyof typeof FILES) => listOf(yaml(FILES[key]), FILES[key]);
  const optional = (key: "terrains" | "gods") => (texts[FILES[key]] === undefined ? [] : list(key));
  const folder = (name: string) =>
    Object.keys(texts)
      .filter((k) => k.startsWith(`${name}/`) && k.endsWith(".yaml") && !k.slice(name.length + 1).includes("/"))
      .sort()
      .map((k) => ({ name: k.slice(name.length + 1), data: yaml(k) }));
  return {
    characters: list("characters"),
    skills: list("skills"),
    equipment: list("equipment"),
    statuses: list("statuses"),
    soldiers: list("soldiers"),
    factions: list("factions"),
    terrains: optional("terrains"),
    gods: optional("gods"),
    rules: yaml(FILES.rules),
    rosters: folder("rosters"),
    battles: folder("battles"),
  };
}
