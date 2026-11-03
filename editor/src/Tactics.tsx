// Tactics board for one hero: ordered rows { priority, skill_id, enabled, main, sub } (Decision 136); main and sub are picked from the presets in
// conditionPresets.ts. The raw leaf editor (inputs generated from the leaf's JSON Schema) stays behind the gear button for custom values.
import { useEffect, useMemo, useState } from "react";
import type { CharacterInfo, ContentInfo, LeafInfo } from "../apiTypes";
import { Info, titleOf, useTips } from "./Hint";
import { buildPresets, canon, type Preset } from "./conditionPresets";
import type { Json } from "./model";
import "./conditionPicker.css";

type Edit = (fn: (draft: Json) => void) => void;
interface Props { c: ContentInfo; hero: CharacterInfo | undefined; sheet: Json[]; path: string; edit: (fn: (sheet: Json[]) => void) => void }

const isLeaf = (n: Json) => n && typeof n === "object" && typeof n.type === "string";

/** One leaf with its required parameters filled in (first enum value, minimum or 0, false, first referenced id). */
export function newLeaf(c: ContentInfo, info: LeafInfo): Json {
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

export function LeafEditor({ c, leaf, path, edit, leaves = c.leaves }: { c: ContentInfo; leaf: Json; path: string; edit: Edit; leaves?: LeafInfo[] }) {
  const info = leaves.find((l) => l.type === leaf.type);
  const tips = useTips();
  const props = (info?.params.properties ?? {}) as Record<string, Json>;
  const required = (info?.params.required ?? []) as string[];
  return (
    <span className="leaf" data-path={path}>
      <select value={leaf.type} title={titleOf(tips.condition(leaf)) ?? info?.description} onChange={(e) => {
        const next = leaves.find((l) => l.type === e.target.value)!;
        edit((l) => { for (const k of Object.keys(l)) delete l[k]; Object.assign(l, newLeaf(c, next)); });
      }}>
        {!info && <option value={leaf.type}>{leaf.type} (not allowed here)</option>}
        {leaves.map((l) => <option key={l.type} value={l.type} title={l.description}>{l.type}</option>)}
      </select>
      <Info tip={tips.condition(leaf)} />
      {Object.entries(props).map(([k, s]) => <ParamInput key={k} c={c} leaf={leaf} k={k} s={s} required={required.includes(k)} path={path} edit={edit} />)}
    </span>
  );
}

/** Main / Sub slot: a categorised preset list. A value matching no preset shows as "Custom: ..." and stays intact; the gear button edits a leaf raw. */
function CondPicker({ c, presets, value, path, set, label }: { c: ContentInfo; presets: Preset[]; value: Json; path: string; set: (v: Json) => void; label: string }) {
  const tips = useTips();
  const [adv, setAdv] = useState(false);
  const match = value == null ? undefined : presets.find((p) => canon(p.value) === canon(value));
  const selected = value == null ? "" : match ? match.id : "custom";
  const groups = [...new Set(presets.map((p) => p.category))];
  const customText = isLeaf(value) ? tips.condition(value)?.summary ?? value.type : `${value?.select ?? "?"}${value?.metric ? ` ${value.metric}` : ""}${value?.filter ? ` ${tips.condition(value.filter)?.summary ?? value.filter.type}` : ""}`;
  return (
    <span className="cond-pick" data-path={path}>
      <select aria-label={label} value={selected} title={match?.tip} onChange={(e) => {
        if (e.target.value === "custom") return;
        set(e.target.value === "" ? null : structuredClone(presets.find((p) => p.id === e.target.value)!.value));
      }}>
        <option value="">(none)</option>
        {selected === "custom" && <option value="custom">Custom: {customText}</option>}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {presets.filter((p) => p.category === g).map((p) => <option key={p.id} value={p.id} title={p.tip}>{p.label}</option>)}
          </optgroup>
        ))}
      </select>
      {match && <span className="kind" title={match.tip}>{match.kind}</span>}
      {isLeaf(value) && <button className="small" aria-label={`Advanced ${label}`} title="Edit the raw condition" onClick={() => setAdv(!adv)}>⚙</button>}
      {adv && isLeaf(value) && <LeafEditor c={c} leaf={value} path={path} edit={(fn) => { const n = structuredClone(value); fn(n); set(n); }} />}
    </span>
  );
}

export function TacticsBoard({ c, hero, sheet, path, edit }: Props) {
  const skills = hero?.skills ?? [];
  const tips = useTips();
  const presets = useMemo(() => buildPresets(c.statuses), [c.statuses]);
  const renumber = (s: Json[]) => s.forEach((t, i) => (t.priority = i + 1));
  const move = (i: number, d: number) => edit((s) => { const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; renumber(s); });
  return (
    <div className="tactics" data-path={path}>
      {sheet.map((t, i) => {
        const tp = `${path}[${i}]`;
        const set = (fn: (t: Json) => void) => edit((s) => fn(s[i]));
        return (
          <div className="tactic-card" key={i} data-path={tp}>
            <div className="tc-top">
              <span className="tc-n" title="Priority">#{t.priority}</span>
              <label className="tc-on">On <input type="checkbox" checked={!!t.enabled} onChange={(e) => set((x) => (x.enabled = e.target.checked))} /></label>
              <span className="tc-skill" data-path={`${tp}.skill_id`}>
                <select aria-label="Skill" value={t.skill_id} onChange={(e) => set((x) => (x.skill_id = e.target.value))}>
                  {!skills.some((s) => s.id === t.skill_id) && <option value={t.skill_id}>{t.skill_id} (not this hero's)</option>}
                  {skills.map((s) => <option key={s.id} value={s.id} title={titleOf(tips.skill(s.id))}>{s.name} [{s.kind}, {s.pp_cost} {s.pp_pool} PP{s.shape ? `, ${s.shape}` : ""}]</option>)}
                </select>
                <Info tip={tips.skill(t.skill_id)} />
              </span>
              <span className="nowrap">
                <button className="small" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>▲</button>
                <button className="small" disabled={i === sheet.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>▼</button>
                <button className="small" aria-label="Remove tactic" onClick={() => edit((s) => { s.splice(i, 1); renumber(s); })}>✕</button>
              </span>
            </div>
            <div className="tc-row"><span className="tc-label">Main condition</span><CondPicker c={c} presets={presets} label="Main condition" value={t.main} path={`${tp}.main`} set={(v) => set((x) => (x.main = v))} /></div>
            <div className="tc-row"><span className="tc-label">Sub condition</span><CondPicker c={c} presets={presets} label="Sub condition" value={t.sub} path={`${tp}.sub`} set={(v) => set((x) => (x.sub = v))} /></div>
          </div>
        );
      })}
      <button disabled={sheet.length >= c.rules.max_tactics || skills.length === 0} onClick={() => edit((s) => {
        s.push({ priority: s.length + 1, skill_id: skills[0]!.id, enabled: true, main: null, sub: null });
      })}>+ tactic ({sheet.length}/{c.rules.max_tactics})</button>
    </div>
  );
}
