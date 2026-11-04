import assert from "node:assert/strict";
import { battleSchema, type Battle, type Tactic } from "../src/schema";
import { loadPack } from "../src/load";
import { validateContent } from "../src/validate";
import type { Pack } from "../src/validate/pack";
import { createBattleState, type BattleState, type Unit } from "../src/engine";

/**
 * Real pack and sample battle. By default the sample's squads are switched off (soldier count 0, so every squad is wiped before it starts),
 * which keeps the hero-only mechanics tests (damage, tactics, phases) independent of soldiers (also their pairing penalties); pass `squads: true` for the real thing.
 * Leader auras (2.5) are switched off the same way (their condition can never hold); pass `auras: true` to keep the real ones.
 * Damage is pinned to the older `subtract` formula with hero_hits 1, so the hand-worked numbers of the mechanics tests stay readable; pass
 * `damage: true` for the content values (pool, hero_hits 4).
 */
export function loadReal(opts: { squads?: boolean; auras?: boolean; damage?: boolean } = {}): { pack: Pack; battle: Battle } {
  const { pack, report } = validateContent("content");
  assert.ok(pack, "content pack must validate");
  assert.deepEqual(report.issues.filter((i) => i.severity === "error"), []);
  // Mounted too: Leon's SPD -20 pairing penalty (2.4) belongs to the soldiers, so hero-only tests must not see it.
  if (!opts.auras) for (const ch of pack.byId.characters.values()) ch.leader_aura.condition = { type: "phase", op: "<", value: 1 };
  if (!opts.squads) for (const st of pack.byId.soldiers.values()) { st.count = 0; st.mounted = true; }
  if (!opts.damage) Object.assign(pack.rules.damage, { formula: "subtract", hero_hits: 1 });
  const raw = (loadPack("content").battles ?? []).find((b) => b.name === "sample.yaml")!.data;
  return { pack, battle: stripGear(battleSchema.parse(raw)) };
}

/** Engine tests pin exact numbers on bare heroes; the content battles are geared for balance runs. */
export function stripGear(battle: Battle): Battle {
  for (const side of [battle.challenger, battle.defender]) for (const h of side.heroes ?? []) h.equipment = { weapon: null, armor: null, accessory_1: null, accessory_2: null };
  return battle;
}

/** Fresh sample 2v2 state (full HP/PP, phase 1). */
export function sampleState(phase = 1, opts: { squads?: boolean; auras?: boolean; damage?: boolean } = {}): BattleState {
  const { pack, battle } = loadReal(opts);
  const state = createBattleState(pack, battle, phase);
  if (!opts.squads) state.units = state.units.filter((u) => u.kind === "hero");
  return state;
}

export const unit = (s: BattleState, id: string): Unit => s.units.find((u) => u.id === id)!;

export const tactic = (skill_id: string, over: Partial<Tactic> = {}): Tactic => ({
  priority: 1, skill_id, enabled: true, main: null, sub: null, ...over,
});

export const LEON = "char_001", EMPEROR = "char_002", JASMINE = "char_003", LIEF = "char_004";

import type { Rng } from "../src/engine";
/** Rng that returns the given values in order (then 0.999..). Values are in [0,1); a roll succeeds when value*100 < chance. */
export function scripted(values: number[]): Rng {
  let i = 0;
  const next = () => (i < values.length ? values[i++]! : 0.999999);
  return { next, int: (n) => Math.floor(next() * n), get draws() { return i; } };
}
