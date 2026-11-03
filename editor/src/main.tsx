// Local editor shell: side navigation (Battle / Units / Log, hash routes), theme, the pins strip above every page, and the battle state all
// pages render from. Content and catalog are fetched once at startup; switching pages never refetches. All validation and simulation happens
// in editor/core.ts: on the server (editor/api.ts) locally, in-process in the static hosted build (client.ts HOSTED).
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { parse } from "yaml";
import type { ApiIssue, BreakdownResult, Catalog, ContentInfo, PpOverride, SimResult } from "../apiTypes";
import { FORMULA_CHOICES, HERO_HITS_CHOICES } from "../apiTypes";
import { get, HOSTED, post, RequestError } from "./client";
import { FormationBoard } from "./Formation";
import { ErrorBoundary } from "./ErrorBoundary";
import { CatalogProvider } from "./Hint";
import { RunLog } from "./Log";
import { elementForPath, heroesOf, isRosterForm, newBattle, SIDES, type Json } from "./model";
import { Breakdown, Issues } from "./Panels";
import { PinProvider, PinStrip } from "./Pins";
import { PIN_KEY, parseState, togglePin, type Pin, type PinState } from "./pinStore";
import { SidePanel } from "./Roster";
import { useRoute } from "./route";
import { loadJson, ROUTES, saveJson, THEMES, type Route, type Theme } from "./store";
import { PinnedUnit, UnitList, UnitsPage, type UnitData } from "./Units";
import { UnitPanel } from "./UnitPanel";
import "./theme.css";
import "./style.css";

const THEME_KEY = "editor.theme.v1";
const NAV: Record<Route, { label: string; key: string }> = { battle: { label: "Battle", key: "b" }, units: { label: "Units", key: "u" }, log: { label: "Log", key: "l" } };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName));

function App() {
  const [c, setContent] = useState<ContentInfo | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [battle, setBattle] = useState<Json>(null);
  const [path, setPath] = useState("battles/new_battle.yaml");
  const [issues, setIssues] = useState<ApiIssue[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState(1);
  const [bd, setBd] = useState<{ data: BreakdownResult | null; error: string | null }>({ data: null, error: null });
  const [sim, setSim] = useState<SimResult | null>(null);
  // What-if PP override (blank = content values), sent with sim and breakdown requests; never saved into the battle.
  const [ppText, setPpText] = useState({ active: "", passive: "" });
  const [formula, setFormula] = useState<string>(""); // what-if damage formula ("" = rules.yaml), sent with sim and breakdown; never saved
  const [heroHitsText, setHeroHitsText] = useState<string>(""); // what-if hero_hits ("" = rules.yaml), same
  const hero_hits = heroHitsText === "" ? null : Number(heroHitsText);
  const [status, setStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const req = useRef(0); // only the latest validate/breakdown round may write its results
  const [pending, setPending] = useState(false);

  const [route] = useRoute();
  const [theme, setTheme] = useState<Theme>(() => { const t = loadJson<string>(THEME_KEY, "auto"); return (THEMES as string[]).includes(t) ? (t as Theme) : "auto"; });
  const [railOpen, setRailOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const [pinState, setPinState] = useState<PinState>(() => parseState(loadJson<unknown>(PIN_KEY, null)));

  const refreshContent = () => get<ContentInfo>("/api/content").then(setContent).catch((e) => setLoadError(String(e.message ?? e)));
  useEffect(() => {
    void refreshContent();
    get<Catalog>("/api/catalog").then(setCat).catch((e) => setStatus(`catalog not loaded: ${String(e.message ?? e)}`));
  }, []);

  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    saveJson(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => saveJson(PIN_KEY, { pins: pinState.pins, height: pinState.height, collapsed: pinState.collapsed }), [pinState]);

  // Keyboard: "g" then b / u / l goes to a page (ignored while typing in a field).
  useEffect(() => {
    let armed = 0;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelected(null); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "g") { armed = Date.now(); return; }
      if (armed && Date.now() - armed < 1200) {
        const r = ROUTES.find((x) => NAV[x].key === e.key);
        if (r) { e.preventDefault(); window.location.hash = `#/${r}`; }
      }
      armed = 0;
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // First load: open the sample battle if the content has one.
  const autoOpened = useRef(false);
  useEffect(() => {
    const sample = c?.files.battles.find((f) => f.endsWith("sample.yaml"));
    if (!c || battle || autoOpened.current || !sample) return;
    autoOpened.current = true;
    void open(sample);
  }, [c, battle]); // eslint-disable-line react-hooks/exhaustive-deps

  // The drawer starts below the sticky party band at tablet widths; publish the band height for the CSS.
  useEffect(() => {
    const band = document.querySelector<HTMLElement>(".stickytop");
    if (!band) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--band-h", `${band.offsetHeight}px`));
    ro.observe(band);
    return () => ro.disconnect();
  }, [c, route, battle]);

  const ppValue = (t: string): number | null | undefined => (t.trim() === "" ? null : /^\d+$/.test(t.trim()) && Number(t) <= 10 ? Number(t) : undefined);
  const ppBad = ppValue(ppText.active) === undefined || ppValue(ppText.passive) === undefined;
  const pp: PpOverride = useMemo(() => ({ active: ppValue(ppText.active) ?? null, passive: ppValue(ppText.passive) ?? null }), [ppText]);

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
        const data = await post<BreakdownResult>("/api/breakdown", { battle, phase, pp, formula, hero_hits });
        if (live()) setBd({ data, error: null });
      } catch (e) {
        if (!live()) return;
        setPending(false);
        setBd({ data: null, error: (e as Error).message });
      }
    }, 400);
  }, [battle, phase, pp, formula, hero_hits]);

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

  /** Hosted build: load a battle YAML from the user's computer (e.g. one saved earlier by download). Save will download it under the same name. */
  const openLocal = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = parse(await f.text()) as Json;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not a battle (expected a YAML mapping)");
      const name = f.name.replace(/\.ya?ml$/i, "").replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[.]+/, "") || "battle";
      setBattle(data);
      setPath(`battles/${name}.yaml`);
      setSim(null);
      setSelected(null);
      setStatus(`loaded ${f.name} from your computer`);
    } catch (e) {
      setStatus(`cannot open ${f.name}: ${(e as Error).message}`);
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
      setSim(await post<SimResult>("/api/sim", { battle, pp, formula, hero_hits }));
      setStatus("");
    } catch (e) {
      setSim(null);
      setStatus(`not run: ${(e as Error).message}`);
    }
  };

  const save = async (overwrite = false) => {
    try {
      const r = await post<{ path: string }>("/api/save", { path, battle, overwrite });
      setStatus(HOSTED ? `downloaded ${r.path.split("/").pop()}` : `saved ${r.path}`);
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

  const pinApi = useMemo(() => ({
    has: (id: string) => pinState.pins.some((p) => p.id === id),
    toggle: (pin: Pin) => setPinState((s) => ({ ...s, pins: togglePin(s.pins, pin) })),
  }), [pinState.pins]);

  if (loadError) return <p className="error">Cannot load content: {loadError}</p>;
  if (!c) return <p className="loading">Loading content...</p>;

  const roster = !!battle && isRosterForm(battle);
  const sel = battle && selected && SIDES.some((s) => heroesOf(battle, s).some((h: Json) => h.char_id === selected)) ? selected : null; // a removed hero closes the panel
  const errors = issues?.filter((i) => i.severity === "error").length ?? 0;
  const unitData: UnitData = { c, cat, battle, bd: bd.data, bdError: bd.error, pp };
  const breakdown = <Breakdown data={bd.data} error={bd.error} selected={selected} phase={phase} setPhase={setPhase} />;
  const issuesPanel = <Issues issues={issues} onPick={pick} />;

  /** What a pin shows, rendered live from the state above. */
  const renderPin = (p: Pin): ReactNode => {
    if (p.kind === "unit") return <PinnedUnit d={unitData} ref_={p.ref} />;
    switch (p.ref) {
      case "units": return <UnitList d={unitData} />;
      case "issues": return issuesPanel;
      case "breakdown": return breakdown;
      case "log": return <RunLog result={sim} />;
      default: return <p className="muted">Unknown pin: {p.title}</p>;
    }
  };

  const band = battle && (
    <div className="formations">
      {SIDES.map((s) => (
        <div key={s} className={s}>
          <h2>{s === "challenger" ? "Your side (challenger)" : "Opponent (defender)"}</h2>
          <FormationBoard c={c} battle={battle} side={s} edit={edit} selected={selected} select={setSelected} />
        </div>
      ))}
    </div>
  );

  const battlePage = !battle ? <p className="empty">Open a saved battle or start a new one.</p> : (
    <div>
      <p className="muted howto">How this works: place heroes on the boards above (drag them, or hold Alt and use the arrow keys), click a hero to see and edit it, then press Run.</p>
      <section className="side">
        <div className="fields">
          <label data-path="battle_id">battle name<input value={battle.battle_id ?? ""} onChange={(e) => edit((b) => (b.battle_id = e.target.value))} /></label>
          {!roster && (
            <label data-path="battlefield">terrain
              <select value={battle.battlefield ?? ""} onChange={(e) => edit((b) => (b.battlefield = e.target.value || null))}>
                <option value="">(none)</option>
                {c.terrains.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>
      {errors > 0 && <p className="error" role="alert">{errors} problem{errors === 1 ? "" : "s"} to fix before you can run or save (open "Advanced" at the bottom of the Battle page to see them).</p>}
      {sim && (
        <div className="side runsummary" role="status">
          <span>Last run: <b>{sim.winner}</b> wins ({sim.reason})</span>
          <a href="#/log">view log</a>
        </div>
      )}
      {SIDES.map((s) => <SidePanel key={s} c={c} battle={battle} side={s} edit={edit} selected={selected} select={setSelected} />)}
      <details className="side advanced">
        <summary>Advanced</summary>
        <div className="fields">
          <label>file path<input className="path" aria-label="file path" value={path} onChange={(e) => setPath(e.target.value)} /></label>
          <label data-path="version">version<input className="num" value={battle.version ?? ""} onChange={(e) => edit((b) => (b.version = e.target.value))} /></label>
          <span data-path="seeds">random seeds
            {[0, 1, 2].map((k) => (
              <input key={k} type="number" className="num" value={battle.seeds?.[k] ?? ""} onChange={(e) => edit((b) => {
                b.seeds = [...(b.seeds ?? [0, 0, 0])];
                b.seeds[k] = e.target.value === "" ? 0 : Number(e.target.value);
              })} />
            ))}
          </span>
          <span title="What-if PP for every hero, before gear PP (blank = content values, 0-10). Sent with sim and breakdown, never saved.">PP override
            {(["active", "passive"] as const).map((k) => (
              <input key={k} className={`num ${ppValue(ppText[k]) === undefined ? "bad" : ""}`} aria-label={`${k} PP override`} placeholder={k} value={ppText[k]}
                onChange={(e) => setPpText((t) => ({ ...t, [k]: e.target.value }))} />
            ))}
          </span>
          <label title="What-if damage formula for the base step (blank = rules.yaml). Sent with sim and breakdown, never saved.">formula
            <select aria-label="damage formula override" value={formula} onChange={(e) => setFormula(e.target.value)}>
              {FORMULA_CHOICES.map((f) => <option key={f} value={f}>{f === "" ? "rules.yaml" : f}</option>)}
            </select>
          </label>
          <label title="What-if hero damage multiplier (rules.damage.hero_hits; blank = rules.yaml). Squads and heals are unaffected. Sent with sim and breakdown, never saved.">hero hits
            <select aria-label="hero hits override" value={heroHitsText} onChange={(e) => setHeroHitsText(e.target.value)}>
              {HERO_HITS_CHOICES.map((h) => <option key={h} value={h}>{h === "" ? "rules.yaml" : `x${h}`}</option>)}
            </select>
          </label>
        </div>
        <div className="panels" aria-label="Issues and breakdown">
          {issuesPanel}
          {breakdown}
        </div>
      </details>
    </div>
  );

  return (
    <CatalogProvider catalog={cat}>
      <PinProvider value={pinApi}>
        <div className={`shell ${railOpen ? "" : "rail-collapsed"}`}>
          <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
          <nav className="rail" aria-label="Pages">
            <div className="brand">Tactics editor</div>
            {HOSTED && <span className="badge" title="Content is bundled into this page and cannot be changed here; save downloads the battle YAML">hosted (read-only content)</span>}
            {ROUTES.map((r) => (
              <a key={r} className="navlink" href={`#/${r}`} aria-current={route === r ? "page" : undefined}>
                {NAV[r].label}<kbd title={`press g then ${NAV[r].key}`}>g {NAV[r].key}</kbd>
              </a>
            ))}
            <div className="spacer" />
            <label className="theme">theme
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                {THEMES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </nav>
          <div className={`content ${sel ? "unit-open" : ""}`}>
            <PinStrip state={pinState} set={setPinState} render={renderPin} />
            <div className="stickytop">
            <header className="top">
              <button type="button" aria-expanded={railOpen} aria-label="Toggle navigation" onClick={() => setRailOpen(!railOpen)}>menu</button>
              {route === "battle" && (
                <>
                  <select value="" aria-label="open file" onChange={(e) => open(e.target.value)}>
                    <option value="">open saved battle...</option>
                    {c.files.battles.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  {HOSTED && (
                    <label className="filebtn">open local file
                      <input type="file" accept=".yaml,.yml" onChange={(e) => { void openLocal(e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                  <button onClick={() => { setBattle(newBattle(c)); setPath("battles/new_battle.yaml"); setSim(null); setSelected(null); setStatus("new battle"); }}>New battle</button>
                  {battle && (
                    <>
                      <button onClick={() => save()} disabled={pending || errors > 0} title={HOSTED ? "Downloads the YAML file" : undefined}>{HOSTED ? "save (download)" : "save"}</button>
                      <button className="primary" onClick={run} disabled={pending || errors > 0 || ppBad} title={ppBad ? "PP override (Advanced) must be blank or 0-10" : undefined}>Run</button>
                    </>
                  )}
                  {roster && c.files.rosters.length > 0 && SIDES.map((side) => (
                    <select key={side} value="" aria-label={`${side} roster from file`} onChange={(e) => importRoster(side, e.target.value)}>
                      <option value="">{side} roster from file...</option>
                      {c.files.rosters.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  ))}
                </>
              )}
              {HOSTED && route === "battle" && <span className="muted note">The hosted editor saves by download; open local file loads it back.</span>}
              {route !== "battle" && battle && <span className="muted">{battle.battle_id ?? path}</span>}
              <span className="muted status" role="status">{status}</span>
            </header>
            {band}
            </div>
            <main id="main" tabIndex={-1}>
              <ErrorBoundary key={route}>
                {route === "battle" && battlePage}
                {route === "units" && <UnitsPage d={unitData} phase={phase} setPhase={setPhase} />}
                {route === "log" && <div className="side"><RunLog result={sim} /></div>}
              </ErrorBoundary>
            </main>
            {sel && <UnitPanel d={unitData} id={sel} edit={edit} close={() => setSelected(null)} />}
          </div>
        </div>
      </PinProvider>
    </CatalogProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
