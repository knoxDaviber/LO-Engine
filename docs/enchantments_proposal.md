# Enchantment proposal (awaiting designer approval, 2026-11-04)

Critique pass over all 14 two-sided blessings (handover queue item 3). Nothing here is built or simmed; values are starting
points for the batch sim. 2-pieces stay as the designer gave them. A hero has 4 sigil slots, so one 4-piece enchantment per hero.

## Problems found

1. **Four of the 14 used the same "HP > 80%" gate** (Full Moon both sides, Breeze both sides). Heroes behind a squad or in the
   back row keep that up almost all battle, so it plays as a flat buff. Give that identity to Full Moon only.
2. **Rush ATK is close to dead.** Ignoring GUARD does little when guard chance is often near 0 (0.5% in the sample log, 20.5% on
   City infantry). Its old version also had ATK/INT +30%.
3. **Rush DEF rarely fires.** HIT 100 against EVA 10-40 is a 70-100% hit chance (`hit_min` 70), so dodges are uncommon on most heroes.
4. **Plate ATK is undefined.** Every unit has a GUARD stat, so "+20% vs enemies with GUARD" is always on.
5. **Breeze DEF "+20% EVA" is unclear.** EVA is a rate stat, and it overlaps Rush, which owns EVA.
6. **Gift DEF gets stronger with the HP% timeout tiebreak.** Healing 30% on a front-line tank hit by 3-4 enemies per phase invites turtling.
7. **Gift ATK needs a definition of "kill".** If soldiers count, it fires constantly on squads.
8. **Meteor DEF is a pure counter-pick.** Worthless against low-crit teams, so -30% is too small to be worth choosing.

## Proposed list

| God | 2-piece | DEF enchantment | ATK enchantment | Status |
|---|---|---|---|---|
| Mirror | HP +20% | Reflect 30% of single-target damage taken | Retaliate: after being attacked, next attack +30% (one charge, does not stack) | Both kept |
| Full Moon | DEF/MDEF +10% | HP > 80%: DEF/MDEF +20% | HP > 80%: ATK/INT +20% | Both kept |
| Plate | GUARD +10 | Damage taken -10% | **Sunder:** attacks ignore 20% of the target's DEF/MDEF | ATK changed |
| Gift | HP +20% | When attacked, 50% chance to heal **20%** max HP after the attack (once per enemy action) | **On a hero kill or squad wipe, heal the lowest-HP ally 20%** (self included) | Both changed |
| Breeze | ATK/INT +10% | **Sidestep:** the first single-target hit each phase deals 50% less | **Second Wind:** HP < 50%: SPD +30% | Both changed |
| Meteor | CRIT +10 | Crit damage taken **-50%** | Crit damage +30% | DEF changed |
| Rush | EVA +10 | **EVA +15**; after a dodge, counter for **75%** ATK | Single-target attacks ignore GUARD and **deal +15% damage** | Both changed |

## Why these

- **Sunder** gives a real answer to high-DEF walls and summed squad DEF, strong against tanks and weak against everything else.
- **Sidestep** directly answers the back-row assassin one-shot seen in city4v4 and draft_city.
- **Second Wind** is the opposite of Full Moon: one rewards staying healthy, the other rewards being in danger.
- **Gift ATK** on an ally keeps the god's generosity theme and helps a team instead of a single carry.

## Watch in the sim

Sunder against full squads; Sidestep plus Mirror on back-row heroes; Gift DEF on anchors now that timeouts use HP%; Second Wind
snowballing with lifesteal or heals.

Later, as before: soldier effects, AP/PP refunds, extra gods (Clock, Crystal, Ice, Tree of Life). The sigil choice must record the
side (schema change).
