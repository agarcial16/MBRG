# Spec 040 — Faster map capture
Status: draft (waiting for approval)
Tier: Light SDD (performance of the viewer's capture mode, `apps/web`; a manual measuring script in `apps/bot/test/real/`; no server, protocol, sim or shared change, no map-format change, no new dependency). Depends on 032/037 (labels), 038 (capture). Ids: FR-740..FR-744, NFR-200..NFR-203 (039 holds FR-727..FR-734, NFR-192..NFR-196).

## Context and goal
Spec 038 left a capture of `world-countries` at 5.5-6.6 s (round image) and ~9-11 s (full map), and NFR-189 relaxed to 15 s. Goal: the round image, the one made every round, back to <= 5 s cold on `world-countries` and `world-1815`, with labels pixel-identical.

## Profile (dev machine, production-like build, SwiftShader; CPU profile of the page, 2026-11-26)
| phase | round image 1600x900 | full map 4096x2179 |
|---|---|---|
| Chrome start, page load | 0.2-0.4 s | 0.2-0.4 s |
| package decode + checks + indexes | ~0.5 s | ~0.5 s |
| label layout in `createMapView` | **~3.3 s** (factions 2.3, territories 1.0) | **~3.9 s** (factions 2.7, territories 1.1) |
| WebGL + label paint, screenshot | ~0.6 + 0.7 s | ~3 s native raster (grows with pixels) + 0.4 s |
| total | 5.4-6.5 s | 8-9.3 s |

The layout is a pure per-region function, and the capture draws ONE fixed camera, yet it lays out every faction twice (far and close tiers) and every territory of the world.

## Ideas evaluated
- **Camera-scoped layout (chosen).** Exact: lay out only what the fixed camera can draw. Below.
- Warm page between queued captures: the browser must close after 10 s idle (NFR-188, 0 MB idle) and rounds come >= 30 s apart, so the page is never warm in real use. Dropped.
- Layout precomputed at build time: needs a map-format change, and the faction half depends on the owners of every round (cannot be precomputed). Dropped.
- Persistent layout cache across captures (IndexedDB + persistent Chrome profile, or bot-held cache injected into the page): only the full map would gain (~2 s), at the price of stale-cache risk and a viewer/bot cache contract. Not now; a follow-up if the full map matters.
- Chrome flags, `optimizeForSpeed` PNG (measured: no gain), Web Workers (the bot host's core count is unknown). Dropped.

## Chosen approach: camera-scoped label layout
`resolveRoleGroup` already drops every candidate whose padded rectangle falls outside the view before it enters the overlap grid, so a region whose land does not meet the view can neither be drawn nor take a place from a drawn label. And `resolveFrameLabels` only reads the far tiers while the close-zoom blend is below 1 and the close tiers while it is above 0. A capture (fixed camera) therefore needs the layout of:
1. the regions whose land (bounding box of one of their pieces) meets the view widened by 32 px;
2. for each of them, the tier kind(s) the camera reads; the other kind only when the read kind came out empty (the draw's first tier comes from the other kind then, so the output stays the same).
The camera is built before the layout (it only needs the entry index).

## Functional requirements
- FR-740: WHILE drawing in capture mode, THE SYSTEM SHALL compute label tiers only for the territories and factions whose land meets the capture view widened by 32 px.
- FR-741: WHILE drawing in capture mode, THE SYSTEM SHALL compute the far faction tiers only when the close-zoom blend at the capture camera is below 1, and the close faction tiers only when it is above 0; IF the tiers of the kind it does read are empty, THEN it SHALL compute the other kind too.
- FR-742: THE SYSTEM SHALL produce the same capture image as before: for every frame kind and round tried (dev, `world-countries`, `world-1815`), the PNG with the scoped layout is byte-identical to the PNG without it.
- FR-743: Outside capture mode (debug scene, live scene, reveal tours, round steps) the layout SHALL be computed exactly as today (no scope).
- FR-744: A manual measuring script (`apps/bot/test/real/capture-perf.ts`) SHALL capture a chosen map N times with a cold browser each time and print time and peak browser memory (sum of working sets), for the before/after table.

## Non-functional requirements
- NFR-200: A cold round image (Chrome start included) of `world-countries` and `world-1815` takes <= 5 s on the dev machine (3 runs each, measured, recorded in PROGRESS). Prototype: 2.3-2.9 s.
- NFR-201: Full-map capture of `world-countries` does not get slower; target and cap in the decision below.
- NFR-202: Peak browser memory <= 1 GB and 0 MB idle, as in NFR-188 (measured, recorded).
- NFR-203: Determinism as NFR-190; the layout functions stay pure (`core/`: no DOM, clock or randomness).

## Expected gains (prototype, measured; images byte-identical in all 7 cases tried)
| capture | before | after |
|---|---|---|
| world-countries round image (rounds 1, 2, 3) | 5.4-6.5 s | 2.3-2.9 s |
| world-1815 round image | 7.0 s | 2.9 s |
| dev round image | 3.6 s | 2.7 s |
| world-countries full map 4096x2179 (rounds 0, 3) | 9.2-9.4 s | 6.5-6.9 s |
| world-1815 full map 4096x4096 | 13.5 s | 11.1 s |

The full map stays above 5 s because ~3 s of it is software rasterisation of ~9 M pixels (grows with the image), not labels.

## Decision for the user (full map)
- A (recommended): ship as is. Full map keeps 4096 px: ~6.5-7 s on `world-countries`, ~11 s on `world-1815`; NFR-189 stays <= 15 s for the full map and the 5 s goal covers the round image.
- B: also cap the full map's longer side at 2048 px (changes FR-723's 4096): `world-countries` full map ~3-4 s. Costs legibility of small labels when the image is opened at full size.

## Out of scope
- Persistent layout cache, faster layout algorithms (`centredInLand`), changes to what labels look like (spec 039 owns appearance and the round framing).

## Done criteria
- FR/NFR traced to tests: scoped vs full layout give the same `resolveFrameLabels` result on `maps/dev` and `maps/world-countries` for several cameras (round-like and full); the scope helpers (region test, far/close flags, empty-kind fallback) unit-tested; capture-main sets the scope.
- Real before/after captures byte-compared; 3 runs each of time and peak memory for `world-countries` and `world-1815` in PROGRESS; `npm test` and `npm run typecheck` green.
- Spec `Status: implemented` and archived; `MEMORY.md`, `docs/board.md`, `docs/lessons/web.md` and `bot.md` updated.

## Open questions
- Full-map option A or B (above).
