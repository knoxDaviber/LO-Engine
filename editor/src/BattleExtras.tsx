// Challenger between-phase edits and the defender ban sheet (roster form) on the Battle page.
import type { ContentInfo } from "../apiTypes";
import { heroesOf, type Json } from "./model";
import { LeafEditor, newLeaf, TacticsBoard } from "./Tactics";
import { STATS } from "../../src/schema/enums";

type Edit = (fn: (battle: Json) => void) => void;
const name = (c: ContentInfo, id: string) => c.characters.find((x) => x.id === id)?.name ?? id;

export function EditsPanel({ c, battle, edit }: { c: ContentInfo; battle: Json; edit: Edit }) {
  const heroes = heroesOf(battle, "challenger");
  const edits: Json[] = battle.challenger.edits ?? [];
  const ed = (i: number, fn: (e: Json) => void) => edit((b) => fn(b.challenger.edits[i]));
  const optional = (e: Json, key: string, v: string) => { if (v) e[key] = v; else delete e[key]; };
  return (
    <details className="edits" data-path="challenger.edits" open={edits.length > 0}>
      <summary>Between-phase edits ({edits.length})</summary>
      {edits.map((e, i) => {
        const ep = `challenger.edits[${i}]`;
        const entries: Json[] = e.heroes ?? [];
        const free = heroes.filter((h) => !entries.some((x) => x.char_id === h.char_id));
        return (
          <div className="hero" key={i} data-path={ep}>
            <div className="fields">
              <label data-path={`${ep}.phase`}>before phase
                <select value={e.phase} onChange={(ev) => ed(i, (x) => (x.phase = Number(ev.target.value)))}>
                  {[2, 3].filter((n) => n === e.phase || !edits.some((o: Json) => o.phase === n)).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label data-path={`${ep}.leader`}>leader
                <select value={e.leader ?? ""} onChange={(ev) => ed(i, (x) => optional(x, "leader", ev.target.value))}>
                  <option value="">(no change)</option>
                  {heroes.map((h) => <option key={h.char_id} value={h.char_id}>{name(c, h.char_id)}</option>)}
                </select>
              </label>
              <label>+ hero
                <select value="" disabled={free.length === 0} onChange={(ev) => ev.target.value && ed(i, (x) => (x.heroes ??= []).push({ char_id: ev.target.value }))}>
                  <option value="">(choose)</option>
                  {free.map((h) => <option key={h.char_id} value={h.char_id}>{name(c, h.char_id)}</option>)}
                </select>
              </label>
              <button className="small right" onClick={() => edit((b) => { b.challenger.edits.splice(i, 1); if (b.challenger.edits.length === 0) delete b.challenger.edits; })}>remove edit</button>
            </div>
            {entries.map((h, j) => {
              const hp = `${ep}.heroes[${j}]`;
              const hs = (fn: (h: Json) => void) => ed(i, (x) => fn(x.heroes[j]));
              const current = heroes.find((x) => x.char_id === h.char_id);
              return (
                <div key={h.char_id} className="fields" data-path={hp}>
                  <b>{name(c, h.char_id)}</b>
                  {(["preferred_row", "squad_row"] as const).map((k) => (
                    <label key={k} data-path={`${hp}.${k}`}>{k === "squad_row" ? "squad row" : "hero row"}
                      <select value={h[k] ?? ""} onChange={(ev) => hs((x) => optional(x, k, ev.target.value))}>
                        <option value="">(no change)</option>
                        {c.rows.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </label>
                  ))}
                  <label data-path={`${hp}.column`}>column
                    <select value={"column" in h ? String(h.column) : ""} onChange={(ev) => hs((x) => { const v = ev.target.value; if (v === "") delete x.column; else x.column = v === "null" ? null : Number(v); })}>
                      <option value="">(no change)</option>
                      <option value="null">auto</option>
                      {Array.from({ length: c.rules.columns }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  {h.tactic_sheet
                    ? <button className="small" onClick={() => hs((x) => delete x.tactic_sheet)}>drop tactics override</button>
                    : <button className="small" onClick={() => hs((x) => (x.tactic_sheet = structuredClone(current?.tactic_sheet ?? [])))}>change tactics</button>}
                  <button className="small" onClick={() => ed(i, (x) => { x.heroes.splice(j, 1); if (x.heroes.length === 0) delete x.heroes; })}>remove entry</button>
                  {h.tactic_sheet && (
                    <TacticsBoard c={c} hero={c.characters.find((x) => x.id === h.char_id)} sheet={h.tactic_sheet} path={`${hp}.tactic_sheet`} edit={(fn) => hs((x) => fn(x.tactic_sheet))} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <button className="small" disabled={[2, 3].every((n) => edits.some((e: Json) => e.phase === n))} onClick={() => edit((b) => (b.challenger.edits ??= []).push({ phase: b.challenger.edits.some((e: Json) => e.phase === 2) ? 3 : 2 }))}>+ edit</button>
    </details>
  );
}

const METRICS = ["cost", "hp", ...STATS.map((s) => `stat:${s}`)];

export function BanSheetPanel({ c, battle, edit }: { c: ContentInfo; battle: Json; edit: Edit }) {
  const sheet = battle.defender.roster.ban_sheet;
  const rules: Json[] = sheet?.rules ?? [];
  const path = "defender.roster.ban_sheet";
  const set = (fn: (rules: Json[]) => void) => edit((b) => fn(b.defender.roster.ban_sheet.rules));
  const renumber = (r: Json[]) => r.forEach((x, i) => (x.priority = i + 1));
  const move = (i: number, d: number) => set((r) => { const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; renumber(r); });
  const first = c.ban_leaves[0];
  return (
    <div className="fields" data-path={path}>
      ban sheet:
      {!sheet && <button className="small" onClick={() => edit((b) => (b.defender.roster.ban_sheet = { rules: [] }))}>+ ban sheet</button>}
      {rules.map((r, i) => {
        const rp = `${path}.rules[${i}]`;
        const f = r.filter;
        const single = f && typeof f.type === "string";
        return (
          <div key={i} className="tactic-card" data-path={rp}>
            <span className="tc-n">#{r.priority}</span>
            <select aria-label="Select" value={r.select} onChange={(e) => set((x) => (x[i].select = e.target.value))}>
              {["highest", "lowest", "nearest"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <select aria-label="Metric" value={r.metric} onChange={(e) => set((x) => (x[i].metric = e.target.value))}>
              {!METRICS.includes(r.metric) && <option value={r.metric}>{r.metric} (invalid)</option>}
              {METRICS.map((m) => <option key={m}>{m}</option>)}
            </select>
            {single
              ? <LeafEditor c={c} leaves={c.ban_leaves} leaf={f} path={`${rp}.filter`} edit={(fn) => set((x) => fn(x[i].filter))} />
              : <span className="muted" data-path={`${rp}.filter`}>custom filter, kept as loaded: {JSON.stringify(f)}</span>}
            <span className="nowrap">
              <button className="small" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>▲</button>
              <button className="small" disabled={i === rules.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>▼</button>
              <button className="small" aria-label="Remove rule" onClick={() => set((x) => { x.splice(i, 1); renumber(x); })}>✕</button>
            </span>
          </div>
        );
      })}
      {sheet && <button className="small" disabled={!first} onClick={() => set((x) => x.push({ priority: x.length + 1, filter: newLeaf(c, first!), select: "highest", metric: "cost" }))}>+ rule</button>}
    </div>
  );
}
