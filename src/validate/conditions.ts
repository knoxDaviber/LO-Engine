import { LEAF_REFS, LEAF_REGISTRY, type CondContext } from "../registry/conditions";
import { walkConditionLeaves, type ConditionNode } from "../schema";
import type { Collector, Location, Tier } from "../types";
import type { Pack } from "./pack";
import { pathToString } from "./schemaPass";

const HERO_ID_LEAVES = new Set(["hero_is", "party_has_hero"]);

/**
 * Checks one condition tree in the context it is written in:
 *  - a leaf must be allowed in that context (hero-ID leaves are forbidden in player tactics and ban sheets),
 *  - ids it references must exist,
 *  - at the community tier, only community-safe leaves are allowed.
 * Parameter shapes are already checked by the schema pass.
 */
export function checkCondition(node: ConditionNode, context: CondContext, loc: Location, c: Collector, pack: Pack, tier: Tier): void {
  walkConditionLeaves(node, (leaf, path) => {
    const spec = LEAF_REGISTRY[leaf.type];
    if (!spec) return;
    const here: Location = { ...loc, path: [loc.path, pathToString(path)].filter(Boolean).join(".") };

    if (!spec.contexts.includes(context)) {
      if (HERO_ID_LEAVES.has(leaf.type)) {
        c.error("E_HERO_ID_FORBIDDEN", `'${leaf.type}' names a specific hero, which is not allowed in ${context} conditions (use class or faction)`, here);
      } else {
        c.error("E_CONDITION_CONTEXT", `'${leaf.type}' is not allowed in ${context} conditions (it is for ${spec.contexts.join(" / ")})`, here);
      }
    }

    const ref = LEAF_REFS[leaf.type];
    if (ref) {
      const value = leaf[ref.field];
      const known =
        ref.kind === "status" ? pack.byId.statuses.has(String(value))
        : ref.kind === "faction" ? pack.byId.factions.has(String(value))
        : pack.byId.characters.has(String(value));
      if (!known) c.error("E_REF_MISSING", `'${leaf.type}' refers to unknown ${ref.kind} '${String(value)}'`, here);
    }

    if (tier === "community" && !spec.communitySafe) {
      c.error("E_NOT_COMMUNITY_SAFE", `condition '${leaf.type}' is official-only`, here);
    }
  });
}
