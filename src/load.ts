// Reads a content directory from disk. The parsing itself is pure (src/content.ts), shared with the editor's browser build.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FILES, OPTIONAL_FILES, rawFromTexts, type RawPack } from "./content";

export { FILES, type RawPack } from "./content";

function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
}

/**
 * The content files of `dir` as texts keyed by relative path (the pack files, rosters/*.yaml and battles/*.yaml); missing optional files are
 * left out. A battle or roster entry that is not a readable file (a directory, a dangling symlink, no permission) is skipped and reported to
 * `onSkip` (default: a console warning) so one bad entry cannot take down the editor or the validator; the pack files themselves still throw.
 */
export function readContentTexts(dir: string, onSkip: (rel: string, reason: string) => void = (rel, reason) => console.warn(`warning: skipped ${rel}: ${reason}`)): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const f of Object.values(FILES)) {
    if (OPTIONAL_FILES.includes(f) && !existsSync(join(dir, f))) continue;
    texts[f] = readText(join(dir, f));
  }
  for (const folder of ["rosters", "battles"]) {
    const d = join(dir, folder);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith(".yaml")).sort()) {
      const rel = `${folder}/${f}`;
      try {
        if (!statSync(join(d, f)).isFile()) { onSkip(rel, "not a file"); continue; }
        texts[rel] = readFileSync(join(d, f), "utf-8");
      } catch (e) {
        onSkip(rel, (e as NodeJS.ErrnoException).code ?? "unreadable");
      }
    }
  }
  return texts;
}

/** Reads a content directory. Rosters and battles (optional) are read from <dir>/rosters/*.yaml and <dir>/battles/*.yaml. */
export function loadPack(dir: string): RawPack {
  return rawFromTexts(readContentTexts(dir), (k) => join(dir, k));
}
