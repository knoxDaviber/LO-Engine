// Full battles (roadmap 2.6). Content has only 4 heroes and a hero may not stand on both sides (E_BATTLE_DUP), so a true 4v4 is built in memory:
// the four real heroes against four clones with fresh ids (same stats, skills and auras, hero references re-pointed at the clones).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Collector } from "../src/types";
import { loadPack } from "../src/load";
import { battleSchema, type Battle } from "../src/schema";
import { validateBattle } from "../src/validate/battle";
import { renderLog, runBattle } from "../src/engine";
import { loadReal } from "./engineHelpers";

const IDS = ["char_001", "char_002", "char_003", "char_004"];
const clone = (id: string) => id.replace("char_00", "char_10");

function build4v4(): { pack: ReturnType<typeof loadReal>["pack"]; battle: Battle } {
  const { pack, battle: sample } = loadReal({ squads: true, auras: true });
  const sheets = new Map([...sample.challenger.heroes, ...sample.defender.heroes].map((h) => [h.char_id, h.tactic_sheet] as const));
  const full = battleSchema.parse((loadPack("content").battles ?? []).find((b) => b.name === "full4v4.yaml")!.data);
  for (const h of [...full.challenger.heroes, ...full.defender.heroes]) sheets.set(h.char_id, h.tactic_sheet);
  const re = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/char_00(\d)/g, "char_10$1"));
  for (const id of IDS) {
    const ch = structuredClone(pack.byId.characters.get(id)!);
    const c = { ...ch, id: clone(id), name: `${ch.name} II`, leader_aura: re(ch.leader_aura) };
    pack.characters.push(c);
    pack.byId.characters.set(c.id, c);
  }
  for (const sk of pack.skills) if (sk.eligible.characters.length) sk.eligible.characters = [...sk.eligible.characters, ...sk.eligible.characters.map(clone)];
  const hero = (id: string, squad: string) => ({
    char_id: id, squad_id: squad, equipment: { weapon: null, armor: null, accessory_1: null, accessory_2: null },
    tactic_sheet: structuredClone(sheets.get(id.startsWith("char_10") ? id.replace("char_10", "char_00") : id)!).map((t) => ({ ...t })),
  });
  const side = (ids: string[], leader: string) => ({ leader, heroes: ids.map((id, i) => hero(id, id.endsWith("1") && i === 0 ? "soldier_002" : "soldier_001")) });
  return {
    pack,
    battle: battleSchema.parse({
      battle_id: "full_4v4", version: "1", seeds: [11, 22, 33],
      challenger: side(IDS, "char_001"), // Leon leads: his aura needs the Emperor, who is fielded beside him
      defender: side(IDS.map(clone), "char_102"), // Emperor II leads (Jasmine II leading would put 4 heroes in the 3-slot front row)
    }),
  };
}

test("the 4v4 battle validates (4 heroes and a squad per side, no duplicates)", () => {
  const { pack, battle } = build4v4();
  const c = new Collector();
  validateBattle(battle, pack, c, { file: "full_4v4", tier: "official" });
  assert.deepEqual(c.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`), []);
  assert.equal(battle.challenger.heroes.length, 4);
  assert.equal(battle.defender.heroes.length, 4);
});

test("the 4v4 sim is deterministic: byte-identical JSON and text twice", () => {
  const a = runBattle(...Object.values(build4v4()) as [any, any]);
  const b = runBattle(...Object.values(build4v4()) as [any, any]);
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(renderLog(a.events), renderLog(b.events));
});

test("the 4v4 sim terminates with a winner and a reason, within three phases", () => {
  const { pack, battle } = build4v4();
  const r = runBattle(pack, battle);
  assert.ok(r.winner === "challenger" || r.winner === "defender");
  assert.ok(r.reason === "wipe" || r.reason === "phase3_timeout");
  assert.ok(r.phases.length >= 1 && r.phases.length <= 3);
  assert.equal(r.units.length, 8);
  assert.equal(r.squads.length, 2);
  assert.ok(r.events.some((e) => e.type === "aura_applied")); // auras ran
  const end = r.events.at(-1)!;
  assert.deepEqual(end.type === "battle_end" && [end.winner, end.reason], [r.winner, r.reason]);
  if (r.reason === "wipe") assert.ok(r.units.filter((u) => u.side !== r.winner).every((u) => !u.alive));
});

test("content/battles/full4v4.yaml (2v2, the most the content allows) validates and runs deterministically", () => {
  const { pack } = loadReal({ squads: true, auras: true });
  const raw = (loadPack("content").battles ?? []).find((b) => b.name === "full4v4.yaml")!.data;
  const c = new Collector();
  validateBattle(raw, pack, c, { file: "full4v4.yaml", tier: "official" });
  assert.deepEqual(c.issues.filter((i) => i.severity === "error"), []);
  const run = () => runBattle(pack, battleSchema.parse(raw));
  assert.equal(JSON.stringify(run().events), JSON.stringify(run().events));
  assert.ok(["challenger", "defender"].includes(run().winner));
});
