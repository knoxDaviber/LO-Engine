import type { Tactic, BanSheet } from "../schema";
import type { ConditionNode } from "../schema";
import { isGroup, isSelector } from "../schema";
import type { Collector, Location, Tier } from "../types";
import { checkCondition } from "./conditions";
import type { Pack } from "./pack";
import { banMetric } from "../draft";

/** Player-written slots hold one leaf, or `all` of exactly two leaves: no `any`, `not`, nesting or third condition. */
export function checkSlotShape(node: ConditionNode, loc: Location, c: Collector): void {
  const n = node as any;
  const isLeaf = (x: any) => !("all" in x || "any" in x || "not" in x);
  if (isLeaf(n)) return;
  if ("all" in n && n.all.length === 2 && n.all.every(isLeaf)) return;
  c.error("E_TACTIC_SHAPE", "a player slot is one condition, or `all` of exactly two conditions (no any, not, nesting or more than two)", loc);
}

/** A player tactic slot (main, sub, a prefer filter) holds exactly one condition leaf: no all / any / not (Decision 136). */
export function checkPlayerLeaf(node: ConditionNode, loc: Location, c: Collector): void {
  if (isGroup(node)) c.error("E_TACTIC_SHAPE", "a player tactic slot is one condition or a selector (no all, any or not)", loc);
}

/** Checks one hero's tactic sheet: size, priorities, skills the hero owns, and every condition in tactic context. */
export function checkTacticSheet(sheet: Tactic[], heroSkills: readonly string[], loc: Location, c: Collector, pack: Pack, tier: Tier): void {
  const max = pack.rules.limits.max_tactics;
  if (sheet.length > max) c.error("E_TACTIC_COUNT", `${sheet.length} tactics exceeds the limit of ${max}`, loc);
  const priorities = new Set<number>();
  sheet.forEach((t, i) => {
    const here = (p: string): Location => ({ ...loc, path: `${loc.path}[${i}].${p}` });
    if (priorities.has(t.priority)) c.error("E_TACTIC_PRIORITY", `priority ${t.priority} is used twice`, here("priority"));
    priorities.add(t.priority);
    if (!heroSkills.includes(t.skill_id)) c.error("E_TACTIC_SKILL", `'${t.skill_id}' is not one of this hero's skills`, here("skill_id"));
    const sk = pack.byId.skills.get(t.skill_id);
    if (sk && sk.category === "active" && !t.main && !sk.targeting.default_main) c.warn("W_TACTIC_NO_CONDITION", "no Main condition and the skill has no default, so this tactic never triggers", here("main"));
    for (const name of ["main", "sub"] as const) {
      const slot = t[name];
      if (!slot) continue;
      const leaf = isSelector(slot) ? slot.filter : slot;
      const at = here(isSelector(slot) ? `${name}.filter` : name);
      if (!leaf) continue;
      checkPlayerLeaf(leaf, at, c);
      checkCondition(leaf, "tactic", at, c, pack, tier);
    }
  });
}

/** A defender's hidden ban sheet: ordered rules of filter + select + metric. Conditions are in ban context. */
export function checkBanSheet(sheet: BanSheet, loc: Location, c: Collector, pack: Pack, tier: Tier): void {
  const priorities = new Set<number>();
  sheet.rules.forEach((r, i) => {
    const here = { ...loc, path: `${loc.path}.rules[${i}]` };
    if (priorities.has(r.priority)) c.error("E_BAN_PRIORITY", `priority ${r.priority} is used twice`, { ...here, path: `${here.path}.priority` });
    priorities.add(r.priority);
    checkSlotShape(r.filter, { ...here, path: `${here.path}.filter` }, c);
    checkCondition(r.filter, "ban", { ...here, path: `${here.path}.filter` }, c, pack, tier);
    if (r.select !== "nearest" && banMetric(r.metric, { cost: 0, stat: () => 0 }) === null) {
      c.error("E_BAN_METRIC", `metric '${r.metric}' must be cost, hp or stat:<STAT>`, { ...here, path: `${here.path}.metric` });
    }
  });
}
