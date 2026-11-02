// Read-only panels: validation issues and the Section 9.1 stacking breakdown (the sim log lives on the Log page, Log.tsx).
import { useState } from "react";
import type { ApiIssue, BreakdownResult, BreakdownStat } from "../apiTypes";
import { Hint, useTips } from "./Hint";
import { PanelHead } from "./Pins";

export const PIN_ISSUES = { id: "panel:issues", kind: "panel", ref: "issues", title: "Issues" } as const;
export const PIN_BREAKDOWN = { id: "panel:breakdown", kind: "panel", ref: "breakdown", title: "Stacking breakdown" } as const;

export function Issues({ issues, onPick }: { issues: ApiIssue[] | null; onPick: (i: ApiIssue) => void }) {
  const errors = issues?.filter((i) => i.severity === "error").length ?? 0;
  return (
    <section aria-label="Issues">
      <PanelHead title={<>Issues {issues && <span className="muted">({errors} errors, {issues.length - errors} other)</span>}</>} pin={PIN_ISSUES} />
      {issues === null ? <p className="muted">validating...</p> : issues.length === 0 ? <p className="ok">No issues.</p> : (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k} className={i.severity} tabIndex={0} onClick={() => onPick(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(i); } }} title="click to highlight the field">
              <b>{i.code}</b> <span className="muted">{i.path}</span><br />{i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** One stat line; the winners and suppressed effects (with the parts that were summed) expand under it. */
export function StatRow({ s, defaultOpen = true }: { s: BreakdownStat; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const tips = useTips();
  return (
    <>
      <tr className="stat">
        <td>
          {s.effects.length > 0
            ? <button type="button" className="statbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{s.stat}</button>
            : <b>{s.stat}</b>}
        </td>
        <td>{fmt(s.base)}</td><td>{fmt(s.flat)}</td><td>x{fmt(s.multiplier)}</td><td><b>{fmt(s.result)}</b></td>
      </tr>
      {open && s.effects.map((e, i) => (
        <tr key={i} className={`effect ${e.outcome}`}>
          <td />
          <td colSpan={4}>
            {e.outcome === "winner" ? "+" : "-"} <Hint tip={tips.status(e.status)}>{e.status}</Hint> <span className="muted">[{e.category}{e.unique ? ", unique" : ""}]</span>{" "}
            {e.value > 0 ? "+" : ""}{fmt(e.value)}{e.mode === "percent" ? "%" : ""} {e.outcome}
            {e.parts && e.parts.length > 1 && <span className="muted"> (sum of {e.parts.join(" + ")})</span>}
          </td>
        </tr>
      ))}
    </>
  );
}

export function StatTable({ stats, defaultOpen }: { stats: Record<string, BreakdownStat>; defaultOpen?: boolean }) {
  return (
    <table className="breakdown">
      <thead><tr><th>stat</th><th>base</th><th>flat</th><th>mult</th><th>result</th></tr></thead>
      <tbody>{Object.values(stats).map((s) => <StatRow key={s.stat} s={s} defaultOpen={defaultOpen} />)}</tbody>
    </table>
  );
}

export function Breakdown({ data, selected, phase, setPhase, error }: { data: BreakdownResult | null; selected: string | null; phase: number; setPhase: (p: number) => void; error: string | null }) {
  const units = data?.units.filter((u) => u.id === selected || (u.kind === "squad" && u.leader === selected)) ?? [];
  return (
    <section aria-label="Stacking breakdown">
      <PanelHead title="Stacking breakdown" pin={PIN_BREAKDOWN} />
      <label>phase
        <select value={phase} onChange={(e) => setPhase(Number(e.target.value))}>{[1, 2, 3].map((p) => <option key={p}>{p}</option>)}</select>
      </label>
      <span className="muted"> after pre-battle; edits applied, HP not carried over</span>
      {error && <p className="muted">{error}</p>}
      {!error && !selected && <p className="muted">Click a hero name to see its breakdown.</p>}
      {!error && selected && units.length === 0 && <p className="muted">{selected} is not fielded (banned in the draft?).</p>}
      {units.map((u) => (
        <div key={u.id}>
          <h3>{u.name} <span className="muted">{u.kind}, {u.side}</span></h3>
          <StatTable stats={u.stats} />
        </div>
      ))}
    </section>
  );
}
