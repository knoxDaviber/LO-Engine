// The prep screen: pool on the left, both formations on the field, hero sheet sliding in on demand.
import { useEffect, useRef, useState, type Dispatch, type PointerEvent as RP, type SetStateAction } from "react";
import { Sprite } from "../../editor/src/Sprite";
import { resolveSquadPlacement } from "../../src/formation";
import type { Row } from "../../src/schema";
import type { RosterHero } from "../../src/schema/roster";
import type { BattleSide } from "../../src/schema";
import { fieldedEntries } from "../logic/party";
import { fightBlocker, moveTo, toggleField, type RunState } from "../logic/run";
import { STAGES } from "../logic/stages";
import { currentStep, tutorialEvent, tutorialHero, type TutEvent } from "../logic/tutorial";
import { HeroPanel, type PanelTab } from "./HeroPanel";
import { pack } from "./pack";
import { Tutorial } from "./Tutorial";
import { Backdrop, cap, Crest, fieldPos, Screen, useEsc, useExit, useScale, type Lane } from "./ui";

interface Selected { id: string; enemy: boolean }

function useDrag(onDrop: (id: string, where: string) => void) {
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const start = (e: RP, id: string) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    moved.current = false;
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      moved.current = true;
      setGhost({ id, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      if (!moved.current) return;
      setTimeout(() => { moved.current = false; }, 0); // a drag between two tiles fires no click to consume the flag
      const where = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop;
      if (where) onDrop(id, where);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { ghost, start, wasDrag: () => { const m = moved.current; moved.current = false; return m; } };
}

const heroName = (id: string) => pack.byId.characters.get(id)!.name;
const classOf = (id: string) => pack.byId.characters.get(id)!.class;

function SquadBlock({ side, s, size }: { side: "challenger" | "defender"; s: BattleSide; size: number }) {
  const sp = resolveSquadPlacement(pack, s);
  if (!sp) return null;
  const st = pack.byId.soldiers.get(sp.squadId)!;
  const pos = fieldPos(side, sp.boardRow, 2);
  return (
    <div className={`squad squad-${side}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <div className="squad-mob">
        {Array.from({ length: st.count }, (_, i) => <Sprite key={i} cls={st.class} name={st.name} size={size} mirror={side === "defender"} />)}
      </div>
      <span className="squad-tag">{st.name} <b>x{st.count}</b></span>
    </div>
  );
}

export function Prep({ s, set, onFight }: { s: RunState; set: Dispatch<SetStateAction<RunState>>; onFight: (s: RunState) => void }) {
  const k = useScale();
  const stage = STAGES[s.stage]!;
  const enemy = s.enemy!;
  const [sel, setSel] = useState<Selected | null>(null);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [picker, setPicker] = useState(false);
  const [charts, setCharts] = useState(false);
  const [drop, setDrop] = useState<string | null>(null);
  const chart = useExit(charts ? true : null);

  const step = currentStep(s.tutorial);
  // Updater form: a popup can set the run and fire in one go, and this must build on that newer state.
  const fire = (ev: TutEvent, next?: RunState) => set((x) => { const n = next ?? x; return { ...n, tutorial: tutorialEvent(n.tutorial, ev) }; });

  const fieldedN = s.pool.filter((h) => h.slot).length;
  const firstHero = tutorialHero(s.pool);
  const lastGuard = (id: string) => !!s.tutorial && fieldedN === 1 && !!s.pool.find((h) => h.entry.char_id === id)?.slot;

  const place = (id: string, where: string) => {
    if (where === "bench") { if (lastGuard(id)) return; return fire("hero_moved", moveTo(pack, s, id, null)); }
    const [row, col] = where.split(":");
    const next = moveTo(pack, s, id, { row: row as Row, column: Number(col) });
    if (next.pool === s.pool) { setDrop("full"); setTimeout(() => setDrop(null), 1400); return; }
    fire("hero_moved", next);
  };
  const drag = useDrag(place);

  // Keeps what the tutorial step points at on screen.
  useEffect(() => {
    if (!step?.needs) return;
    if (step.needs === "no_panel") { setSel(null); setPicker(false); return; }
    setSel((x) => x ?? { id: firstHero, enemy: false });
    if (step.needs === "tactics") setTab("tactics");
  }, [step?.id, sel === null]);

  const close = () => { setSel(null); setPicker(false); };
  useEsc(!!sel && !picker, close);
  useEffect(() => {
    if (!sel) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.(".panel, .tile, .bench-card, .scrim, .tut")) close(); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [!!sel]);
  useEsc(charts, () => { setCharts(false); fire("matchups_closed"); });

  const open = (x: Selected) => {
    if (!x.enemy && x.id === sel?.id && !sel.enemy) return setSel(null);
    if (x.enemy) setTab("overview");
    setSel(x);
    if (!x.enemy) fire("hero_opened");
  };

  const clickSlot = (row: Row, column: number, occupant?: string) => {
    if (drag.wasDrag()) return;
    if (occupant) return open({ id: occupant, enemy: false });
    if (sel && !sel.enemy) place(sel.id, `${row}:${column}`);
  };

  const blocker = fightBlocker(pack, s);
  const mine: BattleSide = { heroes: fieldedEntries(s.pool), leader: s.leader ?? "" };
  const spriteSize = Math.round(112 * k);

  const tile = (row: Row, column: number) => {
    const h = s.pool.find((x) => x.slot?.row === row && x.slot.column === column);
    const pos = fieldPos("challenger", row as Lane, column);
    const id = h?.entry.char_id;
    return (
      <button
        key={`${row}${column}`} className={`tile${id ? " filled" : ""}${id && sel?.id === id ? " picked" : ""}${!id && sel && !sel.enemy ? " can-drop" : ""}`}
        style={{ left: `${pos.x}%`, top: `${pos.y}%` }} data-drop={`${row}:${column}`}
        data-tut={id === firstHero ? "hero-first" : undefined}
        aria-label={id ? `${heroName(id)}, ${row} row, slot ${column}` : `Empty ${row} row slot ${column}`}
        onPointerDown={id ? (e) => drag.start(e, id) : undefined} onClick={() => clickSlot(row, column, id)}
      >
        <span className="tile-floor" />
        {id && (
          <span className={`tile-hero${drag.ghost?.id === id ? " lifted" : ""}`}>
            <Sprite cls={classOf(id)} name={heroName(id)} size={spriteSize} />
            <span className="nameplate">{id === s.leader && <em className="crown" data-tut="leader" title="Party leader" />}<Crest cls={classOf(id)} />{heroName(id)}</span>
          </span>
        )}
      </button>
    );
  };

  const enemyTile = (h: RosterHero) => {
    const pos = fieldPos("defender", h.preferred_row as Lane, h.column!);
    return (
      <button key={h.char_id} className={`tile foe filled${sel?.id === h.char_id ? " picked" : ""}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
        aria-label={`Enemy ${heroName(h.char_id)}`} onClick={() => open({ id: h.char_id, enemy: true })}>
        <span className="tile-floor" />
        <span className="tile-hero">
          <Sprite cls={classOf(h.char_id)} name={heroName(h.char_id)} size={spriteSize} mirror />
          <span className="nameplate">{h.char_id === enemy.leader && <em className="crown" title="Enemy leader" />}<Crest cls={classOf(h.char_id)} />{heroName(h.char_id)}</span>
        </span>
      </button>
    );
  };

  return (
    <Screen name="prep">
      <Backdrop scene={stage.scene} embers={14} />
      <header className="topbar">
        <div className="stage-chip"><b>Battle {s.stage + 1}<small> of {STAGES.length}</small></b><span>{stage.name}</span></div>
        <div className="topbar-mid" />
        <button className="btn btn-small" data-tut="matchups" onClick={() => { setCharts(true); fire("matchups_opened"); }}>Matchups</button>
      </header>

      <div className="prep-body">
        <aside className="bench" data-drop="bench" data-tut="bench" aria-label="Hero pool">
          <h2>Company <span className={`count${fieldedN >= pack.rules.draft.fielded ? " full" : ""}`}>{fieldedN} / {pack.rules.draft.fielded}</span></h2>
          <ul>
            {s.pool.map((h) => {
              const id = h.entry.char_id, out = !h.slot;
              const lead = id === s.leader;
              return (
                <li key={id} className={`bench-card${out ? " benched" : ""}${sel?.id === id ? " picked" : ""}`}>
                  <button className="bench-main" onPointerDown={(e) => drag.start(e, id)} onClick={() => { if (!drag.wasDrag()) open({ id, enemy: false }); }} data-tut={out && id === firstHero ? "hero-first" : undefined} aria-label={`${heroName(id)} sheet`}>
                    <span className="bench-face"><Sprite cls={classOf(id)} name={heroName(id)} size={Math.round(68 * k)} /></span>
                    <span className="bench-text"><b>{heroName(id)}</b><small><Crest cls={classOf(id)} size={15} />{cap(classOf(id))}{lead ? " · Leader" : ""}</small></span>
                  </button>
                  <button className={`bench-toggle${out ? "" : " on"}`} aria-pressed={!out} disabled={(out && fieldedN >= pack.rules.draft.fielded) || lastGuard(id)}
                    title={out ? "Field this hero" : "Send to the bench"} aria-label={out ? `Field ${heroName(id)}` : `Bench ${heroName(id)}`}
                    onClick={() => fire("hero_moved", toggleField(pack, s, id))}>{out ? "+" : "–"}</button>
                </li>
              );
            })}
          </ul>
          <p className="bench-hint">{drop === "full" ? `Only ${pack.rules.draft.fielded} can fight. Swap someone out.` : s.pool.some((h) => !h.slot) ? "Drag a benched hero onto a fielded one to swap them." : "Drag heroes onto the field, or back here to bench them."}</p>
        </aside>

        <section className="field" aria-label="Battlefield">
          <div className="field-ground" />
          <div className="side-tag mine">Your line</div>
          <div className="side-tag theirs">{stage.party}</div>
          <div className="hole hole-player" data-tut="board-player" />
          <div className="hole hole-enemy" data-tut="board-enemy" />
          {(["back", "front"] as Row[]).flatMap((r) => [1, 2, 3].map((c) => tile(r, c)))}
          {enemy.heroes.map(enemyTile)}
          {(["back", "front"] as Row[]).flatMap((r) => [1, 2, 3].filter((c) => !enemy.heroes.some((h) => h.preferred_row === r && h.column === c)).map((c) => {
            const pos = fieldPos("defender", r as Lane, c);
            return <span key={`${r}${c}`} className="tile foe vacant" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}><span className="tile-floor" /></span>;
          }))}
          {s.leader && <SquadBlock side="challenger" s={mine} size={Math.round(46 * k)} />}
          <SquadBlock side="defender" s={enemy} size={Math.round(46 * k)} />
        </section>
      </div>

      <footer className="prep-foot">
        <p className="flavour"><b>{stage.party}.</b> {stage.flavour}</p>
        <div className="fight-wrap">
          {blocker && <span className="fight-why">{blocker}</span>}
          <button className="btn btn-primary btn-fight" data-tut="fight" disabled={!!blocker} onClick={() => { const t = tutorialEvent(s.tutorial, "fight"); onFight({ ...s, tutorial: t }); }}>Fight</button>
        </div>
      </footer>

      <HeroPanel s={s} set={set} sel={sel} tab={tab} setTab={setTab} onClose={close} picker={picker} setPicker={setPicker} fire={fire} />

      {chart.shown && <Matchups leaving={chart.leaving} onClose={() => { setCharts(false); fire("matchups_closed"); }} />}

      {drag.ghost && <div className="ghost" style={{ left: drag.ghost.x, top: drag.ghost.y }}><Sprite cls={classOf(drag.ghost.id)} name={heroName(drag.ghost.id)} size={spriteSize} /></div>}

      <Tutorial s={s} set={set} step={step} />
    </Screen>
  );
}

function Matchups({ leaving, onClose }: { leaving: boolean; onClose: () => void }) {
  const { class_advantage: pairs, matchup } = pack.rules;
  return (
    <div className={`scrim${leaving ? " leaving" : ""}`} onClick={onClose}>
      <section className="modal modal-chart" data-tut="matchup-chart" role="dialog" aria-label="Class matchups" onClick={(e) => e.stopPropagation()}>
        <header><h2>Class Matchups</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <ul className="chart">
          {pairs.map((p) => (
            <li key={`${p.attacker}${p.defender}`}>
              <span><Crest cls={p.attacker} size={30} />{cap(p.attacker)}</span>
              <i className="chart-arrow">+{p.damage_percent ?? matchup.advantage_damage_percent}%</i>
              <span><Crest cls={p.defender} size={30} />{cap(p.defender)}</span>
            </li>
          ))}
        </ul>
        <p className="chart-note">The winning side also gets +{matchup.advantage_hit} to hit. The losing side of a matchup deals {Math.abs(matchup.disadvantage_damage_percent)}% less damage.</p>
      </section>
    </div>
  );
}
