// Battle simulator CLI: npm run sim -- <battle.yaml> [--json] [--pp-active=N] [--pp-passive=N] [--formula=NAME[:PARAMS]]
import { checkBattle, formulaFlag, rejectRepeats, loadContentPack, ppFlag, readBattleFile } from "./cliBattle";
import { renderLog, runBattle } from "./engine";

const USAGE = "usage: npm run sim -- <battle.yaml> [--json] [--pp-active=N] [--pp-passive=N] [--formula=subtract|ratio[:K]|scaled_subtract[:FLOOR[:WEIGHT]]]";
const args = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(`error: ${msg}\n${USAGE}`);
  process.exit(2);
};
for (const a of args) {
  if (!a.startsWith("--") || a === "--json" || /^--(pp-active|pp-passive|formula)=/.test(a)) continue;
  fail(["--pp-active", "--pp-passive", "--formula"].includes(a) ? `${a} needs a value: use ${a}=...` : `unknown option ${a}`);
}
rejectRepeats(args, ["pp-active", "pp-passive", "formula"], fail);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error(USAGE);
  process.exit(2);
}
const active = ppFlag(args, "pp-active", false, fail)?.[0];
const passive = ppFlag(args, "pp-passive", false, fail)?.[0];
const formula = formulaFlag(args, false, fail)?.[0]?.option;

const raw = readBattleFile(file);
const pack = loadContentPack();
const result = runBattle(pack, checkBattle(raw, file, pack), { pp: { active, passive }, ...(formula ? { formula } : {}) });
process.stdout.write(json ? JSON.stringify(result.events, null, 2) + "\n" : renderLog(result.events));
