import type { Character, Equipment, Faction, Rules, Skill, SoldierType, Status } from "../schema";

/** Content that passed the schema pass, with lookup maps. */
export interface Pack {
  characters: Character[];
  skills: Skill[];
  equipment: Equipment[];
  statuses: Status[];
  soldiers: SoldierType[];
  factions: Faction[];
  rules: Rules;
  byId: {
    characters: Map<string, Character>;
    skills: Map<string, Skill>;
    equipment: Map<string, Equipment>;
    statuses: Map<string, Status>;
    soldiers: Map<string, SoldierType>;
    factions: Map<string, Faction>;
  };
}

export function indexPack(p: Omit<Pack, "byId">): Pack {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x] as const));
  return {
    ...p,
    byId: {
      characters: m(p.characters),
      skills: m(p.skills),
      equipment: m(p.equipment),
      statuses: m(p.statuses),
      soldiers: m(p.soldiers),
      factions: m(p.factions),
    },
  };
}

export type CollectionKey = "characters" | "skills" | "equipment" | "statuses" | "soldiers" | "factions";
