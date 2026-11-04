# Hero skills, heroes and races (proposal, 2026-11-04, designer answers in, not built)

Queue item 18. Mechanics are taken as ideas from the Langrisser Mobile skill lists (langrisser.fandom.com/wiki/Skills and its sub-pages). Names and wording are ours.
No number here has been simmed. Everything below is a starting value for `tools/balance-series.ts`.

## Rules used

- **Classes keep generic skills only.** A hero adds at most 4 unique skills on top. Heroes can share a unique skill, so a skill is hero-gated (`eligible.characters`), not one-hero-only.
- **Dropped from the reference:** anything that needs a map, such as movement, teleport, range, terrain painting, knockback and move-again. Also summons, transforms, stacking resources, cooldowns (we pay with PP) and fixed damage.
- **Price bands, from current content:**

| Cost | Single target | Row / column | Examples |
|---|---|---|---|
| 1 PP | x1.0-1.2 | none | Strike 1.0, Charging Assault 1.2 |
| 2 PP | x1.3-1.5 plus a rider | x0.7-1.1 | Rend 1.5 + Defense Down, Cleave 0.8 |
| 2 PP, hero top end | x1.8 with stun | x1.5 | Thousand Azure Hooves, Dark Dragon's Dirge |

The multiplier scales ATK before DEF is taken off, so a small multiplier step is a large damage step on high-DEF targets. New skills stay inside the bands.

## Proposed skills (12)

| Skill | Type | PP | Effect | Reference idea | Why it is fair here | Build |
|---|---|---|---|---|---|---|
| **Sundering Blow** | Active, single | 2 | x1.3, strips the target's buffs first | Annihilation | Lower multiplier than Rend pays for the strip. Official tier only | Ready |
| **Shieldbreaker** | Active, single | 1 | x1.0, target GUARD -30 until its next action | Blade Assault | Plain Strike damage; the value is setting up allies | Ready (new status) |
| **Blood Price** | Active, single | 2 | x1.7, caster loses 10% of current HP first | Blood-Boiling Charge | Above the band, paid in HP. Hurts under the HP% timeout rule (Decision 139), and it cannot kill the caster | New: self HP cost |
| **First Cut** | Active, single | 1 | x1.0, +50% damage if the target is at 100% HP | Back Stab | Strong once per target, then only a Strike | New: conditional damage bonus |
| **Skyfall Volley** | Active, row, ranged | 2 | x0.7, +50% vs Flyer | Arrow Rain | Volley with a counter-pick, no other gain | Ready |
| **Purify** | Active, single ally | 1 | Heal INT x1.2, removes 1 debuff | Heal | Weaker heal than Mend (x1.5), pays for the cleanse | New: remove debuff |
| **Mercy Bolt** | Active, single, magic | 1 | x0.8, then heals the lowest-HP% ally INT x0.6 | Faith | Lets a healer act when nobody needs a full heal. Well below Mend plus Bolt | New: heal lowest ally as a rider |
| **Sworn Banner** | Passive, pre-battle | 2 | Allies sharing a faction with the hero: ATK / INT +10% | Fusion Power | Rewards faction teams. Much smaller than the reference's +20-30% | Check: faction filter on a pre-battle `all` |
| **Bodyguard** | Passive, before hit | 1 | Takes a single-target physical hit aimed at an ally in the same row | Fearless Stance | Costs PP per cover. First content to use `cover` | Ready; no evade for the bodyguard (accepted) |
| **Thornhide** | Passive, after hit | 1 | While HP > 50%, a melee hit returns DEF x0.8 damage | Barb | About Counter's size, for tanks with low ATK; turns off when hurt | Ready |
| **Stand Fast** | Passive, while | 2 | While HP < 50%: DEF / MDEF +15% | Last Stand | Defensive twin of Berserk, same PP | Ready (new status) |
| **Unbroken** | Passive, pre-battle | 2 | Survives one fatal hit at 20% HP, once per battle | Heart of the Twin Moons | Fairy's Grace on self only, and it can be stripped. Official tier only | Ready |

Purify and Mercy Bolt are deliberately support-heavy: the healer team fell in the last series (handover 11a).

**Build:** 7 skills need content only (Sworn Banner may too). 4 need one small engine addition each.

## Proposed heroes

Existing heroes first. Six skills on them are gated by class today; they move to hero gating (answer 2).

| Hero | Class / race | Unique skills (max 4) | Added here |
|---|---|---|---|
| Leon | Cavalry, human | Charging Assault, Thousand Azure Hooves, Bodyguard | Bodyguard |
| The Emperor | Infantry, human | Dark Dragon's Dirge, Iron Fist, Hegemony, Sworn Banner | Sworn Banner |
| Jasmine | Holy, human | Last Chance, Preventative Care, Purify, Mercy Bolt | Purify, Mercy Bolt |
| Lief | Lancer, human | Vine Stab, Defensive Strike, Berserk, Thornhide | Thornhide |

New heroes, one for each class with no named hero and each non-human race. Stats are the generic class hero plus the race lean below.

| Hero | Class / race | Role | Unique skills |
|---|---|---|---|
| **Sylwen** | Archer, elf | Back-row anti-air and setup | Skyfall Volley, First Cut, Shieldbreaker |
| **Aurael** | Mage, angel | Battle healer, hard to remove | Mercy Bolt, Purify, Unbroken |
| **Vexis** | Flyer, demon | High-risk diver | Blood Price, Sundering Blow, First Cut |
| **Rikka** | Assassin, beastfolk | Opener on fresh targets | First Cut, Shieldbreaker, Blood Price |
| **Brunna** | Aquatic, dwarf | Front-row protector | Bodyguard, Thornhide, Stand Fast, Shieldbreaker |
| **Ashkarn** | Monster, dragon | Late-fight anchor | Sundering Blow, Unbroken, Thornhide, Stand Fast |

Overlap: every new skill sits on 1-3 heroes, so two heroes of one class still differ by kit, and a team can double up on a skill it likes.

## Proposed races

The race list follows `RACES` in the schema (human, elf, beastfolk, dwarf, dragon, demon, angel). Each race has a zero-sum stat lean (Decision 112: same total score, checked through `cost.stat_weights`) and one small trait.
Day and night answer the open call from Decision 136. A hero with no race bonus at a given time simply plays at base.

| Race | Stat lean | Benefit | Disadvantage |
|---|---|---|---|
| **Human** | None | No night or day penalty; steady in every battle | No peak: no stat or time bonus |
| **Elf** | SKL, EVA up; HP, DEF down | Night: EVA +5 | Fragile: lowest HP of the races |
| **Beastfolk** | SPD, ATK up; INT, MDEF down | Night: CRIT +5 | Weak to magic |
| **Dwarf** | HP, DEF, GUARD up; SPD, EVA down | Day: GUARD +5 | Acts late, so loses kill races |
| **Dragon** | HP, ATK up; EVA, SKL down | Day: DEF / MDEF +5% | Easy to hit, and rarely crits |
| **Demon** | ATK, INT up; DEF, MDEF down | Night: ATK / INT +10% | Day: DEF / MDEF -5% |
| **Angel** | INT, MDEF up; ATK, HP down | Day: heals done +10% | Night: ATK / INT -5% |

Humans stay exactly as they are, so all 14 current heroes and the balance baseline do not move. Only Demon and Angel swing both ways, to pay for the largest bonuses. Shift sizes are set when built, by keeping the score equal.

### Sub-races (designer 2026-11-04)

The schema's 7 races stay; a sub-race is an optional layer under one. The four below come from Decision 109's list. Other races have none for now. Sizes are set when built, and no number here has been simmed.

| Sub-race | Parent | Lean added to parent's | Time trait (replaces parent's) | Disadvantage |
|---|---|---|---|---|
| **High-Elf** | Elf | INT, MDEF up; ATK, CRIT down | Day: SKL +5 | Weak physical hits; gives up Elf's night EVA |
| **Dark-Elf** | Elf | ATK, CRIT up; INT, MDEF down | Night: EVA +5, CRIT +5 | Day: EVA -5 |
| **Werebeast** | Beastfolk | HP, ATK up; SPD, EVA down | Night: ATK +10% | Day: ATK -5%; loses Beastfolk's speed edge |
| **Rabbit-folk** | Beastfolk | SPD, EVA up; ATK, HP down | Night: EVA +5 | Fragile, with weak hits |

- **Same rules as races:** a sub-race keeps the equal score (Decision 112). As with Demon and Angel, only the ones with the largest bonuses swing both ways.
- **Plain parents stay valid:** an Elf with no sub-race plays as Elf. `race_is` and other race checks match the parent, so "race is Elf" hits High-Elves and Dark-Elves.
- **New heroes:** Sylwen becomes a Dark-Elf (an archer needs ATK, and High-Elf cuts it). Rikka becomes Rabbit-folk (speed suits an opener). High-Elf and Werebeast have no hero yet.

**Sub-race build:** `sub_race` on characters, a parent check in the validator (an error when it does not belong to the hero's race), a `sub_races` block next to `races` in `rules.yaml`, and a `sub_race_is` leaf with an editor preset. Applied in `state.ts` with the race lean.

**Build:** a `races` block in `rules.yaml` for stat leans and time effects, applied in `state.ts`. `race` on characters and `time_is` already exist. Racial soldier types and classes (Decision 112) are left out here.

## Designer answers (2026-11-04)

1. **Races:** keep the schema's 7 and add sub-races (section above). Taken as lifting Decision 112's hold on racial traits.
2. **Re-gating:** yes. Charging Assault, Thousand Azure Hooves, Last Chance, Preventative Care, Vine Stab and Defensive Strike move from class to hero.
3. **Hero count:** 6 new heroes.
4. **Names:** Hegemony is based on the reference skill and stays.
5. **Cover:** accepted, the bodyguard does not evade a covered hit.
6. **Sub-race targeting:** yes. Add a `sub_race_is` tactic leaf with a preset; `race_is` keeps matching the parent.
