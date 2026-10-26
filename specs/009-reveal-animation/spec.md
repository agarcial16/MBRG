# Spec 009 — Reveal animation (victim and absorber tours)
Status: approved (by the user on 2026-10-21; implementation depends on spec 008 milestones M3 and M5, and its plan and tasks follow 008 M5; 008 is implemented; amended by D11 to D16, user-approved 2026-10-25, with the plan and tasks, and by D17, user-approved 2026-10-25; by D18, D19 and D20, user-approved 2026-10-26)

## Context and goal
Spec 008 (implemented) makes every round two-phase: at the phase-1 close C1 the server reveals the victim of the pending round k with a `victim-revealed` event (008 FR-241, FR-287(b)), which carries the victim, its absorption candidates, the factions living at N, the reveal instant, C2, A and its sequence number, with the same fields in the public data during `phase-2` and `locked` (008 FR-288, the hook for this spec). Phase 2 runs for L1 seconds until C2; after the `locked` stage (L2, kept also after a manual or late phase-2 close, 008 FR-244(b), FR-248) the round is applied at A = C2 + L2 with a `round-applied` event, the first message that contains the absorber, carrying the application instant for every round including T (008 FR-239, FR-243, FR-254, FR-256, FR-287(c)). The 008 viewer writes the stage, the countdown and the victim's name in its panel (008 FR-305) and leaves marking the victim on the map to this spec.

User idea (chat, 2026-10-21): when the server reveals who is eliminated, the viewer plays a spectator animation: the participants (living factions) are highlighted one after another in an order that looks random, slowing down until the highlight stops on the eliminated faction, while the rest of the map stays dark ("a oscuras"). Decided by the user on 2026-10-21 (D1 to D10): the camera, the length, a short absorber tour as well, the darkness, the absorber tour timing, the panel name timing, the 008 alignment, the animation seed, reduced motion and no sound; the spec was approved the same day.

This spec defines:
1. The **victim tour**: trigger, stops, timing curve and bounds, what "dark" means exactly, the camera, the end.
2. The **absorber tour** (D3): a short tour among the victim's absorption candidates that ends on the real absorber, played only once the absorber is public.
3. How both tours fit the 008 timeline without taking prediction time, and how they behave for late joiners, reloads, hidden tabs, slow devices, resizes and the reduced-motion preference.
4. The **anti-spoiler rule** for the tours: each starts only on the event that makes its result public and uses only data public at that moment.
5. How the debug scene plays and freezes the tours offline, for fixed seed + round screenshots and golden tests without a browser.

Why: the reveal is the moment the game is about. Today it is a line of text; a short, deterministic, cosmetic sequence on the map turns it into a shared moment that every spectator sees the same way, without changing a rule, a cutoff or a result.

Everything the user did not state or decide is a **planner proposal** marked with a P number; their values are written into the requirements; the parameter proposals still open are confirmed with the review screenshots (Done criteria).

### What the user stated (2026-10-21)
- Purely cosmetic, presentation only; the viewer is a spectator client.
- The victim tour starts only on the server's phase-1 reveal event of 008; never leaks the victim earlier; the client never receives future rounds.
- The sequence is a pure function of (victim, list of alive factions, map geometry, durations, an animation seed not derived from the match secret): deterministic, golden-tested without a browser.
- No new dependency. Dimming is one per-frame factor, the highlight is one faction id per frame, the camera uses the existing camera rules with easing.
- Late joiners and page reloads skip to the final state; reduced motion shows the result without the tour.
- The tour must not take prediction time; the countdown is unaffected. Manual and clock modes behave the same; the debug scene is the offline fallback.
- Frame budget as in 006 NFR-38 (median 16.7 ms, 95th percentile 33.3 ms).
- Decisions D1 to D10 below.

## Depends on
- 004 (camera FR-144 to FR-149, address parameters FR-150, debug scene FR-156 to FR-161, reference machine and browser NFR-24), 005 (round steps FR-176 to FR-186, reduced motion FR-177 and FR-184, rounds requested FR-187, rendering inputs FR-188, frozen `transition` FR-191 to FR-194, label opacity FR-172, Dt), 006 and 007 (labels, unchanged), 008 (timeline FR-239, FR-240, FR-243, FR-244(a) to (c), late steps FR-248, round T FR-246, halts FR-251(a) and (e), anti-spoiler FR-254 and FR-256, reads FR-281(b) and (j), events FR-287(b), (c), (e), (g), reveal hook FR-288, numbering and replay FR-289(b), (d), (e), "Reported time" and FR-302, live viewer FR-303 to FR-308 with the scene rule FR-306, debug scene FR-309).
- **008 is implemented** (accepted by the user on 2026-10-25). This spec relies on its text as of 2026-10-21 (FR-231 to FR-315, NFR-47 to NFR-57, decisions up to D24, later amended by 008 D26 to D32); if 008 changes the referenced items, this spec is updated in the same change.

## Compatibility, "ask first" items and numbering
- Map format, presentation data, id image, `MatchState`, `RoundRecord`, sim and shared packages: unchanged. The server and its interface: unchanged; the tours read only what 008 sends (008 FR-287, FR-288).
- No new dependency. The tour generator is a small documented integer hash and generator written in the viewer, pinned in the plan.
- **Numbering.** Ids continue after 008 (which ends at FR-315 and NFR-57): US-31 to US-36, FR-316 to FR-355, NFR-58 to NFR-64, unique across all specs. Decisions (D1 to D20) and planner proposals (P1 ...) are this spec's own series. No id is added, retired or reused by D11 to D17.

### Earlier items touched by this spec
| Item | Change | By |
|---|---|---|
| 005 FR-188, 006 FR-212 (data given to the rendering part) | Extended with the dim factor, the undimmed faction indices, the marker and the edge indicator; still no seed, round number, round count or record. | FR-353 |
| 005 FR-177, FR-184 (reduced motion) | Extended to both tours. | FR-343, FR-344, FR-350 |
| 005 FR-183 (a request during a running step completes it) | Same rule between a tour and a round step, in both orders. | FR-339, FR-340 |
| 005 FR-176, FR-186 (the round step starts at the request; only the drawing is animated) | On a live `round-applied`, the drawing of the 005 step starts after the absorber tour (at most about 2.5 s later); the displayed round, panel, controls and address still change at once (D5). | FR-345 |
| 004 FR-150, 005 FR-191 to FR-194 (address parameters) | New debug parameter `reveal`. | FR-351, FR-352 |
| 004 FR-155 scans and NFR-25 clock rule (as amended by 005 NFR-35) | Allowed: tour parameters, the seeded generator in pure code, and clock reads for the tours in the part of the viewer that drives the animation. | NFR-60 |
| Traceability test | Expected list extended to FR-355 and NFR-64. | NFR-63 |

### Compatibility with spec 008 (D7)
The user approved on 2026-10-21 that 008 adopts five wording fixes so that both specs agree; this spec relies on the amended 008 text and does not amend 008 itself:
- 008 FR-303: on `round-applied` the viewer plays the 005 step, after the spec 009 absorber tour when one plays (FR-345).
- 008 FR-304: no draw of the engine's randomness in the browser (the cosmetic tour generator seeded by public data is allowed), and the rendering part may also get the spec 009 tour data (FR-317, FR-353, FR-354).
- 008 FR-305: during a spec 009 victim tour the panel shows "revelando…" and the victim's name only from the victim's stop (D6, FR-330).
- 008 FR-288: the late-join fields serve the panel and the freshness check; late joiners get the final state, not a tour (FR-319).
- 008 FR-309: the debug scene stays offline and local; spec 009 adds the `reveal` parameter (FR-351, FR-352), in development builds only (008 FR-306).
Checked against the amended 008 text (008 D19, D20, "Related later specs"): all five points match. Further 008 facts used here: a manual or late phase-2 close keeps the `locked` stage (008 FR-244(b), D22); the application instant in `round-applied` (FR-287(c)); no `schedule` after round T (FR-246, FR-287(e)); the reported time (Definitions, FR-302); subscribing with the public data's last event sequence number (FR-289(b), FR-307); victim fields kept for a halted match (FR-251(e)).
If the amended 008 text differs from these points, the difference is resolved before either spec is approved. Marking the victim on the map, left out of 008, is covered here during the tours only (FR-326 to FR-329, FR-347).

## Users
- **Spectator**: watches a live match and sees the reveals as short sequences on the map.
- **Player**: predicts through another client; the tours never shorten a prediction window.
- **Reviewer (the user)**: accepts the look from screenshots of the debug scene with a tour frozen at fixed instants.
- **Developer**: needs the tours stated as pure functions with fixed inputs, golden-tested in Node.

## User stories
- US-31. As a spectator, I want the map to go dark and a highlight to jump between the living factions, slowing down until it stops on the eliminated one, so that the reveal feels like a shared dramatic moment.
- US-32. As a spectator, I want a short similar sequence among the victim's neighbours that stops on the one that absorbs it, right before its territory changes colour, so that the second reveal has its own moment.
- US-33. As a spectator who joins late, reloads or prefers reduced motion, I want to see the result at once, so that I am never shown a stale or uncomfortable sequence.
- US-34. As a player, I want the animations never to take time from a prediction window or to show anything before the server reveals it, so that predictions stay fair.
- US-35. As a reviewer, I want to freeze a tour at a fixed instant in the debug scene, so that I can accept it from screenshots.
- US-36. As a developer, I want each tour to be a pure function of public inputs with a seed from public data, so that every spectator sees the same tour and tests are golden.

## Definitions
- **Victim reveal** of round k: in a live match, the `victim-revealed` event (008 FR-288: k, victim, candidates, living factions, reveal instant, C2, A, sequence number); in the debug scene, a forward round step from N − 1 to N (FR-351).
- **Absorber reveal** of round k: in a live match, the `round-applied` event of round k (008 FR-287(c)), the first message that contains the absorber (in its record), with the application instant; in the debug scene, the same forward step, after the victim tour.
- **Participants** P of round k: the living factions of the victim reveal (008 FR-288), in faction order; n = |P|. They must equal the factions living in the displayed state N = k − 1 (FR-320).
- **Candidates** Q of round k: the absorption candidates of the victim from the victim reveal or from the public data during `phase-2` and `locked` (008 FR-288); d = |Q|.
- **Animation seed** σ (D8): the first 32 bits of a documented integer hash (pinned in the plan) of a text: `<match id>:<k>` for the victim tour and `<match id>:<k>:absorber` for the absorber tour; in the debug scene `debug:<k>` and `debug:<k>:absorber`. Public data only; never derived from the match secret, a round seed, the debug seed, or the state of round k.
- **Tour**: the stops s_1 ... s_H (factions) with start instants τ_1 ... τ_H in whole milliseconds from the start of the tour, the dim ramp, the camera keyframes and the end instant D; s_H is the result (victim or absorber).
- **Elapsed time** t: wall-clock milliseconds since the clock reading at which the reveal is handled (D11); the first frame draws t = now − handling reading, normally under one frame (as 005 FR-182 for the steps, which start at the request reading).
- **Highlighted faction** at t: s_i for the largest i with τ_i ≤ t.
- **Undimmed set** at t: the highlighted faction (victim tour), or the victim and the highlighted candidate (absorber tour).
- **Dim** δ(t): the fraction by which every pixel outside the undimmed set is darkened (0 = normal; δmax = 0.65 at full dark, i.e. 35 % brightness, D4).
- **Overview camera**: the 004 FR-144 view (whole image at fit scale, centred) for the current drawing area.
- **Framing box** of a set of factions (P6): the bounding rectangle of the union of the unit squares of their main regions (the label sets of their faction labels, 005 FR-167), in map units, in the displayed state.
- **Framing** of a framing box: centre at the box centre; scale = the smaller of 0.5 × drawing width / box width and 0.5 × drawing height / box height, limited to the range from the fit scale to the smaller of 4 × fit scale and L0 (005, so faction labels stay readable), then clamped by 004 FR-146 and FR-147.
- **Easing** of the camera from camera a to camera b over duration E: centre linear, scale geometric (linear in its logarithm), progress smoothstep(0, E, time since the easing started).
- **Tiny** faction (P7): a faction whose framing box at the current camera is smaller than 24 CSS pixels in both width and height.
- **Instants** are whole milliseconds, as in 008; every duration of this spec is a whole number of milliseconds.
- **Reported-time estimate**: the largest 008 reported time received for the match (008 Definitions "Reported time", FR-302) plus the viewer's monotonic milliseconds elapsed since it was received; it never decreases. The **age** of a match instant is max(0, reported-time estimate − instant), never negative.
- **Fresh** reveal (P10): a reveal received as an event over the stream (live, or replayed by 008 FR-289(d) after a reconnection or after subscribing with the last event sequence number of the public data, FR-289(b), 008 FR-307), not read from the public data, while the displayed round is N = k − 1 and the match is not halted, with an age of at most Dlate = 5,000 ms at receipt. The instant of a victim reveal is its reveal instant (008 FR-288); that of an absorber reveal is the application instant carried by `round-applied` (008 FR-287(c)), for every round including T.
- **Final state** of the victim tour: no dim, no highlight, no marker, the camera at the victim framing (FR-332) or the user's camera (FR-333), and the panel showing the victim's name. A tour skipped by FR-319, FR-320 or FR-336 has the final state with the camera unchanged (P12).

## Functional requirements

### Victim tour: trigger, inputs and anti-spoiler
- FR-316: WHEN the viewer showing a live match receives a fresh victim reveal of round k, THE SYSTEM SHALL start the victim tour of round k at the clock reading at which the reveal is handled, drawing it from the next frame (D11), unless FR-319, FR-320, FR-336 or FR-343 applies.
- FR-317: THE SYSTEM SHALL compute a tour only from the result it ends on (victim or absorber), the participants or candidates, the map geometry (id image and label sets of the displayed state), the tour parameters of this spec and σ, and only after the reveal of that result has been received; it SHALL NOT use, request or hold the match secret, a round seed, or anything of round k not yet received (in particular no absorber before the absorber reveal), nor anything of a later round (008 FR-254, 005 FR-187); its generator SHALL be unrelated to the engine's random stream.
- FR-318: THE SYSTEM SHALL give the same stops, instants and dim ramp to every viewer of the same match and round, and the same camera keyframes for the same drawing area and starting camera, by deriving σ from public data only (D8).
- FR-319: IF a reveal is not fresh (read from the public data at load or on reload, including the victim fields kept in the public data of a halted match, 008 FR-251(e); received with an age above Dlate; or arriving while the displayed round is not k − 1), THEN THE SYSTEM SHALL play no tour for it and show its final state with the camera unchanged (for a halted match, the panel as 008 FR-305 shows it); a viewer that joins or reloads SHALL subscribe with the last event sequence number of the public data it read (008 FR-289(b), FR-307), so it receives only later events.
- FR-320: IF the participants of the victim reveal differ from the factions living in the displayed state, the victim is not among them, or n < 2, THEN THE SYSTEM SHALL play no victim tour, show the final state with the camera unchanged and report the mismatch in the debug panel only, and in the live viewer (which has no debug panel) in development builds only as a Spanish line in the message area of its panel, nothing in production (D13).

### Victim tour: stops and timing curve (D2)
- FR-321: THE SYSTEM SHALL use H = 12 stops when n ≥ 3 and H = 6 stops when n = 2 (P3); the last stop s_H SHALL be the victim: the tour SHALL never end on a faction other than the victim.
- FR-322: THE SYSTEM SHALL draw the stops backwards from s_H with the generator seeded by σ: for i = H − 1 down to 1, s_i is drawn uniformly from the factions of the tour's set (participants, or candidates for FR-346) that are not s_{i+1} and not among s_{i+1} ... s_{H−1} (the result s_H is not counted as shown), or, when that set is empty, uniformly from the factions that are not s_{i+1} (D17). Hence no two consecutive stops are equal, s_{H−1} is never the result, every faction of the set alternates before any is shown twice, the result may appear before the last stop, and with two factions the stops alternate. Victim tours alternate over all living factions; absorber tours over the candidates only (one candidate: no alternation).
- FR-323: THE SYSTEM SHALL give stop i (1 ≤ i ≤ H − 1) the dwell d_i = floor(dmin + (dmax − dmin) × ((i − 1) / (H − 2))²) ms with dmin = 120 and dmax = 700 (P4), so that the highlight slows down quadratically; τ_1 = 0, τ_{i+1} = τ_i + d_i; the victim's stop starts at τ_H = Σ d_i (3,549 ms for H = 12; 1,687 ms for H = 6).
- FR-324: THE SYSTEM SHALL hold the last stop for Dhold = 1,500 ms from τ_H and then fade the dim out over Dfade = 300 ms; the tour ends at D = τ_H + Dhold + Dfade (5,349 ms for H = 12, about 5.4 s as decided in D2; 3,487 ms for H = 6). A victim tour at nominal speed SHALL last at least 3,000 ms and at most 6,000 ms.
- FR-325: THE SYSTEM SHALL ramp the dim as δ(t) = δmax × smoothstep(0, Dfade, t) for t < τ_H + Dhold, δ(t) = δmax × (1 − smoothstep(0, Dfade, t − τ_H − Dhold)) afterwards, and δ(t) = 0 for t ≥ D.

### Highlight and dark (D4)
- FR-326: WHILE a tour is playing, THE SYSTEM SHALL draw every pixel whose map unit belongs to a land territory of a faction of the undimmed set exactly as without a tour, and every other pixel (land of other factions, sea, lakes and background, the area outside the image, and every border line pixel whose map unit is not in the undimmed set) with each colour channel c (0 to 255) replaced by floor(c × (1 − δ(t)) + 0.5), with δmax = 0.65 (35 % brightness); with δ(t) = 0 the drawing SHALL equal, pixel for pixel, the drawing without a tour.
- FR-327: WHILE a tour is playing, THE SYSTEM SHALL draw the labels of the factions of the undimmed set at opacity factor 1 (still subject to 005 FR-172 at the current scale), and every other faction label, every territory label and every leader line at opacity factor 1 − δ(t) / δmax, so that they are hidden at full dark (D4).
- FR-328: THE SYSTEM SHALL change the highlighted faction at each stop instant at once, with no crossfade (P4), and SHALL draw on every frame the stop active at its elapsed time, so that a frame falling after several stops shows the latest one.
- FR-329: WHILE the highlighted faction is tiny, THE SYSTEM SHALL draw a marker around it: a circle centred on its framing box centre, with radius 16 CSS pixels plus half the on-screen diagonal of its framing box, 2 CSS pixels wide in white with a 1-pixel black halo (005 FR-174 ink), never dimmed (P7).
- FR-330: THE SYSTEM SHALL never dim or hide the panel, the controls or the countdown (D4); WHILE a victim tour is playing before τ_H, the panel SHALL show the Spanish text "revelando…" instead of the victim's name, and from τ_H on the victim's name (D6, amended 008 FR-305); in the debug scene the record line follows the same rule and, during an absorber tour, hides the absorber until that tour ends (D12); the stage and the countdown SHALL be shown throughout from the reported-time estimate (008 FR-302, FR-305).

### Victim tour: camera (D1)
- FR-331: WHEN a victim tour starts and the camera is not the overview camera, THE SYSTEM SHALL ease the camera to the overview camera over Dcam_in = 800 ms from t = 0; the stops run meanwhile.
- FR-332: WHEN the victim's stop starts (t = τ_H), THE SYSTEM SHALL ease the camera over Dcam_out = 1,200 ms to the framing of the victim's framing box (the **victim framing**).
- FR-333: IF the user pans, zooms or resets the camera at any time during a tour, THEN THE SYSTEM SHALL stop every camera easing of that tour for its remaining time and leave the camera to the user (004 FR-144 to FR-148, D1); stops, dim and marker SHALL continue; WHILE the highlighted faction's framing box is wholly outside the drawing area, THE SYSTEM SHALL draw an edge indicator (a white triangle with black halo, 12 CSS pixels, never dimmed) on the border of the drawing area in the direction of the box centre.
- FR-334: WHEN a victim tour ends, THE SYSTEM SHALL leave the camera where the tour put it (or where the user put it); it SHALL NOT return to the overview by itself (D1). WHEN an absorber tour ends, THE SYSTEM SHALL ease the camera back to the overview over the last 800 ms of the tour (D18); WHEN the victim tour of the last round ends with no absorber tour after it (fewer than two candidates), THE SYSTEM SHALL do the same over its last 800 ms (D20); in both cases only unless the user has taken the camera; the reset control returns to the overview as before.
- FR-335: IF the drawing area is resized during a tour, THEN THE SYSTEM SHALL recompute the overview camera, the framings, tinyness and the marker for the new area and continue at the same elapsed time, the camera at t being the easing between the camera at the start of the easing (clamped to the new area) and the recomputed target.

### Timing against the 008 timeline
- FR-336: WHILE the clock of the match runs, IF the time left until C2 at the start of the victim tour (C2 of the victim reveal minus the reported-time estimate) minus 1,000 ms is less than D, THEN THE SYSTEM SHALL scale every duration of the tour (dwells, hold, fades, camera easings) by c = (time left − 1,000 ms) / D when c ≥ 0.5, and otherwise SHALL play no tour and show the final state with the camera unchanged (D2); a played victim tour therefore ends at least 1,000 ms before C2. Under a reduced-motion preference the same rule applies to the still tour of FR-343 with its D = 1,800 ms (D14).
- FR-337: THE SYSTEM SHALL keep the tours cosmetic: they SHALL send nothing to the server, SHALL NOT delay, pause or alter the countdown, any cutoff or any step of 008, and SHALL NOT delay the handling of any event or the update of the displayed round, panel, controls and address.
- FR-338: WITH timing `manual`, THE SYSTEM SHALL play the tours at nominal durations (FR-336 and FR-349 do not apply); manual and clock modes SHALL give the same stops for the same match, round and result.
- FR-339: IF an absorber reveal, another victim reveal, a `match-halted` event (008 FR-251(a), FR-287(g)), a round request (any 004 FR-154 control), the skip control (FR-341) or the page's unload arrives during a victim tour, THEN THE SYSTEM SHALL complete the victim tour at once (its final state) and then handle the event or request as specified (an absorber reveal by FR-345, a halt by 008 FR-305).
- FR-340: IF a 005 round step is playing when a fresh victim reveal arrives, THEN THE SYSTEM SHALL complete the step at once (005 FR-183) and then start the tour.
- FR-341: THE SYSTEM SHALL offer during a tour a skip control, a button with a Spanish label and the Escape key, that completes the running tour at once (and, for an absorber tour, starts the 005 step as FR-345 does at the tour's end).
- FR-342: THE SYSTEM SHALL take t from the wall clock (005 FR-182), counted from the handling reading (D11): a hidden page or a device that drops frames SHALL draw the tour at the current elapsed time, and the first frame with t ≥ D SHALL draw the final state and end the tour.

### Reduced motion
- FR-343: IF the browser reports a reduced-motion preference when a victim tour would start, THEN THE SYSTEM SHALL show no stops before the victim's and move no camera; it SHALL show the victim's name at once and (D9) draw the victim undimmed with the dim of FR-325 for Dhold, faded in and out over Dfade, then the final state with the camera unchanged; this still tour lasts D = 1,800 ms (Dhold + Dfade, the fade-in inside the hold) and is scaled or skipped by FR-336 (D14; when skipped the victim's name is shown at once).
- FR-344: IF the reduced-motion preference changes during a tour, THEN THE SYSTEM SHALL complete the tour at once (005 FR-184).

### Absorber tour (D3, D5)
- FR-345: WHEN the viewer showing a live match receives a fresh absorber reveal of round k (the `round-applied` event, sent at the application A, never before the phase-2 cutoff C2, 008 FR-254, FR-256) and holds the candidates of round k with d ≥ 2, THE SYSTEM SHALL at once set the displayed round, controls and address to round k (005 FR-186; the address camera is written once at the tour end, D16), and the panel to round k except that its legend (territory counts, alive) follows the drawn state k − 1 until the absorber tour ends (D12), keep holding the state at k − 1 for drawing (as for a backward step, 005 FR-187), play the absorber tour over the drawing of the state at k − 1, and at its end start the 005 round step from k − 1 to k (008 FR-303); the absorber SHALL never be shown, used or computed before that event (D5: only when L2 = 0 are the phase-2 close and the application one instant (008 FR-240), so the tour plays at the phase-2 close; otherwise, also after a manual or late phase-2 close, which performs only the close and keeps the `locked` stage until the application L2 later (008 FR-244(b), FR-248), it plays at the application; with timing `manual` the application is its own advance).
- FR-346: THE SYSTEM SHALL build the absorber tour with FR-322 over the candidates Q, ending on the absorber of the round-k record, with H = 6 stops, dwells by FR-323 with dmin = 120 and dmax = 500, Dhold = 800 ms and Dfade = 300 ms: τ_H = 1,311 ms and D = 2,411 ms (about 2.5 s, D3).
- FR-347: WHILE an absorber tour is playing, THE SYSTEM SHALL draw the victim and the highlighted candidate undimmed (the undimmed set) and everything else by FR-326 and FR-327, with the marker of FR-329 for a tiny highlighted candidate.
- FR-348: WHEN an absorber tour starts, THE SYSTEM SHALL ease the camera over 800 ms to the framing of the framing box of the victim and all candidates, unless the user has taken the camera (FR-333); the camera stays there while the absorption plays and eases back to the overview over the last 800 ms of the tour, so it is at the overview when the absorber tour ends (FR-334, D18).
- FR-349: WHILE the clock of the match runs and k < T, IF the time left until the phase-1 close of round k + 1 (C1 of round k + 1 = application instant of round k + I − L1 − L2, since round k + 1 is anchored at the application, 008 FR-239, FR-244(c); minus the reported-time estimate) minus 1,000 ms minus Dt (005) is less than the absorber tour's D, THEN THE SYSTEM SHALL scale its durations by c as in FR-336 when c ≥ 0.5, and otherwise SHALL play no absorber tour and start the 005 step at once; for k = T (the match finishes, no `schedule` event follows, 008 FR-246, FR-287(e)) the absorber tour plays at nominal durations; this rule SHALL NOT wait for the `schedule` event.
- FR-350: IF d = 1, the candidates of round k are not held, the absorber reveal is not fresh, the absorber is not among the candidates, or a reduced-motion preference is reported, THEN THE SYSTEM SHALL play no absorber tour and handle the `round-applied` event as 008 FR-303 does (the 005 step, drawn at once under reduced motion by 005 FR-177); IF a victim tour is still playing when the absorber reveal arrives, THEN THE SYSTEM SHALL complete it at once first (FR-339); IF a round request, a new victim reveal, a `match-halted` event or the skip control arrives during an absorber tour, THEN THE SYSTEM SHALL complete it at once and continue with the 005 step (completed at once too when the request needs it, 005 FR-183).

### Debug scene (offline fallback)
- FR-351: THE SYSTEM SHALL accept, only in development builds and only in the debug scene (008 FR-306(c), (d), FR-309; production builds have no debug scene and a viewer without a match id shows no scene, so `reveal` does not exist there), the optional address parameter `reveal`: with the value `on`, every forward one-round step from N − 1 to N SHALL play the victim tour of round N over the state at N − 1 (participants living at N − 1, victim and absorber from the record of round N, candidates computed locally as the sim does, σ from `debug:<N>`), then the absorber tour (when d ≥ 2), then the 005 round step; with `victim:<t>` or `absorber:<t>` (t a whole number from 0 to that tour's D), THE SYSTEM SHALL draw that tour of the displayed round N ≥ 1 over the state at N − 1 frozen at elapsed time t, with no time running and the camera of the address (or the tour's camera at t when the address has no camera), while the panel, controls and address show round N; a round change leaves a frozen tour and drops its value from the address (`on` stays), and an address camera with a frozen value counts as the user's camera (D15).
- FR-352: IF `reveal` has another value, t is out of range, the displayed round is 0 for a frozen value, d < 2 for `absorber:<t>`, or `transition` (005 FR-191) is also present, THEN THE SYSTEM SHALL show a Spanish message naming `reveal`, ignore it (with `transition` the frozen step wins) and remove it from the address at the next address update; the debug scene SHALL use only rounds 0..N (005 FR-187) and stay offline (008 FR-309).

### Rendering inputs and purity
- FR-353: THE SYSTEM SHALL give the rendering part, besides the data of 005 FR-188 and 006 FR-212, only: δ(t), the undimmed faction indices (none outside a tour), the label opacity factors of FR-327, the marker circle and the edge indicator in CSS pixels; it SHALL NOT tell it which faction is the result, nor give it a seed, a round number, a round count or a record.
- FR-354: THE SYSTEM SHALL compute each tour with a pure function of (kind, result, participants or candidates, victim for the absorber tour, framing boxes, tour parameters, σ, scale factor c) and each tour frame (undimmed set, δ, label opacity factors, camera, marker, indicator, ended or not) with a pure function of (tour, t, drawing area, image size, camera at the start of the tour, user camera taken or not), with no DOM, clock or randomness other than the generator seeded by σ.
- FR-355: THE SYSTEM SHALL draw a frame with δ(t) = 0 and no undimmed set, marker or indicator identically to the drawing of 004 to 008 at the same camera.

## Non-functional requirements
- NFR-58 (Performance, P15): on the dev map, the reference machine and browser of 004 NFR-24 and a 1920 × 1080 drawing area: frame time median at most 16.7 ms and 95th percentile at most 33.3 ms over each whole tour (as 006 NFR-38), with every allowed label drawn; the first frame of a tour drawn within 50 ms of handling its reveal; no label layout recomputed during a tour (the labels of the state at k − 1 are reused; the labels of round k may be computed while the absorber tour plays, within the 007 NFR-43 budget). Figures recorded in the pull request.
- NFR-59 (Determinism, golden): golden files pin, for the dev map with seed 1 in the debug scene and for a fixed match id, every round's σ, stops, instants and D of both tours, and digests of the frame data of FR-354 at t = 0, 400, 1,000, τ_H − 1, τ_H, τ_H + 800, D − 1 and D at 1920 × 1080; the same goldens in Node and in the reference browser; tests check the FR-322 properties (last stop is the result, no adjacent repeats, the visiting rule) over every round of seeds 1 to 100 and over hand-made sets of 2, 3, 11, 12 and 70 factions.
- NFR-60 (Purity): the functions of FR-354 and the generator are pure, with no DOM, graphics, clock or `Math.random()`; only the part of the viewer that drives the animation reads the clock; the 004/005 scans are amended only by an explicit list in the plan.
- NFR-61 (Anti-spoiler, verified): tests give the victim-tour functions inputs that differ only in data not public at the victim reveal (absorber, state and record of round k, round seed) and check identical tours and frames (the inputs exclude them by type and by a source scan); a test with a fake event stream checks that no tour data is computed before its reveal event is received, that the absorber is not read before the `round-applied` event, and that no request for round-k data is made during a victim tour.
- NFR-62 (Visual verification): screenshots of the debug scene with `reveal` frozen at the instants of NFR-59, at 1920 × 1080: victim tour for seed 1 at round 1 (5 participants) and at round T (n = 2); absorber tour for the first round of seed 1 with d ≥ 3 (found by a test) and one with d = 2; the round where the victim is the smallest faction by area (marker case if it is tiny at the overview, found by a test); one with a user camera away from the highlight (edge indicator); reviewed and accepted by the user with the values of δmax, dmin, dmax, Dhold, Dfade and H.
- NFR-63 (No regression and traceability): 001 to 008 tests pass with the meaning of their assertions; goldens and the dev map are byte-identical; FR-355 checked by a test that the drawing at δ = 0 equals the drawing without a tour; every FR and NFR id of this spec appears in a test title; ids checked by screenshots or measurements are traced by tests of their pure part; the traceability test expects ids up to FR-355 and NFR-64.
- NFR-64 (Dependencies and language): no dependency added; every new visible text ("revealing", the skip button, the `reveal` messages) lives in the UI strings module in Spanish; code, comments and docs in English.

## Edge cases
- One faction alive: the match is finished; no reveal, no tour.
- Two alive (round T): victim tour with H = 6 alternating between the two and ending on the victim; the other is both the only candidate (d = 1, no absorber tour) and the winner, public at the same instant (008 FR-237, FR-246).
- Three alive: every stop differs from its neighbours; the three factions alternate and the victim appears at the last stop (FR-322, D17).
- More participants than stops (about 70 on target maps): 11 distinct decoys, none the victim; most factions are not shown (accepted).
- "Victim equal to the previous highlight": impossible (FR-322, s_{H−1} is never the result); the previous victim is no longer a participant.
- Victim with d = 2: absorber tour alternates between the two candidates and ends on the absorber.
- Tiny islands and small factions: the marker (FR-329); the framing cap (4 × fit, L0) keeps context around a one-territory island.
- A faction with several regions: all its land is undimmed; the framing uses its main region (P6), so a far island may stay outside the framing.
- A huge victim (more than half the map): the victim framing falls back to the fit scale.
- Victim or candidate off-screen: impossible during the victim stops while the camera follows FR-331 (whole image shown); after the user took the camera, the edge indicator (FR-333).
- Window resize mid-tour: FR-335; no restart, no jump.
- Tab hidden: the wall clock runs on from the handling reading (FR-342, D11); on return the current point or the final state is drawn; a reveal handled more than Dlate after its instant plays no tour (FR-319).
- Slow device: dwells shorter than a frame may be skipped on screen; the last stop (at least the hold) is always drawn.
- Reduced motion: still highlight of the victim (FR-343); no absorber tour (FR-350).
- Very short phase 2 (L1 below about 3.7 s): no victim tour; L1 between about 3.7 s and 6.3 s: a compressed one (FR-336).
- Short phase 1 of the next round (I − L1 − L2 below about 2.2 s + Dt): no absorber tour, the 005 step at once; below about 3.4 s + Dt: compressed (FR-349).
- L2 > 0 (stage `locked`): nothing plays during `locked`; the absorber tour starts at A, not at C2, because the absorber is secret until A (FR-345, D5).
- Manual or late phase-2 close (008 FR-244(b), FR-248): only the close is performed; the `locked` stage lasts L2 (with L2 = 0 the application follows at the same instant, 008 FR-240); the absorber tour plays when `round-applied` arrives; a victim tour still running then completes at once first (FR-339). With timing `manual`, the host's third advance of the round applies it.
- Late step after a server delay (008 FR-248): the reveal or application instant is the late instant; the tour plays if its age at receipt is at most Dlate.
- Match halted during phase 2 or `locked` (`victim-mismatch`, `map-changed`): `match-halted` completes any running tour at once (FR-339, FR-350); no `round-applied` follows, so no absorber tour; the victim fields stay in the halted match's public data (008 FR-251(e)), but reading them never starts a tour (FR-319); the panel shows the halted notice (008 FR-305).
- Round T: `round-applied` carries the application instant (008 FR-287(c)) and no `schedule` event follows (008 FR-246); freshness uses that instant and the absorber tour (d ≥ 2 only, which cannot happen with two factions alive) plays at nominal durations (FR-349).
- The viewer stepped back to an earlier round when a reveal arrives: not fresh (FR-319); panel as in 008.
- Reconnection that replays `victim-revealed` or `round-applied` (008 FR-289(d), FR-307) with an age of at most Dlate: fresh, the tour plays; above Dlate: final state.
- Late joiner during `phase-2` or `locked`: the victim comes from the public data (008 FR-288), so no tour (FR-319); the panel shows the victim at once; it subscribes with the public data's last event sequence number (008 FR-289(b)), so it misses nothing after the read; the candidates are held, so a later fresh `round-applied` still plays the absorber tour.
- A viewer that reads the public data in `phase-1` and subscribes with its last sequence number just before the reveal: the `victim-revealed` event is delivered on the stream (replayed or live) and plays if its age is at most Dlate.
- A subscription opened without a sequence number receives live events only (008 FR-289(e)); the viewer always subscribes with a number (FR-319).
- Two viewers of the same match: the same stops and instants (FR-318); cameras may differ with their drawing areas and their own input.
- Participants of the event differ from the displayed state (corrupted or mismatched data): no tour (FR-320).

## Out of scope
- Sound and music (D10).
- Marking the victim on the map after the victim tour has ended (rest of phase 2 and `locked`).
- Any change to the server, its events or timing, the sim, the map package or the rules.
- Animations for the winner, the end of the match, or prediction results.
- Mobile layout and touch; 3D camera moves.

## Done criteria
- Every FR and NFR id of this spec appears in a test title (traceability); NFR-58 and NFR-62 traced by tests of their pure part, with figures and screenshots in the pull request.
- The goldens of NFR-59 pass in Node; the same digests are recorded in the reference browser.
- The anti-spoiler tests of NFR-61 pass.
- A local run of the live viewer against the 008 server with a fake clock shows: the victim tour at a fresh reveal; no tour after a reload in phase 2; a compressed and a skipped victim tour with short L1; the absorber tour at the application followed by the 005 step, with L2 = 0 and with L2 > 0; recorded in the pull request.
- NFR-62 screenshots and the parameter values accepted by the user, which also confirms the parameter proposals P3, P4, P6, P7, P10, P12 and P17; the NFR-58 figures confirm P15.
- `npm test` and `npm run typecheck` green, also with `CI=1`; `MEMORY.md` updated.

## Decisions
Decided by the user (chat answers, 2026-10-21); the whole spec was approved by the user on 2026-10-21.
- D1. **Camera**: overview during the stops, then ease to the victim and stay there; the user can take the camera at any time (FR-331 to FR-334). Discarded: following every stop; no camera move.
- D2. **Length**: about 5.4 s with 12 stops; shrunk to half or skipped when phase 2 is too short (FR-321 to FR-324, FR-336). Discarded: about 3 s; about 8 s.
- D3. **Absorber tour: yes**, short (about 2.5 s), at the phase-2 close before the round step, among the victim's absorption candidates, ending on the real absorber and never leaking it before the phase-2 cutoff (FR-345 to FR-350). How "at the phase-2 close" is read when L2 > 0 is D5.
- D4. **Darkness**: 35 % brightness (δmax = 0.65) for everything except the highlighted faction, other labels hidden, panel never dimmed (FR-326, FR-327, FR-330).
- D5 (closes P18, option A). **Absorber tour timing**: the absorber is public only at the application A (008 FR-254, FR-256), which equals the phase-2 close only when L2 = 0 (008 FR-240); a manual or late phase-2 close keeps the `locked` stage until A (008 FR-244(b), FR-248). The absorber tour starts on `round-applied` and plays over the OLD state (the victim still in its colour), ends on the absorber, and the 005 round step starts when it ends; the round number, panel and address change at once; the next round's phase 1 is not shortened (FR-345, FR-349). Discarded: (B) a tour over the new owners (the result is visible before the tour stops); (C) a tour at C2 (needs the absorber at C2, forbidden by 008 D8 and FR-254); (D) relying on hosts choosing L2 = 0.
- D6 (closes P9). **Panel name timing**: during a victim tour the panel shows "revelando…" and the victim's name only when the tour stops on it (FR-330, amended 008 FR-305). Discarded: the name at once.
- D7. **008 alignment**: 008 adopts the five wording fixes listed under "Compatibility with spec 008" (approved by the user; applied in 008 by its planner).
- D8 (closes P2, with the spec approval). **Animation seed** = hash(match id, round), with `:absorber` for the absorber tour (`debug:` in the debug scene): public, every spectator sees the same tour (Definitions, FR-318). Discarded: the round only.
- D9 (closes P14). **Reduced motion**: a still highlight of the victim with fades for 1.5 s, no stops, no camera move, and no absorber tour (FR-343, FR-350). Discarded: panel only.
- D10 (closes P16). **Sound** out of scope.
Amendments recorded at the planning of this spec (2026-10-25), all user-approved on 2026-10-25 with the plan and tasks (the plan numbers them A1, A2, A3, A5, A6, A7); no id, no other part of any requirement and no approved status changes:
- D11 (plan A1). **Start instant of a tour** (Definitions "Elapsed time", FR-316, FR-342, edge case "Tab hidden"): t = 0 is the clock reading at which the reveal is handled (the runner's or the debug scene's request reading), and the first frame draws t = now − handling, normally under one frame. Why: with "the frame on which the tour started", a reveal received in a hidden tab would play its whole tour minutes later on return, against the edge case "on return the current point or the final state is drawn"; 005 steps already start at the request reading. Discarded: the letter (first frame).
- D12 (plan A2). **Panel during tours** (FR-330, FR-345, D5): during an absorber tour the live legend (territory counts, alive) follows the drawn state k − 1 until the tour ends, and in the debug scene the record line shows "revelando…" until the victim's stop and hides the absorber until the absorber tour ends, the pointer readout following the drawn state; the round line, controls and address still change at once. Why: the legend shows the absorber's new count at once, and the debug record line names victim and absorber at once, which shows each result before its tour stops. Discarded: the letter of FR-345 ("panel at once"; the legend gives the absorber away).
- D13 (plan A3). **FR-320 report in the live viewer**, which has no debug panel: in development builds a Spanish line in the live panel's message area; nothing in production. Discarded: nothing in the live viewer.
- D14 (plan A5). **Reduced motion under a short phase 2**: FR-336 applies to the still tour of FR-343 with its D = 1,800 ms (compressed, or skipped below c = 0.5 with the name at once). Discarded: the still tour always at 1,800 ms (it may end after C2 − 1 s).
- D15 (plan A6). **Frozen `reveal` values** (FR-351, FR-352): a round change leaves a frozen tour and drops `victim:<t>` / `absorber:<t>` from the address (as 005 FR-194); `on` stays; an address camera with a frozen value counts as the user's camera (edge indicator shown when the highlight is off-screen). Discarded: keep the frozen value across round changes (it would freeze tours of other rounds).
- D16 (plan A7). **Address camera during a tour** (008 D31 rewrites the address on every camera change): the tour's own camera moves are written to the address once, at the tour end; the user's moves at once. Discarded: a `replaceState` per frame (60 per second).
- D18 (2026-10-26, user-approved). **Camera after the absorption**: the absorber tour frames the victim and the candidates while the absorption plays and then returns to the overview, so the map is whole again when the round ends (FR-334). The victim tour keeps its framing (D1). Discarded: the camera stays on the absorbed faction (the previous rule).
- D20 (2026-10-26, user-approved). **Last round without absorber tour**: the victim tour of the last round eases back to the overview over its last 800 ms when no absorber tour follows (fewer than two candidates); the camera then ends at the overview, as after D18. Discarded: the camera stays on the victim after the last round (the previous rule).
- D19 (2026-10-26, user-approved; supersedes the D17 wording). **Alternation**: the victim tour alternates over all living factions before the result (the result may appear before the last stop); only the absorber tour alternates over the candidates, and with one candidate it does not alternate. Discarded: the result only at the end for three or more factions (D17 of 2026-10-25).
- D17 (2026-10-25, user-approved after the review of M1). **Stops of a small set** (FR-322, edge case "Three alive"): the fallback of the stop draw, used when every faction of the set has already been placed, excludes the result as well when another faction exists, so that with at least three factions the result appears only at the end and with two the stops alternate. Why: the closing sentence of FR-322 and the edge case promised this, but the algorithm let the result return mid-tour for 3 to 11 factions (for example s_9 with three factions). Discarded: keep the algorithm and drop the promise.

## Planner proposals
Parameters kept as proposals, to be confirmed by the user with the NFR-62 screenshots (Done criteria); the values are in the requirements.
- P3. H = 6 when only two factions are alive (forced alternation); 12 otherwise (D2).
- P4. Timing curve: quadratic dwell growth 120 → 700 ms, instant switches, hold 1.5 s, fades 0.3 s. Alternatives: geometric growth; crossfaded switches.
- P6. Framing on main regions, 50 % of the drawing area, scale between fit and min(4 × fit, L0). Alternatives: all land; the victim plus its candidates already at the victim's stop.
- P7. Marker ring for factions under 24 CSS pixels at the current camera.
- P10. Freshness: an event (not public data at load) with an age of at most 5 s at receipt, by the 008 reported time, using the reveal instant of 008 FR-288 for the victim and the application instant of 008 FR-287(c) for the absorber.
- P12. Skipped tours leave the camera unchanged.
- P15. Performance targets of NFR-58.
- P17. Compression rule (end ≥ 1 s before the next cutoff, durations down to half, otherwise skip), for both tours.
- (Closed: P9 by D6, P18 by D5, P2 by D8, P14 by D9, P16 by D10.)

## Decisions needed from the user
None before implementation. The parameters P3, P4, P6, P7, P10, P12, P15 and P17 are confirmed with the NFR-62 screenshots and NFR-58 figures (Done criteria); a change to any of them is a spec change.

## Open questions
- None.
- Checked on 2026-10-21 (not a user question): the amended 008 text (decisions up to D24) matches the five points of "Compatibility with spec 008" (D7); to be rechecked only if 008 changes again before approval.

## Traceability
| Story | Requirements |
|---|---|
| US-31 | FR-316, FR-321 to FR-335 |
| US-32 | FR-345 to FR-350 |
| US-33 | FR-319, FR-320, FR-342 to FR-344, FR-350 |
| US-34 | FR-317, FR-336 to FR-341, FR-345, FR-349, NFR-61 |
| US-35 | FR-351, FR-352, NFR-62 |
| US-36 | FR-318, FR-353 to FR-355, NFR-58 to NFR-60, NFR-63, NFR-64 |
