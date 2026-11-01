// Shared by the sim and batch CLIs: read a battle file, validate the content pack and the battle. Each step prints and exits on failure
// (exit codes as the validate CLI: 2 load failure, 1 validation errors).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "yaml";
import { parseBattleInput, type BattleInput } from "./schema";
import { Collector, type Issue } from "./types";
import { validateContent } from "./validate";
import { validateBattle } from "./validate/battle";
import type { Pack } from "./validate/pack";

const print = (issues: Issue[]) => {
  for (const i of issues) console.error(`ERROR ${i.code}  ${[i.file, i.id, i.path].filter(Boolean).join(" > ")}\n       ${i.message}`);
};

/** Parsed YAML of a battle file; exits 2 when it cannot be read or parsed. */
export function readBattleFile(file: string): unknown {
  try {
    return parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`error: cannot read ${file}: ${(e as Error).message}`);
    process.exit(2);
  }
}

/** The validated content pack (sample battles in content/battles are not part of it); exits 1 on content errors. */
export function loadContentPack(dir = "content"): Pack {
  const { pack, report } = validateContent(dir);
  const contentErrors = report.issues.filter((i) => i.severity === "error" && !i.file?.startsWith("battles/"));
  if (!pack || contentErrors.length > 0) {
    print(contentErrors);
    console.error("content has validation errors; refusing to run");
    process.exit(1);
  }
  return pack;
}

/** Validates a battle input (either form) against the pack and parses it; exits 1 on errors. */
export function checkBattle(raw: unknown, file: string, pack: Pack): BattleInput {
  const c = new Collector();
  validateBattle(raw, pack, c, { file: basename(file), tier: "official" });
  const errors = c.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    print(errors);
    console.error(`${file} has ${errors.length} validation error(s); refusing to run`);
    process.exit(1);
  }
  return parseBattleInput(raw);
}
