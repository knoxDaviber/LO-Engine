# PP gear with downsides (proposal, 2026-11-04, revised after designer review, not built)

Queue item 14. Gear that moves PP and carries harsh trade-offs, so each item suits one kind of user and hurts everyone else. No number here has been simmed; they are starting values for `tools/balance-series.ts`.

## Rules (designer 2026-11-04)

- **Harsh on purpose.** An item takes 1 PP from the other pool, cuts stats, and pays back with stat ups aimed at its one user.
- **No babysitting.** Items stack, with no validator warning. A wasted penalty is the player's mistake.
- **PP is priced.** PP goes into the cost weights, heavier than stats (item 5).
- **3 and 4 PP skills are coming.** Base Active is 3 and the max is 4, so a 4 PP skill will need a +1 item, and Vigil Charm or Glass Amulet (Active 2) will lock a hero out of 3 PP skills. That makes these items build decisions, not just stat choices.

## Accessories

| Item | Type | PP | Stat ups | Stat downs | Who wants it |
|---|---|---|---|---|---|
| **Reckless Gauntlets** | gloves | Active +1, Passive -1 | ATK +15% | DEF / MDEF -20% | Melee attackers who never plan to react |
| **Bloodpact Ring** | ring | Active +1, Passive -1 | INT +20% | Max HP -25% | Back-row mages kept out of reach |
| **Leaden Boots** | boots | Active +1, Passive -1 | ATK +10%, DEF +15% | SPD -30%, EVA -30% | Front-row bruisers: more actions, all of them late |
| **Vigil Charm** | charm | Passive +1, Active -1 | DEF / MDEF +20% | ATK / INT -20% | Reaction tanks |
| **Glass Amulet** | amulet | Passive +1, Active -1 | ATK +15% | DEF / MDEF -25% | Counter and follow-up builds |

Items that raise Passive pay with Active, since -1 Passive would cancel them. Total PP stays at 6 on all five, so the extra PP is always a shift, never a gain. All set `duplicate_allowed_in_both_accessory_slots: true`.

## Dragon Scale (armor, Leon and The Emperor)

Today: Active +1 with no downside. Revised to a tank-only item:

| PP | Stat ups | Stat downs |
|---|---|---|
| Active +1, Passive unchanged | DEF / MDEF +20% | SPD -40% (on top of heavy armor's -5), EVA -50%, ATK / INT -10% |

Passive stays at 3 because a tank needs its reactions; it pays in speed instead. On Leon it costs the cavalry role, which is the intent.

## Stacking

- PP adds up, then caps at `rules.pp.max`. Two Reckless Gauntlets give Active 4 (not 5) and Passive 1.
- Type base stats add. Percent lines do not: Section 9.1 keeps only the strongest equipment line per stat, so two Gauntlets give ATK +15% and DEF -20%, once.

## Build

- `pp_modifiers` and `modify_stat` percent lines cover everything except Bloodpact Ring.
- **Bloodpact Ring needs one engine change:** `state.ts` counts only blessing HP percent lines towards Max HP, so a gear line must be added there. Without it the item has no HP penalty.
- PP pricing lands in item 5: `heroCost` ignores `pp_modifiers` today. Add `rules.cost.pp_weights` (Active above Passive), each point above any stat line.

## Open question

Should percent lines from stacked PP gear add up, as an exception to Section 9.1? This draft keeps 9.1, so stacking two items adds PP changes but not the percent stats.
