import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { createApi, requestGuard } from "../editor/api";

const api = createApi("content");
const battle = (name: string) => parse(readFileSync(`content/battles/${name}`, "utf-8"));

test("editor api: content lists tactic leaves with a params schema, gods, terrains and battle files", () => {
  const c = api.content();
  const hp = c.leaves.find((l) => l.type === "hp_percent");
  assert.ok(hp, "hp_percent leaf");
  assert.equal((hp.params as any).type, "object");
  assert.deepEqual(Object.keys((hp.params as any).properties).sort(), ["op", "side", "value"]);
  assert.ok(!c.leaves.some((l) => l.type === "hero_is" || l.type === "cost"), "authored-only and ban leaves are not offered");
  assert.ok(c.gods.length > 0 && c.gods.every((g) => g.blessing));
  assert.ok(c.terrains.some((t) => t.id === "terrain_005"));
  assert.ok(c.characters.find((ch) => ch.id === "char_001")!.skills.length > 0);
  assert.equal(c.rules.max_tactics > 0, true);
  assert.ok(c.files.battles.includes("battles/sample.yaml"));
  assert.equal(api.handle("GET", "/api/content", undefined).status, 200);
});

test("editor api: catalog serves the full content, rules and leaf descriptions", () => {
  const r = api.handle("GET", "/api/catalog", undefined);
  assert.equal(r.status, 200);
  const c = r.json as any;
  for (const k of ["skills", "equipment", "statuses", "gods", "soldiers", "terrains"]) assert.ok(c[k].length > 0, k);
  assert.ok(c.rules.board.columns > 0 && c.rules.class_advantage.length > 0);
  assert.ok(c.skills[0].effects.length > 0 && c.gods[0].blessing.two_piece.length > 0);
});

test("editor api: file paths are restricted to content/battles and content/rosters", () => {
  assert.equal((api.file("battles/sample.yaml").data as any).battle_id, "sample_2v2");
  for (const bad of ["../package.json", "battles/../rules.yaml", "rules.yaml", "skills.yaml", "src/sim.ts", "battles/sub/x.yaml", "/etc/passwd", "battles/x.json"]) {
    const r = api.handle("GET", `/api/file?path=${encodeURIComponent(bad)}`, undefined);
    assert.equal(r.status, 400, bad);
  }
  assert.equal(api.handle("GET", "/api/file?path=battles/missing.yaml", undefined).status, 404);
});

test("editor api: validate returns issues for a broken battle and none for sample.yaml", () => {
  assert.equal(api.validate(battle("sample.yaml")).issues.filter((i) => i.severity === "error").length, 0);
  const b = battle("sample.yaml");
  b.challenger.leader = "char_003";
  b.challenger.heroes[0].tactic_sheet[0].skill_id = "skl_inf_active_001";
  const codes = api.validate(b).issues.map((i) => i.code);
  assert.ok(codes.includes("E_BATTLE_LEADER"));
  assert.ok(codes.includes("E_TACTIC_SKILL"));
  const issue = api.validate(b).issues.find((i) => i.code === "E_TACTIC_SKILL")!;
  assert.equal(issue.path, "challenger.heroes[0].tactic_sheet[0].skill_id");
});

test("editor api: sim runs sample.yaml to battle_end; a broken battle is refused with its issues", () => {
  const r = api.handle("POST", "/api/sim", { battle: battle("sample.yaml") });
  assert.equal(r.status, 200);
  const sim = r.json as any;
  assert.equal(sim.events.at(-1).type, "battle_end");
  assert.ok(["challenger", "defender"].includes(sim.winner));
  assert.match(sim.log, /Battle over: \w+ wins/);
  const b = battle("sample.yaml");
  b.seeds = [1];
  const bad = api.handle("POST", "/api/sim", { battle: b });
  assert.equal(bad.status, 422);
  assert.ok((bad.json as any).issues.some((i: any) => i.code === "E_BATTLE_SEEDS"));
});

test("editor api: breakdown shows the summed Full Moon entry with both contributing ids (draft_city Infantry)", () => {
  const bd = api.breakdown(battle("draft_city.yaml"));
  const inf = bd.units.find((u) => u.id === "char_005")!;
  assert.equal(inf.kind, "hero");
  const atk = inf.stats.ATK!;
  const moon = atk.effects.find((e) => e.status.startsWith("prayer:god_002"))!;
  assert.ok(moon, "Full Moon prayer entry on ATK");
  assert.equal(moon.parts!.length, 2);
  assert.equal(moon.value, 30);
  assert.ok(moon.parts!.some((x) => x.startsWith("prayer:god_002:2")) && moon.parts!.some((x) => x.startsWith("prayer:god_002:4")), moon.parts!.join(","));
  assert.ok(bd.units.some((u) => u.kind === "squad"));
});

test("editor api: an optional pp override (integers 0..10) reaches the breakdown PP pools and the sim; bad values are a 400", () => {
  const plain = api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml") }).json as any;
  assert.deepEqual(plain.units.find((u: any) => u.id === "char_001").pp, { active: 2, passive: 2 });
  assert.equal(plain.units.find((u: any) => u.kind === "squad").pp, null);
  const over = api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), pp: { active: 5, passive: null } }).json as any;
  assert.deepEqual(over.units.find((u: any) => u.id === "char_001").pp, { active: 5, passive: 2 });
  const sim = api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), pp: { active: 3 } });
  assert.equal(sim.status, 200);
  assert.equal((sim.json as any).events[0].units[0].pp_active, 3);
  for (const pp of [{ active: 11 }, { active: -1 }, { active: 1.5 }, { active: "2" }, { other: 1 }, [2], 3]) {
    assert.equal(api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), pp }).status, 400, JSON.stringify(pp));
    assert.equal(api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), pp }).status, 400, JSON.stringify(pp));
  }
});

test("editor api: save refuses a battle with errors and writes a valid one (temp copy of content)", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-"));
  try {
    cpSync("content", dir, { recursive: true });
    const tmp = createApi(dir);
    const b = battle("sample.yaml");
    b.challenger.leader = "char_999";
    const r = tmp.handle("POST", "/api/save", { path: "battles/broken.yaml", battle: b });
    assert.equal(r.status, 422);
    assert.ok(!existsSync(join(dir, "battles/broken.yaml")));
    assert.equal(tmp.handle("POST", "/api/save", { path: "../escape.yaml", battle: battle("sample.yaml") }).status, 400);
    assert.equal(tmp.handle("POST", "/api/save", { path: "rosters/x.yaml", battle: battle("sample.yaml") }).status, 400);
    const ok = tmp.handle("POST", "/api/save", { path: "battles/copy.yaml", battle: battle("sample.yaml") });
    assert.equal(ok.status, 200);
    assert.deepEqual(parse(readFileSync(join(dir, "battles/copy.yaml"), "utf-8")), battle("sample.yaml"));
    // An existing file is only replaced with overwrite: true.
    const again = { path: "battles/copy.yaml", battle: { ...battle("sample.yaml"), battle_id: "changed" } };
    assert.equal(tmp.handle("POST", "/api/save", again).status, 409);
    assert.equal(tmp.handle("POST", "/api/save", { ...again, overwrite: true }).status, 200);
    assert.equal(parse(readFileSync(join(dir, "battles/copy.yaml"), "utf-8")).battle_id, "changed");
    // A symlink in battles/ that points outside the folder is refused for save and read, without echoing the target's text.
    writeFileSync(join(dir, "secret.txt"), "top: secret: [unclosed");
    symlinkSync(join(dir, "secret.txt"), join(dir, "battles/link.yaml"));
    assert.equal(tmp.handle("POST", "/api/save", { path: "battles/link.yaml", battle: battle("sample.yaml"), overwrite: true }).status, 400);
    const read = tmp.handle("GET", "/api/file?path=battles/link.yaml", undefined);
    assert.equal(read.status, 400);
    assert.ok(!JSON.stringify(read.json).includes("secret"));
    assert.equal(readFileSync(join(dir, "secret.txt"), "utf-8"), "top: secret: [unclosed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("editor api: request guard checks host, origin and the JSON content type", () => {
  const ok = { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173", "content-type": "application/json" };
  assert.equal(requestGuard("POST", ok, 5173), null);
  assert.equal(requestGuard("GET", { host: "localhost:5173" }, 5173), null);
  assert.equal(requestGuard("POST", { ...ok, host: "evil.example:5173" }, 5173)?.status, 403);
  assert.equal(requestGuard("POST", { ...ok, host: "127.0.0.1:9999" }, 5173)?.status, 403);
  assert.equal(requestGuard("POST", { ...ok, origin: "http://evil.example" }, 5173)?.status, 403);
  assert.equal(requestGuard("POST", { ...ok, origin: "null" }, 5173)?.status, 403);
  assert.equal(requestGuard("POST", { ...ok, "content-type": "text/plain" }, 5173)?.status, 415);
  assert.equal(requestGuard("POST", { host: ok.host, origin: ok.origin }, 5173)?.status, 415);
});

test("editor api: an optional formula override reaches the sim; bad values are a 400", () => {
  const plain = api.handle("POST", "/api/sim", { battle: battle("sample.yaml") }).json as any;
  const same = api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), formula: "" }).json as any;
  const ratio = api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), formula: "ratio:150" }).json as any;
  assert.equal(same.log, plain.log);
  assert.notEqual(ratio.log, plain.log);
  assert.equal(api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), formula: "scaled_subtract:20" }).status, 200);
  for (const formula of ["div", "ratio:-1", 3, { formula: "ratio" }, "ratio:" + "9".repeat(400), "scaled_subtract:20:" + "9".repeat(400)]) {
    assert.equal(api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), formula }).status, 400, JSON.stringify(formula));
    assert.equal(api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), formula }).status, 400, JSON.stringify(formula));
  }
});

test("editor api: an optional hero_hits override reaches the sim and breakdown; bad values are a 400", () => {
  const plain = api.handle("POST", "/api/sim", { battle: battle("sample.yaml") }).json as any;
  assert.equal((api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), hero_hits: null }).json as any).log, plain.log);
  assert.equal((api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), hero_hits: 4 }).json as any).log, plain.log);
  assert.notEqual((api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), hero_hits: 1 }).json as any).log, plain.log);
  assert.equal(api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), hero_hits: 2.5 }).status, 200);
  for (const hero_hits of [0, -1, "4", Infinity, Number.NaN, [4], { n: 4 }]) {
    assert.equal(api.handle("POST", "/api/sim", { battle: battle("sample.yaml"), hero_hits }).status, 400, String(hero_hits));
    assert.equal(api.handle("POST", "/api/breakdown", { battle: battle("sample.yaml"), hero_hits }).status, 400, String(hero_hits));
  }
});
