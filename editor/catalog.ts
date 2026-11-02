// Builds the payload of GET /api/catalog (see Catalog in apiTypes.ts). Pure: no Node imports, so tests call it directly.
import { z } from "zod/v4";
import { LEAF_REFS, LEAF_REGISTRY } from "../src/registry/conditions";
import type { Pack } from "../src/validate/pack";
import type { Catalog } from "./apiTypes";

export function buildCatalog(pack: Pack): Catalog {
  const r = pack.rules;
  return {
    characters: pack.characters,
    skills: pack.skills,
    equipment: pack.equipment,
    statuses: pack.statuses,
    gods: pack.gods,
    soldiers: pack.soldiers,
    terrains: pack.terrains,
    factions: pack.factions,
    rules: { class_advantage: r.class_advantage, class_traits: r.class_traits, board: r.board, matchup: r.matchup, guard: r.guard, stun_pushback_counts: r.stun_pushback_counts, equipment_bases: r.equipment_bases },
    leaves: Object.entries(LEAF_REGISTRY).map(([type, spec]) => ({
      type,
      description: spec.description,
      contexts: [...spec.contexts],
      communitySafe: spec.communitySafe,
      params: z.toJSONSchema(spec.fields, { unrepresentable: "any" }) as Record<string, unknown>,
    })),
    leaf_refs: LEAF_REFS,
  };
}
