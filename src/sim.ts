// Battle simulator CLI: npm run sim -- <battle.yaml> [--json]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "yaml";
import { battleSchema } from "./schema";
import { renderLog, runBattle } from "./engine";
import { Collector } from "./types";
import { validateContent } from "./validate";
import { validateBattle } from "./validate/battle";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run sim -- <battle.yaml> [--json]");
  process.exit(2);
}

let raw: unknown;
try {
  raw = parse(readFileSync(file, "utf-8"));
} catch (e) {
  console.error(`error: cannot read ${file}: ${(e as Error).message}`);
  process.exit(2);
}

const { pack, report } = validateContent("content");
const contentErrors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/"));
if (!pack || contentErrors.length > 0) {
  for (const i of contentErrors) console.error(`ERROR ${i.code}  ${[i.file, i.id, i.path].filter(Boolean).join(" > ")}\n       ${i.message}`);
  console.error("content has validation errors; refusing to run");
  process.exit(1);
}

const c = new Collector();
validateBattle(raw, pack, c, { file: basename(file), tier: "official" });
const errors = c.issues.filter((i) => i.severity === "error");
if (errors.length > 0) {
  for (const i of errors) console.error(`ERROR ${i.code}  ${[i.file, i.id, i.path].filter(Boolean).join(" > ")}\n       ${i.message}`);
  console.error(`${file} has ${errors.length} validation error(s); refusing to run`);
  process.exit(1);
}

const result = runBattle(pack, battleSchema.parse(raw));
process.stdout.write(json ? JSON.stringify(result.events, null, 2) + "\n" : renderLog(result.events));
