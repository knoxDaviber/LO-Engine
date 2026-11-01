// Shapes of the editor's JSON API (editor/api.ts). No Node imports: the browser code imports these types too.
import type { Severity } from "../src/types";

export interface SkillInfo { id: string; name: string; kind: "active" | "passive"; pp_pool: string; pp_cost: number; trigger: string; shape: string | null; side: string }
export interface CharacterInfo { id: string; name: string; class: string; preferred_row: string; skills: SkillInfo[] }
export interface EquipmentInfo { id: string; name: string; slot: string; eligible: { classes: string[]; characters: string[]; required_tags: string[] } }
export interface SoldierInfo { id: string; name: string; class: string; default_soldier_row: string; allowed_soldier_rows: string[]; mounted: boolean; eligible_heroes: string[]; eligible_classes: string[] }
export interface LeafInfo { type: string; description: string; params: Record<string, unknown> /* JSON Schema of the leaf's parameters */ }

export interface ContentInfo {
  characters: CharacterInfo[];
  equipment: EquipmentInfo[];
  gods: { id: string; name: string; blessing: string }[];
  soldiers: SoldierInfo[];
  terrains: { id: string; name: string }[];
  statuses: { id: string; name: string }[];
  factions: { id: string; name: string }[];
  rules: { max_tactics: number; fielded: number; roster_size: number; columns: number };
  /** Player-sheet slot shape (design 4.1, E_TACTIC_SHAPE): one leaf, or `all` of exactly two leaves. */
  slot_shape: { max_leaves: number; combinator: "all" };
  /** Condition leaves allowed in the `tactic` context. */
  leaves: LeafInfo[];
  /** Leaf fields that name other content (status / faction / hero ids). */
  leaf_refs: Record<string, { field: string; kind: string }>;
  selectors: string[];
  selector_metrics: string[];
  selector_sides: string[];
  fallbacks: string[];
  rows: string[];
  files: { battles: string[]; rosters: string[] };
}

export interface ApiIssue { severity: Severity; code: string; path: string; id?: string; message: string }

export interface BreakdownEffect { status: string; category: string; mode: "flat" | "percent"; value: number; unique: boolean; outcome: "winner" | "suppressed"; parts?: string[] }
export interface BreakdownStat { stat: string; base: number; flat: number; effects: BreakdownEffect[]; multiplier: number; result: number }
export interface BreakdownUnit { id: string; name: string; side: string; kind: "hero" | "squad"; leader: string | null; stats: Record<string, BreakdownStat> }
export interface BreakdownResult { phase: number; units: BreakdownUnit[] }

export interface SimResult { winner: string; reason: string; log: string; events: { type: string; [k: string]: unknown }[] }
