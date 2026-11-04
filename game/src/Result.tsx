import { Sprite } from "../../editor/src/Sprite";
import type { RunState } from "../logic/run";
import { STAGES } from "../logic/stages";
import { AFTER_WIN, fillText, tutorialContext } from "../logic/tutorial";
import { GAME_TITLE, pack } from "./pack";
import { MuteButton } from "./music";
import { Backdrop, cap, Screen, useScale } from "./ui";

export function Result({ s, onNext }: { s: RunState; onNext: () => void }) {
  const k = useScale();
  const sum = s.fought!.summary;
  const stage = STAGES[s.stage]!;
  const note = s.tutorial && sum.won && s.stage === 0
    ? fillText(AFTER_WIN, pack, tutorialContext(pack, s.pool, s.leader, stage.party))
    : null;
  return (
    <Screen name="result">
      <Backdrop scene={stage.scene} embers={sum.won ? 30 : 10} />
      <MuteButton fixed />
      <div className={`result-card ${sum.won ? "won" : "lost"}`}>
        <p className="kicker">{stage.name}</p>
        <h2 className="result-title">{sum.won ? "Victory" : "Defeat"}</h2>
        {sum.timeout && <p className="result-sub">Both sides still stood after the last phase. {sum.won ? "You" : "They"} kept the higher share of HP.</p>}
        {sum.mvp && (
          <div className="mvp">
            <Sprite cls={sum.mvp.cls} name={sum.mvp.name} size={Math.round(120 * k)} />
            <div>
              <p className="kicker">Most valuable</p>
              <h3>{sum.mvp.name}</h3>
              <p>{sum.mvp.damage.toLocaleString()} damage{sum.mvp.healing > 0 ? `, ${sum.mvp.healing.toLocaleString()} healed` : ""}</p>
            </div>
          </div>
        )}
        <dl className="result-stats">
          <div><dt>Survivors</dt><dd>{sum.survivors} / {sum.fielded}</dd></div>
          <div><dt>Foes felled</dt><dd>{sum.felled}</dd></div>
          <div><dt>Phases</dt><dd>{sum.phases}</dd></div>
        </dl>
        {note && <p className="result-note">{note}</p>}
        {!sum.won && <p className="result-note">Your company regroups. Change your line-up or orders and try again.</p>}
        <button className="btn btn-primary btn-xl" onClick={onNext} autoFocus>{sum.won ? (s.stage + 1 >= STAGES.length ? "Claim Victory" : "Onward") : "Retry Battle"}</button>
      </div>
    </Screen>
  );
}

export function Victory({ s, onTitle }: { s: RunState; onTitle: () => void }) {
  const k = useScale();
  return (
    <Screen name="victory">
      <Backdrop scene="lake" embers={40} />
      <MuteButton fixed />
      <div className="victory-col">
        <p className="kicker">{GAME_TITLE}</p>
        <h2 className="result-title">The Road Is Open</h2>
        <p className="result-sub">{STAGES.length} battles won. Your company holds the Ember Gate.</p>
        <ul className="victory-line">
          {s.pool.map((h) => {
            const ch = pack.byId.characters.get(h.entry.char_id)!;
            return <li key={ch.id}><Sprite cls={ch.class} name={ch.name} size={Math.round(112 * k)} /><span>{ch.name}</span><small>{cap(ch.class)}</small></li>;
          })}
        </ul>
        <button className="btn btn-primary btn-xl" onClick={onTitle} autoFocus>Back to Title</button>
      </div>
    </Screen>
  );
}
