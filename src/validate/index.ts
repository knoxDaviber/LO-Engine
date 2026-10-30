import { loadPack, type RawPack } from "../load";
import { Collector, toReport, type Report, type Tier } from "../types";
import type { Pack } from "./pack";
import { validateRoster } from "./roster";
import { schemaPass } from "./schemaPass";
import { checkPack } from "./semantics";

export interface ValidateOptions {
  tier?: Tier;
}

/** Layers: schema pass -> cross-references/semantics/tier -> rosters. Later layers only see what earlier layers accepted. */
export function validateContent(dir: string, opts: ValidateOptions = {}): { report: Report; pack: Pack | null } {
  return validateRaw(loadPack(dir), opts);
}

export function validateRaw(raw: RawPack, opts: ValidateOptions = {}): { report: Report; pack: Pack | null } {
  const tier = opts.tier ?? "official";
  const c = new Collector();
  const pack = schemaPass(c, raw);
  if (pack) {
    checkPack(c, pack, tier);
    for (const r of raw.rosters) {
      validateRoster(r.data, pack, c, { role: r.name.startsWith("defender") ? "defender" : "challenger", tier, file: `rosters/${r.name}` });
    }
  }
  return { report: toReport(c), pack };
}
