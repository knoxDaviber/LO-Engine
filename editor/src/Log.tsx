// The sim log, readable: grouped by phase and action (logGroups.ts), coloured by the acting unit's side, each action collapsible.
import { useMemo, useState } from "react";
import type { SimResult } from "../apiTypes";
import { actionMatches, groupLog } from "./logGroups";
import { PanelHead } from "./Pins";

export const PIN_LOG = { id: "panel:log", kind: "panel", ref: "log", title: "Run log" } as const;

export function RunLog({ result }: { result: SimResult | null }) {
  const [unit, setUnit] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const g = useMemo(() => (result ? groupLog(result) : null), [result]);
  if (!result || !g) {
    return (
      <section aria-label="Run log">
        <PanelHead title="Run log" pin={PIN_LOG} />
        <p className="muted">No run yet: use "run sim" on the Battle page.</p>
      </section>
    );
  }
  const names = Object.keys(g.sides);
  const all = g.phases.flatMap((p) => p.actions.filter((a) => actionMatches(a, unit)));
  const setAll = (v: boolean) => setOpen(Object.fromEntries(all.map((a) => [a.id, v])));
  const winnerSide = result.winner === "challenger" || result.winner === "defender" ? result.winner : "";
  return (
    <section aria-label="Run log">
      <PanelHead title="Run log" pin={PIN_LOG} />
      <div className={`banner ${winnerSide}`} role="status">Result: <b>{result.winner}</b> wins ({result.reason})</div>
      <div className="logbar">
        <label>unit filter
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">(all)</option>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setAll(true)}>expand all</button>
        <button type="button" onClick={() => setAll(false)}>collapse all</button>
        <span className="muted">{all.length} actions</span>
      </div>
      {g.header.length > 0 && (
        <details>
          <summary>Draft and battle setup</summary>
          <pre className="logblock">{g.header.join("\n")}</pre>
        </details>
      )}
      {g.phases.map((p) => {
        const actions = p.actions.filter((a) => actionMatches(a, unit));
        return (
          <div key={p.phase} className="logphase">
            <h3>{p.title}</h3>
            {p.intro.length > 0 && <pre className="logblock">{p.intro.join("\n")}</pre>}
            {actions.map((a) => {
              const isOpen = !!open[a.id];
              return (
                <div key={a.id} className={`act ${a.side ?? ""}`}>
                  <button type="button" className="act-head" aria-expanded={isOpen} aria-controls={`${a.id}-body`} onClick={() => setOpen({ ...open, [a.id]: !isOpen })}>
                    <span className="muted nowrap">t={a.t}</span><b>{a.unit}</b>
                    <span className="sum">{a.kind === "acts" ? a.summary.replace(`${a.unit} uses `, "uses ") : a.kind === "attacks" ? "squad attack" : a.kind === "idle" ? "idles" : "cannot act"}</span>
                  </button>
                  {isOpen && <pre id={`${a.id}-body`} className="logblock">{a.lines.join("\n")}</pre>}
                </div>
              );
            })}
            {p.footer && <p className="muted">{p.footer}</p>}
          </div>
        );
      })}
      {g.banner && <p className="muted">{g.banner}</p>}
    </section>
  );
}
