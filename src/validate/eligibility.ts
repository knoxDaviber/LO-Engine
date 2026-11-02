import { HERO_GATED_TAGS, type Character, type Equipment, type Skill, type SoldierType } from "../schema";

// Eligibility is an AND of the two lists: an empty list means "no restriction", a non-empty list must match.
const matches = (list: readonly string[], value: string) => list.length === 0 || list.includes(value);

export function skillEligible(hero: Character, skill: Skill): boolean {
  return matches(skill.eligible.classes, hero.class) && matches(skill.eligible.characters, hero.id);
}

/** The hero may wield the item: class and id filters pass, and the hero's equipment tags cover required_tags and the item's gated type
 * (weapons, armor, shields; other accessory categories are open to every hero). */
export function canEquip(hero: Character, item: Equipment): boolean {
  if (!matches(item.eligible.classes, hero.class) || !matches(item.eligible.characters, hero.id)) return false;
  const have = new Set<string>(hero.restrictions.equipment_tags);
  const need = [...item.eligible.required_tags, ...item.tags.filter((t) => HERO_GATED_TAGS.includes(t))];
  return need.every((t) => have.has(t));
}

export function squadEligible(hero: Character, soldier: SoldierType): boolean {
  return matches(soldier.eligible_heroes, hero.id) && matches(soldier.eligible_classes, hero.class);
}
