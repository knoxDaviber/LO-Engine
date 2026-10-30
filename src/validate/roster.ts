import { rosterSchema } from "../schema";
import type { Collector, Tier } from "../types";
import { heroCost } from "./cost";
import { canEquip, squadEligible } from "./eligibility";
import type { Pack } from "./pack";
import { reportZod } from "./schemaPass";
import { checkBanSheet, checkTacticSheet } from "./tactics";

const SLOTS = { weapon: "weapon", armor: "armor", accessory_1: "accessory", accessory_2: "accessory" } as const;

/** Validates a roster (6 heroes with squads, equipment, tactics) against a content pack. */
export function validateRoster(raw: unknown, pack: Pack, c: Collector, opts: { role: "challenger" | "defender"; tier: Tier; file: string }): void {
  const parsed = rosterSchema.safeParse(raw);
  if (!parsed.success) return void reportZod(c, parsed.error.issues, { file: opts.file });
  const r = parsed.data;
  const { draft, cost } = pack.rules;
  const file = opts.file;

  if (r.heroes.length !== draft.roster_size) c.error("E_ROSTER_SIZE", `a roster has exactly ${draft.roster_size} heroes, found ${r.heroes.length}`, { file, path: "heroes" });
  const ids = r.heroes.map((h) => h.char_id);
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  for (const d of new Set(dupes)) c.error("E_ROSTER_DUP", `hero '${d}' appears twice`, { file, path: "heroes" });

  // leader line must be a permutation of the roster
  const line = r.leader_line;
  const sameSet = line.length === ids.length && new Set(line).size === line.length && line.every((x) => ids.includes(x));
  if (!sameSet) c.error("E_LEADER_LINE", "leader_line must list every roster hero exactly once", { file, path: "leader_line" });

  let rosterCost = 0;
  const costs = new Map<string, number>();
  r.heroes.forEach((h, i) => {
    const loc = { file, id: h.char_id, path: `heroes[${i}]` };
    const hero = pack.byId.characters.get(h.char_id);
    if (!hero) return void c.error("E_REF_MISSING", `unknown hero '${h.char_id}'`, loc);

    const squad = pack.byId.soldiers.get(h.squad_id);
    if (!squad) c.error("E_REF_MISSING", `unknown squad '${h.squad_id}'`, { ...loc, path: `${loc.path}.squad_id` });
    else {
      if (!squadEligible(hero, squad)) c.error("E_SQUAD_INELIGIBLE", `${hero.id} cannot lead squad '${squad.id}'`, { ...loc, path: `${loc.path}.squad_id` });
      const row = h.squad_row ?? squad.default_soldier_row;
      if (!squad.allowed_soldier_rows.includes(row)) c.error("E_SQUAD_ROW", `squad row '${row}' is not allowed for '${squad.id}'`, { ...loc, path: `${loc.path}.squad_row` });
      if (hero.restrictions.soldier.mounted_only && !squad.mounted) c.error("E_SQUAD_INELIGIBLE", `${hero.id} requires a mounted squad`, { ...loc, path: `${loc.path}.squad_id` });
    }

    const items = [];
    for (const [key, slot] of Object.entries(SLOTS) as [keyof typeof SLOTS, string][]) {
      const eid = h.equipment[key];
      if (!eid) continue;
      const item = pack.byId.equipment.get(eid);
      const p = { ...loc, path: `${loc.path}.equipment.${key}` };
      if (!item) { c.error("E_REF_MISSING", `unknown equipment '${eid}'`, p); continue; }
      if (item.slot !== slot) c.error("E_EQUIP_SLOT", `'${eid}' is a ${item.slot}, not a ${slot}`, p);
      if (!canEquip(hero, item)) c.error("E_EQUIP_INELIGIBLE", `${hero.id} cannot equip '${eid}'`, p);
      if (key === "accessory_2" && eid === h.equipment.accessory_1 && !item.rules.duplicate_allowed_in_both_accessory_slots) {
        c.error("E_EQUIP_DUPLICATE", `'${eid}' cannot be equipped in both accessory slots`, p);
      }
      items.push(item);
    }

    checkTacticSheet(h.tactic_sheet, hero.skills, { ...loc, path: `${loc.path}.tactic_sheet` }, c, pack, opts.tier);

    const total = heroCost(hero, pack.rules, { squad: squad ?? null, equipment: items, skills: hero.skills.map((id) => pack.byId.skills.get(id)).filter((s) => s !== undefined) });
    costs.set(hero.id, total);
    rosterCost += total;
    if (cost.caps.per_hero !== null && total > cost.caps.per_hero) c.error("E_COST_CAP", `hero cost ${total} exceeds the per-hero cap of ${cost.caps.per_hero}`, loc);
  });
  if (cost.caps.roster !== null && rosterCost > cost.caps.roster) c.error("E_COST_CAP", `roster cost ${rosterCost} exceeds the cap of ${cost.caps.roster}`, { file, path: "heroes" });

  if (opts.role === "defender") {
    if (draft.defender_anchor) {
      if (!r.anchor) c.error("E_ANCHOR", "a defender roster must name an anchor hero", { file, path: "anchor" });
      else if (!ids.includes(r.anchor)) c.error("E_ANCHOR", `anchor '${r.anchor}' is not in the roster`, { file, path: "anchor" });
      else if (cost.caps.protected_or_anchor !== null && (costs.get(r.anchor) ?? 0) > cost.caps.protected_or_anchor) {
        c.error("E_COST_CAP", `anchor cost exceeds the protected/anchor cap of ${cost.caps.protected_or_anchor}`, { file, path: "anchor" });
      }
    }
    if (!r.ban_sheet) c.error("E_BAN_SHEET", "a defender roster needs a ban_sheet", { file, path: "ban_sheet" });
  }
  if (r.ban_sheet) checkBanSheet(r.ban_sheet, { file, path: "ban_sheet" }, c, pack, opts.tier);
}
