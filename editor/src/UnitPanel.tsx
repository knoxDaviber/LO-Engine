// Info panel for the selected hero (any page): the unit card (portrait, stats, gear, skills, squad, aura) plus its tactic sheet to edit.
import { useEffect, useRef } from "react";
import type { Json } from "./model";
import { heroesOf, heroesPath, SIDES } from "./model";
import { TacticsBoard } from "./Tactics";
import { PinnedUnit, type UnitData } from "./Units";

export function UnitPanel({ d, id, edit, close }: { d: UnitData; id: string; edit: (fn: (b: Json) => void) => void; close: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    return () => { document.querySelector<HTMLElement>(`[data-card="hero:${id}"]`)?.focus(); };
  }, [id]);
  const side = SIDES.find((s) => heroesOf(d.battle, s).some((h: Json) => h.char_id === id));
  if (!side) return null;
  const index = heroesOf(d.battle, side).findIndex((h: Json) => h.char_id === id);
  const hero = heroesOf(d.battle, side)[index];
  const ch = d.c.characters.find((x) => x.id === id);
  return (
    <aside ref={ref} className="unitpanel" role="dialog" aria-label="Selected hero" tabIndex={-1}>
      <button type="button" className="small right" onClick={close} aria-label="Close hero info">close (Esc)</button>
      <PinnedUnit d={d} ref_={id} />
      <h3>Tactics (what this hero does, in priority order)</h3>
      <TacticsBoard c={d.c} hero={ch} sheet={hero.tactic_sheet ?? []} path={`${heroesPath(d.battle, side)}[${index}].tactic_sheet`}
        edit={(fn) => edit((b) => { const h = heroesOf(b, side)[index]; if (h) fn((h.tactic_sheet ??= [])); })} />
    </aside>
  );
}
