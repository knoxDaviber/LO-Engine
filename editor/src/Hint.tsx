// Hover/focus explanations. All wording comes from the shared formatter (describe.ts); this file only shows it. `CatalogProvider` makes the
// catalog reachable everywhere without prop drilling, `useTips()` returns Described-by-id lookups for the common content kinds.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConditionNode } from "../../src/schema";
import type { Catalog } from "../apiTypes";
import {
  describeAura, describeBlessing, describeCondition, describeEquipment, describeSkill, describeSoldier, describeSoldierSkill, describeStatus, describeTerrain,
  text, type Described,
} from "./describe";

const CatalogCtx = createContext<Catalog | null>(null);
export function CatalogProvider({ catalog, children }: { catalog: Catalog | null; children: ReactNode }) {
  return <CatalogCtx.Provider value={catalog}>{children}</CatalogCtx.Provider>;
}
export const useCatalog = (): Catalog | null => useContext(CatalogCtx);

type Tip = Described | string | null | undefined;
const asDescribed = (t: Tip): Described | null => (!t ? null : typeof t === "string" ? { summary: t, lines: [] } : t);

/** `title` text for places that cannot host a rich tooltip (<option>). */
export const titleOf = (t: Tip): string | undefined => {
  const d = asDescribed(t);
  return d ? text(d) : undefined;
};

/** Looks content up by id in the catalog and describes it; undefined when the id is unknown or there is no catalog. */
export function useTips() {
  const cat = useCatalog();
  return useMemo(() => {
    const by = <T extends { id: string }>(list: T[] | undefined, id: string | null | undefined) => (id ? list?.find((x) => x.id === id) : undefined);
    return {
      cat,
      skill: (id: string | null | undefined) => { const s = by(cat?.skills, id); return cat && s ? describeSkill(s, cat) : undefined; },
      equipment: (id: string | null | undefined) => { const s = by(cat?.equipment, id); return cat && s ? describeEquipment(s, cat) : undefined; },
      status: (id: string | null | undefined) => { const s = by(cat?.statuses, id); return cat && s ? describeStatus(s, cat) : undefined; },
      soldier: (id: string | null | undefined) => { const s = by(cat?.soldiers, id); return cat && s ? describeSoldier(s, cat) : undefined; },
      terrain: (id: string | null | undefined) => { const s = by(cat?.terrains, id); return cat && s ? describeTerrain(s, cat) : undefined; },
      /** A god's sigil: both blessing tiers (2 sigils, 4 sigils). */
      god: (id: string | null | undefined): Described | undefined => {
        const g = by(cat?.gods, id);
        if (!cat || !g) return undefined;
        const two = describeBlessing(g, 2, cat);
        const four = describeBlessing(g, 4, cat);
        return { summary: two.summary, lines: [four.summary] };
      },
      condition: (node: unknown) => (cat && node ? describeCondition(node as ConditionNode, cat) : undefined),
      aura: (a: Parameters<typeof describeAura>[0]) => (cat ? describeAura(a, cat) : undefined),
      soldierSkill: (p: Parameters<typeof describeSoldierSkill>[0]) => (cat ? describeSoldierSkill(p, cat) : undefined),
    };
  }, [cat]);
}

function TipBody({ d }: { d: Described }) {
  return (
    <>
      <b>{d.summary}</b>
      {d.lines.map((l, i) => <span key={i} className="l">{l}</span>)}
    </>
  );
}

/** Dotted-underline wrapper. Shows on hover and keyboard focus, Escape closes it, and it is kept inside the viewport. No tip = plain children. */
export function Hint({ tip, children }: { tip: Tip; children: ReactNode }) {
  const d = asDescribed(tip);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = () => {
    if (!anchor.current || !box.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    const m = 8;
    const left = Math.max(m, Math.min(a.left, window.innerWidth - b.width - m));
    const below = a.bottom + 4;
    const top = below + b.height + m > window.innerHeight && a.top - b.height - 4 > m ? a.top - b.height - 4 : Math.max(m, Math.min(below, window.innerHeight - b.height - m));
    setPos({ left, top });
  };
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  useEffect(() => { if (!d) setOpen(false); }, [d]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (!d) return <>{children}</>;
  return (
    <span
      ref={anchor} className="hint" tabIndex={0} aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span ref={box} id={id} role="tooltip" className="hint-tip" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}>
          <TipBody d={d} />
        </span>
      )}
    </span>
  );
}

/** A small "?" that explains an item next to a control that cannot host a tooltip itself (a <select>). Renders nothing without a tip. */
export function Info({ tip }: { tip: Tip }) {
  return asDescribed(tip) ? <Hint tip={tip}><span className="qmark" aria-label="what does this do?">?</span></Hint> : null;
}
