import type { ZodType } from "zod/v4";
import { FILES, type RawPack } from "../load";
import {
  characterSchema,
  equipmentSchema,
  factionSchema,
  rulesSchema,
  skillSchema,
  soldierSchema,
  statusSchema,
} from "../schema";
import type { Collector } from "../types";
import { indexPack, type Pack } from "./pack";

export function pathToString(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const p of path) out += typeof p === "number" ? `[${p}]` : out ? `.${String(p)}` : String(p);
  return out;
}

function depth(issues: any[]): number {
  return issues.reduce((m, i) => Math.max(m, (i.path ?? []).length), 0);
}

/** Zod reports a failed union as one vague "Invalid input". Pick the branch that explains the failure best. */
export function flattenIssues(issues: any[], prefix: PropertyKey[] = []): { path: PropertyKey[]; message: string }[] {
  const out: { path: PropertyKey[]; message: string }[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    if (issue.code === "invalid_union" && Array.isArray(issue.errors) && issue.errors.length > 0) {
      const branches = issue.errors as any[][];
      const tagged = branches.find((b) => b.some((i) => typeof i.message === "string" && i.message.startsWith("[E_")));
      const best = tagged ?? [...branches].sort((a, b) => depth(b) - depth(a))[0]!;
      out.push(...flattenIssues(best, path));
    } else {
      out.push({ path, message: String(issue.message) });
    }
  }
  return out;
}

/** Reports schema failures. Messages tagged "[E_CODE] text" keep their own code; everything else is E_SCHEMA. */
export function reportZod(c: Collector, issues: any[], loc: { file: string; id?: string; base?: string }): void {
  for (const f of flattenIssues(issues)) {
    const m = /^\[(E_[A-Z_]+)\]\s*(.*)$/s.exec(f.message);
    const where = [loc.base, pathToString(f.path)].filter(Boolean).join(".").replace(/\.\[/g, "[");
    c.error(m ? m[1]! : "E_SCHEMA", m ? m[2]! : f.message, { file: loc.file, id: loc.id, path: where || undefined });
  }
}

function parseList<T>(c: Collector, raw: unknown[], schema: ZodType<T>, file: string): T[] {
  const out: T[] = [];
  raw.forEach((entry, i) => {
    const r = schema.safeParse(entry);
    if (r.success) {
      out.push(r.data);
      return;
    }
    const id = typeof (entry as any)?.id === "string" ? (entry as any).id : `entry #${i + 1}`;
    reportZod(c, r.error.issues, { file, id });
  });
  return out;
}

/** Parses every file against its schema. Returns the pack of entries that passed, or null if rules.yaml itself is unusable. */
export function schemaPass(c: Collector, raw: RawPack): Pack | null {
  const rulesResult = rulesSchema.safeParse(raw.rules);
  if (!rulesResult.success) {
    reportZod(c, rulesResult.error.issues, { file: FILES.rules });
  }
  const pack = {
    characters: parseList(c, raw.characters, characterSchema, FILES.characters),
    skills: parseList(c, raw.skills, skillSchema, FILES.skills),
    equipment: parseList(c, raw.equipment, equipmentSchema, FILES.equipment),
    statuses: parseList(c, raw.statuses, statusSchema, FILES.statuses),
    soldiers: parseList(c, raw.soldiers, soldierSchema, FILES.soldiers),
    factions: parseList(c, raw.factions, factionSchema, FILES.factions),
  };
  if (!rulesResult.success) return null;
  return indexPack({ ...pack, rules: rulesResult.data });
}
