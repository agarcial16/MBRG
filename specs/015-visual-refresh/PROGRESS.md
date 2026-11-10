# PROGRESS 015 (visual refresh)

## Logic part (FR-427, FR-430 rule, FR-432, FR-433) - no browser
Changed
- FR-427: chip text is name + points ("Ana · 0 pts"), no "Tú:" and no rank; points show from the start (0 before any score). `chipParts(name, total)` drops the rank; `chipText` (accessible label) keeps `· puesto N` when known. Strings: `chipName` '{name}', `chipStats` ' · {total} pts', new `chipRank`.
- FR-432: `completeBoard(rows, roster)` in `core/results-model.ts` adds every joined player missing from the server rows with 0 points, orders by points, rank = 1 + players with more points (ties share the rank). `PlayState.lobby` (the lobby model) holds the roster: read once in `start()` of `ui/play-session.ts` (one extra `players` read, no polling) and updated by `player-joined` frames in `onFrame` (no request). Panel and Ranking tab share `PlayHud.board`, so both get it. Server untouched.
- FR-433: verified existing behaviour (own row 'name (tú)' via `boardYou`, pinned under the list, fallback row when unlisted); pinned by new tests.
- FR-430 (rule only): removed `border-top` of `.hud-predict` in `ui/live-panel-style.ts`. No scan pinned it before; added a test that the rule has no border.

Tests: red seen first (13 failing), then `npm test` 327 files / 5176 passed, 4 skipped; `npm run typecheck` clean.

Untested (no browser): how the chip and the longer board look; FR-422..426, 428, 429, 431 (CSS/visual) not started.
Next: the visual tasks, by someone with a browser (chip box height/centering FR-428/429 now has a shorter text, check ellipsis of name vs " · N pts").

## Visual part (FR-422..426, 428, 429, 431, NFR-84..87) - browser loop
Method: real server + `npm run dev`, Chrome via DevTools MCP at 1280x720, 1024x720, 390x844 (dpr 2, mobile). Edit -> reload -> screenshot -> read pixels/geometry with `evaluate_script` -> fix. Screens in `screens/` (`before-*` are the old look at 1280).
Changed
- `core/table.ts` (new, pure): wood tones, fade depth/stops/easing, `tableFade(camera, viewport, image)` (the image rect cut at viewport + depth, four eased gradient strips), panel colour, page css, `overBackdrop` for the contrast check. `core/terra.ts`: tile and `terraOffset` removed (asset `public/terra.webp` kept, not drawn). `ui/live-terra.ts`: bands in the ground tone + fade element + vignette; same unchanged-view guard (NFR-85).
- FR-423 first used a blurred `box-shadow` (prototype recipe): its Gaussian tail left 3-9 levels of map at the image edge (a faint rectangle, measured by pixel). Replaced by gradient strips that are exactly opaque at the edge. No map filter (FR-424: colours unchanged; the prototype's saturate .92 was not applied).
- FR-425/426: desk `.hud-frame` = `--hud-panel` (rgba 18,14,10 / .86) + blur(6px); the double gilt frame is now an inset 1px line + an `outline` at -5px (the old 4 px opaque ring would show through a translucent panel). Phone dock, top bar and minimap use the new token `--hud-dock` (#14100c, opaque), frame kept. Chip and seal: no fill, gilt outline and text; tokens `wax`/`onWax` removed.
- FR-428: desk bar `align-items:center`, no padding-top; count at `top:50%` with `translate(-50%,-50%)`; the lobby's `.hud-count{margin-top}` was pushing it (margin reset); `font:` shorthand after `line-height` had cancelled it. Phone grid `1fr auto 1fr` so the count is centred; chip ellipsis (desk `max-width: min(46vw, 50% - 90px)`, phone its own column).
- FR-429: chip has no min-height (box 19-20 px); touch area = invisible `::after` margin (>= 45 px on phone). `overflow:hidden` removed from the chip (it clipped the `::after`); the name span keeps the ellipsis.
- FR-431: `pageCss()` (html edge tone, body radial gradient, `body::before` vignette, z-index -1) is the first block of `PANEL_CSS`; `index.html` lost the flat `#bdb8aa` (inline: html `#0c0906`).
- FR-430 extension: the result block's top rule only shows when a prediction block is above it.
Scans changed because the new requirement replaces them: `terra.test` (texture tests removed), `live-hud-shell` (FR-368 layer scan now `tableFade`/`TABLE.ground`; FR-367 colour scan skips `pageCss()` which holds the table tones; FR-356 baseline -> centre), `hud-tokens` (wax pair -> gilt seal pair). New: `test/table.test.ts` (fade geometry, contrast AA over SEA, land grey, every palette colour and white, CSS rules).
Browser-verified: phase 1, phase 2, results, lobby, create, join at the 3 viewports; fade zoomed out and in (desk and phone), long name (desk 1024: chip left 666 vs count right 535; phone: chip 227 vs count 217, count centre 195 = bar centre), geometry centres (desk bar 58 px: round/phase/count/chip all cy 29; phone bar 50: count and chip cy 25), touch area by `elementFromPoint`.
Untested/left: no `before` phone screenshots (old CSS not re-run on the phone); the fade costs one repaint of a gradient element per camera move (no frame timing taken; the pane was visible but not profiled); the user's hand run; reduced-motion unchanged (no animation added).
