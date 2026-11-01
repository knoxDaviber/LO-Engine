// Battle simulator CLI: npm run sim -- <battle.yaml> [--json]
import { checkBattle, loadContentPack, readBattleFile } from "./cliBattle";
import { renderLog, runBattle } from "./engine";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run sim -- <battle.yaml> [--json]");
  process.exit(2);
}

const raw = readBattleFile(file);
const pack = loadContentPack();
const result = runBattle(pack, checkBattle(raw, file, pack));
process.stdout.write(json ? JSON.stringify(result.events, null, 2) + "\n" : renderLog(result.events));
