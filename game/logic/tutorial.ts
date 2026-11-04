// The guided first battle as data: narrator steps on the prep screen, captions during the replay, a note after the win. Text uses {tokens} filled
// from the real party and the pack, so it holds for any roll. `target` is a data-tut anchor (null = no spotlight). Pure: no DOM.
import { MAX_PHASES } from "../../src/engine";
import type { Pack } from "../../src/validate/pack";
import type { PoolHero } from "./party";
import type { Replay } from "./replay";

export type TutEvent = "hero_moved" | "hero_opened" | "tactics_opened" | "picker_opened" | "picker_closed" | "matchups_opened" | "matchups_closed" | "fight";

export interface TutStep {
  id: string;
  text: string;
  target: string | null;
  /** The real action that moves on; null shows a Next button. */
  wait: TutEvent | null;
  /** What the screen must have open (or closed) for this step to be reachable. */
  needs?: "panel" | "tactics" | "no_panel";
}

export const PREP_STEPS: TutStep[] = [
  { id: "goal", target: null, wait: null, needs: "no_panel", text: "Welcome, commander. You win by defeating every enemy hero; soldiers do not count. You never give orders mid-fight: you set the plan here, then watch it play out." },
  { id: "rows", target: "board-player", wait: "hero_moved", text: "This is your formation. Most attacks go for the nearest target, front row first, so sturdy heroes stand in front and fragile ones behind. Try it: drag a hero to another slot." },
  { id: "bench", target: "bench", wait: null, text: "Your pool sits here. Up to {fielded} heroes can fight, and the rest wait on the bench. All of yours are fielded for now, but one more joins after every win, so soon you will have to choose. The minus button benches a hero, and you can drag them back onto any slot." },
  { id: "enemy", target: "board-enemy", wait: null, needs: "no_panel", text: "This is {enemy}. You can always see who you are facing and where they stand, so plan against it." },
  { id: "open", target: "hero-first", wait: "hero_opened", needs: "no_panel", text: "Click {hero} to open their sheet." },
  { id: "sheet", target: "panel", wait: null, needs: "panel", text: "Stats, skills and gear live here. Once the tutorial is over, clicking outside or pressing Esc closes this sheet." },
  { id: "tactics", target: "tab-tactics", wait: "tactics_opened", needs: "panel", text: "Open Tactics. These are {hero}'s standing orders." },
  { id: "order", target: "tactics-list", wait: null, needs: "tactics", text: "On each turn a hero tries their orders from top to bottom and uses the first one that works. Use the arrows to reorder a card, and the toggle to switch it off." },
  { id: "main", target: "main-first", wait: "picker_opened", needs: "tactics", text: "Each order has two conditions. Main decides when the skill fires or who it goes for. Sub narrows it down or breaks ties. Open this Main slot." },
  { id: "picker", target: "picker", wait: "picker_closed", needs: "tactics", text: "Check means \"only if this is true\". Filter keeps matching targets and skips the skill if there are none. Prioritise only changes who goes first. Pick one, or close this to keep the skill's default." },
  { id: "pp", target: "pp", wait: null, needs: "tactics", text: "Skills cost PP. Heroes start each phase with {ppActive} Active PP for their own turns and {ppPassive} Passive PP for skills that trigger by themselves. Once a hero can't afford any active skill, they are spent for the phase." },
  { id: "leader", target: "leader", wait: null, needs: "no_panel", text: "{leader} leads your party. Only the leader's squad takes the field, here {soldierCount} {soldiers}, and the leader's aura helps the party. If the leader falls, the squad leaves and the aura ends, but the battle goes on." },
  { id: "matchups", target: "matchups", wait: "matchups_opened", needs: "no_panel", text: "Classes counter each other. Open the matchup chart." },
  { id: "matchups_read", target: "matchup-chart", wait: "matchups_closed", needs: "no_panel", text: "{advantage} Close the chart when you are done." },
  { id: "fight", target: "fight", wait: "fight", needs: "no_panel", text: "That's everything. Your plan is set, so press Fight!" },
];

export type CaptionId = "first_action" | "first_pp" | "first_squad" | "first_death" | "phase_change";

export const CAPTIONS: Record<CaptionId, string> = {
  first_action: "Units act in speed order: the higher the SPD, the sooner their turn comes. Watch the queue at the top.",
  first_pp: "That skill cost {spent} PP. The pips under a hero show what is left. When they run dry, that hero is done until the next phase.",
  first_squad: "Soldiers have no PP. Their squad attacks as one on its own schedule until the phase ends, and it dwindles as soldiers fall.",
  first_death: "A fallen hero stays down for the rest of the battle. Lose them all and the battle is lost.",
  phase_change: "Once nobody can act, the phase ends. HP and deaths carry over; PP refreshes and statuses clear. Up to {phases} phases are fought. If both sides still stand after the last, the side with the higher share of its HP left, soldiers included, wins.",
};

export const AFTER_WIN = "You're on your own now. A new hero is about to join, so next time you pick {fielded} of {pool}. Choose your line-up with the enemy in mind.";

export interface TutorialState { step: number; seenCaptions: boolean }

export const startTutorial = (): TutorialState => ({ step: 0, seenCaptions: false });
export const currentStep = (t: TutorialState | null): TutStep | null => (t ? PREP_STEPS[t.step] ?? null : null);

/** The state after a real player action: moves on when it is what the current step waits for. */
export function tutorialEvent(t: TutorialState | null, ev: TutEvent): TutorialState | null {
  const step = currentStep(t);
  return t && step?.wait === ev ? { ...t, step: t.step + 1 } : t;
}

/** The Next button. */
export const tutorialNext = (t: TutorialState): TutorialState => ({ ...t, step: t.step + 1 });

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** The class advantage rules in plain words, straight from rules.yaml. */
export function advantageText(pack: Pack): string {
  const { class_advantage: pairs, matchup } = pack.rules;
  const plain = pairs.filter((p) => p.damage_percent === undefined).map((p) => `${cap(p.attacker)} beats ${cap(p.defender)}`);
  const special = pairs.filter((p) => p.damage_percent !== undefined).map((p) => `${cap(p.attacker)} deals +${p.damage_percent}% to ${cap(p.defender)}`);
  return `${plain.join(", ")}: +${matchup.advantage_damage_percent}% damage and +${matchup.advantage_hit} to hit, and the losing side deals ${Math.abs(matchup.disadvantage_damage_percent)}% less. ${special.join(", ")}.`;
}

/** The hero the walkthrough talks about and points at: the first fielded one (the pool only as a fallback, the tutorial keeps someone fielded). */
export const tutorialHero = (pool: PoolHero[]): string => (pool.find((h) => h.slot) ?? pool[0]!).entry.char_id;

export interface TutContext { hero: string; leader: string; enemy: string; soldiers: string; soldierCount: number; fielded: number; pool: number }

export function tutorialContext(pack: Pack, pool: PoolHero[], leader: string | null, enemy: string): TutContext {
  const name = (id: string | null | undefined) => (id ? pack.byId.characters.get(id)?.name ?? id : "your leader");
  const lead = pool.find((h) => h.entry.char_id === leader) ?? pool[0];
  const soldier = lead ? pack.byId.soldiers.get(lead.entry.squad_id) : undefined;
  return {
    hero: name(tutorialHero(pool)), leader: name(leader), enemy, soldiers: soldier?.name ?? "soldiers", soldierCount: soldier?.count ?? 0,
    fielded: pack.rules.draft.fielded, pool: pool.length + 1,
  };
}

/** Fills {tokens} from the party and the pack. */
export function fillText(text: string, pack: Pack, ctx: TutContext, extra: Record<string, string | number> = {}): string {
  const vals: Record<string, string | number> = {
    ...ctx, ppActive: pack.rules.pp.base_active, ppPassive: pack.rules.pp.base_passive, phases: MAX_PHASES, advantage: advantageText(pack), ...extra,
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => String(vals[k] ?? m)).replace(/\s+/g, " ").trim();
}

export interface Caption { beat: number; id: CaptionId; spent: number }

/** Where the replay pauses, one caption per beat, in beat order. A battle without one of them (no second phase) just skips that caption. */
export function captionsFor(r: Replay): Caption[] {
  const out: Caption[] = [];
  const after = () => out.at(-1)?.beat ?? -1; // each caption gets its own beat
  const add = (id: CaptionId, test: (b: Replay["beats"][number]) => boolean) => {
    const b = r.beats.find((x) => x.index > after() && test(x));
    if (b) out.push({ beat: b.index, id, spent: b.spent });
  };
  const heroFell = (b: Replay["beats"][number]) => b.deaths.some((id) => r.units.find((u) => u.id === id)?.kind === "hero");
  add("first_action", (b) => b.kind === "action");
  add("first_pp", (b) => b.spent > 0);
  add("first_squad", (b) => b.squadHit);
  // These two come when they come, even before an earlier caption; a clash moves one a beat later, where its words still hold.
  const fell = r.beats.find(heroFell), turn = r.beats.find((b) => b.kind === "phase_end" && r.beats[b.index + 1]?.kind === "phase");
  if (fell) out.push({ beat: fell.index, id: "first_death", spent: 0 });
  if (turn) out.push({ beat: turn.index, id: "phase_change", spent: 0 });
  out.sort((a, b) => a.beat - b.beat);
  out.forEach((c, i) => { if (i > 0 && c.beat <= out[i - 1]!.beat) c.beat = out[i - 1]!.beat + 1; });
  return out.filter((c) => c.beat < r.beats.length);
}
