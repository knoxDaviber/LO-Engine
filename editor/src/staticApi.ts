// Static build only (npm run editor:build, GitHub Pages): editor/core.ts runs in the browser over the content/ YAML bundled at build time.
// Battle / roster files are the bundled ones (read-only); save downloads the validated YAML instead of writing it.
import { createCore, type ContentStore } from "../core";

const PREFIX = "../../content/";
const bundled = import.meta.glob(["../../content/*.yaml", "../../content/battles/*.yaml", "../../content/rosters/*.yaml"], {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;
const texts: Record<string, string> = Object.fromEntries(Object.entries(bundled).map(([k, v]) => [k.slice(PREFIX.length), v]));

/** Hands the browser a file named after `rel` (`battles/x.yaml` -> `x.yaml`). */
function download(rel: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  a.download = rel.split("/").pop()!;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const store: ContentStore = {
  list: (folder) => Object.keys(texts).filter((k) => k.startsWith(`${folder}/`)).sort(),
  read: (rel) => texts[rel],
  write: (rel, text) => download(rel, text),
};

export const core = createCore(texts, store);
