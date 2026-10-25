### M3 — Live model, panel texts, debug address (`feat/009-m3-tour-wiring`; 30 / 17 -> 41 / 6)
**Status: DRAFT (planner, 2026-10-25). Not approved.** Plan sections 6, 7, 9. Rules of `tasks.md` apply. Estimate about 1,840 changed lines. Branch from `rewrite` after M2 is merged. Needs A2, A3, A6 decided (panel during tours, live mismatch report, frozen values).

Titles: FR-317, FR-339, FR-340, NFR-61 first named in T2; FR-337, FR-345, FR-350 in T3; FR-330, NFR-64 in T4; FR-351, FR-352 in T5.

- [ ] **T1. Branch and bookkeeping.**
  - Done when: suite green; 30 / 17. Size: S (about 30).

- [ ] **T2. Victim tour effects in the live model, anti-spoiler proofs.** FR-317, FR-339, FR-340, NFR-61
  - Depends on: T1.
  - Files: `apps/web/src/core/live-model.ts`, `apps/web/test/live-model-tour.test.ts` (new), `apps/web/test/live-model.test.ts` (key list grows, meaning unchanged), `apps/web/test/helpers/scripted-match.ts` (clock settings with short L1, replay ages).
  - Tests first: a fresh `victim-revealed` emits one `victim-tour` with round, victim, living, σ of `<match id>:<k>` and budget; a stale replay (age 5,001), a public read, a browsing spectator, a halted match emit none; a second victim reveal emits `complete-tour` first; `match-halted` emits `complete-tour`; twins: two scripted matches equal up to the absorber give byte-equal effects and models until `round-applied`; no effect or model field names the absorber before the `round-applied` frame (fake stream); no request for a round above N during a tour (request log); the effect type has exactly its keys (no absorber, record, state, seed).
  - Commit: `feat(web): start the victim tour from a fresh reveal`.
  - Mutation proofs: tour emitted from `fromPublic`; estimate taken before raising with the event's reported time; `complete-tour` dropped on halt.
  - Done when: tests green; 34 / 13. Size: M (about 400).

- [ ] **T3. Absorber tour with the round step.** FR-337, FR-345, FR-350
  - Depends on: T2.
  - Files: `apps/web/src/core/live-model.ts`, `apps/web/test/live-model-tour.test.ts`.
  - Tests first: a fresh `round-applied` with d >= 2 sets N, displayed and records at `commit` as before and emits `play-step` with `tour` (victim, candidates captured before `victim` is cleared, absorber, σ `<match id>:<k>:absorber`, budget); L2 = 0 and L2 > 0 scripted timelines; d = 1, stale, absorber not among candidates, no candidates held: `play-step` without tour; a digest mismatch (`readInstead`) plays no tour; a late joiner in phase 2 (candidates from public data) gets the tour on a later fresh application; every other event, the countdown and the queue are handled exactly as without tours (the 008 live-model tests unchanged and green; same effects minus the tour fields, FR-337).
  - Commit: `feat(web): play the absorber tour before the round step`.
  - Mutation proofs: candidates read after `victim` is cleared; tour kept on the mismatch path; budget of k = T not nominal.
  - Done when: tests green; 37 / 10. Size: M (about 450).

- [ ] **T4. Panel texts during tours and the new strings.** FR-330, NFR-64
  - Depends on: T3; A2 decided.
  - Files: `apps/web/src/core/{live-view,live-text,panel-text,strings}.ts`, `apps/web/test/{live-view-tour,panel-text}.test.ts`, `apps/web/test/strings-language.test.ts` (lists grow).
  - Tests first: `panelView(model, at, factions, { revealing: true })` contains "revelando…" and no faction name of any participant in the victim line (and nowhere else of the view); `revealing: false` shows the name (D19, also reduced motion and late join); stage and countdown unchanged by tours; A2: with `absorbing: true` the legend uses the owners of k - 1 and the round line says k; the debug record line hides the victim before the result and the absorber during the absorber tour; new Spanish strings (revealing, skip, `reveal` messages, mismatch line of A3, tour timing labels) pass the language scan; `FR-343 (panel)`: still tours never set `revealing`; the tests of the FR-320 mismatch line (A3) use part-named titles such as `FR-320 (panel)` (FR-320 is closed in M2).
  - Commit: `feat(web): show revealing in the panel until the tour stops`.
  - Mutation proofs: name shown when `revealing`; legend from displayed during `absorbing`.
  - Done when: tests green; 39 / 8. Size: S-M (about 350).

- [ ] **T5. Debug address `reveal` and the reveal inputs.** FR-351, FR-352
  - Depends on: T4; A6 decided.
  - Files: `apps/web/src/core/{address,scene}.ts`, `apps/web/test/{address-reveal,scene-reveal}.test.ts` (new).
  - Tests first: `on`, `victim:0`, `victim:5349`, `absorber:2411` accepted; `victim:-1`, `victim:01`, `victim:1.5`, `x`, repeated, round 0 with a frozen value, `transition` present -> one Spanish problem naming `reveal`, value ignored; `checkReveal` refuses t > D (5,350 at n >= 3, 3,488 at n = 2) and `absorber:` with d < 2; `formatAddress` keeps a valid value and drops an invalid one; a round change drops a frozen value and keeps `on` (A6); `revealInputs` asks the sim only for rounds n - 1 and n, gives living at n - 1, victim and absorber of record n, candidates equal to `absorptionCandidatesOf` at n - 1; the existing `SimPort` literals compile unchanged (PD10); `core/scene.ts` stays the only core module naming the sim.
  - Commit: `feat(web): read the reveal parameter of the debug scene`.
  - Mutation proofs: `transition` not winning; t compared with `>=` D; candidates from state n.
  - Done when: tests green; 41 / 6. Size: M (about 550).

- [ ] **T6. Close M3.**
  - Files: traceability closing state 41 / 6, PROGRESS, plan figures, `MEMORY.md` (local).
  - Done when: suite, typecheck, `CI=1` green; scope diff clean; PR opened. Size: S (about 60).
