// Pure validation entry point (no Node imports; the editor's browser build uses it). validate/index.ts adds the disk-reading validateContent.
import type { RawPack } from "../content";
import { Collector, toReport, type Report, type Tier } from "../types";
import type { Pack } from "./pack";
import { validateBattle } from "./battle";
import { validateRoster } from "./roster";
import { schemaPass } from "./schemaPass";
import { checkPack } from "./semantics";

export interface ValidateOptions {
  tier?: Tier;
}

/** Layers: schema pass -> cross-references/semantics/tier -> rosters/battles. Later layers only see what earlier layers accepted. */
export function validateRaw(raw: RawPack, opts: ValidateOptions = {}): { report: Report; pack: Pack | null } {
  const tier = opts.tier ?? "official";
  const c = new Collector();
  const pack = schemaPass(c, raw);
  if (pack) {
    checkPack(c, pack, tier);
    for (const r of raw.rosters) {
      validateRoster(r.data, pack, c, { role: r.name.startsWith("defender") ? "defender" : "challenger", tier, file: `rosters/${r.name}` });
    }
    for (const b of raw.battles ?? []) validateBattle(b.data, pack, c, { tier, file: `battles/${b.name}` });
  }
  return { report: toReport(c), pack };
}
