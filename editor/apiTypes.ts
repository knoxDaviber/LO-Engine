// Shapes of the editor's JSON API (editor/api.ts). No Node imports: the browser code imports these types too.
import type { Character, Equipment, Faction, God, Rules, Skill, SoldierType, Status, Terrain } from "../src/schema";
import type { Severity } from "../src/types";

export interface SkillInfo { id: string; name: string; kind: "active" | "passive"; pp_pool: string; pp_cost: number; trigger: string; shape: string | null; side: string; default_main: unknown }
export interface CharacterInfo { id: string; name: string; class: string; preferred_row: string; skills: SkillInfo[] }
/** `type` is the item's equipment type and `base` its flat stat lines (rules.equipment_bases, Decision 133; zero stats left out). */
export interface EquipmentInfo { id: string; name: string; slot: string; type: string | null; base: Record<string, number>; eligible: { classes: string[]; characters: string[]; required_tags: string[] } }
export interface SoldierInfo { id: string; name: string; class: string; default_soldier_row: string; allowed_soldier_rows: string[]; mounted: boolean; eligible_heroes: string[]; eligible_classes: string[] }
export interface LeafInfo { type: string; description: string; params: Record<string, unknown> /* JSON Schema of the leaf's parameters */ }

export interface ContentInfo {
  characters: CharacterInfo[];
  equipment: EquipmentInfo[];
  gods: { id: string; name: string; blessing: string }[];
  soldiers: SoldierInfo[];
  terrains: { id: string; name: string }[];
  statuses: { id: string; name: string; category: string }[];
  factions: { id: string; name: string }[];
  rules: { max_tactics: number; fielded: number; roster_size: number; columns: number };
  /** Condition leaves allowed in the `tactic` context. */
  leaves: LeafInfo[];
  /** Condition leaves allowed in the `ban` context (defender ban sheets). */
  ban_leaves: LeafInfo[];
  /** Leaf fields that name other content (status / faction / hero ids). */
  leaf_refs: Record<string, { field: string; kind: string }>;
  rows: string[];
  files: { battles: string[]; rosters: string[] };
}

export interface ApiIssue { severity: Severity; code: string; path: string; id?: string; message: string }

export interface BreakdownEffect { status: string; category: string; mode: "flat" | "percent"; value: number; unique: boolean; outcome: "winner" | "suppressed"; parts?: string[] }
export interface BreakdownStat { stat: string; base: number; flat: number; effects: BreakdownEffect[]; multiplier: number; result: number }
/** `pp`: a hero's PP pools after the what-if override and gear (null for squads). */
export interface BreakdownUnit { id: string; name: string; side: string; kind: "hero" | "squad"; leader: string | null; stats: Record<string, BreakdownStat>; pp: { active: number; passive: number } | null }
/** `banned`: char_ids removed by the draft per side (roster form; empty for fielded-form battles). */
export interface BreakdownResult { phase: number; units: BreakdownUnit[]; banned: { challenger: string[]; defender: string[] } }

/** What-if PP override sent with sim and breakdown requests (integers 0..10; absent or null = the content values). Never saved. */
export interface PpOverride { active?: number | null; passive?: number | null }

/** What-if damage formula choices for the editor select ("" = rules.yaml), sent as `formula` with sim and breakdown requests. Never saved. */
export const FORMULA_CHOICES = ["", "pool", "subtract", "ratio:100", "ratio:150", "ratio:200", "scaled_subtract:20", "scaled_subtract:35"] as const;

/** What-if hero_hits choices for the editor select ("" = rules.yaml), sent as `hero_hits` (a number) with sim and breakdown requests. Never saved. */
export const HERO_HITS_CHOICES = ["", "1", "2", "4", "6", "10"] as const;

export interface SimResult { winner: string; reason: string; log: string; events: { type: string; [k: string]: unknown }[] }

/** A condition leaf from LEAF_REGISTRY (all contexts), as served by GET /api/catalog. */
export interface CatalogLeaf {
  type: string;
  description: string;
  contexts: string[]; // "tactic" | "authored" | "ban"
  communitySafe: boolean;
  params: Record<string, unknown>; // JSON Schema of the leaf's parameters
}

/**
 * GET /api/catalog: the full, zod-parsed content (plain JSON, passed through unchanged) plus the rules and leaf descriptions needed to describe
 * every unit in words (editor/src/describe.ts). Read-only; loaded once with the pack. Lookups are by `id` (arrays, not maps).
 */
export interface Catalog {
  characters: Character[];
  skills: Skill[];
  equipment: Equipment[];
  statuses: Status[];
  gods: God[];
  soldiers: SoldierType[];
  terrains: Terrain[];
  factions: Faction[];
  rules: Pick<Rules, "class_advantage" | "class_traits" | "board" | "matchup" | "guard" | "stun_pushback_counts" | "equipment_bases">;
  leaves: CatalogLeaf[];
  leaf_refs: Record<string, { field: string; kind: string }>; // leaf fields that hold status / faction / hero ids
}
