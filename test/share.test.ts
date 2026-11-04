// Team sharing (game/logic/share.ts) and Versus mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readContentTexts } from "../src/load";
import { runBattle } from "../src/engine";
import { bootPack } from "../game/logic/content";
import { buildBattle } from "../game/logic/battle";
import { fieldedEntries } from "../game/logic/party";
import { afterResult, fight, fightBlocker, startRun } from "../game/logic/run";
import { exportTeam, importTeam, MAX_KEY_CHARS, MAX_NAME_CHARS } from "../game/logic/share";

const pack = bootPack(readContentTexts("content"));
const versus = () => startRun(pack, 7, false, "versus");
const sideOf = (s = versus()) => ({ leader: s.leader!, heroes: fieldedEntries(s.pool, { [s.leader!]: 50 }) });
const enc = (o: unknown) => "LO1-" + Buffer.from(JSON.stringify(o)).toString("base64url");
const bad = (t: string) => { const r = importTeam(pack, t); assert.equal(r.ok, false); return (r as { error: string }).error; };

test("share: round trip keeps heroes, gear, sheets, sigils and the leader; wounds never travel", () => {
  const side = sideOf();
  side.heroes[0] = { ...side.heroes[0]!, sigils: { weapon: "god_001" } as never };
  const key = exportTeam(side, "Ünï Team");
  assert.ok(!Buffer.from(key.slice(4), "base64url").toString().includes("start_hp_percent"));
  const r = importTeam(pack, `  ${key.slice(0, 20)}\n${key.slice(20)} `);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.name, "Ünï Team");
  assert.equal(r.side.leader, `${side.leader}_c1`);
  const back = r.side.heroes.map((h) => ({ ...h, char_id: h.char_id.replace(/_c1$/, "") }));
  assert.deepEqual(back, side.heroes.map(({ start_hp_percent: _w, ...h }) => h));
});

test("share: an imported team fights a player holding the same heroes, and Versus never moves on", () => {
  let s = versus();
  assert.match(fightBlocker(pack, s)!, /rival/);
  const r = importTeam(pack, exportTeam(sideOf(s), "Twin"));
  assert.ok(r.ok);
  if (!r.ok) return;
  s = fight(pack, { ...s, enemy: r.side, rival: r.name });
  assert.equal(s.screen, "fight");
  const again = afterResult(pack, s);
  assert.equal(again.screen, "prep");
  assert.equal(again.enemy, r.side);
  assert.equal(again.pool, s.pool);
  assert.equal(buildBattle(pack, { seed: s.seed, stage: 0, attempt: 0, pool: s.pool, leader: s.leader!, enemy: r.side, mode: "versus" }).battle_id, "versus_1");
});

test("share: rejects garbage, truncation, versions, oversize, size and name caps", () => {
  const key = exportTeam(sideOf(), "x");
  for (const t of ["", "hello", "LO1-", "LO1-%%%", "LO1-" + "A".repeat(50), key.slice(0, key.length - 40)]) bad(t);
  assert.match(bad("LO2-" + key.slice(4)), /another version/);
  assert.match(bad(key + " ".repeat(MAX_KEY_CHARS)), /too long/);
  assert.match(bad(exportTeam(sideOf(), "x").replace(/^LO1-.*/, enc({ n: "y".repeat(MAX_NAME_CHARS + 1), s: sideOf() }))), /name/);
});

test("share: rejects too many heroes, unknown or generic heroes, wounds, edits, illegal gear", () => {
  const side = sideOf(), { start_hp_percent: _w, ...one } = side.heroes[0]!;
  side.heroes = [one];
  const many = { leader: side.leader, heroes: Array.from({ length: pack.rules.draft.fielded + 1 }, () => one) };
  bad(enc({ n: "a", s: many }));
  assert.match(bad(enc({ n: "a", s: { leader: "char_999", heroes: [{ ...one, char_id: "char_999" }] } })), /does not exist/);
  const generic = pack.characters.find((c) => c.name.toLowerCase() === c.class)!;
  bad(enc({ n: "a", s: { leader: generic.id, heroes: [{ ...one, char_id: generic.id }] } }));
  bad(enc({ n: "a", s: { leader: `${one.char_id}_c1`, heroes: [{ ...one, char_id: `${one.char_id}_c1` }] } }));
  bad(enc({ n: "a", s: { ...side, heroes: [{ ...one, start_hp_percent: 40 }] } }));
  bad(enc({ n: "a", s: { ...side, edits: [] } }));
  const armor = pack.equipment.find((e) => e.id !== one.equipment.weapon && !e.eligible.characters.includes(one.char_id) && e.slot === "weapon");
  assert.ok(armor, "content has a weapon this hero cannot equip");
  assert.match(bad(enc({ n: "a", s: { ...side, heroes: [{ ...one, equipment: { ...one.equipment, weapon: armor!.id } }] } })), /E_EQUIP_INELIGIBLE/);
});
