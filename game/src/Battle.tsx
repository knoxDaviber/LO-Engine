// The animated replay: it plays game/logic/replay.ts beats on the same field the prep screen uses.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Sprite } from "../../editor/src/Sprite";
import { motionOf, type Beat, type Motion, type Pop, type UnitInfo, type UnitSnap } from "../logic/replay";
import type { RunState } from "../logic/run";
import { STAGES } from "../logic/stages";
import { captionsFor, CAPTIONS, fillText, tutorialContext } from "../logic/tutorial";
import { pack } from "./pack";
import { Narrator } from "./Tutorial";
import { MuteButton } from "./music";
import { tileStyle } from "./scenes";
import { Backdrop, Crest, fieldPos, Pips, Screen, useScale, type Lane } from "./ui";

const SPEEDS = [1, 2, 4];
const BASE: Record<Beat["kind"], number> = { phase: 1700, action: 1250, squad: 850, stunned: 800, phase_end: 1500, end: 1500 };
const IMPACT = 340;

const durationOf = (b: Beat) => BASE[b.kind] + Math.max(0, b.pops.length - 1) * 170 + (b.deaths.length ? 350 : 0);

function PopNumber({ pop, i, speed }: { pop: Pop; i: number; speed: number }) {
  const style = { animationDelay: `${(IMPACT + i * 170) / speed}ms`, animationDuration: `${1000 / speed}ms` } as CSSProperties;
  if (pop.kind === "damage") return <span className={`pop pop-dmg${pop.crit ? " crit" : ""}${pop.guard ? " guarded" : ""}`} style={style}>{pop.crit && <small>Critical</small>}{pop.guard && <small>Guard</small>}{pop.amount}</span>;
  if (pop.kind === "heal") return <span className="pop pop-heal" style={style}>+{pop.amount}</span>;
  if (pop.kind === "miss") return <span className="pop pop-miss" style={style}>Miss</span>;
  return <span className="pop pop-text" style={style}>{pop.text}</span>;
}

function Bar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? (hp / max) * 100 : 0;
  return <div className={`hp${pct < 30 ? " low" : ""}`} role="img" aria-label={`${hp} of ${max} HP`}><i className="hp-lag" style={{ width: `${pct}%` }} /><i className="hp-fill" style={{ width: `${pct}%` }} /></div>;
}

interface Aim { dx: number; dy: number; reach: number }

function Unit({ u, units, snap, beat, landed, speed, size, aim }: { u: UnitInfo; units: UnitInfo[]; snap: UnitSnap; beat: Beat | null; landed: boolean; speed: number; size: number; aim: Aim | null }) {
  const actorSide = units.find((x) => x.id === beat?.actor)?.side;
  const lane = u.row as Lane;
  const pos = fieldPos(u.side, lane, u.column);
  const mirror = u.side === "defender";
  const acting = beat?.actor === u.id;
  const motion = motionOf(u, beat, units);
  const pops = beat?.pops.filter((p) => p.unit === u.id) ?? [];
  const marked = !!beat && (pops.length > 0 || beat.targets.includes(u.id));
  const mark = !marked ? "" : pops.some((p) => p.kind === "damage" || p.kind === "miss") || (!pops.some((p) => p.kind === "heal") && actorSide && actorSide !== u.side) ? "foe" : "good";
  const hit = landed && pops.some((p) => p.kind === "damage");
  const healed = landed && pops.some((p) => p.kind === "heal");
  // The body travels part of the way to the target; a projectile flies all of it.
  const body = !aim ? { dx: 0, dy: 0 }
    : motion === "melee" ? { dx: aim.dx * aim.reach, dy: (aim.dy * aim.reach) / 1.6 }
      : motion === "squad" ? { dx: aim.dx * 0.22, dy: aim.dy * 0.22 }
        : motion === "shot" ? { dx: aim.dx * -0.1, dy: aim.dy * -0.1 }
          : { dx: 0, dy: 0 };
  const style = {
    left: `${pos.x}%`, top: `${pos.y}%`, ["--speed" as string]: speed, ["--dx" as string]: `${body.dx}vw`, ["--dy" as string]: `${body.dy}vh`,
    ["--ax" as string]: `${aim?.dx ?? 0}vw`, ["--ay" as string]: `${aim?.dy ?? 0}vh`,
  } as CSSProperties;
  const cls = `unit unit-${u.kind} side-${u.side}${snap.alive ? "" : " dead"}${acting ? " acting" : ""}${motion ? ` motion-${motion}` : ""}${hit ? " hit" : ""}${healed ? " healed" : ""}`;
  return (
    <div className={cls} style={style} data-unit={u.id}>
      {aim && (motion === "shot" || motion === "cast") && <i key={`f${beat!.index}`} className={`fx fx-${motion}`} aria-hidden />}
      <div className="stand">
      {mark && <i key={beat!.index} className={`mark mark-${mark}`} aria-hidden />}
      <div className="unit-body" key={acting ? `a${beat!.index}` : "idle"}>
        {acting && beat?.skill && <span key={beat!.index} className="skill-tag">{beat.skill}</span>}
        {u.kind === "hero" ? (
          <Sprite cls={u.cls} name={u.name} size={size} mirror={mirror} />
        ) : (
          <div className="squad-mob">{Array.from({ length: snap.soldiers }, (_, i) => <Sprite key={i} cls={u.cls} name={u.name} size={Math.round(size * 0.42)} mirror={mirror} />)}</div>
        )}
      </div>
      </div>
      <div className="hud">
        <div className="hud-name">{snap.leader && <em className="crown" />}{u.kind === "hero" ? <Crest cls={u.cls} size={15} /> : null}<span>{u.kind === "hero" ? u.name : `${u.name.split("'s ").pop()} x${snap.soldiers}`}</span></div>
        <Bar hp={snap.hp} max={snap.maxHp} />
        {u.kind === "hero" && <div className="hud-pp"><Pips n={snap.ppActive} max={u.ppActive} kind="active" /><Pips n={snap.ppPassive} max={u.ppPassive} kind="passive" /></div>}
        {snap.statuses.length > 0 && <div className="hud-st">{snap.statuses.map((st) => <span key={st.id} className={`st st-${st.category}`} title={st.name}>{st.name}</span>)}</div>}
      </div>
      {pops.length > 0 && <div className="pops" key={`p${beat!.index}`}>{pops.map((p, i) => <PopNumber key={i} pop={p} i={i} speed={speed} />)}</div>}
    </div>
  );
}

export function Battle({ s, set, onDone }: { s: RunState; set: (s: RunState) => void; onDone: () => void }) {
  const k = useScale();
  const stage = STAGES[s.stage]!;
  const replay = s.fought!.replay;
  const beats = replay.beats;
  const units = replay.units;
  const [i, setI] = useState(0);
  const [applied, setApplied] = useState(-1); // the last beat whose result is on screen
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState(false);
  const [caption, setCaption] = useState<{ id: string; text: string } | null>(null);
  const showCaps = !!s.tutorial && !s.tutorial.seenCaptions;
  const caps = useMemo(() => (showCaps ? captionsFor(replay) : []), [replay, showCaps]);
  const ctx = useMemo(() => tutorialContext(pack, s.pool, s.leader, stage.party), []);

  const beat = beats[i] ?? null;
  const last = beats.length - 1;
  const snapRow = beats[Math.max(applied, 0)]!.units;
  const snapOf = (id: string) => snapRow.find((u) => u.id === id)!;

  useEffect(() => {
    if (paused || caption) return;
    const t1 = setTimeout(() => setApplied((a) => Math.max(a, i)), IMPACT / speed);
    const t2 = setTimeout(() => {
      const c = caps.find((x) => x.beat === i);
      if (c) { setCaption({ id: c.id, text: fillText(CAPTIONS[c.id], pack, ctx, { spent: c.spent }) }); return; }
      if (i >= last) onDone(); else setI(i + 1);
    }, durationOf(beats[i]!) / speed);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [i, speed, paused, caption]);

  const resume = () => {
    setCaption(null);
    if (i >= last) { onDone(); return; }
    setI(i + 1);
  };
  const stopCaps = () => { setCaption(null); set({ ...s, tutorial: s.tutorial && { ...s.tutorial, seenCaptions: true } }); };
  const skip = () => {
    setCaption(null);
    set({ ...s, tutorial: s.tutorial && { ...s.tutorial, seenCaptions: true } });
    setApplied(last);
    setI(last);
  };

  /** Where the actor's action lands, in vw/vh from its own spot: the chosen target, else whoever the beat actually touched (squads attack without a target selection). */
  const aimFor = (u: UnitInfo): Aim | null => {
    if (beat?.actor !== u.id) return null;
    const tid = beat.targets[0] ?? beat.pops.find((p) => p.unit !== u.id)?.unit;
    if (!tid || tid === u.id) return null;
    const t = units.find((x) => x.id === tid);
    if (!t) return null;
    const a = fieldPos(u.side, u.row as Lane, u.column), b = fieldPos(t.side, t.row as Lane, t.column);
    return { dx: b.x - a.x, dy: b.y - a.y, reach: t.side === u.side ? 0.1 : 0.42 };
  };

  const banner = beat && (beat.kind === "phase" || beat.kind === "phase_end" || beat.kind === "end");
  const logLines = beats.slice(0, i + 1).flatMap((b) => b.lines);

  return (
    <Screen name="battle">
      <Backdrop scene={stage.scene} embers={10} dim />
      <div className="field-ground battle-ground" />
      <header className="battle-top">
        <div className="stage-chip"><b>Phase {beat?.phase ?? 1}</b><span>{stage.name}</span></div>
        <ol className="queue" aria-label="Next to act">
          {(beat?.next ?? []).slice(0, 7).map((id, n) => {
            const u = units.find((x) => x.id === id)!;
            return <li key={`${id}${n}`} className={`q side-${u.side}`}><span><Sprite cls={u.cls} name={u.name} size={Math.round(58 * k)} mirror={u.side === "defender"} /></span></li>;
          })}
        </ol>
        <div className="controls">
          <MuteButton />
          <button className="btn btn-small" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? "Resume" : "Pause"}</button>
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map((v) => <button key={v} className={speed === v ? "on" : ""} aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}x</button>)}
          </div>
          <button className="btn btn-small" onClick={skip}>Skip</button>
        </div>
      </header>

      <section className="field battle-field" aria-label="Battle" style={tileStyle(stage.scene)}>
        {(["challenger", "defender"] as const).flatMap((side) => (["back", "front"] as Lane[]).flatMap((r) => [1, 2, 3].map((c) => {
          const pos = fieldPos(side, r, c);
          return <span key={`${side}${r}${c}`} className={`tile ground${side === "defender" ? " foe" : ""}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}><span className="tile-floor" /></span>;
        })))}
        {units.map((u) => <Unit key={u.id} u={u} units={units} snap={snapOf(u.id)} beat={beat} landed={applied >= i} speed={speed} size={Math.round(112 * k)} aim={aimFor(u)} />)}
      </section>

      {banner && (
        <div className={`phase-banner${beat!.kind === "end" ? ` end ${replay.winner === "challenger" ? "won" : "lost"}` : ""}`} key={`b${beat!.index}`}>
          <b>{beat!.kind === "phase" ? `Phase ${beat!.phase}` : beat!.kind === "phase_end" ? `Phase ${beat!.phase} Ends` : replay.winner === "challenger" ? "Victory" : "Defeat"}</b>
          {beat!.kind === "phase_end" && <small>{beat!.reason}</small>}
        </div>
      )}

      {beat?.lines[0] && !caption && <div className="action-caption" key={`c${beat.index}`}>{beat.lines[0]}</div>}

      <div className={`log${log ? " open" : ""}`}>
        <button className="btn btn-small" onClick={() => setLog((x) => !x)} aria-expanded={log}>Log</button>
        {log && <ol ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>{logLines.map((l, n) => <li key={n}>{l}</li>)}</ol>}
      </div>

      {caption && (
        <div className="caption-wrap">
          <Narrator text={caption.text} action="Continue" onAction={resume} onSkip={stopCaps} />
        </div>
      )}
    </Screen>
  );
}
