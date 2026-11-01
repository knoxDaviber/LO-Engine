// Read-only panels: validation issues, the Section 9.1 stacking breakdown and the sim log.
import { useState } from "react";
import type { ApiIssue, BreakdownResult, BreakdownStat, SimResult } from "../apiTypes";

export function Issues({ issues, onPick }: { issues: ApiIssue[] | null; onPick: (i: ApiIssue) => void }) {
  if (issues === null) return <p className="muted">validating...</p>;
  if (issues.length === 0) return <p className="ok">No issues.</p>;
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.severity} onClick={() => onPick(i)} title="click to highlight the field">
          <b>{i.code}</b> <span className="muted">{i.path}</span><br />{i.message}
        </li>
      ))}
    </ul>
  );
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function StatRow({ s }: { s: BreakdownStat }) {
  return (
    <>
      <tr className="stat">
        <td><b>{s.stat}</b></td><td>{fmt(s.base)}</td><td>{fmt(s.flat)}</td><td>x{fmt(s.multiplier)}</td><td><b>{fmt(s.result)}</b></td>
      </tr>
      {s.effects.map((e, i) => (
        <tr key={i} className={`effect ${e.outcome}`}>
          <td />
          <td colSpan={4}>
            {e.outcome === "winner" ? "+" : "-"} {e.status} <span className="muted">[{e.category}{e.unique ? ", unique" : ""}]</span>{" "}
            {e.value > 0 ? "+" : ""}{fmt(e.value)}{e.mode === "percent" ? "%" : ""} {e.outcome}
            {e.parts && e.parts.length > 1 && <span className="muted"> (sum of {e.parts.join(" + ")})</span>}
          </td>
        </tr>
      ))}
    </>
  );
}

export function Breakdown({ data, selected, phase, setPhase, error }: { data: BreakdownResult | null; selected: string | null; phase: number; setPhase: (p: number) => void; error: string | null }) {
  const units = data?.units.filter((u) => u.id === selected || (u.kind === "squad" && u.leader === selected)) ?? [];
  return (
    <div>
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
          <table className="breakdown">
            <thead><tr><th>stat</th><th>base</th><th>flat</th><th>mult</th><th>result</th></tr></thead>
            <tbody>{Object.values(u.stats).map((s) => <StatRow key={s.stat} s={s} />)}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function RunLog({ result }: { result: SimResult }) {
  const [unit, setUnit] = useState("");
  const setup = result.events.find((e) => e.type === "battle_setup") as any;
  const names: string[] = setup ? [...setup.units, ...setup.squads].map((u: any) => u.name) : [];
  const lines = result.log.split("\n").filter((l) => !unit || l.includes(unit) || l.startsWith("===") || l.startsWith("---"));
  return (
    <div>
      <p className="result">Result: <b>{result.winner}</b> wins ({result.reason})</p>
      <label>unit filter
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">(all)</option>
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      <pre className="log">{lines.join("\n")}</pre>
    </div>
  );
}
