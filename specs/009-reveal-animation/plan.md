# Plan 009 — Reveal animation (victim and absorber tours)
**Status: approved by the user on 2026-10-25, with `tasks.md` and the spec amendments A1, A2, A3, A5, A6, A7 (recorded in `spec.md` as D11 to D16); A4 and A8 to A13 and PD1 to PD16 approved with the plan.**

Spec: `specs/009-reveal-animation/spec.md` (approved by the user on 2026-10-21). Covers FR-316 to FR-355 and NFR-58 to NFR-64 (47 ids). Depends on spec 008 (implemented, accepted by the user on 2026-10-25). Delivery in five milestones (section 14), each with its own `feat/009-...` branch cut from an up-to-date `rewrite`, one PR into `rewrite`, squash merge with the user's OK and CI green.

## 0. Gate
- Spec amendments A1 to A7 (section 16) change requirement text: they need the user's approval and go into `spec.md` first (spec -> plan -> tasks -> code). Until then the plan follows the recommended reading and marks each place.
- Plan decisions PD1 to PD16 (section 15) and the pins of section 4 (hash, generator, rounding) are approved with the plan.
- No "ask first" item is triggered: no new dependency, no change to the map format, the presentation data, the id image, `MatchState`, `RoundRecord`, the sim, shared, protocol or the server (`apps/server/src` unchanged; only `apps/server/test` gains a proof file in M5).

## 1. Starting point (facts read from the code on 2026-10-25)
- **Live model** (`core/live-model.ts`): pure `reduce(model, input) -> { model, effects }`; inputs carry the monotonic `at` read by the runner (injected `now`). `victim-revealed` sets `model.victim` (the FR-288 fields) and raises `reported`; `round-applied` starts `applying` (`hash-state`), and only `commit` (digest matched) sets N, clears `victim` and emits `play-step` (when `displayed === k - 1`). A digest mismatch takes `readInstead` (state read, then an instant `draw`). `estimateAt(model, at)` is the 009 reported-time estimate. The panel stage follows `schedule` events, so after `victim-revealed` the victim line appears only once the `schedule` (stage `phase-2`) is consumed.
- **Runner** (`ui/live-runner.ts`): `feed` runs every effect of one `reduce` **before** `port.show(model, at)`; port = `open`, `draw`, `playStep`, `show`, `fail`. The 1 s panel refresh exists only while `clockDriven`.
- **Panel data** (`core/live-view.ts` `panelView`): victim line from `live-text.ts` `victimLine(stage, victim)`; the legend counts the owners of the **displayed** round.
- **Map view** (`ui/map-view.ts`): owns the renderer, labels, playback (`core/playback.ts`), camera and resize; reads no clock (frame times come from `ui/frame-loop.ts`, request times from the caller). `prepare` computes the label layout of a round (`placeCentredFactions`, the 007 NFR-43 cost); `commit` shows it. The camera is set by `setCamera` from `ui/input.ts` (user) and by nothing else today.
- **Debug scene** (`ui/main.ts`): rounds from the sim through `core/scene.ts` (`SimPort`: `totalRounds`, `getState`, `getRounds`, `ownerOf`); the panel shows the record summary of the displayed round (eliminated, absorber, transferred) and the pointer readout of the displayed state; address via `core/address.ts` (`transition`) and `ui/url.ts`.
- **Shader** (`render/shader.ts`): ports `core/borders.ts` `shade` and `core/transition-shade.ts` `shadeTransition`; uniforms on the 0..1 scale, owners by faction index, `uFrontOn` gate. Labels (`render/labels-layer.ts`) draw `AnyLabelDraw[]` with `factor` x scale opacity; draw data carry no faction id (only `RoundLabels` do, by faction index).
- **Scans that constrain new code**: `anti-spoiler.test.ts` FR-155 bans the words `animate`, `animation(s)`, `tween(s)`, `keyframes`, `transitions`, timers and time-like uniforms in code of every source, `transition` outside `core/address.ts`, `core/playback.ts`, `ui/main.ts`, `ui/url.ts`, `lerp` outside `src/core`, the frame API outside `ui/frame-loop.ts`; `purity.test.ts` NFR-25 (no clock, randomness, DOM, three in `src/core`; clock only in `ui/clock.ts`); `labels-purity.test.ts` NFR-33 (clock importers exactly `ui/client-main.ts`, `ui/frame-loop.ts`, `ui/live-main.ts`, `ui/main.ts`); `live-scans.test.ts` (live files `core|ui/live-*.ts` import no sim/debug module and hold no identifier containing `seed`; debug-side files `ui/main.ts`, `ui/load.ts`, `core/scene.ts`, `core/step.ts`, `core/playback.ts` import no live module); `anti-spoiler.test.ts` FR-159 (only `core/scene.ts` and `ui/main.ts` name `@mbrg/sim`; render sources name no seed, round or record).
- **008 facts used**: event order of one step (FR-287, plan 20.4): `phase-closed`, `victim-revealed`, `results`, `schedule`; `round-applied` carries `appliedAt` and no reported time; in `locked` `victim.a` is the stale reveal-time A while `schedule.a` is the shifted one (008 plan 13): 009 never reads `victim.a`.
- Constants: L0 = `LABEL_PARAMS.fadeStart` = 1.5; Dt = `LABEL_PARAMS.durationMs` = 1,500 ms.

## 2. Architecture (pure model first)
```
 live: event --reduce--> model + effects { victim-tour | play-step{tour?} | complete-tour }   (core/live-model.ts, pure)
                         decisions: fresh? participants ok? budget (time left)               (core/tour-plan.ts, pure)
       runner (effects before show) --> port (ui/live-main.ts) --> map view (ui/map-view.ts)
 debug: showRound(N) with reveal=on --> revealInputs via the sim (core/scene.ts) --> map view
 map view: buildTour(spec, framing boxes of the drawn round)   (core/tour.ts, pure)
           driver: start at the handling instant, sequence of tours, then the 005 step (core/tour-playback.ts, pure)
           each frame: tourFrame(tour, t, area, image, startCamera, taken) (core/tour-frame.ts, pure)
                       -> lit factions, dim, label factors, camera?, marker?, indicator?, result shown, ended
           drawing: map scene setTour({ lit, dim }) (shader port of core/tour-shade.ts), tour label draws,
                    overlay (marker, indicator) on the label layer
```
- Everything that decides or computes is a pure function in `src/core` with time, area, camera and the animation key as parameters, tested in Node without WebGL. The shells (`ui/map-view.ts`, `ui/live-main.ts`, `ui/main.ts`, `ui/live-runner.ts`) only route inputs and draw.
- **Two decision layers** (PD3): the live model decides what depends on the match timeline (freshness, participants, the time budget); the map view decides what depends on the browser (reduced motion) and builds the tour from its own framing boxes. The model never sees boxes; the rendering part never sees the result (FR-353).
- **One clock source**: the elapsed time comes from the clock readings the shells already have (the request instant of the runner or `ui/main.ts`, the frame readings of `ui/frame-loop.ts`); no new clock importer, no timer (PD5).

## 3. Files and responsibilities
```
apps/web/src/core/                                              (all PURE; NFR-25 and the new 009 scan apply)
  tour-params.ts (new)   TOUR_PARAMS: every number of the spec (H, dmin, dmax, Dhold, Dfade, dim max, camera durations,
                         tiny 24 px, marker 16/2 px, indicator 12 px, Dlate 5,000, margin 1,000, min scale 0.5)   M1 T2
  tour-key.ts (new)      keyText(scope, k, kind) ('<match id>:<k>', '<match id>:<k>:absorber', 'debug:<k>', 'debug:<k>:absorber'),
                         fnv1a32(text), tourStream(sigma) (mulberry32), pick(stream, m)       FR-318, FR-322     M1 T2
  tour.ts (new)          buildTour(spec, boxes) -> Tour: stops (FR-322), dwells and instants (FR-323, FR-346), hold,
                         fades, D, scale c (FR-336 durations), still tour (FR-343), camera legs (FR-331, FR-332, FR-348)  M1 T2-T4
  tour-camera.ts (new)   framingBoxOf(boxes, factions), framing(box, image, area), overview(image, area),
                         ease(a, b, E, s), cameraAt(tour, t, area, image, start)          FR-331 to FR-335, FR-348  M1 T4
  tour-frame.ts (new)    tourFrame(tour, t, view) -> TourFrame; tourLabelDraws(round, lit, other); marker; indicator
                                                         FR-327 to FR-329, FR-333, FR-347, FR-353, FR-354  M1 T5
  tour-plan.ts (new)     victimTourDecision(...), absorberTourDecision(...), scaleFor(D, budget), viewChoice(reduced)
                                             FR-316, FR-319, FR-320, FR-336, FR-338, FR-343, FR-349, FR-350  M2 T2
  tour-playback.ts (new) TourRun: start(handlingMs, tours, then?), at(run, nowMs), complete(run), motionChanged(run)
                                                                            FR-339, FR-342, FR-344  M2 T3
  tour-digest.ts (new)   frameText(frame) canonical text, frameDigest (fnv1a32 hex) for the goldens and the debug panel  M2 T4
  tour-shade.ts (new)    unitLit(kind, owner, lit), dimByte(c, dim), shadeTour(...) reference over `shade`   FR-326, FR-355  M4 T2
  live-model.ts (edit)   effects victim-tour, complete-tour, play-step { tour? }; Applying.tour   FR-317, FR-337, FR-339, FR-340, FR-345, FR-350  M3 T2, T3
  live-view.ts (edit)    panelView(model, at, factions, tour: { revealing, absorbing })   FR-330  M3 T4
  live-text.ts (edit)    victimLine with the "revelando…" text; skip label                FR-330, NFR-64  M3 T4
  panel-text.ts (edit)   debug record line hidden by the tour state (A2); tour timing lines   M3 T4, M4 T5
  strings.ts (edit)      liveRevealing ("revelando…"), tourSkip ("Saltar"), revealInvalid, revealMismatch, tour timing labels  NFR-64  M3 T4
  address.ts (edit)      `reveal` parse (on | victim:<t> | absorber:<t>), problems, format    FR-351, FR-352  M3 T5
  scene.ts (edit)        RevealSimPort (absorptionCandidatesOf, livingFactions) and revealInputs(map, seed, n, sim)  FR-351  M3 T5
  playback.ts (edit)     completeRunning(state) (a tour start completes a running step, FR-340)   M4 T3
apps/web/src/render/
  shader.ts (edit)       uDim, uLit (ivec2 faction indices); the dim step after the colour, gated `uDim > 0.0`  FR-326, FR-355  M4 T2
  map-scene.ts (edit)    setTour({ lit, dim } | undefined)                                          FR-353  M4 T2
  labels-layer.ts (edit) draw(labels, view, overlay?): marker ring and edge triangle, never dimmed   FR-329, FR-333  M4 T3
apps/web/src/ui/
  map-view.ts (edit)     beginTour(spec, handlingMs, then?), freezeTour(spec, t, then?), completeTour(nowMs), onTour hook,
                         userCamera(next) (marks the camera taken); round-k labels prepared on the 2nd tour frame    M4 T3
  input.ts (edit)        Escape -> onSkip                                                           FR-341  M4 T4
  main.ts (edit)         reveal=on chain (victim -> absorber -> step), frozen tours, panel/pointer during tours, tour figures  M4 T4, T5
  panel.ts (edit)        skip button, tour figures, record line hidden by the tour state           M4 T4, T5
  url.ts (edit)          reveal text kept in the address                                            M4 T4
  live-runner.ts (edit)  runs the three new effects through the port                                M5 T2
  live-main.ts (edit)    port: tour, playStep with tour, completeTour; revealing flag; panel update at the result hook;
                         address camera synced at the tour end (A7)                                  M5 T2
  live-panel.ts (edit)   skip button                                                                M5 T2
apps/web/test/ (new): tour-key, tour, tour-camera, tour-frame, tour-plan, tour-playback, tour-digest, tour-golden,
                      tour-scans, tour-shade, live-model-tour, live-view-tour, address-reveal, scene-reveal, map-view-tour-scan
apps/web/test/golden/tours.json (new) + golden/generate-tours.ts + golden/tours-model.ts (hand-run, independent; M2 T4)
apps/web/test/golden/tour-frame-pins.json (new, regression pins) + golden/generate-tour-frame-pins.ts + helpers/tour-pins.ts (M2 T4); the digest tests live in tour-golden.test.ts (there is no tour-digest.test.ts)
apps/server/test/viewer-tour.test.ts (new; M5 T3)
```
Unchanged: `packages/*`, `apps/server/src`, `tools/*`, `maps/dev`, every golden of 001 to 008, `ui/frame-loop.ts`, `ui/clock.ts`, `ui/live-net.ts`, `ui/live-timer.ts`.

## 4. Pinned algorithms
**4.1 Key, hash, generator (D8, FR-318, FR-322; PD1).**
- Key text: `<match id>:<k>` and `<match id>:<k>:absorber` (live), `debug:<k>` and `debug:<k>:absorber` (debug scene), k in decimal without leading zeros. Text is ASCII (match ids are base64url); a non-ASCII character is a `RangeError` (cannot happen).
- σ = FNV-1a 32-bit over the bytes of the key text: `h = 0x811c9dc5; for b: h = Math.imul(h ^ b, 0x01000193) >>> 0`.
- Stream: mulberry32 from σ: `a = (a + 0x6d2b79f5) >>> 0; t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0`. Unrelated to the engine's sfc32 `roundRng` (a test asserts the first outputs differ for the same 32-bit input).
- `pick(stream, m) = floor(next() * m / 2^32)` (exact in doubles for m < 2^21).
**4.2 Stops (FR-321, FR-322, FR-346).** The set is sorted ascending by faction id (PD2). H = 12 (victim, n >= 3), 6 (victim, n = 2), 6 (absorber). s_H = result; for i = H - 1 down to 1: eligible = set minus {s_{i+1} .. s_H} (ascending), or, when that is empty, set minus {s_{i+1}} and, when another faction then exists, minus the result (D17: with 3 or more factions the result appears only at the end; with 2 the stops alternate); s_i = eligible[pick(stream, |eligible|)]. One stream per tour.
**4.3 Timing (FR-323 to FR-325, FR-336, FR-343, FR-346; PD4).** Integer form: d_i = dmin + floor((dmax - dmin) (i - 1)^2 / (H - 2)^2) for 1 <= i <= H - 1 (equal to the spec's floor of the real expression, without float error). Scaled by c (FR-336, FR-349): each dwell, hold, fade and camera duration becomes floor(x * c) with c = budget / D as an exact ratio (computed as `floor(x * budget / D)` in integers), τ from the scaled dwells, D = τ_H + hold + fade from the scaled values (A4). Checks: τ_H = 3,549 and D = 5,349 (H = 12); 1,687 and 3,487 (H = 6); absorber 1,311 and 2,411. Dim: δ(t) = δmax smoothstep(0, Dfade, t) for t < τ_H + Dhold, δmax (1 - smoothstep(0, Dfade, t - τ_H - Dhold)) after, 0 for t >= D; smoothstep(a, b, x) = clamp(u)^2 (3 - 2 clamp(u)), u = (x - a) / (b - a). **Still tour** (FR-343, reduced motion): H = 1, stops [victim], τ_1 = τ_H = 0, no camera leg, Dhold = 1,500, Dfade = 300, D = 1,800.
**4.4 Camera (FR-331 to FR-335, FR-348).** Framing box of a set: union of `PieceIndex.box` of the pieces of each faction's label set (`FactionBoxes.labels.get(index).pieces`), as half-open map rectangles [x0, x1 + 1) x [y0, y1 + 1); a faction without a label entry falls back to the box of all its land units (PD6). Framing: centre = box centre; scale = min(0.5 W / bw, 0.5 H / bh) clamped to [fit, max(fit, min(4 fit, L0))], then `clampCamera`. Overview = `initialCamera(image, area)`. Ease(a, b, E, s): p = smoothstep(0, E, s); centre a + (b - a) p; scale exp(ln a + (ln b - ln a) p). Legs: victim tour [{ from 0, E = Dcam_in, to overview }, { from τ_H, E = Dcam_out, to victim framing }] (the first leg is skipped when the start camera equals the overview); absorber [{ from 0, E = 800, to framing of victim + candidates }]; still tour none. `cameraAt(tour, t, area, image, start)`: the start of leg 1 is `clampCamera(start)` for the current area, the start of leg 2 is cameraAt at its own start instant, targets are recomputed for the current area: a pure function of the area, so a resize (FR-335) continues at the same t with no stored state. With the camera taken (FR-333), `cameraAt` is not used and the frame carries no camera.
**4.5 Frame (FR-326 to FR-329, FR-333, FR-347, FR-353, FR-354).** `tourFrame(tour, t, { area, image, start, taken, current })` returns `{ lit, dim, factors: { lit: 1, other: 1 - dim / dimMax }, camera?, marker?, indicator?, resultShown: t >= τ_H, ended: t >= D }`; highlight = s_i for the largest i with τ_i <= t (frames after several stops show the latest, FR-328); lit = [highlight] (victim tour) or [victim, highlight] (absorber tour), as faction indices; at t >= D: dim 0, lit [], no marker, no indicator. Tiny: framing box of the highlight at the frame's camera smaller than 24 CSS px in width and height; marker = circle at the box centre, radius 16 + half the on-screen box diagonal. Indicator: when the on-screen box lies wholly outside [0, W] x [0, H], a 12 px triangle whose tip is where the segment from the area centre to the box centre crosses the area rectangle inset by 12 px, pointing along that segment. `tourLabelDraws(round, lit, other)`: the order and draws of `instantLabels`, with `factor = 1` for the faction labels of lit factions and `other` for every other faction label, every territory label and their leader lines (FR-327 letter, A10); equals `instantLabels` when other = 1.
**4.6 Shading (FR-326, FR-355; M4).** `unitLit(a) = kind(a) == land && owner(a) in lit` (the pixel's own map unit; border pixels follow their unit); a pixel of an unlit unit (other land, sea, lake, background, outside the image, their border lines) gets every channel c -> floor(c (1 - δ) + 0.5) after the existing colour; the shader applies it only when `uDim > 0.0`, so δ = 0 is the old drawing bit for bit.
**4.7 Decisions (FR-316, FR-319, FR-320, FR-336, FR-338, FR-349, FR-350; M2).**
- Victim: play only if the reveal came as an event (not public data), the match is not halted, `displayed === k - 1`, age = max(0, estimate - revealedAt) <= 5,000, `living` equals the factions living in the held owners of the displayed round, the victim is in it, n >= 2; budget = `timing === 'manual' || c2 === null` ? none : c2 - estimate - 1,000.
- Absorber: decided at receipt of `round-applied` (age = max(0, estimate - appliedAt) <= 5,000, `displayed === k - 1`, not halted, candidates of round k held with d >= 2, absorber among them); budget = manual or k = T ? none : appliedAt + (I - L1 - L2) x 1,000 - estimate - 1,000 - Dt. The tour is started at `commit` (digest matched); a mismatch (`readInstead`) plays no tour (PD8).
- `scaleFor(D, budget)`: none -> 1; budget >= D -> 1; budget / D >= 0.5 -> budget; else skip. Reduced motion (view): victim -> still tour (scaled by the same rule with D = 1,800, A5); absorber -> no tour.
- The estimate is taken after raising it with the event's own reported time (`victim-revealed`); `round-applied` has none.

## 5. Interfaces (sketch; names final in the tasks)
```ts
type TourKind = 'victim' | 'absorber';
interface TourSpec { kind: TourKind; result: number; set: readonly number[]; victim?: number; sigma: number; budget?: number; still?: true }
interface Tour { kind; stops: readonly number[]; at: readonly number[]; hold: number; fade: number; end: number; legs: readonly Leg[]; boxes: ReadonlyMap<number, Box> }
interface TourFrame { lit: readonly number[]; dim: number; factors: { lit: 1; other: number }; camera?: Camera;
  marker?: { x: number; y: number; r: number }; indicator?: { x: number; y: number; angle: number }; resultShown: boolean; ended: boolean }
// live model effects (added)
| { type: 'victim-tour'; round: number; victim: number; living: readonly number[]; sigma: number; budget?: number }
| { type: 'play-step'; from; to; data: StepData; tour?: { victim: number; candidates: readonly number[]; absorber: number; sigma: number; budget?: number } }
| { type: 'complete-tour' }
```
The victim-tour types have no field for an absorber, a record, a state of round k or a round seed (type-level key tests, NFR-61). `MapScene.setTour` takes `{ lit: readonly number[]; dim: number } | undefined` only (FR-353).

## 6. Live integration (M3, M5)
- `consume` `victim-revealed`: after setting `victim` and raising `reported`, `victimTourDecision` gives play (with budget) or skip; play emits `victim-tour`, also a `complete-tour` first when a tour may be running (FR-339 "another victim reveal").
- `consume` `round-applied`: `absorberTourDecision` at receipt; the decision goes into `Applying.tour`; `commit` emits `play-step` with `tour` (candidates captured before `victim` is cleared). `match-halted` emits `complete-tour` (FR-339, FR-350). Navigation needs no effect: the map view completes a running tour before any `draw` or `playStep` (FR-339, FR-350).
- Runner: `victim-tour` -> `port.tour(...)`; `complete-tour` -> `port.completeTour()`; `play-step` passes `tour`. Because effects run before `show` in the same `feed`, the panel never shows the victim's name for even one call before the tour state is set (D19; tested with a recording port).
- Port (`ui/live-main.ts`): builds the `TourSpec`, calls `view.beginTour(spec, now(), then?)`; keeps `revealing` (true from a full victim tour start until its result hook or completion) and `absorbing` (A2); the map view's `onTour` hook (`result`, `ended`) triggers `panel.update` on that very frame, not on the 1 s refresh (PD9). Address: D31 rewrite of the round at once; camera written at the tour end and on user moves only (A7).
- Late join, reload, resync: `fromPublic` emits no tour (FR-319); the candidates from the public data stay held, so a later fresh `round-applied` can play the absorber tour.
- Skip: panel button and Escape -> `view.completeTour(now())` (an absorber tour then starts its 005 step, FR-341).

## 7. Debug scene `reveal` (M3 T5, M4 T4)
- Parse (`core/address.ts`): `reveal` absent | `on` | `victim:<t>` | `absorber:<t>` (t whole, no sign, no leading zeros besides `0`); repeated or another value -> problem `reveal` (Spanish message, ignored, dropped at the next address update); with a valid `transition` -> problem (the frozen step wins); frozen with round 0 -> problem. Range checks needing the scene (t > D of that tour; d < 2 for `absorber:`) run in `checkReveal(reveal, inputs)` after `revealInputs` (FR-352).
- `revealInputs(map, seed, n, sim)` in `core/scene.ts` (the only core module naming the sim): participants = `livingFactions` at n - 1, victim and absorber from the record of round n, candidates = `absorptionCandidatesOf(map, state n - 1, victim)`, through a separate `RevealSimPort` type so the existing `SimPort` literals in tests are untouched (PD10).
- `on`: a forward one-round step N - 1 -> N plays victim tour, then absorber tour (d >= 2), then the 005 step; nominal durations; σ from `debug:<N>`. Frozen: drawing of N - 1 at t with no clock; camera = address camera (counted as taken, A6) or the tour camera at t from the overview (victim) or from the victim framing (absorber, the camera a played chain would have). A round change leaves a frozen tour and drops its value from the address; `on` stays (A6).
- Panel during tours (A2): the record line shows "revelando…" until the victim's stop, hides the absorber until the absorber tour ends; the pointer readout and the legend follow the drawn state.

## 8. Drawing (M4)
- Shader: `uniform float uDim; uniform ivec2 uLit;` (names pass the FR-155 time-uniform rule); after `color` is final: `if (uDim > 0.0 && !(fillKind == 1 && (owner == uLit.x || owner == uLit.y) && owner != 0)) color = floor(floor(color * 255.0 + 0.5) * (1.0 - uDim) + 0.5) / 255.0;` where `owner` is the drawn table's owner of unit a (no front during tours). Ported line by line from `core/tour-shade.ts`, like `borders.ts`.
- Labels: `tourLabelDraws` replaces `current.draws` while a tour runs; overlay drawn after pass 2: black 4 px under white 2 px (ring), filled white triangle with a 1 px black halo.
- Map view driver: `TourRun` from `core/tour-playback.ts`; each paint: `tourFrame` -> `mapScene.setTour`, labels, overlay, camera (unless taken); hooks on the frames where `resultShown` or `ended` first hold. A running 005 step is completed first (`completeRunning`, FR-340). An absorber tour draws the held view of k - 1; the round-k views are prepared on the tour's second frame (NFR-58: the first frame is drawn within 50 ms, PD11); at the end frame the 005 step starts with `startMs` = that frame's reading. Motion change -> `TourRun.motionChanged` (FR-344). `userCamera(next)` (input, reset) marks the camera taken (FR-333); `setCamera` from the tour does not.

## 9. Anti-spoiler (FR-317, D19, NFR-61)
Places where the victim or the absorber could show early, and how each is closed:
| Path | Guard | Test |
|---|---|---|
| Panel victim line before τ_H | `revealing` -> "revelando…"; set by the effect before `show` | panelView over every faction name; runner order with a recording port |
| DOM attributes, title, aria | the panel writes the victim text only from `LivePanelView.victim` | scan of `ui/live-panel.ts` and `ui/panel.ts` |
| Camera before τ_H | leg 2 starts at τ_H; leg 1 targets the overview | cameraAt at τ_H - 1 equals the leg-1 value |
| Legend counts during the absorber tour (absorber's count jumps) | A2: legend follows the drawn state k - 1 until the tour ends | panelView with `absorbing` |
| Debug record line, pointer readout | A2 | panel-text tests |
| Debug panel legend (M4 T4; found in the M3 review) | The legend comes from the scene of round N: with `reveal=on` or a frozen value it would mark the victim eliminated and show the absorber's new count before either tour stops. The debug legend follows the drawn state (N - 1) or is hidden until the tours stop | debug shell test: legend rows during the victim and the absorber tour equal those of N - 1, and those of N after the chain ends |
| Round-k step data and prepared label layout during the absorber tour (M4 T3; M3 review) | `StepData` of the record and the round-k label layout may be built early (PD11) but are not drawn or shown before the end frame; the tour draws the held view of k - 1 | map-view test: until the end frame the painted owners, labels and legend are those of k - 1; `completeTour` with no tour running is a no-op |
| Render inputs | `setTour` gets lit indices and dim only (FR-353) | type-level key test, render scan |
| Inputs of the victim tour | `TourSpec`/effect have no absorber, record, state of k, seed | key tests; twins: two scripted matches equal up to the absorber give byte-equal victim-tour effects and frames |
| Requests during a tour | `canRequest` (N only) | fake-server request log over a whole match with tours |
| Absorber before `round-applied` | `Applying.tour` built only in `consume(round-applied)` | fake stream: no effect names the absorber before that frame |

## 10. Performance (NFR-58, P15)
- Budget: frame median <= 16.7 ms, 95th percentile <= 33.3 ms over each whole tour; first tour frame within 50 ms of handling the reveal; no label layout recomputed during a tour (round-k layout of an absorber tour computed on its second frame, within the 007 NFR-43 200 ms).
- Measured in the browser (reference PC of 004 NFR-24, Chromium-based browser, window sized for a 1920 x 1080 drawing area, **pane visible**, MEMORY lesson), in the debug scene `?seed=1&round=0&reveal=on`, stepping rounds 1 to T, three runs. The debug panel gains tour figures per tour: frame-interval median and 95th percentile (the existing `frameStats` over the frames of the tour only), first-frame latency (first tour frame reading minus the handling reading), layouts during the tour (a counter in the map view, must be 0 for a victim tour and 1 for an absorber tour). Figures recorded in PROGRESS and the PR.
- The live scene shares the map view: the PR adds one DevTools performance trace of a live victim tour (local fixture) for the first-frame latency; no live timings panel (A12 recommendation, PD12). Node tests trace the pure part (the tour paint path calls no layout; the runner reaches the port in the same `feed`).

## 11. Test strategy (Vitest only)
- Pure, Node: every module of section 3 with literal inputs and the dev map (`test/helpers/dev-map.ts`); the FR-322 properties over every round of seeds 1 to 100 and hand-made sets of 2, 3, 11, 12 and 70 factions; hand-derived values (τ_H, D, δ at given t, framing of a known box, marker radius) with non-round inputs where a constant could hide a mutant (MEMORY).
- Goldens (NFR-59): `test/golden/tours.json` for the dev map, seed 1, debug keys, and the fixed match id `Ab3dE5fG7hI9jK1m`: per round σ, stops, instants, D of both tours, frame digests at t = 0, 400, 1,000, τ_H - 1, τ_H, τ_H + 800, D - 1, D at 1920 x 1080. σ, stops and instants are written by a hand-run generator that re-implements 4.1 to 4.3 independently (MEMORY lesson); frame digests are regression pins written by the code under test (stated as such). Browser parity: the debug panel shows the digest of the frame it actually draws while a tour is frozen; the reviewer compares it with pins computed under the frozen debug-scene rules (section 14, approved 2026-10-26: no address camera, drawing area exactly 1920 x 1080, start camera per the scene, framing boxes from label-set pieces; today's pins stay as an extra case) for the NFR-62 frames (recorded in the PR).
- Live model: `test/helpers/scripted-match.ts` driver over whole matches (manual and clock timing, L2 = 0 and > 0, short L1, late join in phase 2, reconnection replay with age <= and > 5 s, halt during a tour, browsing back).
- Runner and port: the existing fake-server and a recording port (order of `tour`, `show`, `playStep`).
- Real server (M5 T3): the M3 harness with a fake clock and the viewer core + `live-net` + runner with a recording port.
- Mutation proofs per task (listed in the task files), full `npm test`, one chain at a time.
- Visual: section 12.

## 12. Screenshots (AGENTS.md visual rule; NFR-62)
Delivered as an HTML review page outside git (`.claude/review/009-m4-tours.html`, `.claude/review/009-m5-live.html`), each pair side by side with its address:
1. **No regression pair** (FR-355): the debug scene `?seed=1` at rounds 0, 1 and T, before (rewrite) and after the M4 branch, no `reveal`: identical.
2. **Tour frames, before/after pairs**: for each case the state without a tour beside the frozen frame, at the NFR-59 instants: victim tour round 1 (5 participants); victim tour round T (n = 2); absorber tour, first round of seed 1 with d >= 3 and one with d = 2 (rounds found by a test, M4 T5); the round whose victim is the smallest faction by area (marker if tiny at the overview); a user camera away from the highlight (edge indicator).
3. **Live** (M5): the panel with "revelando…" and then the victim name; the absorber tour over the old state with "Ronda k de T" already shown; a reload in phase 2 (no tour).
The user accepts the look and the values δmax, dmin, dmax, Dhold, Dfade, H (confirms P3, P4, P6, P7, P10, P12, P17; NFR-58 figures confirm P15).

## 13. Scans and earlier tests edited (NFR-60 explicit list; meaning stated)
- No 004/005/008 scan rule is relaxed: no new clock importer, no timer, no new network or crypto user, no banned word in code (naming rule: tours, stops, legs, never the banned words; no identifier containing `seed` in tour or live modules: σ is `sigma`), `transition` only in `core/address.ts` and `ui/main.ts`, `lerp` only in `src/core`.
- New scan `tour-scans.test.ts`: the tour modules of `src/core` are pure (NFR-25 rule), name no `@mbrg/sim`, protocol record type or `Math.random`; the shader's new uniforms are exactly `uDim`, `uLit`.
- Edited (lists grow, meaning unchanged): `live-model.test.ts` key list of `LiveModel` / `Applying` (FR-304; the new field holds no absorber beyond the announced record); `strings-language.test.ts` placeholder and kind lists; `live-scans.test.ts` only if a new file matches `live-*` (none planned); `packages/sim/test/traceability.test.ts` ranges `FR [[1, 355]]`, `NFR [[1, 64]]`, `PENDING_009` and its closing states; `labels-render.test.ts` FR-188 "nothing else is uploaded" (setTour changes uniforms only) if it pins the uniform set.
- M4 edit (T3): `labels-render.test.ts` FR-175 type-level pin of `draw` gained the optional third parameter `TourOverlay`. This contradicts the letter of T3's "every 004 to 007 test unchanged", but it is a widening by an optional parameter: the first two parameters and every behaviour are unchanged.

## 14. Milestones, ids and sizes
| Milestone | Branch | Content | Closes | Ledger after |
|---|---|---|---|---|
| M1 | `feat/009-m1-tour-core` | key, hash, generator, stops, timing, still and absorber timing, camera, frame function, label factors (pure) | FR-318, FR-321, FR-322; FR-323, FR-324, FR-325, FR-343, FR-346; FR-331, FR-332, FR-334, FR-335, FR-348; FR-327, FR-328, FR-329, FR-333, FR-347, FR-353, FR-354 | 20 / 27 |
| M2 | `feat/009-m2-tour-decisions` | decisions, tour playback driver, goldens, purity scan (pure) | FR-316, FR-319, FR-320, FR-336, FR-338, FR-349; FR-342, FR-344; NFR-59, NFR-60 | 30 / 17 |
| M3 | `feat/009-m3-tour-wiring` | live model effects, panel texts and strings, debug address and reveal inputs (headless) | FR-317, FR-339, FR-340, NFR-61; FR-337, FR-345, FR-350; FR-330, NFR-64; FR-351, FR-352 | 41 / 6 |
| M4 | `feat/009-m4-tour-drawing` | shading reference and shader, overlay, map view driver, debug shell, skip, figures, debug screenshots | FR-326, FR-355; FR-341; NFR-58, NFR-62 | 46 / 1 |
| M5 | `feat/009-m5-live-tours` | live shell, real-server proofs, local live run, live screenshots, close | NFR-63 | 47 / 0 |

**M1 result (2026-10-25):** done on `feat/009-m1-tour-core`, ledger 20 / 27, about 1,620 changed lines in `apps` and `packages` against the estimate of 2,240 (per task in `PROGRESS.md`). The Tour carries `legs`, `boxes` and, for an absorber tour, `victim`; `TourSpec` gained `boxes?`, `victim?`, `budget?`, `still?` (names final).
**M1 review outcome (2026-10-25):** the reviewer's findings were fixed on the same branch: D17 (FR-322 fallback keeps the result out of repeated stops), the FR-343 parenthetical, an absorber `TourSpec` without `victim` is refused, doc alignments.
**M2 result (2026-10-25):** done on `feat/009-m2-tour-decisions`, ledger 30 / 17, about 1,370 changed lines in `apps` and `packages` (src + tests, golden JSON apart) against the estimate of 1,740 (per task in `PROGRESS.md`). New modules: `core/tour-plan.ts` (decisions; names `victimTourDecision`, `absorberTourDecision`, `scaleFor`, `viewChoice`), `core/tour-playback.ts` (`startTourRun`, `tourRunAt`, `completeTourRun`, `motionChangedTourRun`), `core/tour-digest.ts`; `core/tour.ts` gained `nominalEnd`. The goldens are split in `tours.json` (independent) and `tour-frame-pins.json` (regression pins, A13). Open for M4: the browser parity of the digests depends on the start camera, the address camera and the drawing area, not on the label aspects (corrected note in PROGRESS, M2 T4).
**M3 result (2026-10-26):** done on `feat/009-m3-tour-wiring`, ledger 41 / 6, about 1,340 changed lines in `apps` and `packages` (src + tests) against the estimate of 1,840 (per task in `PROGRESS.md`). Names final: effects `victim-tour { round, victim, living, sigma, budget? }`, `complete-tour`, `play-step { tour?: AbsorberTour }`; model field `touring`; `Applying.tour`; `livingOf` (`live-rounds.ts`); `panelView(model, at, factions, { revealing, absorbing, mismatch })`, `panelTourState`, `recordLine(scene, presentation, { revealing, absorbing })`; `parseAddress` result `reveal`, `checkReveal`, `revealText`, `revealAfterRoundChange`; `RevealSimPort`, `revealInputs`. Open for M5: nothing carries the model's FR-320 skip (reason `mismatch`) to the panel option `mismatch`; the runner ignores the new effects until M5 T2; after a played absorber tour every later victim reveal also emits one `complete-tour` (no-op in the view).
**M4 result (2026-10-26):** done on `feat/009-m4-tour-drawing`, ledger 46 / 1, about 2,300 changed lines in `apps` and `packages` (src + tests, golden JSON apart) against the estimate of 2,240: T1 about 15 (30), T2 about 408 (500), T3 about 1,070 (650; 1.65x accepted by the user: the pure `core/tour-session.ts` was added so the map view's tour logic is testable in Node), T4 about 640 to 690 (550), T5 about 270 (450). New: `core/tour-shade.ts`, `core/tour-session.ts`, `core/debug-reveal.ts`; `setTour`, the overlay, `completeRunning`, `tourFrameStats`, `tourFiguresLine`; the debug pins `tour-frame-pins-debug.json`. Browser facts (coordinator, 2026-10-26): victim-tour digests equal the debug pins at 8 instants (round 1); live-style timing of `reveal=on` matches tau_H and D within 20 ms; per-tour frame timing from the panel over four tours: median 16.7 ms and p95 16.8 ms, first frame 3.8 to 6.8 ms, layouts 0 / 0 / 1 / 0, run durations within 20 ms of D, one 100 ms frame at the absorber tour's second frame (the round-k layout, within the 007 NFR-43 200 ms); an earlier count of 837 and 655 frames was over fixed observation windows and is withdrawn; Escape completes the whole chain; resize keeps the timeline. Findings: the dev map has no round with d >= 3 and no tiny faction (smallest victim: round 2, 139 x 249 px at the overview), so the marker and the d >= 3 screenshots cannot be produced on it. The NFR-62 review page `.claude/review/009-m4-tours.html` (not in git) holds the no-regression pairs (rounds 0, 1, 4), frozen victim tours (round 1, round 4), the smallest victim (round 2) and the absorber tour (round 3), and the edge indicator, which is browser-verified; it was delivered to the user on 2026-10-26 (the review is recorded when the user answers). Browser parity of NFR-59 is verified ONLY for the victim tour of round 1 (8 instants) and the absorber frozen frame at round 3, t = 1000 (bf49c525, which is also the pin at t = 1310; at exactly 1920 x 1080 with no address camera; an earlier 8737f2ae was a reading in a window of another size). NOT compared: the victim tours of rounds 2 and 4, the other absorber instants, in particular the mid-ease ones (0 and 400) where the exp/log parity risk sits; the spec's Done criterion "same digests recorded in the reference browser" is therefore only partly met and M5's close must complete or report it. Open also: the Spanish messages of a bad `reveal` value were not browser-checked. After the review fixes: the round-k layout is asked for on the second frame of the ABSORBER tour (on the ending frame when no absorber tour follows), the end frame's camera is applied before the step starts, and the frozen digest lines follow every tour frame. Open; reduced motion and GPU float32 .5 ties are not browser-verified. Hand-offs to M5: the live port builds `TourRequest`s and calls `beginTour` with the handling reading (the map view API is `beginTour`, `completeTour`, `userCamera`, `onTour`, `tourFrame`, `tourLayouts`; `TourStatus` maps to the live `TourReport`), the runner still ignores the three effects, the model's FR-320 skip is not routed to the panel yet.
**Approved by the user on 2026-10-26: rules of the browser-compared pins (A13).** The pins of `tour-frame-pins.json` use a fixed start camera (2.5 x fit around 0.3 w / 0.4 h); the frozen debug scene starts from the overview (victim tour, leg 1 skipped) or from the victim framing (absorber tour), has no address camera (an address camera counts as taken, A6, and the digest carries `camera=-`) and needs a drawing area of exactly 1920 x 1080 CSS px. M4 adds pins computed under the frozen debug-scene rules (today's pins stay as an extra case), a Node test that the digests are identical with non-round aspects (for example 2.7 and 9.3) and with the `placeCentredFactions` boxes, and a panel that shows the digest of the frame it actually draws.

Sizes (changed lines, src + tests; docs and golden JSON apart):
| Task | Est. | Task | Est. | Task | Est. |
|---|---|---|---|---|---|
| M1 T1 | 80 | M2 T1 | 30 | M3 T1 | 30 |
| M1 T2 | 500 | M2 T2 | 550 | M3 T2 | 400 |
| M1 T3 | 400 | M2 T3 | 450 | M3 T3 | 450 |
| M1 T4 | 600 | M2 T4 | 650 | M3 T4 | 350 |
| M1 T5 | 600 | M2 T5 | 60 | M3 T5 | 550 |
| M1 T6 | 60 | | | M3 T6 | 60 |
| **M1** | **2,240** | **M2** | **1,740** | **M3** | **1,840** |
| M4 T1 | 30 | M5 T1 | 30 | | |
| M4 T2 | 500 | M5 T2 | 600 | | |
| M4 T3 | 650 | M5 T3 | 500 | | |
| M4 T4 | 550 | M5 T4 | 120 | | |
| M4 T5 | 450 | | | | |
| M4 T6 | 60 | | | | |
| **M4** | **2,240** | **M5** | **1,250** | **total** | **about 9,300** |
**Where a split is needed**: one branch would be about 9,300 lines, far above 3,500; with the measured overruns of 008 (1.2x to 2.3x) even two branches (about 4,600 each) would pass it, so five branches are proposed, each estimated at most 2,240 (3,360 at 1.5x). Checkpoints: stop and report when a task passes 1.5x its estimate or a branch passes 1.5x its total. Merging M2 into M3 (about 3,580) is possible but not recommended.

## 15. Decisions of this plan (planner, with the discarded alternative)
- PD1. FNV-1a 32 + mulberry32 + multiply-shift pick (4.1). Discarded: SHA-256 of the key (async, only `ui/web-crypto.ts` may use the platform crypto); reusing sfc32 (FR-317 wants a generator unrelated to the engine's).
- PD2. The tour's set sorted by faction id before drawing. Discarded: server order (the debug scene computes candidates locally; sorting removes any order dependence).
- PD3. Two decision layers (model: timeline; view: reduced motion and boxes). Discarded: the model builds the whole tour (it would need the label layout of the map view).
- PD4. Integer dwell formula and floor-scaled durations (4.3, A4). Discarded: real-valued floor (float error at (i-1)/(H-2) = 0.3 etc.).
- PD5. Elapsed time from the handling reading (A1) through the readings the shells already have; no clock importer, no timer. Discarded: a timer per stop (banned, and wrong on hidden tabs).
- PD6. Framing on label-set pieces, fallback to all land units. Discarded: always all land (P6 says main regions).
- PD7. Camera legs recomputed per frame from the area (stateless resize, FR-335). Discarded: storing eased cameras (needs resize bookkeeping).
- PD8. The absorber tour is decided at receipt but started at `commit` (digest matched); a mismatch plays no tour. Discarded: starting at receipt (would draw from an unverified record, against 008 PD37).
- PD9. The panel switches from "revelando…" on the frame of τ_H through a map-view hook. Discarded: the 1 s refresh (up to 1 s late, or early if the panel used model time).
- PD10. `RevealSimPort` as a separate type in `core/scene.ts`. Discarded: widening `SimPort` (edits every test literal of it).
- PD11. Round-k label layout on the absorber tour's second frame. Discarded: at the event (a 150 to 200 ms layout before the first tour frame breaks the 50 ms rule).
- PD12. Performance measured in the debug scene plus one live trace. Discarded: a timings panel in the live viewer (not in 008 FR-305).
- PD13. Overlay drawn by the label layer after the texts. Discarded: a third canvas (another resize path and z-order).
- PD14. One `TourRun` for a sequence (debug chain victim -> absorber -> step; the second tour starts at the end instant of the first). Discarded: chaining in `ui/main.ts` with hooks (harder to test).
- PD15. Frame digests are regression pins; σ, stops, instants independent. Discarded: an independent re-implementation of the camera and frame math (as large as the code under test).
- PD16. Five milestones (section 14). Discarded: two or three larger branches.

## 16. Spec amendments and readings needing the user's approval (recommendation first)
Spec changes (each becomes an amendment D11+ in `spec.md` before the task that needs it):
- **A1. Start instant of a tour** (Definitions "Elapsed time", FR-316, FR-342, edge case "Tab hidden"). Read t = 0 as the clock reading at which the reveal is handled (the runner's or the debug scene's request reading), the first frame drawing t = now - handling (normally under one frame). Why: with "the frame on which the tour started", a reveal received in a hidden tab would play its whole tour minutes later on return, against the edge case "on return the current point or the final state is drawn"; 005 steps already start at the request reading. Alternative: the spec letter (first frame).
- **A2. Panel during tours** (FR-330, FR-345, D5). During an absorber tour the live legend (territory counts, alive) follows the drawn state k - 1 until the tour ends, and in the debug scene the record line shows "revelando…" until the victim's stop and hides the absorber until the absorber tour ends, the pointer readout following the drawn state; the round line, controls and address still change at once. Why: today the legend shows the absorber's new count at once, and the debug record line names victim and absorber at once, which shows each result before its tour stops. Alternative: the letter of FR-345 ("panel at once"; the legend gives the absorber away).
- **A3. FR-320 report in the live viewer**, which has no debug panel: in development builds a Spanish line in the live panel's message area; nothing in production. Alternative: nothing in the live viewer.
- **A5. Reduced motion under a short phase 2**: FR-336 applies to the still tour with its D = 1,800 ms (compressed, or skipped below c = 0.5 with the name at once). Alternative: the still tour always at 1,800 ms (may end after C2 - 1 s).
- **A6. Frozen `reveal` values**: a round change leaves a frozen tour and drops `victim:<t>` / `absorber:<t>` from the address (as 005 FR-194); `on` stays; an address camera with a frozen value counts as the user's camera (edge indicator shown when the highlight is off-screen). Alternative: keep the frozen value across round changes (it would freeze tours of other rounds).
- **A7. Address camera during a tour** (008 D31 rewrites on every camera change): the tour's own camera moves are written to the address once, at the tour end; the user's moves at once. Alternative: a `replaceState` per frame (60 per second).
Readings that are plan-level (approve with the plan):
- **A4.** Rounding of scaled durations: floor of each scaled duration, D from the scaled values (4.3).
- **A8.** FR-339 "the page's unload": nothing to run (the page goes away); no code.
- **A9.** A resync (gap, protocol fault) does not complete a running tour (not in the FR-339 list).
- **A10.** FR-327 letter kept: territory labels inside the lit faction are also faded.
- **A11.** FR-349's scale is c = (time left - 1,000 - Dt) / D, the reading that gives the edge-case figures 2.2 s + Dt and 3.4 s + Dt.
- **A12.** Live performance figures from the debug scene plus one trace (PD12).
- **A16 (M4, user-confirmed 2026-10-26).** In the debug chain (victim, absorber, step) the skip button and Escape complete the WHOLE chain (`completeTourRun` hands over the step at the skip reading, then the 005 step plays); the live viewer has separate runs, so there FR-341 is exact. Alternative: skip only the running tour.
- **A13.** Golden frame digests as regression pins; browser parity read from the debug panel (PD15). Approved by the user on 2026-10-26 with the pins computed under the frozen debug-scene rules (section 14). Verified in a browser (2026-10-26) only for: the round 1 victim tour at 8 instants and the round 3 absorber frame at t = 1000 (also the pin at t = 1310); not the other rounds or instants.

## 17. Risks
- **Size**: 008 tasks ran up to 2.3x; the checkpoints of section 14 apply. Largest: M1 T4/T5, M2 T4, M4 T3.
- **GPU rounding**: the shader computes the dim in float32; ties at .5 may differ by one from the reference; accepted (cosmetic), the δ = 0 path is exact by the gate; screenshots are the check.
- **Float parity of digests** (Node and browser both V8; `Math.exp`/`Math.log` in the geometric easing): digests use camera values rounded to 3 decimals; a mismatch is reported, not hidden.
- **Banned-word scan**: the domain words of the spec ("animation", "keyframes") cannot be identifiers; naming rule in `tasks.md`.
- **Map view complexity**: the driver adds a third mode to `paint` (whole, step, tour); every 004 to 007 test and the no-regression screenshot pair guard it.
- **Hidden-tab timing** depends on A1.
- **Spec 008 changes**: none expected (implemented); 009 relies on the shipped event order and fields (section 1).

## 18. Open questions
- None besides the approvals of section 16 and of this plan.
