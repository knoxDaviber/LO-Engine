import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const FILES = {
  characters: "characters.yaml",
  skills: "skills.yaml",
  equipment: "equipment.yaml",
  statuses: "statuses.yaml",
  soldiers: "soldiers.yaml",
  factions: "factions.yaml",
  rules: "rules.yaml",
} as const;

export interface RawPack {
  characters: unknown[];
  skills: unknown[];
  equipment: unknown[];
  statuses: unknown[];
  soldiers: unknown[];
  factions: unknown[];
  rules: unknown;
  rosters: { name: string; data: unknown }[];
}

function readYaml(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    return parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid YAML: ${(e as Error).message}`);
  }
}

function listOf(value: unknown, file: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${file} must be a YAML list of entries`);
  return value;
}

/** Reads a content directory. Rosters (optional) are read from <dir>/rosters/*.yaml. */
export function loadPack(dir: string): RawPack {
  const list = (key: keyof typeof FILES) => listOf(readYaml(join(dir, FILES[key])), FILES[key]);
  const rosters: { name: string; data: unknown }[] = [];
  const rosterDir = join(dir, "rosters");
  if (existsSync(rosterDir)) {
    for (const f of readdirSync(rosterDir).filter((n) => n.endsWith(".yaml")).sort()) {
      rosters.push({ name: f, data: readYaml(join(rosterDir, f)) });
    }
  }
  return {
    characters: list("characters"),
    skills: list("skills"),
    equipment: list("equipment"),
    statuses: list("statuses"),
    soldiers: list("soldiers"),
    factions: list("factions"),
    rules: readYaml(join(dir, FILES.rules)),
    rosters,
  };
}
