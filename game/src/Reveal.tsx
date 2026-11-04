import { Sprite } from "../../editor/src/Sprite";
import type { RunState } from "../logic/run";
import { STAGES } from "../logic/stages";
import { pack } from "./pack";
import { Backdrop, cap, Crest, Screen, useScale } from "./ui";

export function Reveal({ s, onNext }: { s: RunState; onNext: () => void }) {
  const k = useScale();
  const recruit = s.stage > 0;
  const stage = STAGES[s.stage]!;
  let flip = 0;
  return (
    <Screen name="reveal">
      <Backdrop scene={stage.scene} />
      <div className="reveal-col">
        <header className="reveal-head">
          <p className="kicker">{recruit ? "A hero joins your company" : "Fate deals your company"}</p>
          <h2>{recruit ? `${pack.byId.characters.get(s.fresh[0]!)!.name} answers the call` : "Your Company"}</h2>
        </header>
        <ul className={`cards cards-${s.pool.length}`}>
          {s.pool.map((h) => {
            const ch = pack.byId.characters.get(h.entry.char_id)!;
            const isNew = s.fresh.includes(ch.id);
            return (
              <li key={ch.id} className={`card${isNew ? " card-new" : " card-old"}`} style={{ animationDelay: isNew ? `${0.35 + flip++ * 0.32}s` : "0s" }}>
                <div className="card-in">
                  <div className="card-back"><span className="card-seal"><Crest cls={ch.class} size={Math.round(58 * k)} /></span></div>
                  <div className={`card-front glow-${ch.class}`}>
                    <div className="card-art"><Sprite cls={ch.class} name={ch.name} size={Math.round(148 * k)} /></div>
                    <div className="card-text">
                      <h3>{ch.name}</h3>
                      <p className="card-class"><Crest cls={ch.class} size={20} />{cap(ch.class)}</p>
                      <p className="card-meta">{cap(ch.sub_race ?? ch.race)}</p>
                      <p className="card-role">{ch.role}</p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <button className="btn btn-primary btn-xl reveal-go" onClick={onNext} autoFocus style={{ animationDelay: `${0.5 + s.fresh.length * 0.32}s` }}>
          {recruit ? `March on ${stage.name}` : "To the Field"}
        </button>
      </div>
    </Screen>
  );
}
