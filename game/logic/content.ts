// Content bootstrap: builds the validated pack from content file texts (path relative to content/ -> YAML). The browser passes the texts
// bundled by Vite (game/src/pack.ts), the tests and tools pass readContentTexts. Pure: no DOM, no Node.
import { rawFromTexts } from "../../src/content";
import { validateRaw } from "../../src/validate/raw";
import type { Pack } from "../../src/validate/pack";

export function bootPack(texts: Record<string, string>): Pack {
  const { pack, report } = validateRaw(rawFromTexts(texts));
  const errors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/") && !i.file?.startsWith("rosters/"));
  if (!pack || errors.length > 0) throw new Error(`content has validation errors: ${errors.map((i) => i.code).join(", ")}`);
  return pack;
}
