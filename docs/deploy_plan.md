# Plan: deploying the game page

Status: plan only, nothing changed yet. Today `.github/workflows/pages.yml` deploys only the editor, on every push to main, after typecheck and tests.

## Shape

A repo has one GitHub Pages site, so both builds go into one artifact:

| Page | URL |
|---|---|
| Editor (unchanged) | `https://knoxdaviber.github.io/LO-Engine/` |
| Game (new) | `https://knoxdaviber.github.io/LO-Engine/game/` |

The editor keeps its link for now. Once the game is the main thing, the two can swap, so the game sits at the root and the editor at `/editor/`. That is a designer call.

The game needs no code change for this: `game/vite.config.ts` has `base: "./"`, so its assets and `sprites/` resolve from any folder. The build is about 14MB, well inside Pages limits, and the music is committed, so CI has it.

## Steps

1. **Check the build locally first** (never done, still open from item 21): build, serve `game/dist` from a subfolder, and play a full run. Look for missing sprites, art or music, and console errors.
2. **Change `pages.yml`:** after `npm run editor:build`, add `npm run game:build` and `cp -r game/dist editor/dist/game`. Keep `path: editor/dist`, and rename the workflow to "Deploy editor and game to GitHub Pages".
3. **Namespace the mute key:** `muted` in `game/src/music.tsx` becomes `lo-muted`. All of `knoxdaviber.github.io` shares one localStorage, so a bare key can clash with other projects and the editor.
4. **Link the pages:** optional, a small "Play the game" link in the editor. Skip it if the game should stay unlisted for now.
5. **Push** (designer does this, or says to), then check the Actions run and open `/game/` on the live URL: a full run, music, mute, and a reload.

Rollback: revert the workflow commit and push. The editor deploy is unaffected.

## Decisions for the designer

- **Public release:** Pages sites are public, so anyone with the link can play, and the art and music can be downloaded. Is that fine now? The repo's visibility and the Pages plan decide whether this can be restricted.
- **Name:** the page would ship with the placeholder title "Vanguard Tactics" (`GAME_TITLE`).
- **URL:** game at `/game/` as above, or game at the root now?

## Not in this plan

Custom domain, a separate game repo, saves, analytics, and a mobile layout (the game is built for 1280x720).
