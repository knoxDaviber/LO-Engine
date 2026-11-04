// The sliding hero sheet: overview for anyone, tactics for your own heroes.
import { useEffect, useMemo, useState } from "react";
import { Sprite } from "../../editor/src/Sprite";
import { buildPresets, canon, type Kind, type Preset } from "../../editor/src/conditionPresets";
import { equipmentStats, equipmentType } from "../../src/equipmentBase";
import { leanedBase } from "../../src/race";
import { STATS, type Skill, type Stat, type Tactic } from "../../src/schema";
import type { RosterHero } from "../../src/schema/roster";
import { matchupPct, moveTactic, setSlot, toggleTactic } from "../logic/party";
import { setLeader, setSheet, toggleField, type RunState } from "../logic/run";
import { COMMON_PRESETS } from "../logic/presets";
import { currentStep, type TutEvent } from "../logic/tutorial";
import { pack } from "./pack";
import { cap, Crest, Pips, useEsc, useExit, useScale } from "./ui";

export type PanelTab = "overview" | "tactics";

const presets = buildPresets(pack.statuses.map((x) => ({ id: x.id, name: x.name, category: x.category })));
const clean = (l: string) => l.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
const byCanon = new Map(presets.map((p) => [canon(p.value), p]));
const presetOf = (v: unknown): Preset | undefined => (v ? byCanon.get(canon(v)) : undefined);
const nameOf = (v: unknown) => { const p = presetOf(v); return p ? clean(p.label) : "Custom"; };

const STAT_TIPS: Record<Stat, string> = {
  HP: "Hit points", ATK: "Physical power", INT: "Magic power and healing", DEF: "Reduces physical damage", MDEF: "Reduces magic damage", SPD: "Higher acts sooner",
  HIT: "Accuracy", SKL: "Helps hit, crit and guard", CRIT: "Critical hit chance", GUARD: "Chance to halve damage", EVA: "Chance to dodge",
};

function heroStats(h: RosterHero) {
  const ch = pack.byId.characters.get(h.char_id)!;
  const out = { ...leanedBase(pack.rules, ch) };
  for (const id of Object.values(h.equipment)) {
    const e = id ? pack.byId.equipment.get(id) : undefined;
    if (!e) continue;
    const flat = equipmentStats(e, pack.rules.equipment_bases);
    for (const st of STATS) out[st] += flat[st];
  }
  return out;
}

const lines = (id: string) => {
  const e = pack.byId.equipment.get(id)!;
  return Object.entries(equipmentStats(e, pack.rules.equipment_bases)).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join("  ");
};

function SkillRow({ sk }: { sk: Skill }) {
  return (
    <li className="skill-row">
      <div><b>{sk.name}</b><span className={`cost cost-${sk.pp_pool}`}>{sk.pp_cost} PP</span></div>
      <p>{sk.description}</p>
    </li>
  );
}

function Overview({ h, leaderView }: { h: RosterHero; leaderView: boolean }) {
  const ch = pack.byId.characters.get(h.char_id)!;
  const st = heroStats(h);
  const skills = ch.skills.map((id) => pack.byId.skills.get(id)!);
  return (
    <div className="panel-scroll">
      <dl className="stats">
        {STATS.map((k) => <div key={k} className="tip" data-tip={STAT_TIPS[k]}><dt>{k}</dt><dd>{st[k]}</dd></div>)}
      </dl>
      <h4>Gear</h4>
      <ul className="gear">
        {(["weapon", "armor", "accessory_1", "accessory_2"] as const).map((slot) => {
          const id = h.equipment[slot];
          const e = id ? pack.byId.equipment.get(id) : null;
          return <li key={slot} className={e ? "" : "empty"}><b>{e?.name ?? "Empty"}</b><small>{e ? `${cap(equipmentType(e) ?? e.slot)} · ${lines(id!)}` : cap(slot)}</small></li>;
        })}
      </ul>
      <h4>Skills</h4>
      <ul className="skills">{skills.map((sk) => <SkillRow key={sk.id} sk={sk} />)}</ul>
      {leaderView && ch.leader_aura && (
        <>
          <h4>Leader aura</h4>
          <p className="aura"><b>{ch.leader_aura.name ?? "Aura"}.</b> {ch.leader_aura.description}</p>
        </>
      )}
    </div>
  );
}

const KIND_WORD: Record<Kind, string> = { Check: "Only if", Filter: "Targets", Prioritise: "Goes first" };

function Picker({ title, value, fallback, onPick, onClose, leaving }: { title: string; value: Tactic["main"]; fallback: string; onPick: (v: Tactic["main"]) => void; onClose: () => void; leaving: boolean }) {
  const cats = useMemo(() => ["Common", ...new Set(presets.map((p) => p.category))], []);
  const [cat, setCat] = useState("Common");
  const [hover, setHover] = useState<string | null>(null);
  const list = cat === "Common" ? COMMON_PRESETS.map((id) => presets.find((p) => p.id === id)!).filter(Boolean) : presets.filter((p) => p.category === cat);
  const cur = value ? canon(value) : null;
  return (
    <div className={`scrim${leaving ? " leaving" : ""}`} onClick={onClose}>
      <section className="modal modal-picker" data-tut="picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="chips" role="tablist">
          {cats.map((c) => <button key={c} role="tab" aria-selected={c === cat} className={`chip${c === cat ? " on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="tiles">
          <button className={`ctile ctile-default${cur === null ? " on" : ""}`} onClick={() => onPick(null)} onMouseEnter={() => setHover(`Use the default: ${fallback}.`)} onFocus={() => setHover(`Use the default: ${fallback}.`)}>
            <small>Default</small><b>{fallback}</b>
          </button>
          {list.map((p) => (
            <button key={p.id} className={`ctile k-${p.kind}${cur === canon(p.value) ? " on" : ""}`} onClick={() => onPick(p.value as Tactic["main"])} onMouseEnter={() => setHover(p.tip)} onFocus={() => setHover(p.tip)}>
              <small>{KIND_WORD[p.kind]}</small><b>{clean(p.label)}</b>
            </button>
          ))}
        </div>
        <footer className="picker-tip">{hover ?? "Hover a tile to read what it does."}</footer>
      </section>
    </div>
  );
}

function TacticsTab({ s, set, h, fire, picking, setPicking }: { s: RunState; set: (s: RunState) => void; h: RosterHero; fire: (e: TutEvent) => void; picking: { index: number; slot: "main" | "sub" } | null; setPicking: (p: { index: number; slot: "main" | "sub" } | null) => void }) {
  const sheet = h.tactic_sheet;
  const skill = (t: Tactic) => pack.byId.skills.get(t.skill_id)!;
  const put = (next: Tactic[]) => set(setSheet(s, h.char_id, next));
  const actives = sheet.map((t, i) => ({ t, i })).filter((x) => skill(x.t).category === "active");
  const passives = sheet.map((t, i) => ({ t, i })).filter((x) => skill(x.t).category === "passive");
  const defaultName = (t: Tactic, slot: "main" | "sub") => {
    const d = slot === "main" ? skill(t).targeting.default_main : skill(t).targeting.default_sub;
    return d ? nameOf(d) : slot === "main" ? "No condition" : "None";
  };
  const slotBtn = (t: Tactic, i: number, slot: "main" | "sub", first: boolean) => (
    <button className={`slot${t[slot] ? " set" : ""}`} data-tut={first && slot === "main" ? "main-first" : undefined} disabled={!t.enabled} onClick={() => { setPicking({ index: i, slot }); fire("picker_opened"); }}>
      <small>{slot === "main" ? "Main" : "Sub"}</small><span>{t[slot] ? nameOf(t[slot]) : defaultName(t, slot)}</span>
    </button>
  );
  return (
    <div className="panel-scroll">
      <ul className="facing" aria-label="Facing">
        {s.enemy!.heroes.map((e) => {
          const ec = pack.byId.characters.get(e.char_id)!;
          const pct = matchupPct(pack, pack.byId.characters.get(h.char_id)!.class, ec.class);
          return <li key={e.char_id}><Crest cls={ec.class} size={16} />{ec.name}{pct !== 0 && <i className={pct > 0 ? "up" : "down"}>{pct > 0 ? "+" : ""}{pct}%</i>}</li>;
        })}
      </ul>
      <ol className="tactics" data-tut="tactics-list">
        {actives.map(({ t, i }, n) => (
          <li key={t.skill_id} className={`tactic${t.enabled ? "" : " off"}`}>
            <span className="tactic-num">{n + 1}</span>
            <div className="tactic-body">
              <div className="tactic-head">
                <b className="tip" data-tip={skill(t).description}>{skill(t).name}</b>
                <span className="cost cost-active">{skill(t).pp_cost} PP</span>
                <span className="tactic-ctl">
                  <button className="mini" disabled={n === 0} aria-label={`Move ${skill(t).name} up`} onClick={() => put(moveTactic(sheet, i, -1))}>▲</button>
                  <button className="mini" disabled={n === actives.length - 1} aria-label={`Move ${skill(t).name} down`} onClick={() => put(moveTactic(sheet, i, 1))}>▼</button>
                  <button className={`switch${t.enabled ? " on" : ""}`} role="switch" aria-checked={t.enabled} aria-label={`${skill(t).name} enabled`} onClick={() => put(toggleTactic(sheet, i))}><i /></button>
                </span>
              </div>
              <div className="tactic-slots">{slotBtn(t, i, "main", n === 0)}{slotBtn(t, i, "sub", false)}</div>
            </div>
          </li>
        ))}
      </ol>
      {passives.length > 0 && <h4>Passive skills <small>trigger by themselves</small></h4>}
      <ul className="passives">
        {passives.map(({ t, i }) => (
          <li key={t.skill_id} className={t.enabled ? "" : "off"}>
            <b className="tip" data-tip={skill(t).description}>{skill(t).name}</b>
            <span className="cost cost-passive">{skill(t).pp_cost} PP</span>
            <button className={`switch${t.enabled ? " on" : ""}`} role="switch" aria-checked={t.enabled} aria-label={`${skill(t).name} enabled`} onClick={() => put(toggleTactic(sheet, i))}><i /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  s: RunState; set: (s: RunState) => void; sel: { id: string; enemy: boolean } | null; tab: PanelTab; setTab: (t: PanelTab) => void; onClose: () => void;
  picker: boolean; setPicker: (b: boolean) => void; fire: (e: TutEvent) => void;
}

export function HeroPanel({ s, set, sel, tab, setTab, onClose, setPicker, fire }: Props) {
  const k = useScale();
  const { shown, leaving } = useExit(sel);
  const [picking, setPickingRaw] = useState<{ index: number; slot: "main" | "sub" } | null>(null);
  const setPicking = (p: typeof picking) => { setPickingRaw(p); setPicker(!!p); };
  const pickerExit = useExit(picking);
  useEffect(() => { setPicking(null); }, [sel?.id]); // the sheet closed or changed hero: an open picker belongs to the old one
  const closePicker = () => { setPicking(null); fire("picker_closed"); };
  useEsc(!!picking, closePicker);
  if (!shown) return null;
  const entry = shown.enemy ? s.enemy!.heroes.find((h) => h.char_id === shown.id) : s.pool.find((h) => h.entry.char_id === shown.id)?.entry;
  if (!entry) return null;
  const ch = pack.byId.characters.get(entry.char_id)!;
  const own = !shown.enemy;
  const fielded = own && !!s.pool.find((h) => h.entry.char_id === ch.id)?.slot;
  const isLeader = own ? s.leader === ch.id : s.enemy!.leader === ch.id;
  const pp = ch.pp;
  const t = pickerExit.shown ? entry.tactic_sheet[pickerExit.shown.index] : null;
  const skillOf = t ? pack.byId.skills.get(t.skill_id)! : null;
  const fallback = pickerExit.shown && skillOf
    ? (() => { const d = pickerExit.shown.slot === "main" ? skillOf.targeting.default_main : skillOf.targeting.default_sub; return d ? nameOf(d) : pickerExit.shown.slot === "main" ? "No condition" : "None"; })()
    : "";
  const activeTab = own ? tab : "overview";
  return (
    <>
      <aside className={`panel${leaving ? " leaving" : ""}`} data-tut="panel" aria-label={`${ch.name} sheet`}>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        <header className={`panel-head glow-${ch.class}`}>
          <div className="panel-art"><Sprite cls={ch.class} name={ch.name} size={Math.round(120 * k)} mirror={!own} /></div>
          <div>
            <h2>{ch.name}{isLeader && <em className="crown" />}</h2>
            <p className="card-class"><Crest cls={ch.class} size={20} />{cap(ch.class)} · {cap(ch.sub_race ?? ch.race)}</p>
            <p className="panel-role">{ch.role}</p>
            <p className="pp-row" data-tut="pp">
              <span><small>Active</small><Pips n={pp.active} max={pp.active} kind="active" /></span>
              <span><small>Passive</small><Pips n={pp.passive} max={pp.passive} kind="passive" /></span>
            </p>
          </div>
        </header>
        {own && (
          <div className="panel-actions">
            <button className="btn btn-small" disabled={!fielded || isLeader} onClick={() => set(setLeader(s, ch.id))}>{isLeader ? "Leader" : "Make Leader"}</button>
            <button className="btn btn-small" disabled={!!currentStep(s.tutorial)} onClick={() => set(toggleField(pack, s, ch.id))}>{fielded ? "Send to Bench" : "Field Hero"}</button>
          </div>
        )}
        {own && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
            <button role="tab" aria-selected={activeTab === "tactics"} className={activeTab === "tactics" ? "on" : ""} data-tut="tab-tactics" onClick={() => { setTab("tactics"); fire("tactics_opened"); }}>Tactics</button>
          </div>
        )}
        {activeTab === "overview" ? <Overview h={entry} leaderView={isLeader || own} /> : <TacticsTab s={s} set={set} h={entry} fire={fire} picking={picking} setPicking={setPicking} />}
      </aside>
      {pickerExit.shown && t && skillOf && (
        <Picker
          title={`${skillOf.name}: ${pickerExit.shown.slot === "main" ? "Main" : "Sub"} condition`} value={t[pickerExit.shown.slot]} fallback={fallback} leaving={pickerExit.leaving}
          onClose={closePicker}
          onPick={(v) => { if (!picking) return; set(setSheet(s, ch.id, setSlot(entry.tactic_sheet, picking.index, picking.slot, v))); closePicker(); }}
        />
      )}
    </>
  );
}
