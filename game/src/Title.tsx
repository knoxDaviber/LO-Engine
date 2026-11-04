import { Sprite } from "../../editor/src/Sprite";
import { GAME_TITLE } from "./pack";
import { Backdrop, Screen, useScale } from "./ui";

const MARCH = ["infantry", "lancer", "cavalry", "archer", "mage", "holy", "flyer", "assassin", "aquatic", "monster"];

export function Title({ onStart }: { onStart: (guided: boolean) => void }) {
  const k = useScale();
  const [first, ...rest] = GAME_TITLE.split(" ");
  return (
    <Screen name="title">
      <Backdrop scene="dusk" castle embers={34} />
      <div className="title-vignette" />
      <div className="march" aria-hidden>
        <div className="march-line">
          {[...MARCH, ...MARCH].map((c, i) => <span className="marcher" key={i} style={{ animationDelay: `${-(i % 5) * 0.13}s` }}><Sprite cls={c} name={c} size={Math.round(112 * k)} /></span>)}
        </div>
      </div>
      <div className="title-col">
        <p className="title-kicker">A game of orders given and battles watched</p>
        <h1 className="logo"><span className="logo-a">{first}</span><span className="logo-b">{rest.join(" ")}</span></h1>
        <div className="logo-rule"><i /><b /><i /></div>
        <div className="title-menu">
          <button className="btn btn-primary btn-xl" onClick={() => onStart(true)} autoFocus>Begin Tutorial</button>
          <button className="btn btn-ghost btn-xl" onClick={() => onStart(false)}>Play Without Guide</button>
        </div>
      </div>
    </Screen>
  );
}
