// Share a team as a key or file, and in Versus mode import a rival's. The team name is shown as plain text only.
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fieldedEntries } from "../logic/party";
import type { RunState } from "../logic/run";
import { exportTeam, importTeam, MAX_KEY_CHARS, MAX_NAME_CHARS } from "../logic/share";
import { pack } from "./pack";

export function Share({ s, set, onClose }: { s: RunState; set: Dispatch<SetStateAction<RunState>>; onClose: () => void }) {
  const [name, setName] = useState("My team");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const keyBox = useRef<HTMLTextAreaElement>(null);
  const ready = !!s.leader && s.pool.some((h) => h.slot);
  const key = ready ? exportTeam({ heroes: fieldedEntries(s.pool), leader: s.leader! }, name) : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(key); setNote("Copied."); } catch {
      keyBox.current?.select();
      setNote(document.execCommand?.("copy") ? "Copied." : "Press Ctrl+C to copy.");
    }
  };
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([key], { type: "text/plain" }));
    a.download = `${name.trim().replace(/[^\w-]+/g, "_") || "team"}.lo-team`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const pick = async (f?: File) => {
    if (!f) return;
    if (f.size > MAX_KEY_CHARS) return setErr("That file is too large to be a team.");
    setText(await f.text());
    setErr("");
  };
  const doImport = () => {
    const r = importTeam(pack, text);
    if (!r.ok) return setErr(r.error);
    set((x) => ({ ...x, enemy: r.side, rival: r.name }));
    onClose();
  };

  return (
    <div className="scrim" onClick={onClose}>
      <section className="modal modal-chart" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <header><h2>Share your team</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="share-sec">
          {ready ? (
            <>
              <label className="chart-note">Team name <input value={name} maxLength={MAX_NAME_CHARS} onChange={(e) => setName(e.target.value)} /></label>
              <textarea ref={keyBox} className="share-box" readOnly value={key} aria-label="Team key" onFocus={(e) => e.target.select()} />
              <div className="menu-btns"><button className="btn" onClick={copy}>Copy key</button><button className="btn" onClick={save}>Save file</button></div>
              {note && <p className="chart-note">{note}</p>}
            </>
          ) : <p className="chart-note">Field at least one hero and a leader to share.</p>}
        </div>
        {s.mode === "versus" && (
          <div className="share-sec">
            <h3>Fight a rival team</h3>
            <textarea className="share-box" value={text} placeholder="Paste a team key here" aria-label="Rival team key" onChange={(e) => { setText(e.target.value); setErr(""); }} />
            <div className="menu-btns">
              <input type="file" accept=".lo-team,.txt,text/plain" aria-label="Team file" onChange={(e) => void pick(e.target.files?.[0])} />
              <button className="btn btn-primary" disabled={!text.trim()} onClick={doImport}>Import</button>
            </div>
            {err && <p className="share-err" role="alert">{err}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
