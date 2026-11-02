// Groups the rendered sim log (renderLog text, src/engine/log.ts) into phases and actions. Text parsing is the reliable boundary here: an
// action starts at a tagged line with a single space after the tag (`[p1 t=  25] Lief acts`, `... X attacks (10 soldiers)`, `... X cannot act (..)`;
// an idle action is `... X idles` with the usual indent); all other tagged lines are indented details of the current action. Pure: no DOM.

export interface LogAction {
  id: string;
  phase: number;
  t: number;
  unit: string;
  side: string | null; // "challenger" | "defender" from battle_setup, null when the unit is unknown
  kind: "acts" | "attacks" | "prevented" | "idle";
  title: string; // "t=25 Lief acts"
  summary: string; // the "uses X on Y" line of a hero action, "" otherwise
  lines: string[]; // every line of the action, the first one included
}
export interface LogPhase { phase: number; title: string; intro: string[]; actions: LogAction[]; footer: string | null }
export interface LogGroups {
  header: string[]; // draft and battle setup lines before the first phase
  phases: LogPhase[];
  banner: string | null; // "=== Battle over: ..." without the === marks
  sides: Record<string, string>; // unit name -> side
}

interface LogLike { log: string; events: { type: string; [k: string]: unknown }[] }

const TAG = /^\[p(\d+) t=\s*(\d+)\] (.*)$/;

/** Unit name -> side, from the battle_setup event (heroes and squads). */
export function sidesOf(events: LogLike["events"]): Record<string, string> {
  const out: Record<string, string> = {};
  const setup = events.find((e) => e.type === "battle_setup") as { units?: { name: string; side: string }[]; squads?: { name: string; side: string }[] } | undefined;
  for (const u of [...(setup?.units ?? []), ...(setup?.squads ?? [])]) out[u.name] = u.side;
  return out;
}

function starter(rest: string): { unit: string; kind: LogAction["kind"] } | null {
  let m: RegExpExecArray | null;
  if (!rest.startsWith(" ")) {
    if ((m = /^(.+) acts$/.exec(rest))) return { unit: m[1]!, kind: "acts" };
    if ((m = /^(.+) attacks \(\d+ soldiers\)$/.exec(rest))) return { unit: m[1]!, kind: "attacks" };
    if ((m = /^(.+) cannot act \(.*\)$/.exec(rest))) return { unit: m[1]!, kind: "prevented" };
    return null;
  }
  if ((m = /^ +(.+) idles$/.exec(rest))) return { unit: m[1]!, kind: "idle" };
  return null;
}

export function groupLog(result: LogLike): LogGroups {
  const sides = sidesOf(result.events);
  const g: LogGroups = { header: [], phases: [], banner: null, sides };
  let phase: LogPhase | null = null;
  let action: LogAction | null = null;
  let n = 0;
  for (const line of result.log.split("\n")) {
    if (line.trim() === "") continue;
    const ph = /^=== Phase (\d+) /.exec(line);
    if (ph) {
      phase = { phase: Number(ph[1]), title: line.replace(/^=== | ===$/g, ""), intro: [], actions: [], footer: null };
      g.phases.push(phase);
      action = null;
      continue;
    }
    if (line.startsWith("=== Battle over")) { g.banner = line.replace(/^=== | ===$/g, ""); action = null; continue; }
    if (line.startsWith("--- Phase")) {
      if (phase) phase.footer = line.replace(/^--- /, "");
      action = null;
      continue;
    }
    const tag = TAG.exec(line);
    if (tag && phase) {
      const s = starter(tag[3]!);
      if (s) {
        action = {
          id: `p${phase.phase}-a${n++}`, phase: phase.phase, t: Number(tag[2]), unit: s.unit, side: sides[s.unit] ?? null, kind: s.kind,
          title: `t=${tag[2]} ${tag[3]!.trim()}`, summary: "", lines: [],
        };
        phase.actions.push(action);
      }
      if (action) {
        action.lines.push(line);
        if (!action.summary && / uses .+ on /.test(tag[3]!)) action.summary = tag[3]!.trim();
      } else phase.intro.push(line);
      continue;
    }
    // untagged line: draft/setup before the first phase, the phase's roster lines afterwards
    if (phase) (action ? action.lines : phase.intro).push(line);
    else g.header.push(line);
  }
  return g;
}

/** Unit filter: an action stays when any of its lines names the unit (same rule as the old plain log). */
export const actionMatches = (a: LogAction, unit: string): boolean => !unit || a.lines.some((l) => l.includes(unit));
