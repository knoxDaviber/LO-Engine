// Local editor, milestone 1 (roadmap Step 5): tactics board + run sim. One page: file picker, both sides, live validation, stacking
// breakdown and the sim log. All validation and simulation happens on the server (editor/api.ts).
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApiIssue, BreakdownResult, ContentInfo, SimResult } from "../apiTypes";
import { get, post, RequestError } from "./client";
import { elementForPath, isRosterForm, newBattle, SIDES, type Json } from "./model";
import { Breakdown, Issues, RunLog } from "./Panels";
import { SidePanel } from "./Roster";
import "./style.css";

function App() {
  const [c, setContent] = useState<ContentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [battle, setBattle] = useState<Json>(null);
  const [path, setPath] = useState("battles/new_battle.yaml");
  const [issues, setIssues] = useState<ApiIssue[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState(1);
  const [bd, setBd] = useState<{ data: BreakdownResult | null; error: string | null }>({ data: null, error: null });
  const [sim, setSim] = useState<SimResult | null>(null);
  const [status, setStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const req = useRef(0); // only the latest validate/breakdown round may write its results
  const [pending, setPending] = useState(false);

  const refreshContent = () => get<ContentInfo>("/api/content").then(setContent).catch((e) => setLoadError(String(e.message ?? e)));
  useEffect(() => void refreshContent(), []);

  // Live validation and breakdown, debounced.
  useEffect(() => {
    if (!battle) return;
    setIssues(null);
    setPending(true);
    const n = ++req.current;
    const live = () => n === req.current;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const v = await post<{ issues: ApiIssue[] }>("/api/validate", { battle });
        if (!live()) return;
        setIssues(v.issues);
        setPending(false);
        if (v.issues.some((i) => i.severity === "error")) return setBd({ data: null, error: "Fix the validation errors to see the breakdown." });
        const data = await post<BreakdownResult>("/api/breakdown", { battle, phase });
        if (live()) setBd({ data, error: null });
      } catch (e) {
        if (!live()) return;
        setPending(false);
        setBd({ data: null, error: (e as Error).message });
      }
    }, 400);
  }, [battle, phase]);

  const edit = (fn: (b: Json) => void) => setBattle((b: Json) => { const next = structuredClone(b); fn(next); return next; });

  const open = async (p: string) => {
    if (!p) return;
    try {
      const f = await get<{ path: string; data: Json }>(`/api/file?path=${encodeURIComponent(p)}`);
      setBattle(f.data);
      setPath(f.path);
      setSim(null);
      setSelected(null);
      setStatus(`loaded ${f.path}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  /** Roster form: replace a side's roster with a content/rosters file (draft picks and edits are kept). */
  const importRoster = async (side: string, p: string) => {
    if (!p) return;
    try {
      const f = await get<{ path: string; data: Json }>(`/api/file?path=${encodeURIComponent(p)}`);
      edit((b) => {
        b[side].roster = f.data;
        // Draft picks that name heroes no longer in this roster: this side's protects and the other side's bans.
        const ids = new Set(((f.data as Json)?.heroes ?? []).map((h: Json) => h.char_id));
        const other = side === "challenger" ? "defender" : "challenger";
        for (const [s, kind] of [[side, "protects"], [other, "bans"]] as const) {
          const d = b[s]?.draft;
          if (!d?.[kind]) continue;
          d[kind] = d[kind].filter((id: string) => ids.has(id));
          if (d[kind].length === 0) delete d[kind];
          if (Object.keys(d).length === 0) delete b[s].draft;
        }
      });
      setStatus(`${side} roster from ${f.path}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const run = async () => {
    setStatus("running...");
    try {
      setSim(await post<SimResult>("/api/sim", { battle }));
      setStatus("");
    } catch (e) {
      setSim(null);
      setStatus(`not run: ${(e as Error).message}`);
    }
  };

  const save = async (overwrite = false) => {
    try {
      const r = await post<{ path: string }>("/api/save", { path, battle, overwrite });
      setStatus(`saved ${r.path}`);
      refreshContent();
    } catch (e) {
      if (e instanceof RequestError && e.status === 409 && !overwrite) {
        if (window.confirm(`${path} already exists. Overwrite it? (YAML comments in it will be lost)`)) return save(true);
        return setStatus("not saved");
      }
      setStatus(`not saved: ${(e as Error).message}${e instanceof RequestError && e.issues.length ? ` (${e.issues.length} errors)` : ""}`);
    }
  };

  const pick = (i: ApiIssue) => {
    const el = elementForPath(i.path);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
  };

  if (loadError) return <p className="error">Cannot load content: {loadError}</p>;
  if (!c) return <p>Loading content...</p>;
  const roster = battle && isRosterForm(battle);
  const errors = issues?.filter((i) => i.severity === "error").length ?? 0;

  return (
    <div className="app">
      <header>
        <b>Tactics editor</b>
        <select value="" onChange={(e) => open(e.target.value)}>
          <option value="">open file...</option>
          {c.files.battles.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button onClick={() => { setBattle(newBattle(c)); setPath("battles/new_battle.yaml"); setSim(null); setSelected(null); setStatus("new battle"); }}>new battle</button>
        {battle && (
          <>
            <input className="path" value={path} onChange={(e) => setPath(e.target.value)} />
            <button onClick={() => save()} disabled={pending || errors > 0}>save</button>
            <button onClick={run} disabled={pending || errors > 0}>run sim</button>
          </>
        )}
        {roster && c.files.rosters.length > 0 && SIDES.map((side) => (
          <select key={side} value="" onChange={(e) => importRoster(side, e.target.value)}>
            <option value="">{side} roster from file...</option>
            {c.files.rosters.map((f) => <option key={f}>{f}</option>)}
          </select>
        ))}
        <span className="muted">{status}</span>
      </header>
      {!battle ? <p className="muted">Open a battle file or start a new battle.</p> : (
        <div className="cols">
          <main>
            <section className="side">
              <div className="fields">
                <label data-path="battle_id">battle id<input value={battle.battle_id ?? ""} onChange={(e) => edit((b) => (b.battle_id = e.target.value))} /></label>
                <label data-path="version">version<input className="num" value={battle.version ?? ""} onChange={(e) => edit((b) => (b.version = e.target.value))} /></label>
                {!roster && (
                  <label data-path="battlefield">battlefield
                    <select value={battle.battlefield ?? ""} onChange={(e) => edit((b) => (b.battlefield = e.target.value || null))}>
                      <option value="">(none)</option>
                      {c.terrains.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
                    </select>
                  </label>
                )}
                <span data-path="seeds">seeds
                  {[0, 1, 2].map((k) => (
                    <input key={k} type="number" className="num" value={battle.seeds?.[k] ?? ""} onChange={(e) => edit((b) => {
                      b.seeds = [...(b.seeds ?? [0, 0, 0])];
                      b.seeds[k] = e.target.value === "" ? 0 : Number(e.target.value);
                    })} />
                  ))}
                </span>
              </div>
            </section>
            {SIDES.map((s) => <SidePanel key={s} c={c} battle={battle} side={s} edit={edit} selected={selected} select={setSelected} />)}
            {sim && <section className="side"><h2>Sim</h2><RunLog result={sim} /></section>}
          </main>
          <aside>
            <h2>Issues {issues && <span className="muted">({errors} errors, {issues.length - errors} other)</span>}</h2>
            <Issues issues={issues} onPick={pick} />
            <h2>Stacking breakdown</h2>
            <Breakdown data={bd.data} error={bd.error} selected={selected} phase={phase} setPhase={setPhase} />
          </aside>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
