// The game client. One RunState drives everything; every screen only renders it and calls game/logic.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterResult, fight, rerollStart, startRun, titleState, toPrep, toResult, type RunState } from "../logic/run";
import { pack } from "./pack";
import { Battle } from "./Battle";
import { Prep } from "./Prep";
import { Result, Victory } from "./Result";
import { Reveal } from "./Reveal";
import { Title } from "./Title";
import "./style.css";

function App() {
  const [s, set] = useState<RunState>(titleState);
  useEffect(() => { window.scrollTo(0, 0); }, [s.screen]);
  const begin = (guided: boolean) => set(startRun(pack, crypto.getRandomValues(new Uint32Array(1))[0]!, guided));
  const reroll = () => set((x) => rerollStart(pack, x, crypto.getRandomValues(new Uint32Array(1))[0]!));
  switch (s.screen) {
    case "title": return <Title onStart={begin} />;
    case "reveal": return <Reveal s={s} onNext={() => set(toPrep(pack, s))} onReroll={s.stage === 0 ? reroll : undefined} />;
    case "prep": return <Prep s={s} set={set} onFight={(next) => set(fight(pack, next))} />;
    case "fight": return <Battle s={s} set={set} onDone={() => set((x) => toResult(x))} />;
    case "result": return <Result s={s} onNext={() => set(afterResult(pack, s))} />;
    case "victory": return <Victory s={s} onTitle={() => set(titleState())} />;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
