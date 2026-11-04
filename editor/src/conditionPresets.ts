// Main / Sub condition presets for the tactics board: plain-English labels mapped onto one condition leaf or selector each.
// Kind: Check = "only use the skill if ..." (self / board condition), Filter = keeps matching targets (skipped if none),
// Prioritise = orders targets, never skips. Browser-safe (the test imports it too).
import { CLASSES, RACES, STATS } from "../../src/schema/enums";

export type Kind = "Check" | "Filter" | "Prioritise";
export interface Preset { id: string; label: string; category: string; kind: Kind; tip: string; value: Record<string, unknown> }
export interface StatusRef { id: string; name: string; category: string }

const LT = "▼", GT = "▲";
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const PREFIX: Record<Kind, string> = {
  Prioritise: "Prioritise: puts these targets first, never skips the skill. ",
  Filter: "Filter: only targets ",
  Check: "Check: only uses the skill if ",
};
const T = "target";

/** Canonical JSON (sorted keys) so a stored condition matches a preset regardless of key order. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export function buildPresets(statuses: StatusRef[]): Preset[] {
  const out: Preset[] = [];
  const add = (category: string, id: string, label: string, kind: Kind, detail: string, value: Record<string, unknown>) =>
    out.push({ id, label, category, kind, tip: PREFIX[kind] + (kind === "Filter" && !detail.startsWith("whose") ? "that " : "") + detail, value });
  const prefer = (category: string, id: string, label: string, filter: Record<string, unknown>, what: string) =>
    add(category, id, label, "Prioritise", `${what} first.`, { select: "prefer", filter });
  const sel = (category: string, id: string, label: string, select: "lowest" | "highest", metric: string, what: string) =>
    add(category, id, label, "Prioritise", `${what}.`, { select, metric });

  // Formation & Situation
  const F = "Formation & Situation";
  for (const r of ["front", "back"]) {
    prefer(F, `prefer_row_${r}`, `Prioritise ${cap(r)} Row`, { type: "row_is", side: T, value: r }, `Targets in the ${r} row`);
    add(F, `row_${r}`, `${cap(r)} Row`, "Filter", `stand in the ${r} row; skipped if none.`, { type: "row_is", side: T, value: r });
  }
  add(F, "column_full", "Full Column", "Filter", "stand in a column with a hero in both hero rows; skipped if none.", { type: "column_full", side: T });
  for (const r of ["most", "least"]) add(F, `row_rank_${r}`, `Row with ${cap(r)} Combatants`, "Filter", `are in the row holding the ${r} combatants; skipped if none.`, { type: "row_rank", side: T, value: r });
  for (const n of [2, 3]) add(F, `row_size_${n}`, `${GT} Row with ${n}+ Combatants`, "Filter", `are in a row with ${n} or more combatants; skipped if none.`, { type: "row_size", side: T, op: ">=", value: n });
  add(F, "time_day", "Daytime", "Check", "the battle takes place by day.", { type: "time_is", value: "day" });
  add(F, "time_night", "Nighttime", "Check", "the battle takes place by night.", { type: "time_is", value: "night" });

  // Unit Type
  const U = "Unit Type";
  for (const [kindName, list, leaf] of [["class", CLASSES, "class_is"], ["race", RACES, "race_is"]] as const)
    for (const v of list) {
      prefer(U, `prefer_${kindName}_${v}`, `Prioritise ${cap(v)}`, { type: leaf, side: T, value: v }, `${cap(v)} targets`);
      add(U, `${kindName}_${v}`, cap(v), "Filter", `are ${cap(v)} (${kindName}); skipped if none.`, { type: leaf, side: T, value: v });
    }

  // Percent / threshold families
  const hpSet = (cat: string, idp: string, who: string, side: string, type: string, kind: Kind, hint: string) => {
    for (const v of [25, 50, 75, 100]) add(cat, `${idp}_lt_${v}`, `${LT} ${who} < ${v}%`, kind, `${hint} is below ${v}%${kind === "Filter" ? "; skipped if none" : ""}.`, { type, side, op: "<", value: v });
    for (const v of [25, 50, 75]) add(cat, `${idp}_gt_${v}`, `${GT} ${who} > ${v}%`, kind, `${hint} is above ${v}%${kind === "Filter" ? "; skipped if none" : ""}.`, { type, side, op: ">", value: v });
    add(cat, `${idp}_full`, `${GT} ${who} is full (100%)`, kind, `${hint} is full (100%)${kind === "Filter" ? "; skipped if none" : ""}.`, { type, side, op: ">=", value: 100 });
  };
  const H = "HP";
  sel(H, "hp_highest", "Highest ❤ HP", "highest", "hp_current", "Targets with the most current HP");
  sel(H, "hp_lowest", "Lowest ❤ HP", "lowest", "hp_current", "Targets with the least current HP");
  sel(H, "hp_pct_highest", "Highest % HP", "highest", "hp_percent", "Targets with the highest HP percentage");
  sel(H, "hp_pct_lowest", "Lowest % HP", "lowest", "hp_percent", "Targets with the lowest HP percentage");
  hpSet(H, "t_hp", "Target HP", T, "hp_percent", "Filter", "whose HP");
  hpSet(H, "avg_hp", "Average HP", T, "average_hp_percent", "Filter", "whose side's average HP");

  // PP
  const ppSet = (cat: string, idp: string, pool: "active" | "passive", own: boolean) => {
    const g = pool === "active" ? "✦" : "◇", type = `${pool}_pp`, side = own ? "self" : T, kind: Kind = own ? "Check" : "Filter";
    const who = own ? `Own ${g}` : g, sfx = kind === "Filter" ? "; skipped if none" : "";
    const zero = own ? `Own ${g} ${pool} PP is 0` : `${g} 0 ${pool} PP`;
    add(cat, `${idp}_${pool}_0`, zero, kind, `${own ? "own" : "whose"} ${pool} PP is 0${sfx}.`, { type, side, op: "=", value: 0 });
    for (const v of [1, 2, 3]) add(cat, `${idp}_${pool}_le_${v}`, `${LT} ${who} ${v} or less ${pool} PP`, kind, `${own ? "own" : "whose"} ${pool} PP is ${v} or less${sfx}.`, { type, side, op: "<=", value: v });
    for (const v of [1, 2, 3, 4]) add(cat, `${idp}_${pool}_ge_${v}`, `${GT} ${who} ${v} or more ${pool} PP`, kind, `${own ? "own" : "whose"} ${pool} PP is ${v} or more${sfx}.`, { type, side, op: ">=", value: v });
  };
  const P = "PP";
  sel(P, "pp_most_active", "Most ✦ active PP", "highest", "active_pp", "Targets with the most active PP");
  sel(P, "pp_least_active", "Least ✦ active PP", "lowest", "active_pp", "Targets with the least active PP");
  sel(P, "pp_most_passive", "Most ◇ passive PP", "highest", "passive_pp", "Targets with the most passive PP");
  sel(P, "pp_least_passive", "Least ◇ passive PP", "lowest", "passive_pp", "Targets with the least passive PP");
  for (const pool of ["active", "passive"] as const) ppSet(P, "t_pp", pool, false);

  // Unit status
  const S = "Unit status";
  prefer(S, "prefer_buffed", "Prioritise Buffed", { type: "has_any_buff", side: T }, "Buffed targets");
  prefer(S, "prefer_debuffed", "Prioritise Debuffed", { type: "has_any_debuff", side: T }, "Debuffed targets");
  add(S, "buffed", "Buffed", "Filter", "have any buff; skipped if none.", { type: "has_any_buff", side: T });
  add(S, "debuffed", "Debuffed", "Filter", "have any debuff; skipped if none.", { type: "has_any_debuff", side: T });
  for (const st of statuses.filter((x) => x.category === "buff" || x.category === "debuff"))
    add(S, `has_${st.id}`, st.name, "Filter", `have the ${st.category} ${st.name}; skipped if none.`, { type: "has_status", side: T, status_id: st.id });
  add(S, "not_buffed", "Not buffed", "Filter", "have no buff; skipped if none.", { type: "lacks_any_buff", side: T });
  add(S, "not_debuffed", "Not debuffed", "Filter", "have no debuff; skipped if none.", { type: "lacks_any_debuff", side: T });
  for (const st of statuses.filter((x) => x.category === "buff" || x.category === "debuff"))
    add(S, `lacks_${st.id}`, `Not ${st.name}`, "Filter", `do not have ${st.name}; skipped if none.`, { type: "lacks_status", side: T, status_id: st.id });

  // Attack type
  const A = "Attack type";
  const att = (id: string, label: string, v: Record<string, unknown>, d: string) => add(A, id, label, "Check", `this hero was ${d} since its last action.`, { type: "attacked_since_last_action", ...v });
  att("att_phys", "Physically attacked", { damage_type: "physical" }, "hit by a physical attack");
  att("att_mag", "Magically attacked", { damage_type: "magical" }, "hit by a magical attack");
  att("att_row", "Row is attacked", { shape: "row" }, "hit by a row attack");
  att("att_col", "Column is attacked", { shape: "column" }, "hit by a column attack");
  att("att_all", "All allies are attacked", { shape: "all" }, "hit by an attack on all allies");
  for (const v of CLASSES) att(`att_by_class_${v}`, `Attacked by ${cap(v)}`, { by_class: v }, `attacked by a ${cap(v)}`);
  for (const v of RACES) att(`att_by_race_${v}`, `Attacked by ${cap(v)}`, { by_race: v }, `attacked by a ${cap(v)}`);

  // Squad size
  const Q = "Squad size";
  for (const n of [2, 3, 4, 5]) add(Q, `enemies_ge_${n}`, `${GT} ${n}+ enemies`, "Check", `${n} or more enemy combatants are alive (soldiers count).`, { type: "combatants", side: "enemy", op: ">=", value: n });
  for (const n of [1, 2, 3, 4]) add(Q, `enemies_le_${n}`, `${LT} ${n} or fewer enemies`, "Check", `${n} or fewer enemy combatants are alive (soldiers count).`, { type: "combatants", side: "enemy", op: "<=", value: n });
  for (const n of [2, 3, 4]) add(Q, `allies_ge_${n}`, `${GT} ${n}+ allies`, "Check", `${n} or more allied combatants are alive (soldiers count).`, { type: "combatants", side: "ally", op: ">=", value: n });

  // Own condition
  const O = "Own condition";
  add(O, "is_self", "User", "Filter", "are the acting hero itself; skipped if none.", { type: "is_self" });
  add(O, "always", "Always", "Check", "always holds (no filter).", { type: "always" });
  add(O, "nearest", "Nearest", "Prioritise", "the nearest target, front row first.", { select: "nearest" });
  add(O, "not_self", "Other combatants", "Filter", "are not the acting hero; skipped if none.", { type: "not_self" });
  add(O, "self_buffed", "User is Buffed", "Check", "the acting hero has any buff.", { type: "has_any_buff", side: "self" });
  add(O, "self_debuffed", "User is Debuffed", "Check", "the acting hero has any debuff.", { type: "has_any_debuff", side: "self" });
  ["First", "2nd", "3rd", "4th", "5th"].forEach((w, i) => add(O, `action_${i}`, `${w} action`, "Check", `this is the hero's ${w.toLowerCase()} action this phase.`, { type: "action_count", op: "=", value: i }));

  // Own HP / PP
  hpSet("Own HP", "own_hp", "Own HP", "self", "hp_percent", "Check", "the hero's own HP");
  for (const pool of ["active", "passive"] as const) ppSet("Own PP", "own_pp", pool, true);

  // Enemies present
  const E = "Enemies present";
  for (const [kn, list] of [["class", CLASSES], ["race", RACES]] as const)
    for (const v of list) {
      add(E, `has_enemy_${kn}_${v}`, `${cap(v)} enemies present`, "Check", `at least one ${cap(v)} enemy is alive.`, { type: "side_has", side: "enemy", [kn]: v, present: true });
      add(E, `no_enemy_${kn}_${v}`, `No ${cap(v)} enemies`, "Check", `no ${cap(v)} enemy is alive.`, { type: "side_has", side: "enemy", [kn]: v, present: false });
    }

  // High / Low stats
  const metrics: [string, string][] = [
    ["max_hp", "❤ Max HP"], ["max_active_pp", "✦ Max active PP"], ["max_passive_pp", "◇ Max passive PP"], ["ATK", "⚔ ATK"], ["INT", "🔮 INT"], ["DEF", "🛡 DEF"],
    ...STATS.filter((s) => !["HP", "ATK", "INT", "DEF"].includes(s)).map((s): [string, string] => [s, s]),
  ];
  for (const [which, cat] of [["highest", "High stats"], ["lowest", "Low stats"]] as const)
    for (const [m, l] of metrics) sel(cat, `${which}_${m}`, `${cap(which)} ${l}`, which, m, `Targets with the ${which} ${l.replace(/^\S+ /, "")}`);

  return out;
}
