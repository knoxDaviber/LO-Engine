// Balance series (handover 3b): controlled tests, each changing exactly one thing, printed as markdown tables.
//   npx tsx tools/balance-series.ts [--runs=N] [--seed=S] [--only=T0,T3]     (default 300 runs; T0 defaults to 1000)
// T0 side (mirror), T1 team (swapped sides), T2 accessories, T3 sigil sets, T4 team comp round robin, T5 draft_city defender advantages.
// Every variant is built in memory and must pass validateBattle (checkBattle aborts naming it). All variants share the run seeds, so rows are paired.
// Reading side effect (T1): A and B each play once as challenger. If sides were neutral, A's win as challenger + B's win as challenger = 100.
// Side effect = (A wins as challenger + B wins as challenger) - 100, in points: positive favours the challenger seat, negative the defender seat.
// Team effect = A's win rate averaged over both seats. Exact ties at the phase-3 timeout go to the defender, so T0 also splits timeouts by winner.
// Clones (fresh ids char_1NN, same stats / skills / aura, aura re-pointed) let the same team stand on both sides (a hero may not, E_BATTLE_DUP).
import { execSync } from "node:child_process";
import { parse } from "yaml";
import { aggregate, runMatchup, runSeeds, type MatchupReport } from "../src/batchReport";
import { checkBattle, loadContentPack, readBattleFile } from "../src/cliBattle";
import { runBattle } from "../src/engine";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const RUNS = Number(arg("runs") ?? 300), RUNS0 = Number(arg("runs") ?? 1000), SEED = Number(arg("seed") ?? 1);
const only = arg("only")?.split(",");
const OLD_CITY = "4537d4e"; // commit before the gear rework of city4v4.yaml (T2 reproduces its accessory state); not HEAD so it survives new commits

const pack = loadContentPack();
// Clones of every character: char_0NN -> char_1NN, aura and eligibility lists re-pointed (same pattern as test/engine.fullbattle.test.ts).
const cid = (id: string) => id.replace(/^char_0/, "char_1");
const orig = (id: string) => id.replace(/^char_1/, "char_0");
const repoint = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/char_0(\d\d)/g, "char_1$1"));
for (const ch of [...pack.characters]) {
  const c = { ...structuredClone(ch), id: cid(ch.id), name: `${ch.name} II`, leader_aura: repoint(ch.leader_aura) };
  pack.characters.push(c);
  pack.byId.characters.set(c.id, c);
}
const extend = (l: string[]) => (l.length ? [...l, ...l.map(cid)] : l);
for (const s of pack.skills) s.eligible.characters = extend(s.eligible.characters);
for (const e of pack.equipment) e.eligible.characters = extend(e.eligible.characters);
for (const s of pack.soldiers) s.eligible_heroes = extend(s.eligible_heroes);

// One kit per class (weapon, armor, 2 plain-shop accessories); named heroes follow their class, within their equipment_tags.
const KIT: Record<string, string[]> = {
  char_001: ["010", "018", "024", "027"], char_002: ["009", "018", "024", "021"], char_003: ["011", "019", "025", "021"], char_004: ["010", "017", "021", "021"],
  char_005: ["009", "018", "020", "021"], char_006: ["016", "018", "021", "021"], char_007: ["010", "018", "024", "027"], char_008: ["012", "017", "025", "022"],
  char_009: ["010", "017", "025", "022"], char_010: ["014", "019", "025", "026"], char_011: ["013", "017", "022", "022"], char_012: ["011", "019", "025", "021"],
  char_013: ["016", "017", "024", "027"], char_014: ["015", "018", "021", "021"],
};
const kit = (id: string) => {
  const [w, a, x, y] = KIT[orig(id)]!;
  return { weapon: `equip_${w}`, armor: `equip_${a}`, accessory_1: `equip_${x}`, accessory_2: `equip_${y}` };
};

type Hero = any;
interface Team { heroes: Hero[]; leader: string }
const fileRaw = (f: string): any => readBattleFile(`content/battles/${f}`);
const teamOf = (raw: any, side: "challenger" | "defender"): Team => ({ heroes: structuredClone(raw[side].heroes), leader: raw[side].leader });
const mapHeroes = (t: Team, f: (h: Hero) => void): Team => { const c = structuredClone(t); c.heroes.forEach(f); return c; };
const noSigils = (t: Team) => mapHeroes(t, (h) => { delete h.sigils; delete h.sigil_side; });
const evenKit = (t: Team) => mapHeroes(t, (h) => { delete h.sigils; delete h.sigil_side; h.equipment = kit(h.char_id); });
const clone = (t: Team): Team => ({ leader: cid(t.leader), heroes: t.heroes.map((h) => ({ ...structuredClone(h), char_id: cid(h.char_id) })) });
const withSigils = (t: Team, god: string, side: string) => mapHeroes(t, (h) => { h.sigils = { weapon: god, armor: god, accessory_1: god, accessory_2: god }; h.sigil_side = side; });
const mk = (c: Team, d: Team, terrain?: string) => ({
  battle_id: "series", version: "1", ...(terrain ? { battlefield: terrain } : {}), seeds: [1, 2, 3],
  challenger: { leader: c.leader, heroes: c.heroes }, defender: { leader: d.leader, heroes: d.heroes },
});
const CITY = "terrain_005";

const run = (label: string, raw: any, runs = RUNS): MatchupReport => runMatchup(pack, checkBattle(raw, label, pack), "series", runs, SEED);
const pct = (x: number) => (x * 100).toFixed(1);
const md = (head: string[], rows: (string | number)[][]) => console.log([head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n") + "\n");
const margin = (n: number) => (196 * Math.sqrt(0.25 / n)).toFixed(1);
const heroes = (r: MatchupReport) => r.units.filter((u) => u.kind === "hero");
const t0 = Date.now();
const want = (t: string) => !only || only.includes(t);
const done = (t: string, s: number) => console.error(`${t} done in ${((Date.now() - s) / 1000).toFixed(0)}s`);

console.log(`# Balance series (seed ${SEED})\n`);
console.log(`95% margin on a win rate near 50%: +-${margin(RUNS)} points at ${RUNS} runs, +-${margin(RUNS0)} at ${RUNS0} (T0 default). Win rates are the challenger's unless a column says otherwise.\n`);

// ---- T0: side only
if (want("T0")) {
  const s = Date.now();
  console.log(`## T0 Side only (mirror, ${RUNS0} runs)\nA team against its own clone: same gear, same formation, no sigils. 50% +-${margin(RUNS0)} only if nothing ties, but in a mirror everything does: every action ties (Decision 64, challenger first) and exact timeout ties go to the defender, so OUTSIDE is expected here.\n`);
  const city = fileRaw("city4v4.yaml"), sample = fileRaw("sample.yaml");
  const teams: [string, Team][] = [
    ["city4v4 challenger team", noSigils(teamOf(city, "challenger"))], ["city4v4 defender team", noSigils(teamOf(city, "defender"))],
    ["sample Leon+Lief", noSigils(teamOf(sample, "challenger"))], ["sample Emperor+Jasmine", noSigils(teamOf(sample, "defender"))],
  ];
  const rows: (string | number)[][] = [];
  for (const [name, t] of teams) for (const [tn, terrain] of [["none", undefined], ["City", CITY]] as const) {
    const label = `T0-${name}-${tn}`;
    const input = checkBattle(mk(t, clone(t), terrain), label, pack);
    const logs = Array.from({ length: RUNS0 }, (_, i) => runBattle(pack, { ...input, seeds: runSeeds(SEED, "series", i) } as any).events);
    const r = aggregate(label, logs);
    const to = { challenger: 0, defender: 0 };
    for (const ev of logs) { const e = ev.at(-1)!; if (e.type === "battle_end" && e.reason.includes("timeout")) to[e.winner]++; }
    const diff = (r.challenger_win_rate - 0.5) * 100;
    rows.push([name, tn, pct(r.challenger_win_rate), Math.abs(diff) > Number(margin(RUNS0)) ? "OUTSIDE" : "ok", pct(r.timeout_rate), `${to.challenger} / ${to.defender}`, r.avg_phases.toFixed(2)]);
  }
  md(["team", "terrain", "chal win %", "vs 50% margin", "timeout %", "timeouts won chal / def", "avg phases"], rows);
  done("T0", s);
}

// ---- T1: even start, swapped
if (want("T1")) {
  const s = Date.now();
  console.log(`## T1 Even start, swapped (${RUNS} runs per seat)\nEven kit, no sigils, no terrain. A = the file's challenger heroes, B = its defender heroes. Exact timeout ties count in the side effect, so read it next to the timeout column.\n`);
  const rows: (string | number)[][] = [];
  for (const f of ["city4v4.yaml", "city4v4-edit.yaml", "sample.yaml", "full4v4.yaml"]) {
    const raw = fileRaw(f), A = evenKit(teamOf(raw, "challenger")), B = evenKit(teamOf(raw, "defender"));
    const ab = run(`T1-${f}-A`, mk(A, B)), ba = run(`T1-${f}-B`, mk(B, A));
    const a = ab.challenger_win_rate * 100, b = ba.challenger_win_rate * 100;
    rows.push([f, a.toFixed(1), b.toFixed(1), ((a + (100 - b)) / 2).toFixed(1), (a + b - 100).toFixed(1), pct((ab.timeout_rate + ba.timeout_rate) / 2), ((ab.avg_phases + ba.avg_phases) / 2).toFixed(2)]);
  }
  md(["file", "A win % (A challenger)", "B win % (B challenger)", "A win % avg of both seats", "side effect (pts)", "timeout %", "avg phases"], rows);
  done("T1", s);
}

// ---- T2: accessories (city4v4 as of OLD_CITY)
if (want("T2")) {
  const s = Date.now();
  console.log(`## T2 Accessories (${RUNS} runs)\ncity4v4 as of commit ${OLD_CITY} (its sigils and City terrain kept). "fill" = the class kit's two accessories. Delta is against the old state.\n`);
  const old = parse(execSync(`git show ${OLD_CITY}:content/battles/city4v4.yaml`, { encoding: "utf-8" }));
  const side = (who: "challenger" | "defender", f: (h: Hero) => void, only?: string) => { const t = teamOf(old, who); t.heroes.forEach((h) => (!only || h.char_id === only) && f(h)); return t; };
  const none = (h: Hero) => { h.equipment.accessory_1 = null; h.equipment.accessory_2 = null; };
  const fill = (h: Hero) => { const k = kit(h.char_id); h.equipment.accessory_1 = k.accessory_1; h.equipment.accessory_2 = k.accessory_2; };
  const nop = () => {};
  const go = (name: string, c: Team, d: Team) => ({ name, r: run(`T2-${name}`, mk(c, d, old.battlefield)) });
  const res = [
    go("no accessories at all", side("challenger", none), side("defender", none)),
    go("old accessories", side("challenger", nop), side("defender", nop)),
    go("filled: challenger only", side("challenger", fill), side("defender", nop)),
    go("filled: defender only", side("challenger", nop), side("defender", fill)),
    go("filled: both", side("challenger", fill), side("defender", fill)),
  ];
  const oneAt: typeof res = [];
  for (const who of ["challenger", "defender"] as const) for (const h of old[who].heroes) {
    const c = side("challenger", who === "challenger" ? fill : nop, who === "challenger" ? h.char_id : "-"), d = side("defender", who === "defender" ? fill : nop, who === "defender" ? h.char_id : "-");
    oneAt.push(go(`fill ${who} ${h.char_id} only`, c, d));
  }
  const base = res[1]!.r.challenger_win_rate;
  md(["variant", "chal win %", "delta (pts)", "timeout %", "avg phases"], [...res, ...oneAt].map(({ name, r }) => [name, pct(r.challenger_win_rate), ((r.challenger_win_rate - base) * 100).toFixed(1), pct(r.timeout_rate), r.avg_phases.toFixed(2)]));
  const top = oneAt.reduce((m, x) => (Math.abs(x.r.challenger_win_rate - base) > Math.abs(m.r.challenger_win_rate - base) ? x : m));
  console.log(`Biggest single-hero swing: ${top.name}. Per hero, old state -> that variant (death rate = share of runs the hero died; dmg = avg damage dealt per run):\n`);
  const after = new Map(heroes(top.r).map((u) => [u.id, u]));
  md(["side", "hero", "death % before", "death % after", "dmg before", "dmg after"], heroes(res[1]!.r).map((u) => [u.side, u.name, pct(u.death_rate), pct(after.get(u.id)!.death_rate), u.avg_damage.toFixed(0), after.get(u.id)!.avg_damage.toFixed(0)]));
  done("T2", s);
}

// ---- T3: sigil sets
if (want("T3")) {
  const s = Date.now();
  console.log(`## T3 Sigil sets (${RUNS} runs per cell)\nMirror, no terrain, even kit: one side wears one god's 4-piece on all 4 heroes, the other none. Cell = win % of the set wearer, averaged over wearing the challenger seat and the defender seat (cancels seat bias).\n`);
  const city = fileRaw("city4v4.yaml");
  const teams = (["challenger", "defender"] as const).map((w) => evenKit(teamOf(city, w)));
  const rows: (string | number)[][] = [];
  for (const g of pack.gods) for (const side of ["def", "atk"]) {
    const cells = teams.map((t, i) => {
      const w = withSigils(t, g.id, side), c = clone(t);
      const onChal = run(`T3-${g.id}-${side}-${i}-c`, mk(w, c)).challenger_win_rate;
      const onDef = 1 - run(`T3-${g.id}-${side}-${i}-d`, mk(t, clone(w))).challenger_win_rate;
      return ((onChal + onDef) / 2) * 100;
    });
    rows.push([`${g.name} (${g.blessing.name})`, side, ...cells.map((x) => x.toFixed(1)), ((cells[0]! + cells[1]!) / 2) as any]);
  }
  rows.sort((a, b) => Number(b[4]) - Number(a[4]));
  md(["set", "side", "on city4v4 challenger team", "on city4v4 defender team", "mean"], rows.map((r) => [...r.slice(0, 4), Number(r[4]).toFixed(1)] as (string | number)[]));
  done("T3", s);
}

// ---- T4 / T5 draw on draft_city's sheets and rosters
const draft = fileRaw("draft_city.yaml");
const sheets = new Map<string, Hero>([...draft.challenger.roster.heroes, ...draft.defender.roster.heroes].map((h: Hero) => [h.char_id, h]));
// The front row holds 3: the last front-line hero of a 4-front team stands in the back row (the roster form does this itself, "moved").
const fitFront = (t: Team): Team => {
  const front = t.heroes.filter((h) => pack.byId.characters.get(orig(h.char_id))!.preferred_row === "front");
  if (front.length > 3) front.at(-1)!.preferred_row = "back";
  return t;
};
if (want("T4")) {
  const s = Date.now();
  console.log(`## T4 Team comp round robin (${RUNS} runs per ordered pair)\nGeneric heroes, sheets from draft_city, even kit, no sigils, no terrain; the defending comp is always played by clones. First hero leads. Cell = row comp's win % as challenger against the column comp.\n`);
  const comps: [string, string[]][] = [
    ["A (inf, cav, archer, holy)", ["005", "007", "008", "012"]], ["B (monster, assassin, mage, lancer)", ["014", "011", "010", "006"]],
    ["no-healer (inf, cav, archer, mage)", ["005", "007", "008", "010"]], ["3-backline (inf, archer, mage, holy)", ["005", "008", "010", "012"]],
    ["melee (inf, lancer, cav, aquatic)", ["005", "006", "007", "013"]],
  ];
  const team = (ids: string[]): Team => fitFront(evenKit({ leader: `char_${ids[0]}`, heroes: ids.map((i) => structuredClone(sheets.get(`char_${i}`))) }));
  const win: number[][] = comps.map(() => comps.map(() => NaN));
  comps.forEach(([, a], i) => comps.forEach(([, b], j) => { if (i !== j) win[i]![j] = run(`T4-${i}-${j}`, mk(team(a), clone(team(b)))).challenger_win_rate * 100; }));
  const overall = comps.map((_, i) => { const o = comps.map((_, j) => j).filter((j) => j !== i); return o.reduce((t, j) => t + win[i]![j]! + (100 - win[j]![i]!), 0) / (2 * o.length); });
  md(["comp (row = challenger)", ...comps.map(([n]) => n.split(" ")[0]!), "overall win % (both seats)"], comps.map(([n], i) => [n, ...win[i]!.map((x) => (isNaN(x) ? "-" : x.toFixed(1))), overall[i]!.toFixed(1)]));
  done("T4", s);
}

if (want("T5")) {
  const s = Date.now();
  console.log(`## T5 Real defender advantages (draft_city, ${RUNS} runs; the draft runs every run)\nEven kit, no sigils. One change per row against "as is" unless noted. Unit names with a rate below 100% were fielded / banned in only some runs.\n`);
  const base = (): any => {
    const r = structuredClone(draft);
    for (const side of ["challenger", "defender"]) r[side].roster.heroes.forEach((h: Hero) => { delete h.sigils; delete h.sigil_side; h.equipment = kit(h.char_id); });
    return r;
  };
  const first4 = (r: any, side: string): Team => { const ro = r[side].roster, ids: string[] = ro.leader_line.slice(0, 4); return evenKit(fitFront({ leader: ids[0]!, heroes: ids.map((i) => structuredClone(ro.heroes.find((h: Hero) => h.char_id === i))) })); };
  const variants: [string, any][] = [["as is", base()]];
  // An empty ban sheet still bans (the fallback takes the highest-cost hero, here the Infantry), so "no ban sheet" is the fixed-fielding row below.
  let r = base(); { const raw = mk(first4(r, "challenger"), first4(r, "defender"), CITY) as any; raw.challenger.edits = r.challenger.edits.filter((e: any) => e.phase === 2); variants.push(["no draft: each side fields the first 4 of its leader line, fielded form (also drops the phase-3 leader edit)", raw]); }
  r = base(); r.defender.roster.battlefield = null; variants.push(["no terrain", r]);
  r = base(); delete r.challenger.edits; variants.push(["no challenger edits", r]);
  r = base(); {
    const ch = r.challenger.roster, df = r.defender.roster;
    r.challenger.roster = { ...df, roster_id: "swapped_challenger", anchor: null, ban_sheet: null, battlefield: undefined };
    r.defender.roster = { ...ch, roster_id: "swapped_defender", anchor: "char_005", ban_sheet: df.ban_sheet, battlefield: df.battlefield };
    r.challenger.draft = { bans: ["char_012", "char_008"], protects: ["char_004"] }; // mirrors the original picks: top non-anchor hero, then a damage dealer; protect the leader
    delete r.challenger.edits; variants.push(["rosters swapped (old defender roster challenges; old challenger roster defends with anchor Infantry, the same ban sheet, City; no edits)", r]);
  }
  const rows = variants.map(([name, raw], i) => {
    const m = run(`T5-${i}`, raw);
    const list = (side: string, f: (u: MatchupReport["units"][number]) => number) => heroes(m).filter((u) => u.side === side && f(u) > 0).map((u) => `${u.name}${f(u) < 1 ? ` ${pct(f(u))}%` : ""}`).join(", ") || "-";
    return [name, pct(m.challenger_win_rate), pct(m.timeout_rate), m.avg_phases.toFixed(2), list("challenger", (u) => u.fielded_rate), list("defender", (u) => u.fielded_rate), list("challenger", (u) => u.banned_rate), list("defender", (u) => u.banned_rate)];
  });
  md(["row", "chal win %", "timeout %", "avg phases", "chal fielded", "def fielded", "chal banned", "def banned"], rows);
  console.log("Anchor not isolated: the anchor only protects a hero from bans, and the scripted human bans never target the Monster, so removing it changes nothing here.\n");
  done("T5", s);
}
console.error(`total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
