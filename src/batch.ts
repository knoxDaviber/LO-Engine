// Batch simulator CLI: npm run batch -- <battle.yaml> [more.yaml ...] [--runs=N] [--seed=S] [--json]
import { renderReport, runMatchup } from "./batchReport";
import { checkBattle, loadContentPack, readBattleFile } from "./cliBattle";

const USAGE = "usage: npm run batch -- <battle.yaml> [more.yaml ...] [--runs=N] [--seed=S] [--json]";
const args = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(`error: ${msg}\n${USAGE}`);
  process.exit(2);
};
for (const a of args) {
  if (!a.startsWith("--") || a === "--json" || /^--(runs|seed)=/.test(a)) continue;
  fail(a === "--runs" || a === "--seed" ? `${a} needs a value: use ${a}=N` : `unknown option ${a}`);
}
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));
const opt = (name: string, def: number, min: number, max: number): number => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  if (a === undefined) return def;
  const s = a.slice(name.length + 3);
  const v = Number(s);
  if (!/^\d+$/.test(s) || v < min || v > max) fail(`--${name} must be a decimal integer in [${min}, ${max}]`);
  return v;
};
const runs = opt("runs", 100, 1, 1e6);
const base = opt("seed", 1, 0, 2 ** 32 - 1);
if (files.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const raws = files.map((f) => readBattleFile(f));
const pack = loadContentPack();
const inputs = files.map((f, i) => checkBattle(raws[i], f, pack));
const reports = inputs.map((input, i) => runMatchup(pack, input, files[i]!, runs, base));
process.stdout.write(json ? JSON.stringify({ base_seed: base, runs, matchups: reports }, null, 2) + "\n" : renderReport(reports, base));
