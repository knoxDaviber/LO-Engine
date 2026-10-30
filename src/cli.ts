import { validateContent } from "./validate";
import type { Tier } from "./types";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.startsWith("--tier")));
const tierArg = args.find((a) => a.startsWith("--tier="))?.split("=")[1] ?? (args.includes("--tier") ? args[args.indexOf("--tier") + 1] : undefined);
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--tier") ?? "content";
const tier: Tier = tierArg === "community" ? "community" : "official";

let result;
try {
  result = validateContent(dir, { tier });
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(2);
}
const { report } = result;

if (flags.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const icon = { error: "ERROR", warning: "warn ", info: "info " } as const;
  for (const i of report.issues) {
    if (i.severity === "info" && !flags.has("--verbose")) continue;
    const where = [i.file, i.id, i.path].filter(Boolean).join(" > ");
    console.log(`${icon[i.severity]} ${i.code}  ${where}\n       ${i.message}`);
  }
  console.log(`\n${tier} tier: ${report.errors} error(s), ${report.warnings} warning(s), ${report.infos} note(s)`);
}
process.exit(report.errors > 0 || (flags.has("--strict") && report.warnings > 0) ? 1 : 0);
