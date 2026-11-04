# PP gear with downsides (proposal, 2026-11-04, not built)

Queue item 14. Gear that raises PP and carries a clear penalty. No number here has been simmed.

## Why it needs care

- Base PP is 3 / 3 with a max of 4, so +1 Active PP is a third more actions per phase.
- The PP sweep showed Active PP swings matchups hard: `city4v4-edit` went 95% at 3, 60% at 4 and 85% at 5.
- The cap means a second +1 item gives nothing, but its penalty still applies.
- Each item is an accessory unless noted, so it costs a slot that would otherwise hold stats.

## Proposed items

| Item | Slot / type | PP | Downside | Who wants it | Build |
|---|---|---|---|---|---|
| **Reckless Gauntlets** | Accessory, gloves | Active +1, Passive -1 | Fewer reactions: no Quick Guard or Counter to spare | Attackers | `pp_modifiers` only |
| **Vigil Charm** | Accessory, charm | Passive +1, Active -1 | One less skill per phase | Tanks and reaction builds | `pp_modifiers` only |
| **Bloodpact Ring** | Accessory, ring | Active +1 | Max HP -15% | Back-row damage dealers | `pp_modifiers` plus `modify_stat` |
| **Leaden Boots** | Accessory, boots | Active +1 | SPD -20% | Front-row bruisers: more actions, all of them later | `pp_modifiers` plus `modify_stat` |
| **Glass Amulet** | Accessory, amulet | Passive +1 | DEF / MDEF -15% | Counter and follow-up builds | `pp_modifiers` plus `modify_stat` |

The first two are pure trades: total PP stays at 6, so they are the safe starting point. The other three raise total PP to 7 and pay in stats.

## Questions for the designer

1. **Dragon Scale:** it gives +1 Active PP with no downside today, and only Leon and The Emperor can wear it. Keep it as their signature, or add a penalty to match?
2. **Stacking:** add a validator warning when a hero's PP gear goes past the cap, so a player doesn't pay a penalty for nothing?
3. **Cost:** should PP be priced in the cost weights? Do this in the item 5 balance pass, before any cost caps are set.
