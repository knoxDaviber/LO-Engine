// The spotlight and narrator. It dims everything but the data-tut target; the hole stays clickable, so a step can wait for the real action.
import { useEffect, useState } from "react";
import type { RunState } from "../logic/run";
import { STAGES } from "../logic/stages";
import { fillText, tutorialContext, tutorialNext, type TutStep } from "../logic/tutorial";
import { pack } from "./pack";

interface Box { x: number; y: number; w: number; h: number }

function useTarget(target: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!target) { setBox(null); return; }
    let live = true;
    const tick = () => {
      if (!live) return;
      const el = document.querySelector(`[data-tut="${target}"]`);
      const r = el?.getBoundingClientRect();
      const pad = 8;
      setBox((b) => {
        if (!r) return null;
        const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
        const n = { x, y, w: Math.min(window.innerWidth, r.right + pad) - x, h: Math.min(window.innerHeight, r.bottom + pad) - y };
        return b && b.x === n.x && b.y === n.y && b.w === n.w && b.h === n.h ? b : n;
      });
      requestAnimationFrame(tick);
    };
    tick();
    return () => { live = false; };
  }, [target]);
  return box;
}

export function Narrator({ text, action, onAction, onSkip, top }: { text: string; action?: string; onAction?: () => void; onSkip?: () => void; top?: boolean }) {
  return (
    <aside className={`narrator${top ? " top" : ""}`} aria-live="polite">
      <span className="narrator-seal" aria-hidden>?</span>
      <p>{text}</p>
      <div className="narrator-btns">
        {onSkip && <button className="btn btn-small btn-ghost" onClick={onSkip}>Skip Tutorial</button>}
        {action && <button className="btn btn-small btn-primary" onClick={onAction} autoFocus>{action}</button>}
      </div>
    </aside>
  );
}

export function Tutorial({ s, set, step }: { s: RunState; set: (s: RunState) => void; step: TutStep | null }) {
  const box = useTarget(step?.target ?? null);
  if (!step) return null;
  const text = fillText(step.text, pack, tutorialContext(pack, s.pool, s.leader, STAGES[s.stage]!.party));
  const next = () => set({ ...s, tutorial: tutorialNext(s.tutorial!) });
  const skip = () => set({ ...s, tutorial: null });
  const b = box ?? { x: 0, y: 0, w: 0, h: 0 };
  // The box goes to the top of the screen when the spotlight sits low.
  const top = !!box && box.y + box.h / 2 > window.innerHeight * 0.55;
  return (
    <div className="tut">
      <div className="dim" style={{ left: 0, top: 0, right: 0, height: b.y }} />
      <div className="dim" style={{ left: 0, top: b.y + b.h, right: 0, bottom: 0 }} />
      <div className="dim" style={{ left: 0, top: b.y, width: b.x, height: b.h }} />
      <div className="dim" style={{ left: b.x + b.w, top: b.y, right: 0, height: b.h }} />
      {box && <div className="spot" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />}
      <Narrator text={text} action={step.wait ? undefined : "Next"} onAction={next} onSkip={skip} top={top} />
    </div>
  );
}
