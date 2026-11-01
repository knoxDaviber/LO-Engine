// Tactics board for one hero: ordered rows, each the player-sheet slot shape (design 4.1): activation and targeting main are one leaf or
// `all` of two leaves, sub is a selector or one such condition. Leaf parameter inputs are generated from the leaf's JSON Schema.
import { useEffect, useState } from "react";
import type { CharacterInfo, ContentInfo, LeafInfo } from "../apiTypes";
import type { Json } from "./model";

type Edit = (fn: (draft: Json) => void) => void;
interface Props { c: ContentInfo; hero: CharacterInfo | undefined; sheet: Json[]; path: string; edit: (fn: (sheet: Json[]) => void) => void }

const isLeaf = (n: Json) => n && typeof n === "object" && typeof n.type === "string";

/** One leaf with its required parameters filled in (first enum value, minimum or 0, false, first referenced id). */
function newLeaf(c: ContentInfo, info: LeafInfo): Json {
  const leaf: Json = { type: info.type };
  const props = (info.params.properties ?? {}) as Record<string, Json>;
  const required = (info.params.required ?? []) as string[];
  const fill = required.length > 0 ? required : Object.keys(props).slice(0, 1); // e.g. unit_kind: exactly one of is/ignore
  for (const k of fill) leaf[k] = defaultParam(c, info.type, k, props[k]);
  return leaf;
}

function refOptions(c: ContentInfo, type: string, field: string): { id: string; name: string }[] | null {
  const ref = c.leaf_refs[type];
  if (!ref || ref.field !== field) return null;
  return ref.kind === "status" ? c.statuses : ref.kind === "faction" ? c.factions : null;
}

function defaultParam(c: ContentInfo, type: string, key: string, s: Json): unknown {
  if (s?.enum) return s.enum[0];
  if (s?.type === "number" || s?.type === "integer") return s.minimum ?? 0;
  if (s?.type === "boolean") return false;
  return refOptions(c, type, key)?.[0]?.id ?? "";
}

/** Keeps the typed text while it does not parse ("-", "", "1e"), writing the param only for a finite number. An optional param left empty
 * is removed on blur; a required one keeps its last number. */
function NumberInput({ value, s, required, set }: { value: unknown; s: Json; required: boolean; set: (x: unknown) => void }) {
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  useEffect(() => { if (Number(raw) !== value || raw.trim() === "") setRaw(value === undefined ? "" : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="text" inputMode="decimal" className="num" value={raw} title={[s.minimum !== undefined && `min ${s.minimum}`, s.maximum !== undefined && `max ${s.maximum}`].filter(Boolean).join(", ")}
      onChange={(e) => {
        setRaw(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) set(n);
      }}
      onBlur={() => { if (raw.trim() === "" && !required) set(undefined); else setRaw(value === undefined ? "" : String(value)); }} />
  );
}

function ParamInput({ c, leaf, k, s, required, path, edit }: { c: ContentInfo; leaf: Json; k: string; s: Json; required: boolean; path: string; edit: Edit }) {
  const v = leaf[k];
  const set = (x: unknown) => edit((l) => { if (x === undefined || x === "") delete l[k]; else l[k] = x; });
  const refs = refOptions(c, leaf.type, k);
  let input;
  if (s?.type === "boolean") input = <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />;
  else if (s?.enum || refs) {
    const opts: { id: string; name: string }[] = refs ?? s.enum.map((x: unknown) => ({ id: String(x), name: String(x) }));
    input = (
      <select value={v ?? ""} onChange={(e) => set(e.target.value)}>
        {(!required || v === undefined) && <option value="">{required ? "(choose)" : "(any)"}</option>}
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name === o.id ? o.id : `${o.name} (${o.id})`}</option>)}
      </select>
    );
  } else if (s?.type === "number" || s?.type === "integer") {
    input = <NumberInput value={v} s={s} required={required} set={set} />;
  } else input = <input type="text" value={v ?? ""} onChange={(e) => set(e.target.value)} />;
  return <label className="param" data-path={`${path}.${k}`}>{k}{input}</label>;
}

function LeafEditor({ c, leaf, path, edit, onRemove }: { c: ContentInfo; leaf: Json; path: string; edit: Edit; onRemove?: () => void }) {
  const info = c.leaves.find((l) => l.type === leaf.type);
  const props = (info?.params.properties ?? {}) as Record<string, Json>;
  const required = (info?.params.required ?? []) as string[];
  return (
    <span className="leaf" data-path={path}>
      <select value={leaf.type} title={info?.description} onChange={(e) => {
        const next = c.leaves.find((l) => l.type === e.target.value)!;
        edit((l) => { for (const k of Object.keys(l)) delete l[k]; Object.assign(l, newLeaf(c, next)); });
      }}>
        {!info && <option value={leaf.type}>{leaf.type} (not allowed here)</option>}
        {c.leaves.map((l) => <option key={l.type} value={l.type}>{l.type}</option>)}
      </select>
      {Object.entries(props).map(([k, s]) => <ParamInput key={k} c={c} leaf={leaf} k={k} s={s} required={required.includes(k)} path={path} edit={edit} />)}
      {onRemove && <button className="small" onClick={onRemove}>x</button>}
    </span>
  );
}

/** A condition slot: none, one leaf, or `all` of two leaves. Anything else (any/not/nesting) is shown as unsupported with a clear button. */
export function ConditionSlot({ c, value, path, set }: { c: ContentInfo; value: Json; path: string; set: (v: Json) => void }) {
  const first = c.leaves[0]!;
  if (value == null) return <span data-path={path}><button className="small" onClick={() => set(newLeaf(c, first))}>+ condition</button></span>;
  const leaves: Json[] | null = isLeaf(value) ? [value] : Array.isArray(value.all) && value.all.length === 2 && value.all.every(isLeaf) ? value.all : null;
  if (!leaves) return <span className="bad" data-path={path}>unsupported shape (player slots: one condition or two ANDed) <button className="small" onClick={() => set(null)}>clear</button></span>;
  const write = (list: Json[]) => set(list.length === 0 ? null : list.length === 1 ? list[0] : { all: list });
  const editAt = (i: number): Edit => (fn) => { const list = structuredClone(leaves); fn(list[i]); write(list); };
  const leafPath = (i: number) => (leaves.length === 1 ? path : `${path}.all[${i}]`);
  return (
    <span className="slot" data-path={path}>
      {leaves.map((l, i) => (
        <span key={i}>
          {i > 0 && <b> AND </b>}
          <LeafEditor c={c} leaf={l} path={leafPath(i)} edit={editAt(i)} onRemove={() => write(leaves.filter((_, j) => j !== i))} />
        </span>
      ))}
      {leaves.length < c.slot_shape.max_leaves && <button className="small" onClick={() => write([...leaves, newLeaf(c, first)])}>+ AND</button>}
    </span>
  );
}

function SubSlot({ c, value, path, set }: { c: ContentInfo; value: Json; path: string; set: (v: Json) => void }) {
  const mode = value == null ? "none" : "select" in value ? "selector" : "condition";
  return (
    <span data-path={path}>
      <select value={mode} onChange={(e) => {
        const m = e.target.value;
        set(m === "none" ? null : m === "selector" ? { select: "lowest", metric: "hp_percent" } : newLeaf(c, c.leaves[0]!));
      }}>
        <option value="none">default</option>
        <option value="selector">selector</option>
        <option value="condition">condition</option>
      </select>
      {mode === "selector" && (
        <>
          <select value={value.select} onChange={(e) => set({ ...value, select: e.target.value })}>
            {c.selectors.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={value.metric ?? ""} onChange={(e) => set({ ...value, metric: e.target.value || undefined })}>
            <option value="">(hp_percent)</option>
            {c.selector_metrics.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={value.side ?? ""} onChange={(e) => { const v = { ...value }; if (e.target.value) v.side = e.target.value; else delete v.side; set(v); }}>
            <option value="">(any side)</option>
            {c.selector_sides.map((s) => <option key={s}>{s}</option>)}
          </select>
        </>
      )}
      {mode === "condition" && <ConditionSlot c={c} value={value} path={path} set={set} />}
    </span>
  );
}

export function TacticsBoard({ c, hero, sheet, path, edit }: Props) {
  const skills = hero?.skills ?? [];
  const renumber = (s: Json[]) => s.forEach((t, i) => (t.priority = i + 1));
  const move = (i: number, d: number) => edit((s) => { const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; renumber(s); });
  return (
    <div className="tactics" data-path={path}>
      <table>
        <thead><tr><th>#</th><th>on</th><th>skill</th><th>activation</th><th>targeting main</th><th>sub</th><th>fallback</th><th /></tr></thead>
        <tbody>
          {sheet.map((t, i) => {
            const tp = `${path}[${i}]`;
            const set = (fn: (t: Json) => void) => edit((s) => fn(s[i]));
            return (
              <tr key={i} data-path={tp}>
                <td>{t.priority}</td>
                <td><input type="checkbox" checked={!!t.enabled} onChange={(e) => set((x) => (x.enabled = e.target.checked))} /></td>
                <td data-path={`${tp}.skill_id`}>
                  <select value={t.skill_id} onChange={(e) => set((x) => (x.skill_id = e.target.value))}>
                    {!skills.some((s) => s.id === t.skill_id) && <option value={t.skill_id}>{t.skill_id} (not this hero's)</option>}
                    {skills.map((s) => <option key={s.id} value={s.id}>{s.name} [{s.kind}, {s.pp_cost} {s.pp_pool} PP{s.shape ? `, ${s.shape}` : ""}]</option>)}
                  </select>
                </td>
                <td><ConditionSlot c={c} value={t.activation} path={`${tp}.activation`} set={(v) => set((x) => (x.activation = v))} /></td>
                <td><ConditionSlot c={c} value={t.targeting?.main} path={`${tp}.targeting.main`} set={(v) => set((x) => ((x.targeting ??= { main: null, sub: null }).main = v))} /></td>
                <td><SubSlot c={c} value={t.targeting?.sub} path={`${tp}.targeting.sub`} set={(v) => set((x) => ((x.targeting ??= { main: null, sub: null }).sub = v))} /></td>
                <td data-path={`${tp}.fallback`}>
                  <select value={t.fallback} onChange={(e) => set((x) => (x.fallback = e.target.value))}>
                    {c.fallbacks.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </td>
                <td className="nowrap">
                  <button className="small" disabled={i === 0} onClick={() => move(i, -1)}>up</button>
                  <button className="small" disabled={i === sheet.length - 1} onClick={() => move(i, 1)}>down</button>
                  <button className="small" onClick={() => edit((s) => { s.splice(i, 1); renumber(s); })}>remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button disabled={sheet.length >= c.rules.max_tactics || skills.length === 0} onClick={() => edit((s) => {
        s.push({ priority: s.length + 1, skill_id: skills[0]!.id, enabled: true, activation: null, targeting: { main: null, sub: null }, fallback: "skip" });
      })}>+ tactic ({sheet.length}/{c.rules.max_tactics})</button>
    </div>
  );
}
