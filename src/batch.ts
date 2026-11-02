// Batch simulator CLI: npm run batch -- <battle.yaml> [more.yaml ...] [--runs=N] [--seed=S] [--json] [--pp-active=A,B] [--pp-passive=C,D]
//   [--formula=F,G] (damage formula sweep; every combination with the PP lists, same run seeds)
import { renderReport, renderSweep, runMatchup, runSweep } from "./batchReport";
import { checkBattle, formulaFlag, rejectRepeats, loadContentPack, ppFlag, readBattleFile } from "./cliBattle";

const USAGE = "usage: npm run batch -- <battle.yaml> [more.yaml ...] [--runs=N] [--seed=S] [--json] [--pp-active=N[,N...]] [--pp-passive=N[,N...]] [--formula=F[,F...]] (F = subtract | ratio[:K] | scaled_subtract[:FLOOR[:WEIGHT]])";
const args = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(`error: ${msg}\n${USAGE}`);
  process.exit(2);
};
for (const a of args) {
  if (!a.startsWith("--") || a === "--json" || /^--(runs|seed|pp-active|pp-passive|formula)=/.test(a)) continue;
  fail(["--runs", "--seed", "--pp-active", "--pp-passive", "--formula"].includes(a) ? `${a} needs a value: use ${a}=N` : `unknown option ${a}`);
}
rejectRepeats(args, ["runs", "seed", "pp-active", "pp-passive", "formula"], fail);
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
const actives = ppFlag(args, "pp-active", true, fail);
const passives = ppFlag(args, "pp-passive", true, fail);
const formulas = formulaFlag(args, true, fail);
if (files.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const raws = files.map((f) => readBattleFile(f));
const pack = loadContentPack();
const inputs = files.map((f, i) => checkBattle(raws[i], f, pack));
if (actives || passives || formulas) {
  const sweeps = inputs.map((input, i) => runSweep(pack, input, files[i]!, runs, base, actives ?? [undefined], passives ?? [undefined], formulas ?? [undefined]));
  process.stdout.write(json ? JSON.stringify({ base_seed: base, runs, sweeps }, null, 2) + "\n" : renderSweep(sweeps, base));
} else {
  const reports = inputs.map((input, i) => runMatchup(pack, input, files[i]!, runs, base));
  process.stdout.write(json ? JSON.stringify({ base_seed: base, runs, matchups: reports }, null, 2) + "\n" : renderReport(reports, base));
}
