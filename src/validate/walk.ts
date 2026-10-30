import type { ConditionNode } from "../schema";
import type { Effect } from "../schema";
import type { CondContext } from "../registry/conditions";
import { FILES } from "../load";
import type { Pack } from "./pack";

export interface Where {
  file: string;
  id: string;
  path: string;
}

/** Every effect in the pack, with where it lives. Auras, equipment, soldier passives and faction effects are included. */
export function forEachEffect(pack: Pack, fn: (effect: Effect, where: Where) => void): void {
  pack.skills.forEach((s) => s.effects.forEach((e, i) => fn(e, { file: FILES.skills, id: s.id, path: `effects[${i}]` })));
  pack.equipment.forEach((q) => q.effects.forEach((e, i) => fn(e, { file: FILES.equipment, id: q.id, path: `effects[${i}]` })));
  pack.characters.forEach((h) => {
    h.leader_aura.effects.forEach((e, i) => fn(e, { file: FILES.characters, id: h.id, path: `leader_aura.effects[${i}]` }));
    h.unique_effects.forEach((e, i) => fn(e, { file: FILES.characters, id: h.id, path: `unique_effects[${i}]` }));
  });
  pack.soldiers.forEach((s) =>
    s.passive_effects.forEach((p, pi) =>
      p.effects.forEach((e, i) => fn(e, { file: FILES.soldiers, id: s.id, path: `passive_effects[${pi}].effects[${i}]` })),
    ),
  );
  pack.factions.forEach((f) => f.effects.forEach((e, i) => fn(e, { file: FILES.factions, id: f.id, path: `effects[${i}]` })));
}

/** Every condition tree in the pack with the context it is written in. */
export function forEachCondition(pack: Pack, fn: (node: ConditionNode, context: CondContext, where: Where) => void): void {
  const cond = (n: ConditionNode | null | undefined, ctx: CondContext, where: Where) => {
    if (n) fn(n, ctx, where);
  };
  forEachEffect(pack, (e, w) => cond(e.condition as ConditionNode | null | undefined, "authored", { ...w, path: `${w.path}.condition` }));
  pack.skills.forEach((s) => {
    const w = { file: FILES.skills, id: s.id };
    cond(s.default_activation, "tactic", { ...w, path: "default_activation" });
    cond(s.targeting.default_main, "tactic", { ...w, path: "targeting.default_main" });
    cond(s.targeting.default_sub, "tactic", { ...w, path: "targeting.default_sub" });
  });
  pack.characters.forEach((h) => {
    const w = { file: FILES.characters, id: h.id };
    cond(h.leader_aura.condition, "authored", { ...w, path: "leader_aura.condition" });
    cond(h.leader_aura.target.filter, "authored", { ...w, path: "leader_aura.target.filter" });
    h.restrictions.soldier.stat_penalties.forEach((p, i) =>
      cond(p.when, "authored", { ...w, path: `restrictions.soldier.stat_penalties[${i}].when` }),
    );
  });
}
