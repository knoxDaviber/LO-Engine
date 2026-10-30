# Conversion Report v4

Validator: **0 errors, 2 warnings** (the soldier types still have small blanks). Everything you answered is applied.

## Applied this round

| Area | Result |
|---|---|
| Heavy Cavalry | HP 40, ATK 30, INT 10, DEF 30, MDEF 10, SPD 50, CRIT 15, GUARD 0, EVA 10. HIT 60 and SKL 30 were not given, so they stay at Heavy Infantry's values. |
| Soldier rows | Both types may stand in the first or last board row (`allowed_soldier_rows: [front, back]`). The player picks one per squad; `squad_row` is **optional** and falls back to the soldier type's `default_soldier_row`; the resolved row must be in `allowed_soldier_rows`. |
| Soldier class | Heavy Infantry is infantry, Heavy Cavalry is cavalry, so class matchups apply to squads too (decided, see below). |
| Leader debuffs | Stat buffs **and debuffs** on the leader also apply to the leader's squad. |
| Squads and column skills | Superseded: each soldier has its own HP; a column skill hits every living soldier of the squad separately (design doc Decisions 42, 43, 61). |
| Stun | Superseded: pushback. Delays the target's pending action by a fixed number of timeline counts (`rules.yaml` constant, value TBD); no action or PP lost (design doc Section 6, Decision 48). |
| Class advantage | Now applied to power x multiplier **before** defense is subtracted. |

## Corrected example (cavalry beats infantry)

A bare Leon attacking a Dragon-Scale Emperor (DEF 50 + 50 = 100):

| Skill | Without class advantage | With cavalry > infantry (+25%) |
|---|---|---|
| Charging Assault (70 x 1.2) | 1 | **5** |
| Thousand Azure Hooves (70 x 1.8) | 26 | **57** |

If the Emperor is also his party's leader (Empire's Dominion makes his DEF 120), those become 1 and 37. So the Emperor with Dragon Scale still walls Leon's Charging Assault, but not his signature skill.

## Open items

1. **Class advantage before defense.** Resolved: kept (applies before DEF).
2. **Stun in clock time.** Resolved: stun is a pushback of the target's pending action by a fixed number of timeline counts (`rules.yaml` constant, value TBD), no action or PP lost. This replaces the earlier SPD-scaled sqrt/linear curve and the clamp-formula delay recorded in earlier versions of this report.
3. **Which leader statuses reach the squad.** Resolved: stat modifiers only; death intercepts, Regen and control statuses stay on the leader.
4. **Soldier class.** Resolved: soldier types keep their class.
5. **Jasmine's aura cost adjustment** (+10): DEFERRED to gauntlet calibration.
