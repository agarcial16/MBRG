### M1 — Forced absorber (`feat/011-m1-forced-absorber`; 0 / 29 -> 3 / 26)

Plan sections 6, 11, 12 (M1 rows), 15 (Q2). The rules of `tasks.md` apply; sizes are changed lines (src + tests; golden JSON and docs apart). Branch cut from an up-to-date `rewrite`. M1 lands alone because it is the only milestone that re-pins 008 goldens (plan 12).

**Ids that M1 may name:** FR-387 (T4), FR-388 (T5), FR-389 (T6). No other pending id of spec 011 is named in any M1 title. The 029-id pin test of T1 names only old ids (NFR-13, NFR-19).

**Hand-offs from 008/009** (facts the tasks rely on; plan section 0): `closePhase1` builds `PublicVictim` (`candidates`, `living`, `c2`, `a`) and calls `anchorsAfterStep`; `apply()` emits the absorber `ScoredPhase` with `worth = candidates.length`; `persist` writes results only for a non-empty row set; `decideSubmission` order is halted, finished, closed, invalid; `StepDeps` carries `map`, `seedOf`, `sha256`; the settings list is pinned in `server-settings`, `service-settings`, `service-seam` (~line 122) and `helpers/main-child.ts`.

- [x] **T1. Branch, docs, ledger extension.** (no pending id named)
  - Depends on: spec approved; plan and tasks approved by the user; Q2 answered (or T5 stays blocked).
  - Files: `specs/011-playable-matches/{plan,tasks,tasks-M1,PROGRESS}.md`, `packages/sim/test/traceability.test.ts`.
  - Tests first: `FR_RANGES [[1, 392]]`, `NFR_RANGES [[1, 76]]`; both `expected.length` assertions 437 -> 466; the two literal range assertions; the comment of the ranges names spec 011; `PENDING_011` = literal list of the 29 ids (FR-369..FR-392, NFR-72..NFR-76) and `DONE_011 = []`; new tests titled `NFR-13 NFR-19 the 29 ids of spec 011 are pinned ...` (independent literal computation: 24 FR from 369, 5 NFR from 72; pending + done = 29, every id expected), `NFR-55 no pending id of spec 011 is already traced by a test title`, a planted-id detection test over a synthetic list, and the "every expected id appears in a test name" filter also excludes `PENDING_011`.
  - Commit: `test: extend the traceability ledger to spec 011`.
  - Mutation proofs: one pending id removed from the literal (pin test fails); one id planted in a title (the "already traced" test fails).
  - Done when: suite, typecheck, `CI=1` green; counts 0 / 29; `git diff` touches only the traceability test and specs.
  - Size: S (about 90).

- [ ] **T2. Protocol: the forced mark and the `forced-absorber` kind.** (describe in words; no pending id in titles)
  - Depends on: T1.
  - Files: `packages/protocol/src/{wire,errors,encode,decode,public,index}.ts`, `apps/server/src/http/status.ts`, `packages/protocol/test/{errors,public,encode-events,decode,encode}.test.ts`, `apps/server/test/http-status.test.ts`.
  - Tests first: `PublicVictim.forced` and the `victim-revealed` event accept `forced: true` and write it after `a` (PUBLIC_VICTIM_KEYS and `EVENT_KEYS` gain `forced`); `forced: false` is refused by the encoder and decoder (present only when true); a victim without `forced` encodes to exactly the 008 bytes (SHA-256 pin of one 008 `PublicVictim` and one 008 `victim-revealed` frame); `forced-absorber` sits between `prediction-closed` and `invalid-choice` in `ERROR_ORDER`, `firstError` picks by that order, status 409; the error decoder accepts it; the public-view type-level key test lists `forced` (no secret-looking key).
  - Commit: `feat(protocol): add the forced mark and the forced-absorber error`.
  - Mutation proofs: `forced` written first; `forced: false` accepted; `forced-absorber` after `invalid-choice`; status 422.
  - Done when: tests green; mutations caught; protocol purity scan green; no id moved.
  - Size: M (about 300).

- [ ] **T3. Setting F and its path to the core.** (no pending id named)
  - Depends on: T2.
  - Files: `apps/server/src/service/settings.ts` (`MBRG_FORCED_PHASE_SECONDS`, default 5, whole number >= 1 and <= 3,600; `Settings.forcedPhaseSeconds`), `apps/server/src/core/steps.ts` (`StepDeps.forcedPhaseSeconds`), `apps/server/src/service/matches.ts` (`depsOf` passes it), `apps/server/test/{server-settings,service-settings,service-seam}.test.ts`, `apps/server/test/helpers/{main-child,service-harness,server-harness}.ts`.
  - Tests first: the variable list is 16 variables in order (appended at the end); default 5; `0`, `-1`, `3601`, `1.5`, `x`, empty are problems naming the variable only; the FR-260 environment scans (no seed-source variable) run over 16; `StepDeps` keys are pinned.
  - Commit: `feat(server): add the forced phase setting`.
  - Mutation proofs: default 6; `0` accepted; variable inserted in the middle of the pinned order.
  - Done when: tests green; mutations caught; no id moved. Note: the list grows again in M2, M3, M4 (30 at the end).
  - Size: S (about 150).

- [ ] **T4. Core: a forced absorber is not predicted and does not score.** FR-387
  - Depends on: T2, T3.
  - Files: `apps/server/src/core/{steps,predictions,scoring}.ts`, `apps/server/test/{core-steps,core-predictions,core-scoring,service-scoring,service-predictions}.test.ts` (earlier tests edited only where a fixture used d = 1, listed in `PROGRESS.md`).
  - Tests first: `closePhase1` with one candidate sets `forced: true` on the `PublicVictim` and the `victim-revealed` event (d >= 2: field absent, bytes as 008); `decideSubmission` for kind `absorber` in `phase-2` with one candidate is `forced-absorber`, in `phase-1` still `prediction-closed`, at `locked`/`finished`/`halted` as before (order halted, finished, closed, forced, invalid); an absorber prediction already stored cannot exist (it was refused); `apply()` returns no `absorber` `ScoredPhase` when `victim.candidates.length === 1` (the winner phase is still returned at the finish); through the service: a forced round writes no absorber row, the `results` event of phase 2 is still emitted (empty), the winner scores as before, d = 2 and d = 3 rounds score d as in 008; the dev-map secrets give at least one forced round (the last) and one non-forced round; a victim prediction in a forced round scores n as before; the public data after the reveal shows `forced` and its bytes are identical for twin matches with equal public data.
  - Commit: `feat(server): do not predict or score a forced absorber`.
  - Mutation proofs: forced test `<= 2`; refusal after `invalid-choice`; absorber scored in a forced round (worth 1); `forced` also set when d = 2; `forced` derived from `living` instead of `candidates`.
  - Also in this commit (the suite must be green): the results-side re-pin forced by the rule: `golden/dev-results.json` with its generator `golden/generate-dev-results.ts` (independent arithmetic: no absorber row and no points when the golden's own d is 1), `helpers/{results-timelines,results-script,durability-script}.ts`, and the earlier tests that used d = 1 (`service-halting`, `service-results`, `store-results*`, `results-golden`, `results-durability`, `http-results-twins`), each listed in `PROGRESS.md`. The timeline goldens are not touched here (the rule alone changes no anchor or event bytes of d >= 2 rounds; forced `victim-revealed` events appear in T5's re-pin).
  - Done when: tests green; mutations caught; FR-387 moved (1 / 28) in this commit.
  - Size: M (about 550; golden JSON apart).

- [ ] **T5. Core: the shortened phase 2 after a forced reveal.** FR-388 (Q2 answered: shorten phase 2 = L1 to min(L1, F), A moves earlier, L2 and the next round's anchoring as in 008)
  - Depends on: T3, T4, and the answer to Q2 (which interval shortens: phase 2 = L1 or locked = L2; whether A moves).
  - Files: `apps/server/src/core/time.ts` (`forcedAnchors(anchors, timing, forcedSeconds, instant, cause)`, pure), `apps/server/src/core/steps.ts` (`closePhase1` uses it when forced), `apps/server/test/{core-time,core-steps,service-timer,service-steps}.test.ts`.
  - Tests first (fake clock, fake scheduler; non-round constants such as I = 47, L1 = 13, L2 = 7, F = 5 and F = 9): span below, equal to and above F; span 0 where the timing allows it (L2 = 0); an on-time clock step, a late step (instant = effective) and a manual advance each give the anchors of the plan's reading; the shortened phase closes exactly at the new instant (the scheduler wake-up is re-armed from the stored view); the next round's anchors are the 008 anchors derived from the application instant (the plan's reading of "do not move"); timing `manual`: no anchors, nothing changes; the victim event carries the shortened `c2`/`a`; a restart (new store and service on the file) recovers the shortened anchors; a non-forced round is byte-identical to 008.
  - Commit: `feat(server): shorten phase 2 after a forced reveal`.
  - Mutation proofs: `min` replaced by `max`; F read as milliseconds; shortening applied to a non-forced round; the next round anchored at the old A; the wake-up armed at the old C2.
  - Also in this commit: the timeline re-pin: `golden/{core-timelines,service-timelines}.json` with their generators (the `forced` field of the forced rounds' victim events and public views, shortened anchors/instants of forced rounds and what follows them in clock timelines) and `helpers/{core-timelines,service-timelines}.ts`; the earlier tests that pin sequences/instants of those timelines (`core-timeline-golden`, `service-timelines`, `service-restart`, `stream-restart`, `stream-late-join`, `load-stats` only if red).
  - Done when: tests green; mutations caught; FR-388 moved (2 / 27) in this commit.
  - Size: M (about 600; golden JSON apart).

- [ ] **T6. Winner, victim and two-faction rules are unchanged.** FR-389
  - Depends on: T4, T5.
  - Files: `apps/server/test/{core-predictions,service-scoring,service-results}.test.ts` (new cases only).
  - Tests first: a two-faction round (n = 2, d = 1) accepts a victim prediction (worth 2) and refuses an absorber; winner predictions are accepted before and after a forced reveal with the same candidate rule and are scored at the finish with their stored count; a forced round does not change `scoredPhaseCount` (2N, +1 after a reveal), `readResultsRound` or the leaderboard generation; a player with only forced-round absorber attempts (refused) is not on the leaderboard.
  - Commit: `test(server): pin the victim and winner rules around a forced absorber`.
  - Mutation proofs: victim refused when n = 2; generation counting the forced absorber phase twice.
  - Done when: tests green; mutations caught; FR-389 moved (3 / 26) in this commit.
  - Size: S (about 200).

- [ ] **T7. Verify the re-pin of the 008 goldens.** (no pending id named; NFR-75 listing)
  - Depends on: T4, T5, T6.
  - Files: `specs/011-playable-matches/PROGRESS.md`, scratchpad script (not committed), generators/helpers only if the check shows a defect, `apps/server/test/golden-repin.test.ts` (new, small).
  - Tests first: a test pins literal figures that are NOT read from the regenerated JSON: the forced rounds of the three dev secrets (round numbers, d, shortened `c2`/`a` for I = 47, L1 = 13, L2 = 7, F = 5 computed in the test), the absorber point totals of one scripted match, and that every non-forced round's events/anchors in `core-timelines.json` equal the pre-M1 file (SHA-256 of those rows, taken from the `rewrite` version before the re-pin). A scratchpad script compares the `rewrite` and branch versions of the three JSON files and prints the changed paths; only forced rounds, the anchors/instants following them, absorber rows/totals and digests containing them may differ. The output goes in `PROGRESS.md` with the final list of edited earlier tests and the reason of each.
  - Commit: `test(server): pin the forced-absorber re-pin by independent figures`.
  - Mutation proofs: one non-forced anchor perturbed in the golden (the SHA pin fails); one forced absorber total changed (the literal fails).
  - Done when: full suite green; the diff script shows only the allowed paths; `dev-secrets.json` and the 009 tour goldens byte-equal (`git diff --exit-code`).
  - Size: S (about 200). Checkpoint: stop if the branch passes ~2,500 changed lines (golden JSON apart).

- [ ] **T8. Real-server proofs of the forced absorber.** (parts of FR-387 and FR-388 named as `(HTTP)`)
  - Depends on: T7.
  - Files: `apps/server/test/{http-forced-absorber,stream-forced-absorber}.test.ts` (new), `apps/server/test/helpers/{server-harness,http-client,stream-run}.ts` (additions only).
  - Tests first (real listener, port 0, fake clock): a client submits an absorber prediction during phase 2 of a forced round -> 409 `forced-absorber` with the exact reply bytes, nothing stored (own-predictions read empty); during a non-forced round it is accepted; `GET /matches/:id` shows `victim.forced: true` exactly in the forced round; the event stream delivers `victim-revealed` with `forced` and the shortened `schedule`; the shortened phase 2 closes at the fake-clock instant (HTTP read of `schedule` and `stage`); the phase results and the leaderboard of the finished match have no absorber row for the forced round; twins (equal public data, different futures) give identical bytes on all of these reads.
  - Commit: `test(server): prove the forced absorber over HTTP and the stream`.
  - Mutation proofs: route returning 422 for the forced refusal; `forced` dropped from the stream encoder only.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 400).

- [ ] **T9. Close M1: closing-state test, process checks, PR.** (no pending id named in titles)
  - Depends on: T1 to T8.
  - Files: `packages/sim/test/traceability.test.ts` (a closing-state test titled for M1 pins FR-387, FR-388, FR-389 as done and the other 26 as pending, literal lists in its body; the ids themselves moved in T4, T5, T6), `specs/011-playable-matches/PROGRESS.md`, `MEMORY.md` (local).
  - Steps: the protected-path `git diff --exit-code` of `tasks.md` clean; `git diff --stat rewrite` lists only planned files (plan 12 M1 row); no `package.json`, lockfile or `.nvmrc` change; `SCHEMA_VERSION` still 1; scans (sqlite only in `store/sqlite.ts`, timers only in `scheduler.ts`, protocol/core purity); the PR body lists the changed tests/goldens with reasons, Q2's answer and the ledger. Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 011 ledger after M1`.
  - Done when: CI green; counts 3 / 26; `MEMORY.md` updated (next: M2).
  - Size: S (about 80).
