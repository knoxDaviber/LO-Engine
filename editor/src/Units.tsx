// Units overview: one card per unit of both teams (heroes, plus each leader's squad), built only from data the App already holds (ContentInfo,
// Catalog, the latest breakdown, the battle JSON). No fetching here, so switching to this page is instant. All wording comes from describe.ts
// (through Hint / useTips); this file only lays it out.
import { useMemo, type ReactNode } from "react";
import type { BreakdownResult, Catalog, ContentInfo, PpOverride } from "../apiTypes";
import { unlockedBlessings } from "../../src/devotion";
import { describeAura, describeBlessing, describeEffect, describeEquipmentBase, describeSkill, describeSoldier, describeSoldierSkill, describeTerrain } from "./describe";
import { layoutSide, leaderOf } from "./formationLayout";
import { Hint, useTips } from "./Hint";
import { heroesOf, isRosterForm, SIDES, SLOTS, type Json, type SideKey } from "./model";
import { PinButton } from "./Pins";
import type { Pin } from "./pinStore";
import { StatTable } from "./Panels";
import { Sprite } from "./Sprite";

export const PIN_UNITS: Pin = { id: "page:units", kind: "page", ref: "units", title: "Units overview" };

/** Everything the page reads; assembled by the App from its state. */
export interface UnitData { c: ContentInfo; cat: Catalog | null; battle: Json; bd: BreakdownResult | null; bdError: string | null; pp?: PpOverride }

/** `ref` is the pin ref: a hero's char id, or `squad:<leader id>` for a leader's squad. */
export interface UnitView { ref: string; kind: "hero" | "squad"; side: SideKey; name: string; cls: string; charId: string }

const unitPin = (v: UnitView): Pin => ({ id: `unit:${v.ref}`, kind: "unit", ref: v.ref, title: v.kind === "squad" ? `${v.name} (squad)` : v.name });

/** Both sides' units in battle order. Roster form lists every roster hero (the draft is applied by the server, not here). */
export function unitViews(c: ContentInfo, battle: Json): UnitView[] {
  const out: UnitView[] = [];
  if (!battle) return out;
  for (const side of SIDES) {
    const heroes = heroesOf(battle, side);
    for (const h of heroes) {
      const ch = c.characters.find((x) => x.id === h.char_id);
      out.push({ ref: h.char_id, kind: "hero", side, name: ch?.name ?? h.char_id, cls: ch?.class ?? "infantry", charId: h.char_id });
    }
    const leader = leaderOf(battle, side);
    const entry = heroes.find((h: Json) => h.char_id === leader);
    if (entry) {
      const st = c.soldiers.find((s) => s.id === entry.squad_id);
      out.push({ ref: `squad:${leader}`, kind: "squad", side, name: st?.name ?? entry.squad_id ?? "squad", cls: st?.class ?? "infantry", charId: leader! });
    }
  }
  return out;
}

/** Board row per unit ref, as the engine would place it; empty when the battle JSON is too broken to lay out. */
function rowMap(c: ContentInfo, battle: Json): Record<string, string> {
  const out: Record<string, string> = {};
  for (const side of SIDES) {
    try {
      for (const r of layoutSide(c, battle, side).rows) for (const cell of r.cells) if (cell) out[cell.kind === "squad" ? `squad:${cell.leaderId}` : cell.charId] = r.row;
    } catch { /* unplaceable battle: rows stay unknown */ }
  }
  return out;
}

/** Blessing tiers a hero entry unlocks: the engine's rule (src/devotion.ts, type-only imports so it is browser-safe) over the catalog's gods. */
function activeBlessings(cat: Catalog, entry: Json): { god: Catalog["gods"][number]; tier: 2 | 4 }[] {
  const pack: any = { byId: { gods: new Map(cat.gods.map((g) => [g.id, g])) } };
  return unlockedBlessings(pack, { equipment: entry.equipment ?? {}, sigils: entry.sigils });
}

const Section = ({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) => (
  <details open={open}><summary>{title}</summary>{children}</details>
);

function SoldierBlock({ cat, soldierId, row, deployed, full }: { cat: Catalog; soldierId: string; row: string; deployed: boolean; full: boolean }) {
  const tips = useTips();
  const st = cat.soldiers.find((s) => s.id === soldierId);
  if (!st) return <p className="muted">Soldier type {soldierId || "(none)"} is not in the catalog.</p>;
  return (
    <>
      <div className="kv">
        <span>type</span><span><Hint tip={tips.soldier(st.id)}>{st.name}</Hint> <span className="muted">{st.class}, {st.count} soldiers</span></span>
        <span>row</span><span>{row}{deployed ? "" : " (not deployed: only the leader's squad takes the field)"}</span>
      </div>
      {full && <p className="sub">{describeSoldier(st, cat).summary}</p>}
      {st.passive_effects.length > 0 && (
        <ul>
          {st.passive_effects.map((p, i) => {
            const d = describeSoldierSkill(p, cat);
            return <li key={i}><Hint tip={d}>{p.name ?? "Soldier skill"}</Hint> <span className="sub">{d.summary}</span></li>;
          })}
        </ul>
      )}
    </>
  );
}

function Terrain({ cat, battle, cls, roster }: { cat: Catalog; battle: Json; cls: string; roster: boolean }) {
  const id: string | null = (roster ? battle?.defender?.roster?.battlefield : battle?.battlefield) ?? null;
  const t = id ? cat.terrains.find((x) => x.id === id) : undefined;
  if (!id) return <p className="muted">No battlefield.</p>;
  if (!t) return <p className="muted">Battlefield {id} is not in the catalog.</p>;
  const mine = describeTerrain({ ...t, modifiers: t.modifiers.filter((m) => m.classes.includes(cls as never)), water: !!t.water && cls === "aquatic" }, cat);
  const none = t.modifiers.every((m) => !m.classes.includes(cls as never)) && !(t.water && cls === "aquatic");
  return (
    <p>
      <Hint tip={describeTerrain(t, cat)}>{t.name}</Hint>: {none ? <span className="muted">no modifiers for {cls}</span> : mine.summary}
    </p>
  );
}

export function UnitCard({ d, v, rows }: { d: UnitData; v: UnitView; rows: Record<string, string> }) {
  const { c, cat, battle } = d;
  const tips = useTips();
  const roster = isRosterForm(battle);
  const isHero = v.kind === "hero";
  const entry: Json = heroesOf(battle, v.side).find((h: Json) => h.char_id === v.charId);
  const ch = cat?.characters.find((x) => x.id === v.charId);
  const leader = leaderOf(battle, v.side) === v.charId;
  const bu = d.bd?.units.find((u) => (isHero ? u.id === v.charId : u.kind === "squad" && u.leader === v.charId));
  const row = rows[v.ref];
  const factions = (ch?.factions ?? []).map((f) => cat?.factions.find((x) => x.id === f)?.name ?? f);
  const sheet: Json[] = entry?.tactic_sheet ?? [];

  return (
    <article className={`unit ${v.side} ${v.kind}`} aria-label={`${v.name}, ${v.side}`}>
      <div className="unit-head">
        <Sprite cls={v.cls} name={v.name} mirror={v.side === "defender"} size={72} />
        <div className="id">
          <h3>{v.name}</h3>
          <div className="badges">
            <span className={`badge ${v.side}`}>{v.side}</span>
            <span className="badge">{isHero ? v.cls : `squad, ${v.cls}`}</span>
            {isHero && leader && <span className="badge leader">leader</span>}
            {row && <span className="badge">{row.replace(/_/g, " ")} row</span>}
            {factions.map((f) => <span key={f} className="badge">{f}</span>)}
          </div>
        </div>
        <PinButton pin={unitPin(v)} />
      </div>

      <Section title={`Stats (final, phase ${d.bd?.phase ?? "?"})`}>
        {bu ? <StatTable stats={bu.stats} defaultOpen={false} /> : (
          <>
            <p className="muted">{d.bdError ?? (d.bd ? `${v.name} is not fielded in this phase (banned in the draft?).` : "Breakdown not loaded yet.")}</p>
            {ch && <p className="sub">Base stats: {Object.entries(ch.base_stats).map(([k, x]) => `${k} ${x}`).join(", ")}</p>}
          </>
        )}
      </Section>

      {isHero && entry && (
        <Section title="Equipment and sigils">
          {cat ? (
            <>
              <div className="kv">
                {SLOTS.map(([slot]) => {
                  const itemId: string | null = entry.equipment?.[slot] ?? null;
                  const item = itemId ? cat.equipment.find((e) => e.id === itemId) : undefined;
                  const godId: string | null = entry.sigils?.[slot] ?? null;
                  const god = godId ? cat.gods.find((g) => g.id === godId) : undefined;
                  return (
                    <span key={slot} style={{ display: "contents" }}>
                      <span>{slot.replace("_", " ")}</span>
                      <span>
                        {itemId ? <Hint tip={tips.equipment(itemId)}>{item?.name ?? itemId}</Hint> : <span className="muted">empty</span>}
                        {item && <span className="sub"> {[describeEquipmentBase(item, cat), ...item.effects.map((e) => describeEffect(e, cat).summary)].join("; ")}</span>}
                        {godId && <> <span className="sub">sigil: </span><Hint tip={tips.god(godId)}>{god?.name ?? godId}</Hint>{!itemId && <span className="sub"> (inactive: empty slot)</span>}</>}
                      </span>
                    </span>
                  );
                })}
              </div>
              {(() => {
                const act = activeBlessings(cat, entry);
                return act.length === 0 ? <p className="sub">No blessing active.</p> : (
                  <ul>{act.map((a) => <li key={`${a.god.id}${a.tier}`}><Hint tip={describeBlessing(a.god, a.tier, cat)}>{a.god.blessing.name}</Hint> <span className="sub">{a.tier} {a.god.name} sigils: {describeBlessing(a.god, a.tier, cat).lines.join("; ")}</span></li>)}</ul>
                );
              })()}
            </>
          ) : <p className="muted">Catalog not loaded.</p>}
        </Section>
      )}

      {isHero && ch && cat && (
        <Section title="Skills">
          <p className="sub">
            PP pools: active {ch.pp.active}{d.pp?.active != null && <> (override {d.pp.active})</>}, passive {ch.pp.passive}{d.pp?.passive != null && <> (override {d.pp.passive})</>}
            {bu?.pp && <>; with gear: active {bu.pp.active}, passive {bu.pp.passive}</>}
          </p>
          {ch.skills.map((id) => {
            const s = cat.skills.find((x) => x.id === id);
            if (!s) return <div key={id} className="skill muted">{id} (not in the catalog)</div>;
            const t = sheet.find((x) => x.skill_id === id);
            const d2 = describeSkill(s, cat);
            return (
              <div key={id} className={`skill ${t?.enabled ? "" : "off"}`}>
                <b><Hint tip={d2}>{s.name}</Hint></b>{" "}
                <span className="badge">{s.category}</span>{" "}
                <span className="sub">{s.pp_cost} {s.pp_pool} PP{s.targeting.shape ? `, ${s.targeting.shape.replace(/_/g, " ")}` : ""}</span>{" "}
                <span className={`badge ${t?.enabled ? "leader" : ""}`}>{t ? (t.enabled ? `on sheet #${t.priority}` : "disabled on sheet") : "not on sheet"}</span>
                <ul>{d2.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            );
          })}
        </Section>
      )}

      {cat && (isHero ? !!entry : true) && (
        <Section title={isHero ? "Squad and soldier skills" : "Soldier type and skills"}>
          <SoldierBlock
            cat={cat} soldierId={entry?.squad_id ?? ""} row={rows[`squad:${v.charId}`] ?? entry?.squad_row ?? cat.soldiers.find((s) => s.id === entry?.squad_id)?.default_soldier_row ?? "?"}
            deployed={!isHero || leader} full={!isHero}
          />
        </Section>
      )}

      {isHero && ch && cat && (
        <Section title="Leader aura" open={leader}>
          <p>
            <Hint tip={describeAura(ch.leader_aura, cat)}>{ch.leader_aura.name}</Hint>{" "}
            <span className="sub">{leader ? "active while the leader lives" : "applies only if this hero leads"}</span>
          </p>
          <ul>{describeAura(ch.leader_aura, cat).lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Section>
      )}

      {cat && (
        <Section title="Terrain">
          <Terrain cat={cat} battle={battle} cls={v.cls} roster={roster} />
        </Section>
      )}
    </article>
  );
}

/** All cards, grouped by side. */
export function UnitList({ d }: { d: UnitData }) {
  const views = useMemo(() => unitViews(d.c, d.battle), [d.c, d.battle]);
  const rows = useMemo(() => rowMap(d.c, d.battle), [d.c, d.battle]);
  if (!d.battle) return <p className="muted">Open a battle file or start a new battle to see its units.</p>;
  return (
    <>
      {!d.cat && <p className="muted">The content catalog did not load: names, skills and hover text are unavailable.</p>}
      {SIDES.map((side) => (
        <section key={side} aria-label={`${side} units`}>
          <h2>{side}</h2>
          <div className="unitgrid">{views.filter((v) => v.side === side).map((v) => <UnitCard key={v.ref} d={d} v={v} rows={rows} />)}</div>
        </section>
      ))}
    </>
  );
}

/** A single card pinned by ref; says so when the unit is no longer in the battle. */
export function PinnedUnit({ d, ref_ }: { d: UnitData; ref_: string }) {
  const views = useMemo(() => unitViews(d.c, d.battle), [d.c, d.battle]);
  const rows = useMemo(() => rowMap(d.c, d.battle), [d.c, d.battle]);
  const v = views.find((x) => x.ref === ref_);
  return v ? <UnitCard d={d} v={v} rows={rows} /> : <p className="muted">{ref_} is not in the open battle.</p>;
}

export function UnitsPage({ d, phase, setPhase }: { d: UnitData; phase: number; setPhase: (p: number) => void }) {
  return (
    <div>
      <div className="pagehead">
        <h1>Units</h1>
        <PinButton pin={PIN_UNITS} />
        <label>phase
          <select value={phase} onChange={(e) => setPhase(Number(e.target.value))}>{[1, 2, 3].map((p) => <option key={p}>{p}</option>)}</select>
        </label>
        <span className="muted">stats after pre-battle, edits applied{isRosterForm(d.battle) ? "; roster form lists every roster hero (the draft is not applied here)" : ""}</span>
      </div>
      <UnitList d={d} />
    </div>
  );
}
