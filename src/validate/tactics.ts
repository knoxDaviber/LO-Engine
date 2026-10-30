import type { Tactic, BanSheet } from "../schema";
import type { ConditionNode } from "../schema";
import type { Collector, Location, Tier } from "../types";
import { checkCondition } from "./conditions";
import type { Pack } from "./pack";

/** Player-written slots hold one leaf, or `all` of exactly two leaves: no `any`, `not`, nesting or third condition. */
export function checkSlotShape(node: ConditionNode, loc: Location, c: Collector): void {
  const n = node as any;
  const isLeaf = (x: any) => !("all" in x || "any" in x || "not" in x);
  if (isLeaf(n)) return;
  if ("all" in n && n.all.length === 2 && n.all.every(isLeaf)) return;
  c.error("E_TACTIC_SHAPE", "a player slot is one condition, or `all` of exactly two conditions (no any, not, nesting or more than two)", loc);
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
    if (t.activation) {
      checkSlotShape(t.activation, here("activation"), c);
      checkCondition(t.activation, "tactic", here("activation"), c, pack, tier);
    }
    if (t.targeting.main) {
      checkSlotShape(t.targeting.main, here("targeting.main"), c);
      checkCondition(t.targeting.main, "tactic", here("targeting.main"), c, pack, tier);
    }
    const sub = t.targeting.sub;
    if (sub && "select" in sub === false) {
      checkSlotShape(sub as ConditionNode, here("targeting.sub"), c);
      checkCondition(sub as ConditionNode, "tactic", here("targeting.sub"), c, pack, tier);
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
  });
}
