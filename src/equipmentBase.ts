// Equipment type standard (design Section 12.1, Decision 133): an item's flat stat lines are its type's base in rules.equipment_bases.
// Pure (enum constants and types only), so the engine, validator, draft and the browser editor share it.
import { SLOT_TAGS, STATS, type EquipmentSlot, type EquipmentTag, type Stat } from "./schema/enums";

type Bases = Partial<Record<string, Partial<Record<string, number>>>>;

/** The item's equipment type: its one tag that is valid for its slot (the validator guarantees exactly one). */
export function equipmentType(item: { slot: EquipmentSlot | string; tags: readonly string[] }): EquipmentTag | undefined {
  const allowed = (SLOT_TAGS as Record<string, readonly string[]>)[item.slot] ?? [];
  return item.tags.find((t) => allowed.includes(t)) as EquipmentTag | undefined;
}

/** The item's flat stat lines (every stat, 0 when the base leaves it out). */
export function equipmentStats(item: { slot: EquipmentSlot | string; tags: readonly string[] }, bases: Bases): Record<Stat, number> {
  const t = equipmentType(item);
  const base = (t && bases[t]) || {};
  return Object.fromEntries(STATS.map((s) => [s, base[s] ?? 0])) as Record<Stat, number>;
}
