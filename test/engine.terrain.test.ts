// Terrain (battlefield modifiers in the `terrain` stacking category), bonus_on_terrain, per-pair class advantage damage_percent and the class traits
// (roadmap 3d: Flyer EVA vs melee, Aquatic SPD on water).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventLog, beginPhase, computeDamage, effectiveStat, hitChance, type DamageEffect } from "../src/engine";
import type { Terrain } from "../src/schema";
import { EMPEROR, JASMINE, LEON, LIEF, loadReal, sampleState, unit } from "./engineHelpers";

const HIT = { hit: true, crit: false, guard: false };
const strike = (over: Partial<DamageEffect> = {}): DamageEffect => ({
  type: "damage", damage_type: "physical", range: "melee", scaling: [{ stat: "ATK", coef: 1 }], multiplier: 1, ignores_guard: false,
  bonus_vs_class: [], bonus_on_terrain: [], hit_bonus_percent: 0, ...over,
});

test("terrain modifiers reach every hero and squad of a listed class, both sides; a squad never takes its leader's terrain", () => {
  const field: Terrain = {
    id: "terrain_901", name: "Test Field", description: "",
    modifiers: [{ classes: ["infantry"], stat: "MDEF", mode: "flat", value: 7 }, { classes: ["cavalry"], stat: "MDEF", mode: "flat", value: 100 }],
  };
  const mdef = (battlefield: string | null) => {
    const { pack, battle } = loadReal({ squads: true });
    pack.terrains.push(field);
    pack.byId.terrains.set(field.id, field);
    const log = new EventLog();
    const { state } = beginPhase(pack, { ...battle, battlefield }, 1, null, log);
    const ids = [LEON, LIEF, EMPEROR, JASMINE, `squad_${LEON}`, `squad_${EMPEROR}`];
    return { log, m: Object.fromEntries(ids.map((id) => [id, effectiveStat(state.units.find((u) => u.id === id)!, "MDEF", pack)])) };
  };
  const base = mdef(null).m;
  const { m, log } = mdef(field.id);
  assert.equal(m[EMPEROR]! - base[EMPEROR]!, 7); // infantry hero
  assert.equal(m[LEON]! - base[LEON]!, 100); // cavalry hero
  assert.equal(m[LIEF], base[LIEF]); // lancer
  assert.equal(m[JASMINE], base[JASMINE]); // holy
  // Both squads are infantry (soldier_001): each gets the infantry line once; Leon's squad does not share Leon's cavalry line.
  assert.ok(m[`squad_${LEON}`]! > base[`squad_${LEON}`]! && m[`squad_${LEON}`]! - base[`squad_${LEON}`]! < 100);
  assert.equal(m[`squad_${LEON}`]! - base[`squad_${LEON}`]!, m[`squad_${EMPEROR}`]! - base[`squad_${EMPEROR}`]!);
  const applied = log.events.filter((e) => e.type === "terrain_applied");
  assert.equal(applied.length, 4); // Emperor, two squads, Leon
  assert.ok(applied.every((e) => e.type === "terrain_applied" && e.category === "terrain"));
});

test("bonus_on_terrain multiplies the matchup only on its own battlefield", () => {
  const s = sampleState();
  const leon = unit(s, LEON), lief = unit(s, LIEF);
  const e = strike({ bonus_on_terrain: [{ terrain: "terrain_901", modifier_percent: 20 }] });
  const power = (battlefield: string | null) => computeDamage(lief, leon, e, { pack: s.pack, battlefield }, HIT).matchup;
  assert.equal(power(null), 1.25); // lancer > cavalry
  assert.equal(power("terrain_902"), 1.25);
  assert.equal(power("terrain_901"), 1.25 * 1.2);
});

test("a class_advantage pair's damage_percent replaces the global advantage for that pair only (holy > monster 50)", () => {
  const s = sampleState();
  const holy = unit(s, JASMINE), mon = unit(s, EMPEROR);
  mon.class = "monster";
  const ctx = { pack: s.pack };
  assert.equal(computeDamage(holy, mon, strike(), ctx, HIT).matchup, 1.5);
  assert.equal(computeDamage(mon, holy, strike(), ctx, HIT).matchup, 0.85); // disadvantage side unchanged
  assert.equal(computeDamage(unit(s, LIEF), unit(s, LEON), strike(), ctx, HIT).matchup, 1.25); // other pairs keep the global 25
});

test("Flyer: EVA x1.5 against melee hits only (rules.class_traits.flyer_melee_eva_bonus 50)", () => {
  const s = sampleState();
  const a = unit(s, LIEF), d = unit(s, LEON);
  Object.assign(a.baseStats, { HIT: 100, SKL: 0 });
  Object.assign(d.baseStats, { EVA: 20, SKL: 0 });
  const ctx = { pack: s.pack };
  a.class = "mage"; // neutral matchup: no advantage HIT
  assert.equal(hitChance(a, d, strike(), ctx), 80); // not a flyer
  d.class = "flyer";
  assert.equal(hitChance(a, d, strike(), ctx), 70); // 100 - 20 * 1.5
  assert.equal(hitChance(a, d, strike({ range: "ranged" }), ctx), 80);
});

test("Aquatic: SPD +30% (terrain category) on water terrain (Swamp), nothing on Plains", () => {
  const spd = (battlefield: string) => {
    const { pack, battle } = loadReal();
    pack.byId.characters.get(LIEF)!.class = "aquatic";
    const log = new EventLog();
    const { state } = beginPhase(pack, { ...battle, battlefield }, 1, null, log);
    const lief = state.units.find((u) => u.id === LIEF)!;
    return { spd: effectiveStat(lief, "SPD", pack), ids: lief.statuses.map((x) => x.statusId), log };
  };
  const plains = spd("terrain_001"), swamp = spd("terrain_004");
  assert.deepEqual(plains.ids, []);
  assert.deepEqual(swamp.ids, ["terrain:terrain_004:water"]);
  assert.ok(Math.abs(swamp.spd - plains.spd * 1.3) < 1e-9);
  assert.ok(swamp.log.events.some((e) => e.type === "terrain_applied" && e.unit === LIEF && e.effect === "SPD +30%"));
});
