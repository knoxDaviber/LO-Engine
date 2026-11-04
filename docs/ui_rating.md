# UI rating loop (queue item 22)

Scored 1-10 from real screenshots at 1280x720, as a strategy RPG player would (Final Fantasy Tactics, Langrisser Mobile, Unicorn Overlord, Etrian Odyssey). A score only rises on a visible change. Stops after 5 passes for the designer's review.

Screenshot note: the browser pane barely advances CSS animations, so finish them first (`document.getAnimations()`, `finish()` on the finite ones) or the title menu and narrator look missing.

| Category | P1 | P2 | P3 |
|---|---|---|---|
| Board readability | 6 | 8 | 8 |
| Tactics setup | 6 | 6 | 8 |
| Battle feedback | 6 | 8 | 8 |
| Information access | 6 | 7 | 8 |
| Menu flow | 7 | 7 | 7 |
| Art direction | 7 | 9 | 9 |
| Onboarding | 7 | 7 | 7 |

## Pass 1 (baseline, commit 236ae06)

- **Board readability:** in battle, units float on the backdrop with no ground or tiles, unlike prep. The squad name overlaps its bottom sprite row.
- **Tactics setup:** clear priority list and toggles, but the hero panel hides the whole enemy side while you set targets.
- **Battle feedback:** the motions read well, but nothing marks the target or says who did what unless the log is open. The skill tag stays behind when a melee unit lunges.
- **Information access:** the log covers your own back row. No way to inspect a unit during battle. Matchups sit behind a modal.
- **Menu flow:** short and clear: title, reveal, prep, fight, result.
- **Art direction:** strong title and reveal cards; the battle screen is the plainest of them, with an empty band at the bottom.
- **Onboarding:** the narrator explains the goal well, not re-scored in depth this pass.

## Pass 2 (battle screen pass plus the designer's painted art, tiles and music)

- **Board readability (6 to 8):** units stand on terrain tiles and rows are clear. The top row still sits above the painted ground line, and the tiles are a stand-in until sprites can stand on the art.
- **Battle feedback (6 to 8):** target rings, action caption and a skill tag that follows the unit.
- **Information access (6 to 7):** the log no longer covers heroes. Still no unit inspection during battle.
- **Art direction (7 to 9):** painted scenes per stage, matching tiles, music. Bright scenes need the dim overlay to keep text readable.
- **Tactics setup, Menu flow, Onboarding:** no visible change, so no score change. The hero panel still hides the enemy side.

## Pass 3 (Facing strip, unit inspection)

- **Tactics setup (6 to 8):** the Tactics tab now lists who you face, with matchup tags, so the panel no longer hides the enemy. The strip has no visible heading yet, and "Nearest / None" still reads like raw data.
- **Information access (7 to 8):** click any unit in battle for a live card with HP, PP and statuses.
- **Others:** no visible change, so no score change.
