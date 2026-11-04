# UI rating loop (queue item 22)

Scored 1-10 from real screenshots at 1280x720, as a strategy RPG player would (Final Fantasy Tactics, Langrisser Mobile, Unicorn Overlord, Etrian Odyssey). A score only rises on a visible change. Stops after 5 passes for the designer's review.

Screenshot note: the browser pane barely advances CSS animations, so finish them first (`document.getAnimations()`, `finish()` on the finite ones) or the title menu and narrator look missing.

| Category | P1 |
|---|---|
| Board readability | 6 |
| Tactics setup | 6 |
| Battle feedback | 6 |
| Information access | 6 |
| Menu flow | 7 |
| Art direction | 7 |
| Onboarding | 7 |

## Pass 1 (baseline, commit 236ae06)

- **Board readability:** in battle, units float on the backdrop with no ground or tiles, unlike prep. The squad name overlaps its bottom sprite row.
- **Tactics setup:** clear priority list and toggles, but the hero panel hides the whole enemy side while you set targets.
- **Battle feedback:** the motions read well, but nothing marks the target or says who did what unless the log is open. The skill tag stays behind when a melee unit lunges.
- **Information access:** the log covers your own back row. No way to inspect a unit during battle. Matchups sit behind a modal.
- **Menu flow:** short and clear: title, reveal, prep, fight, result.
- **Art direction:** strong title and reveal cards; the battle screen is the plainest of them, with an empty band at the bottom.
- **Onboarding:** the narrator explains the goal well, not re-scored in depth this pass.
