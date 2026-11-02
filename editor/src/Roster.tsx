// One side of the battle: its heroes (fielded form: `heroes` + `leader`; roster form: `roster` with leader line, anchor, battlefield and
// draft picks) and, per hero, squad, rows, equipment, sigils and the tactics board. Eligibility is left to the validator.
import type { ContentInfo } from "../apiTypes";
import { Info, titleOf, useTips } from "./Hint";
import { defaultHero, heroesOf, heroesPath, isRosterForm, SLOTS, usedHeroes, type Json, type SideKey } from "./model";
import { TacticsBoard } from "./Tactics";

type Edit = (fn: (battle: Json) => void) => void;
interface SideProps { c: ContentInfo; battle: Json; side: SideKey; edit: Edit; selected: string | null; select: (id: string) => void }

const name = (c: ContentInfo, id: string) => c.characters.find((x) => x.id === id)?.name ?? id;

function Opt({ id, label, tip }: { id: string; label: string; tip?: string }) {
  return <option value={id} title={tip}>{label === id ? id : `${label} (${id})`}</option>;
}

function HeroPanel({ c, battle, side, index, edit, selected, select }: SideProps & { index: number }) {
  const hero = heroesOf(battle, side)[index];
  const tips = useTips();
  const base = `${heroesPath(battle, side)}[${index}]`;
  const ch = c.characters.find((x) => x.id === hero.char_id);
  const squad = c.soldiers.find((s) => s.id === hero.squad_id);
  const set = (fn: (h: Json) => void) => edit((b) => fn(heroesOf(b, side)[index]));
  const optional = (key: string) => (e: { target: { value: string } }) => set((h) => { if (e.target.value) h[key] = e.target.value; else delete h[key]; });
  return (
    <div className={`hero ${selected === hero.char_id ? "selected" : ""}`} data-path={base}>
      <div className="hero-head" onClick={() => select(hero.char_id)}>
        <b>{ch ? `${ch.name}` : hero.char_id}</b> <span className="muted">{hero.char_id} {ch?.class}</span>
        <button className="small right" onClick={(e) => { e.stopPropagation(); edit((b) => removeHero(b, side, index)); }}>remove hero</button>
      </div>
      <div className="fields">
        <label data-path={`${base}.squad_id`}>squad
          <select value={hero.squad_id} onChange={(e) => set((h) => (h.squad_id = e.target.value))}>
            {!squad && <option value={hero.squad_id}>{hero.squad_id || "(none)"}</option>}
            {c.soldiers.map((s) => <Opt key={s.id} id={s.id} label={`${s.name}, ${s.class}`} tip={titleOf(tips.soldier(s.id))} />)}
          </select>
          <Info tip={tips.soldier(hero.squad_id)} />
        </label>
        <label data-path={`${base}.squad_row`}>squad row
          <select value={hero.squad_row ?? ""} onChange={optional("squad_row")}>
            <option value="">default ({squad?.default_soldier_row ?? "?"})</option>
            {c.rows.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label data-path={`${base}.preferred_row`}>hero row
          <select value={hero.preferred_row ?? ""} onChange={optional("preferred_row")}>
            <option value="">default ({ch?.preferred_row ?? "?"})</option>
            {c.rows.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label data-path={`${base}.column`}>column
          <select value={hero.column ?? ""} onChange={(e) => set((h) => { if (e.target.value) h.column = Number(e.target.value); else delete h.column; })}>
            <option value="">auto</option>
            {Array.from({ length: c.rules.columns }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            {hero.column != null && !(Number.isInteger(hero.column) && hero.column >= 1 && hero.column <= c.rules.columns) && <option value={hero.column}>{hero.column} (invalid)</option>}
          </select>
        </label>
      </div>
      <div className="fields">
        {SLOTS.map(([key, slot]) => (
          <span key={key} className="slotbox">
            <label data-path={`${base}.equipment.${key}`}>{key}
              <select value={hero.equipment?.[key] ?? ""} onChange={(e) => set((h) => ((h.equipment ??= {})[key] = e.target.value || null))}>
                <option value="">(empty)</option>
                {c.equipment.filter((x) => x.slot === slot || x.id === hero.equipment?.[key]).map((x) => <Opt key={x.id} id={x.id} label={x.name} tip={titleOf(tips.equipment(x.id))} />)}
              </select>
              <Info tip={tips.equipment(hero.equipment?.[key])} />
            </label>
            <label data-path={`${base}.sigils.${key}`}>sigil
              <select value={hero.sigils?.[key] ?? ""} onChange={(e) => set((h) => {
                const sg = { ...(h.sigils ?? {}) };
                if (e.target.value) sg[key] = e.target.value; else delete sg[key];
                if (Object.keys(sg).length > 0) h.sigils = sg; else delete h.sigils;
              })}>
                <option value="">(none)</option>
                {c.gods.map((g) => <Opt key={g.id} id={g.id} label={`${g.name}: ${g.blessing}`} tip={titleOf(tips.god(g.id))} />)}
              </select>
              <Info tip={tips.god(hero.sigils?.[key])} />
            </label>
          </span>
        ))}
      </div>
      <TacticsBoard c={c} hero={ch} sheet={hero.tactic_sheet ?? []} path={`${base}.tactic_sheet`}
        edit={(fn) => set((h) => { h.tactic_sheet ??= []; fn(h.tactic_sheet); })} />
    </div>
  );
}

function removeHero(b: Json, side: SideKey, index: number) {
  const list = heroesOf(b, side);
  const [gone] = list.splice(index, 1);
  if (isRosterForm(b)) {
    const r = b[side].roster;
    r.leader_line = (r.leader_line ?? []).filter((x: string) => x !== gone.char_id);
    if (r.anchor === gone.char_id) r.anchor = null;
  } else if (b[side].leader === gone.char_id) b[side].leader = list[0]?.char_id ?? "";
  pruneEdits(b[side], gone.char_id);
}

/** Drops a removed hero from the side's between-phase edits (hero entries and `leader`), and edits left with nothing in them. */
function pruneEdits(s: Json, id: string) {
  if (!Array.isArray(s.edits)) return;
  for (const e of s.edits) {
    if (Array.isArray(e.heroes)) {
      e.heroes = e.heroes.filter((h: Json) => h.char_id !== id);
      if (e.heroes.length === 0) delete e.heroes;
    }
    if (e.leader === id) delete e.leader;
  }
  s.edits = s.edits.filter((e: Json) => e.heroes !== undefined || e.leader !== undefined);
  if (s.edits.length === 0) delete s.edits;
}

function addHero(c: ContentInfo, b: Json, side: SideKey, id: string) {
  const ch = c.characters.find((x) => x.id === id)!;
  heroesOf(b, side).push(defaultHero(c, ch));
  if (isRosterForm(b)) (b[side].roster.leader_line ??= []).push(id);
  else if (!b[side].leader) b[side].leader = id;
}

/** Draft picks (roster form): bans name the other roster's heroes, protects this roster's. */
function Picks({ c, battle, side, edit, kind }: Omit<SideProps, "selected" | "select"> & { kind: "bans" | "protects" }) {
  const other: SideKey = side === "challenger" ? "defender" : "challenger";
  const list: string[] = battle[side].draft?.[kind] ?? [];
  const pool = heroesOf(battle, kind === "bans" ? other : side).map((h: Json) => h.char_id);
  const write = (next: string[]) => edit((b) => {
    const d = { ...(b[side].draft ?? {}) };
    if (next.length > 0) d[kind] = next; else delete d[kind];
    if (Object.keys(d).length > 0) b[side].draft = d; else delete b[side].draft;
  });
  return (
    <label data-path={`${side}.draft.${kind}`}>draft {kind}
      {list.map((id, i) => <span key={i} className="chip">{name(c, id)} <button className="small" onClick={() => write(list.filter((_, j) => j !== i))}>x</button></span>)}
      <select value="" onChange={(e) => e.target.value && write([...list, e.target.value])}>
        <option value="">+ add</option>
        {pool.map((id: string) => <Opt key={id} id={id} label={name(c, id)} />)}
      </select>
    </label>
  );
}

export function SidePanel(props: SideProps) {
  const { c, battle, side, edit } = props;
  const roster = isRosterForm(battle);
  const heroes = heroesOf(battle, side);
  const used = usedHeroes(battle);
  const r = roster ? battle[side].roster : null;
  const limit = roster ? c.rules.roster_size : c.rules.fielded;
  return (
    <section className="side">
      <h2>{side} <span className="muted">({roster ? "roster form" : "fielded form"}, {heroes.length}/{limit} heroes)</span></h2>
      <div className="fields">
        {!roster && (
          <label data-path={`${side}.leader`}>leader
            <select value={battle[side].leader ?? ""} onChange={(e) => edit((b) => (b[side].leader = e.target.value))}>
              {!heroes.some((h: Json) => h.char_id === battle[side].leader) && <option value={battle[side].leader ?? ""}>(choose)</option>}
              {heroes.map((h: Json) => <Opt key={h.char_id} id={h.char_id} label={name(c, h.char_id)} />)}
            </select>
          </label>
        )}
        {r && (
          <>
            <label data-path={`${side}.roster.roster_id`}>roster id
              <input value={r.roster_id ?? ""} onChange={(e) => edit((b) => (b[side].roster.roster_id = e.target.value))} />
            </label>
            {side === "defender" && (
              <>
                <label data-path={`${side}.roster.anchor`}>anchor
                  <select value={r.anchor ?? ""} onChange={(e) => edit((b) => (b[side].roster.anchor = e.target.value || null))}>
                    <option value="">(none)</option>
                    {heroes.map((h: Json) => <Opt key={h.char_id} id={h.char_id} label={name(c, h.char_id)} />)}
                  </select>
                </label>
                <label data-path={`${side}.roster.battlefield`}>battlefield
                  <select value={r.battlefield ?? ""} onChange={(e) => edit((b) => (b[side].roster.battlefield = e.target.value || null))}>
                    <option value="">(none)</option>
                    {c.terrains.map((t) => <Opt key={t.id} id={t.id} label={t.name} />)}
                  </select>
                </label>
                <span className="muted" data-path={`${side}.roster.ban_sheet`}>ban sheet: {r.ban_sheet ? `${r.ban_sheet.rules?.length ?? 0} rule(s), kept as loaded` : "none"}</span>
              </>
            )}
          </>
        )}
      </div>
      {r && (
        <div className="fields" data-path={`${side}.roster.leader_line`}>
          leader line:
          {(r.leader_line ?? []).map((id: string, i: number) => (
            <span key={id} className="chip">{i + 1}. {name(c, id)}
              <button className="small" disabled={i === 0} onClick={() => edit((b) => { const l = b[side].roster.leader_line; [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}>up</button>
            </span>
          ))}
        </div>
      )}
      {r && (
        <div className="fields">
          <Picks c={c} battle={battle} side={side} edit={edit} kind="bans" />
          <Picks c={c} battle={battle} side={side} edit={edit} kind="protects" />
        </div>
      )}
      {(battle[side].edits?.length ?? 0) > 0 && <p className="muted" data-path={`${side}.edits`}>{battle[side].edits.length} between-phase edit(s), kept as loaded (not editable here yet).</p>}
      {heroes.map((_: Json, i: number) => <HeroPanel key={`${heroes[i].char_id}-${i}`} {...props} index={i} />)}
      <label>add hero
        <select value="" disabled={heroes.length >= limit} onChange={(e) => e.target.value && edit((b) => addHero(c, b, side, e.target.value))}>
          <option value="">{heroes.length >= limit ? "(side is full)" : "(choose)"}</option>
          {c.characters.filter((ch) => !used.has(ch.id)).map((ch) => <Opt key={ch.id} id={ch.id} label={`${ch.name}, ${ch.class}`} />)}
        </select>
      </label>
    </section>
  );
}
