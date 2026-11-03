// editor/core.ts as the static (browser) build uses it: content as texts, an in-memory store, no disk access by the core itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { createApi } from "../editor/api";
import { createCore, type ContentStore } from "../editor/core";
import { rawFromTexts } from "../src/content";
import { readContentTexts } from "../src/load";

const texts = readContentTexts("content");
const written: { rel: string; text: string; overwrite: boolean }[] = [];
const store: ContentStore = {
  list: (folder) => Object.keys(texts).filter((k) => k.startsWith(`${folder}/`)).sort(),
  read: (rel) => texts[rel],
  write: (rel, text, overwrite) => void written.push({ rel, text, overwrite }),
};
const core = createCore(texts, store);
const api = createApi("content");
const battle = (name: string) => parse(readFileSync(`content/battles/${name}`, "utf-8"));

test("editor core: content and catalog from bundled texts match the Node api", () => {
  const c = core.handle("GET", "/api/content", undefined);
  assert.equal(c.status, 200);
  assert.deepEqual(c.json, api.content());
  assert.ok((c.json as any).files.battles.includes("battles/draft_city.yaml"));
  assert.deepEqual(core.handle("GET", "/api/catalog", undefined).json, api.catalog());
});

test("editor core: file reads the store; missing is 404, bad paths 400", () => {
  const f = core.handle("GET", "/api/file?path=battles%2Fdraft_city.yaml", undefined);
  assert.equal(f.status, 200);
  assert.deepEqual((f.json as any).data, battle("draft_city.yaml"));
  assert.equal(core.handle("GET", "/api/file?path=battles/missing.yaml", undefined).status, 404);
  assert.equal(core.handle("GET", "/api/file?path=rules.yaml", undefined).status, 400);
});

test("editor core: sim and breakdown give the same results as the Node api", () => {
  for (const name of ["sample.yaml", "draft_city.yaml"]) {
    const body = { battle: battle(name), formula: "ratio:150" };
    const a = core.handle("POST", "/api/sim", body);
    assert.equal(a.status, 200, name);
    assert.deepEqual(a.json, api.handle("POST", "/api/sim", body).json, name);
    assert.deepEqual(core.handle("POST", "/api/breakdown", { battle: battle(name), phase: 2 }).json, api.breakdown(battle(name), 2), name);
  }
  const b = battle("sample.yaml");
  b.seeds = [1];
  assert.equal(core.handle("POST", "/api/sim", { battle: b }).status, 422);
});

test("editor core: save hands the store the YAML of a valid battle only", () => {
  written.length = 0;
  const broken = { ...battle("sample.yaml"), seeds: [1] };
  assert.equal(core.handle("POST", "/api/save", { path: "battles/x.yaml", battle: broken }).status, 422);
  assert.equal(core.handle("POST", "/api/save", { path: "rosters/x.yaml", battle: battle("sample.yaml") }).status, 400);
  assert.equal(written.length, 0);
  const ok = core.handle("POST", "/api/save", { path: "battles/x.yaml", battle: battle("sample.yaml") });
  assert.deepEqual(ok, { status: 200, json: { path: "battles/x.yaml", saved: true } });
  assert.equal(written.length, 1);
  assert.equal(written[0]!.rel, "battles/x.yaml");
  assert.deepEqual(parse(written[0]!.text), battle("sample.yaml"));
});

test("rawFromTexts: optional files may be missing, required ones and bad YAML throw", () => {
  const without = (...keys: string[]) => Object.fromEntries(Object.entries(texts).filter(([k]) => !keys.includes(k)));
  const noOptional = without("terrains.yaml", "gods.yaml");
  const raw = rawFromTexts(noOptional);
  assert.deepEqual(raw.terrains, []);
  assert.deepEqual(raw.gods, []);
  assert.ok(raw.battles!.some((b) => b.name === "sample.yaml"));
  assert.throws(() => rawFromTexts(without("rules.yaml")), /cannot read rules\.yaml/);
  assert.throws(() => rawFromTexts({ ...texts, "battles/bad.yaml": "a: [" }), /battles\/bad\.yaml is not valid YAML/);
});
