### M5, M5b and M5' (approved by the user on 2026-10-24; re-split after M5 T4 on 2026-10-24)

Plan section 21, approved by the user on 2026-10-24 (H1 to H12; spec clarifications D30, D31 and D32 of 21.19, recorded in the spec). The rules of `tasks.md` apply; sizes are changed lines (src + tests; docs apart), plan 21.20. Branches are cut from an up-to-date `rewrite`.

**Split up front (H1).** One branch would be about 5,500 changed lines (21.20), above the 3,500 ceiling; the work was first cut into M5 (headless) and M5' (browser).

**Re-split after M5 T4 (user decision, 2026-10-24).** M5 T4 ran 2.3x its estimate (src 403 against about 250, tests 677 against about 300, helper 189); the user accepted the overrun and closed M5 after T4 with a short closing task, so M5's branch stays near 2,700 changed lines. The connection policy, the transport and the old closing task move to a new branch M5b; the browser milestone keeps its label M5' on a renamed branch:
- **M5** (`feat/008-m5-live-core`, T1 to T4 and T4c): protocol readers, address and scene choice, panel texts, the pure live model; closes FR-305, FR-306, NFR-56, FR-303, FR-304 (86 / 10 -> 91 / 5).
- **M5b** (`feat/008-m5-2-live-transport`, from `rewrite` after M5 is merged, T5 to T7): the connection policy, the frame parser, the `fetch` transport, the map digest in the browser, the fake server and the D30 scan edits; closes FR-307, FR-308 (91 / 5 -> 93 / 3).
- **M5'** (`feat/008-m5-3-live-viewer`, from `rewrite` after M5b is merged, T1' to T7'): the browser shell, the debug-scene exclusion, the web test client, the real-server proofs and the screenshots; closes FR-309, FR-311, FR-310 (93 / 3 -> 96 / 0).
Checkpoints: stop and report if M5b passes about 1,050 changed lines at the end of T5 or about 2,500 at the end of T6, or M5' about 1,300 at the end of T3'. The 1.5x per-task stop rule still applies.

**Titles rule (this file).** No task title or test title names a pending id before the task that closes it: FR-305, FR-306, NFR-56 are first named in M5 T3; FR-303, FR-304 in M5 T4; FR-307 in M5b T5; FR-308 in M5b T6b; FR-309, FR-311 in M5' T4'; FR-310 in M5' T5'. Closing-state tests (M5 T4c, M5b T7) list the later ids in their body as a literal list, never in their title. Earlier tasks cite a done id with a part name, for example `FR-287 (readers)`, `FR-288 (readers)`, `FR-289 (d) (client)`, `NFR-51 (protocol readers)`, `FR-161 (live modules)`. Check before every commit (must find only the ids already closed):
`rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\b(FR-30[3-9]|FR-31[01]|NFR-56)\b" apps/*/test packages/*/test tools/*/test`
The planted pending id of `traceability.test.ts` ('the pending-id check sees a pending id planted in a test title', FR-303) switched to FR-309 in M5 T4 (done), stays FR-309 through M5b, and switches to FR-310 in M5' T4'; M5' T5' replaces both planted tests (21.15).

**Hand-offs from M4' and the viewer** (delivered facts the tasks rely on; plan 21.1):
- Server: routes, CORS (`*` for credential-free GETs), the stream format (one `id:` + `data:` frame, heartbeat `:` every 14,000 ms, `Last-Event-ID` header wins over `lastEventId`, the `last-event-id` preflight), streams of finished or halted matches stay open (E4), the `results` event (20.4), path segments matched literally (a `:` is literal, `%3A` is refused), `{"event":"listening","port":n}`.
- Protocol: encoders and `*_KEYS` lists for every reply and event, `mapDigestBytes`, `stateText`, `isLocalId`, `isMapId`, `isPlayerId`, `playerIdOf`; no reader of a reply or event.
- Viewer: `ui/main.ts` is the debug scene; `ui/load.ts` reads text, not bytes; `core/playback.ts` and `core/step.ts` `StepData` are reusable; the scans of 21.1 forbid `fetch` outside `ui/load.ts`, timers everywhere, `crypto` outside `ui/clock.ts`; the manifest pins of NFR-36 / NFR-42.
- Server test harness (`apps/server/test/helpers/server-harness.ts`, `main-child.ts`): fake clock, port 0, `streams.closeAll()`, child processes killed by PID.

## M5 (`feat/008-m5-live-core`, T1 to T4 and T4c; 86 / 10 -> 91 / 5)

- [x] **T1. Branch, docs, bookkeeping targets.** NFR-55
  - Depends on: M4' merged (PR #37); plan section 21 and this file approved (done, 2026-10-24); D30 to D32 decided (done).
  - Files: `specs/008-server-and-predictions/{spec,plan,tasks,tasks-M5}.md` (the approved clarifications D30 to D32 recorded in the spec's Decisions and status line; "DRAFT" markers removed), `packages/sim/test/traceability.test.ts` (comments only: the targets of 21.16).
  - Tests first: counts stay 86 / 10.
  - Commits: `docs: plan spec 008 milestone M5`; `test: prepare the spec 008 bookkeeping for M5`.
  - Mutation proof: none (no logic).
  - Done when: suite, typecheck and `CI=1` green; no id moved.
  - Size: S (about 40).

- [x] **T2. Protocol readers of every reply and event the clients read.** FR-287 (readers); FR-288 (readers); NFR-51 (protocol readers)
  - Depends on: T1.
  - Files: `packages/protocol/src/{decode,index}.ts`, `packages/protocol/test/decode.test.ts` (new), `packages/protocol/test/purity.test.ts` (if it lists files).
  - Tests first (plan 21.2, PD36): for every shape the server encodes (`PublicMatch` in each stage, with and without `schedule`, `victim`, `winner`, `matchSecret`, `haltReason`; the seven events; `StateReply`, `RecordReply`, `ErrorReply` with its optional fields, `PredictionReply`, a page of `OwnPrediction`, `PlayerResultsPage`, a page of `LeaderboardRow`) `read(JSON.parse(encode(x)))` equals x; refusals name the first failing field in the key order: a missing, extra, inherited (`__proto__` text) or ill-typed member, a negative or fractional number, a `victim` with `c2` without `a`, `winner` outside `finished`, a stage outside `STAGES`, a halt reason outside `HALT_REASONS`; `readEvent` returns `unknown` with its `seq` for a type outside `EVENT_KEYS` with a whole `seq`, and `invalid` for an unknown type without one; inputs never mutated.
  - Commit: `feat(protocol): read the replies and events of the server`.
  - Mutation proofs (full suite): an extra key accepted; `winner` accepted in `phase-1`; an unknown type answered `invalid` instead of `unknown`; `seq` 0 accepted; the own-property check replaced by `in`.
  - Done when: tests green; mutations caught; no id moved; `rg` finds `NFR-51 (protocol readers)` and no pending id.
  - Size: L (about 650).

- [x] **T3. Address, scene choice, panel texts and the protocol dependency of the viewer.** FR-305, FR-306, NFR-56 (close); FR-302 (client estimate)
  - Depends on: T2 (D31 decides the address shape).
  - Files: `apps/web/src/core/{live-address,live-text,strings}.ts` (new, new, edit), `apps/web/package.json` and `package-lock.json` (`"@mbrg/protocol": "*"`, the `apps/web` entry only), `apps/web/test/{live-address,live-text}.test.ts` (new), `apps/web/test/{shaped-deps,labels-render}.test.ts` (the pinned manifest and lockfile entry gain the workspace, D30, H4), `apps/web/test/strings-language.test.ts` (placeholder list and `INTERNAL_KINDS` gain the new names, D30), `packages/sim/test/traceability.test.ts` (FR-305, FR-306, NFR-56 out of `PENDING_008`: 89 / 7).
  - Tests first: `chooseScene(search, dev)` for every FR-306 case in both builds: seed and match (`both`, both builds), match (live), seed only and neither (debug in development, `need-match` in production), a malformed or repeated `match` (`bad-match`, no request); the live address (D31): `round` above N shown as N with a notice, a camera clamped as in 004, `formatLiveAddress` never writes a seed; `live-text`: the five stage texts, the countdown `M:SS` / `H:MM:SS` from an anchor and a reported-time estimate (never negative, none with `manual`), the victim line in `phase-2`, `locked` and a halted match after a reveal (at once, D19), the winner line, one Spanish halt text per reason, the connection notice with the time of the next attempt, the errors `unknown-match`, `digest-mismatch`, `insecure-origin`, `both`, `need-match`, `bad-match`; every new text comes from `STRINGS` and the language scan passes (NFR-56); the manifest tests list exactly the 005 set plus `@mbrg/protocol` and still 138 lockfile entries outside the spec 008 workspaces.
  - Commit: `feat(web): choose the scene and write the live panel texts`.
  - Mutation proofs: both parameters giving the live scene; a seed-only address giving the debug scene in production; a countdown that goes negative; the victim line shown in `phase-1`; a Spanish literal planted in `live-text.ts` (the scan).
  - Done when: tests green; mutations caught; FR-305, FR-306, NFR-56 moved (89 / 7); `rg` finds them.
  - Size: M (about 450).

- [x] **T4. Live model: rounds held, events, requests only for applied rounds.** FR-303, FR-304 (close); FR-289 (d) (client order); FR-254 (client requests)
  - Depends on: T3 (D32 decides the browsing rule).
  - Files: `apps/web/src/core/{live-rounds,live-model}.ts` (new), `apps/web/test/{live-rounds,live-model}.test.ts` (new), `packages/sim/test/traceability.test.ts` (FR-303, FR-304 out: 91 / 5; the planted id FR-303 becomes FR-309).
  - Tests first (plan 21.3, 21.5, 21.6; inputs built with the protocol encoders and the T2 readers from a scripted dev-map match): the public data read gives N, the state at N and the effect `open-stream { after: lastSeq }`; `round-applied` k = N + 1 gives `applyRecord` and a `hash-state` effect, the matching digest input gives `held[k]`, N = k, `play-step` (k - 1 -> k) with the `StepData` of 005 (no seed, round or record in it) while following, controls only while browsing (D32), and a mismatching digest gives `read-state k` and an instant change; a record listing a territory not owned by the eliminated faction is a mismatch; duplicates and overlaps (`seq <= lastSeq`) change nothing; a gap or a `round-applied` of another round gives a resync; an unknown type is consumed by number; `results` is consumed; `victim-revealed`, `schedule`, `match-finished`, `match-halted` set their fields (the victim kept when halted after a reveal); the reported-time estimate never decreases; navigation over 0..N reads only rounds <= N; over a whole match with every replay pattern, no effect ever names a round above the N of that moment and the model has no field holding an absorber or a state of round N + 1 (a type-level key test, FR-304); no live module imports `@mbrg/sim` (scan).
  - Commit: `feat(web): keep the live match from the server's rounds and events`.
  - Mutation proofs: a `seq <= lastSeq` frame applied again; a gap accepted; `play-step` before the digest matched; `read-state` of round N + 1; an unknown type stopping the model; the record applied to the wrong faction.
  - Done when: tests green; mutations caught; FR-303, FR-304 moved (91 / 5); `rg` finds them and no FR-305..FR-311 title outside T3.
  - Size: L (about 550). Actual: 1,269 (src 403, tests 677, helper `test/helpers/scripted-match.ts` 189): 2.3x, accepted by the user on 2026-10-24.

- [x] **T4c. Close M5: ledger, process checks, PR.** NFR-55
  - Depends on: T1 to T4; the user's acceptance of the T4 overrun (done, 2026-10-24).
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test retitled to M5: 91 / 5, FR-303 to FR-306 and NFR-56 pinned done, the later ids FR-307, FR-308, FR-309, FR-310, FR-311 as a literal list in the body, none in a title), `plan.md` (sections 11 and 13: M5 closing summary, figures, the T4 decisions (1) to (7) of `PROGRESS.md` and the hand-offs to M5b: `scripted-match.ts` and its `Driver`, the `queue` of frames under check, the retry wait left open by T4 decision (6)), `PROGRESS.md`, `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server apps/web/src/ui apps/web/index.html` clean; `git diff --stat rewrite` only planned files; `package.json` changes only the `@mbrg/protocol` line of `apps/web`, the lockfile only its `apps/web` entry; no `.nvmrc` change; the titles `rg` finds only FR-303 to FR-306 and NFR-56 (and the planted FR-309); the existing viewer scans and the T4 `@mbrg/sim` scan green; `npm test`, `npm run typecheck` and `CI=1 npm test` green.
  - PR facts: H1 to H12 and D30 to D32 as decided; the re-split into M5 / M5b / M5' (user, 2026-10-24); the T4 overrun (2.3x) accepted by the user; the ledger 91 / 5; the earlier tests edited (21.15: `shaped-deps`, `labels-render`, `strings-language`, `traceability`; `live-text` list made `arrayContaining` in T4).
  - Commit: `test: pin the spec 008 pending set after M5`.
  - Done when: CI green; counts 91 / 5; `MEMORY.md` updated (next: M5b).
  - Size: S (about 80).

## M5b (`feat/008-m5-2-live-transport`, from `rewrite` after M5 is merged; T5, T6a, T6b, T7; 91 / 5 -> 93 / 3)

**Split of T6 (user order, 2026-10-24).** The old T6 (about 1,200) is cut into T6a (parser and digest function) and T6b (transport, fake server, scans; closes FR-308). The rest of this file reads "T6" for either part, and the titles rule holds: FR-307 is first named in T5, FR-308 first in T6b; T6a names parts only.

Sizes re-estimated from the measured M5 T4 ratio (src about 1.6x, tests about 2.3x the first estimate), less the reuse of `apps/web/test/helpers/scripted-match.ts` (match, encoders, `Driver`) instead of new fixtures. M5b changes no manifest or lockfile.

- [x] **T5. Connection policy: retries, reconnection, unknown match, closing.** FR-307 (close); FR-289 (e) (client)
  - Depends on: M5 merged (T4c PR); branch cut from an up-to-date `rewrite`.
  - Files: `apps/web/src/core/{live-retry,live-model}.ts` (new, edit), `apps/web/test/live-retry.test.ts` (new), `apps/web/test/live-model.test.ts` (more cases), `apps/web/test/helpers/scripted-match.ts` (the `Driver` gains failures, drops and due timers; no second helper), `packages/sim/test/traceability.test.ts` (comments: M5b targets; FR-307 out: 92 / 4).
  - Tests first (plan 21.7, H10): delays 1, 2, 4, 8, 16, 30, 30 s after consecutive failures and reset after a success; a 429 waits the larger of the schedule and `Retry-After`; the last drawn round stays and the notice shows while waiting; `unknown-match` is fatal (no retry, no scene); a stream drop reconnects at once with `{ header: lastSeq }`, then by the schedule; 45,000 ms without a byte is a drop; the resync of T4 decision (6) (refused event, gap, wrong round) waits by the schedule; the replay after a reconnection is applied without gaps or duplicates (scripted overlaps through the `Driver`); the first connection uses the parameter, every later one the header; no stream is opened without a number; `match-finished` and `match-halted` close the stream and nothing reopens it.
  - Hand-off from the M5 review (plan 13): decide whether to tighten the readers' cross-field rules (`appliedRounds` vs stage and `totalRounds`; `victim.round === N + 1`; `living` holds the victim, `candidates` an ordered subset of `living`; schedule anchor order; `listsSeveral` for error items), since `fromPublic` accepts a public-data victim of the wrong round while the event path resyncs on one (`live-model.ts` about 276); the `onState` read path does not compare `reply.stateDigest` with `applying.digest` and `readInstead` stores a record that did not fit in `records` (about 248, 317-321); after a digest mismatch, a failed state read and a resync make `fromPublic` compute `following=false` (about 197); `navigate 'last'` while `applying.step === 'read'` sends a second `read-state k` and `wanted` is not cleared by the follow branch of `onState` (about 317-322).
  - Commit: `feat(web): retry and reconnect the live match`.
  - Mutation proofs: the schedule doubling past 30 s; `Retry-After` ignored; the reconnection by parameter; `unknown-match` retried; the stream reopened after `match-finished`.
  - Done when: tests green; mutations caught; FR-307 moved (92 / 4). Checkpoint: about 1,050 changed lines on the branch here at most, else stop and report.
  - Size: L (about 700: src about 240, tests about 460; first estimate 350).

- [x] **T6a. Frame parser and the browser digest function.** FR-289 (d) (frame parser); NFR-25 (digest function); map digest (part, FR-308 is named in T6b)
  - Depends on: T5. (T6 of the earlier M5b text, split in two by the user on 2026-10-24: the parts about parsing and the digest function.)
  - Files: `apps/web/src/core/live-sse.ts` (new, pure), `apps/web/src/ui/web-crypto.ts` (new: `digestAvailable()`, `sha256Hex(bytes)`; `requestId()` waits for M5' T5'), `apps/web/test/{live-sse,web-crypto}.test.ts` (new), `apps/web/test/purity.test.ts` (NFR-25: `crypto` only in `ui/web-crypto.ts`; D30; it moves here because this task creates the first `crypto` user).
  - Tests first: the parser gives the same frames for a recorded stream split at every byte, with LF, CRLF and CR endings (also a CR LF pair split between chunks), comments (heartbeats) and an `id:` without data, a `data:` with and without the space after the colon, several `data:` lines of one frame; `sha256Hex` of known vectors (empty input, `abc`, the dev map digest input), `digestAvailable()` false when the platform has no digest function (an injected platform object, no ambient global patched), the purity scan flags `crypto` in any other `ui` file.
  - Commit: `feat(web): parse the event stream and hash bytes in the browser`.
  - Mutation proofs: a parser that drops a frame split inside `data:`; CR taken as part of a line; `sha256Hex` hashing the wrong view (an offset byte array); the purity exception widened to every `ui` file.
  - Done when: tests green; mutations caught; no id moved. (T5 moved FR-307.)
  - Size: M (about 600 as the user's split of the old 1,200; src about 150, tests about 450).

- [x] **T6b. `fetch` transport, map digest check, fake server, live scans.** FR-308 (close); FR-307 (transport); FR-289 (d) (transport); FR-161 (live modules); NFR-55 (viewer scans)
  - Depends on: T6a; D30 approved.
  - Files: `apps/web/src/ui/live-net.ts` (new), `apps/web/test/helpers/fake-server.ts` (new: an injected `fetch` over the protocol encoders, plan 21.14, serving the replies and frames of `scripted-match.ts`), `apps/web/test/{live-net,live-scans}.test.ts` (new), `apps/web/test/anti-spoiler.test.ts` (FR-161: `fetch(` also in `ui/live-net.ts`; D30), `packages/sim/test/traceability.test.ts` (FR-308 out: 93 / 3).
  - Tests first: `live-net` against the fake server: reads use `credentials: 'omit'` and no `Authorization`, the map files are read as bytes and `sha256Hex(mapDigestBytes(files))` equals the dev map digest `4d1698a3...` (the plan 13 literal), a changed byte of any file gives `digest-mismatch` and nothing drawn, `digestAvailable()` false gives `insecure-origin` before any request (FR-308, fail closed), the stream request carries `lastEventId=<n>` the first time and the `Last-Event-ID` header on a reconnection, a dropped body (the fake errors its stream) is a drop, a 404 `unknown-match` reply is classified fatal, a 503 and a 429 with `Retry-After` are classified for the schedule; the request log of a scripted whole match (the `scripted-match.ts` match) never names a round above the N of that moment; scans: no live module imports `@mbrg/sim`, `core/scene.ts`, `ui/main.ts` or `ui/load.ts`, the debug modules import no live module, no `seed` identifier in the live modules (identifiers only: a `'seed'` string literal such as `params.has('seed')` in `live-address.ts` is not an identifier), `fetch(` only in `ui/load.ts` and `ui/live-net.ts`, `crypto` only in `ui/web-crypto.ts` (each scan flags a planted violation).
  - Hand-off from the M5 review (plan 13): State in the PR that `applying.record` holds the absorber of round N + 1 while its digest is checked (from a public round-applied event) and that the key test checks only top-level keys and the keys of `applying`.
  - Commit: `feat(web): read the live match over the network and check the map digest`.
  - Mutation proofs: the digest over the decoded texts instead of the bytes; a missing `digestAvailable` check (a request is sent); the header on the first connection; `credentials` left to the default; `fetch(` planted in `ui/main.ts` (the scan).
  - Done when: tests green; mutations caught; FR-308 moved (93 / 3); `rg` finds `FR-307 (transport)` and FR-308. Checkpoint: about 2,500 changed lines on the branch here at most, else stop and report.
  - Size: L (about 600 as the user's split: src about 250, fake server about 150, tests about 200 + scans; first estimate for the whole old T6 was 650).

- [x] **T7. Close M5b: ledger, process checks, PR.** NFR-55
  - Depends on: T5, T6a, T6b.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test retitled to M5b: 93 / 3, FR-303 to FR-308 and NFR-56 pinned done, FR-309, FR-310, FR-311 as a literal list in the body), `plan.md` (sections 11 and 13: M5b closing summary, figures, open parts for M5'), `PROGRESS.md`, `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server apps/web/src/ui/main.ts apps/web/src/ui/load.ts apps/web/index.html apps/web/package.json package-lock.json` clean; `git diff --stat rewrite` only planned files; no `.nvmrc` change; scans of T6 green; the PR lists H10, D30 (the scan edits), the ledger, the T5 and T6 sizes against their re-estimates and the earlier tests edited (`anti-spoiler`, `purity`, `live-model`, `scripted-match`, `traceability`).
  - Commit: `test: pin the spec 008 pending set after M5b`.
  - Done when: CI green; counts 93 / 3; `MEMORY.md` updated (next: M5').
  - Size: S (about 80).

## M5' (`feat/008-m5-3-live-viewer`, from `rewrite` after M5b is merged; T1' to T7'; 93 / 3 -> 96 / 0)

- [x] **T1'. Branch and bookkeeping targets.** NFR-55
  - Depends on: M5b merged.
  - Files: `packages/sim/test/traceability.test.ts` (comments: T4' 95 / 1, T5' 96 / 0).
  - Note: the M5' sizes below are the first estimates; re-estimate them here from the measured M5 and M5b ratios and report them before T2'.
  - Commit: `test: prepare the spec 008 bookkeeping for M5'`.
  - Done when: suite, typecheck, `CI=1` green; no id moved.
  - Size: S (about 30).

- [x] **T2'. Extract the drawing shell; the debug scene unchanged.** FR-156 (map view); FR-176 (map view); FR-161 (live modules); NFR-27 (before and after)
  - Depends on: T1'; H5 approved (if the alternative is chosen, this task becomes "no change" and T3' duplicates the shell).
  - Files: `apps/web/src/ui/{map-view,main}.ts` (new, edit), `apps/web/test/map-view-scan.test.ts` (new: `map-view.ts` names no seed or round count, imports neither the sim nor the scene module, avoids the banned words of FR-155).
  - Tests first: the new scan; every 004 to 007 test passes unedited (the meaning of the debug scene is unchanged).
  - Visual: screenshots of the debug scene before and after (seed 1, rounds 0, 1 and T at fit scale, one frozen `transition=0.5`, one zoomed view of a border), shown to the user as pairs; pixel-identical or explained.
  - Commit: `refactor(web): share the map drawing between the scenes`.
  - Mutation proofs: `map-view.ts` importing `@mbrg/sim` (the scan); the label layout of the previous round not passed (the 007 label tests).
  - Done when: tests green; the pairs reviewed by the user; no id moved.
  - Size: M (about 550, mostly moved lines).

- [x] **T3'. The live scene in the browser: entry, shell, panel, timers, runner.** FR-303 (shell); FR-304 (shell); FR-305 (shell); FR-306 (entry); FR-307 (shell); FR-155 (live timers); NFR-33 (live clock)
  - Depends on: T2'.
  - Files: `apps/web/src/ui/{entry,live-main,live-panel,live-runner,live-timer,live-config}.ts` (new), `apps/web/index.html` (script `/src/ui/entry.ts`), `apps/web/test/{live-runner,live-entry}.test.ts` (new), `apps/web/test/anti-spoiler.test.ts` (FR-155: timers only in `ui/live-timer.ts`) and `apps/web/test/labels-purity.test.ts` (NFR-33: the exact clock-importer list) (both D30).
  - Tests first (Node, fake server of M5b T6, fake timers, no DOM): the runner executes `reduce` effects in order and feeds the results back: a whole dev-map match from round 0 to T draws N at load, plays one step per `round-applied`, writes the address of D31 with `history.replaceState` (a stub), shows the notice and keeps the last drawn round while the fake server is down, reconnects with the header, closes the stream at the finish; `entry.ts` chooses the scene of each FR-306 case and imports `./main` only when `import.meta.env.DEV` (a source scan of the guard); timers only in `ui/live-timer.ts`; the countdown refreshes once per second from the estimate.
  - Note (M5b review, FR-308; plan 13 "Runner contract"): the model departs from plan 21.3: it has no "map files verified" input and no "read map files" effect, and `LiveFatal` is only `unknown-match`, so `fromPublic -> goto -> show` emits `draw` as soon as a `public` input arrives. The guarantee "no state drawn before the map digest matched" therefore belongs to the RUNNER: it calls `readMapFiles(mapId, mapDigest)` ONCE, before the first `public` input (not on resyncs), shows `insecure-origin` and `digest-mismatch` itself (outside the model, as `NetFatal`), and feeds no `public` input until `readMapFiles` returned ok. Test required (runner test): when `readMapFiles` fails (digest-mismatch, insecure-origin, a retry failure) nothing is drawn and no `public` input is fed. The other runner-contract items (one timer with replace semantics, handler mapping, stream ownership, hash path, bound `fetch`) are in plan 13 and are tested here.
  - Visual (local run with the T6' fixture, or the real `main.ts` with timing `manual` until T6'): first look at round 0 and phase 2, shown to the user before T4'.
  - Commit: `feat(web): show a live match from the server`.
  - Mutation proofs: the debug import without the `DEV` guard (the scan); the step played while browsing an earlier round (D32); the countdown refreshed from the server's last reported time without the elapsed time; a `setTimeout` planted in `live-main.ts` (the scan).
  - Done when: tests green; mutations caught; no id moved. Checkpoint: about 1,300 changed lines on the branch here at most.
  - Size: L (about 650).

- [ ] **T4'. Production build output: no debug scene, no web test client, no credential.** FR-309, FR-311 (close); FR-306 (production build)
  - Depends on: T3'.
  - Files: `apps/web/test/build-output.test.ts` (new; explicit timeout), `apps/web/src/ui/main.ts` (one marker line `data-mbrg-scene="debug"` if T2' did not add it), `packages/sim/test/traceability.test.ts` (FR-309, FR-311 out: 95 / 1; the planted id FR-309 becomes FR-310).
  - Tests first (plan 21.10): the Vite build API into a temporary folder with `VITE_MBRG_WEB_CREDENTIAL` set to a planted value: no file contains the planted value; no `map.json`, `ids.png` or `presentation.json` copy; no `data-mbrg-scene` value `debug` or `client`; no `client.html`; the emitted entry has no reference to the sim exports' error kinds that only the debug path uses (a code marker list); the development server (`import.meta.env.DEV` true) still offers the debug scene for a seed-only address (the T3' entry test); the debug scene never connects to the server (the M5b T6 scan, re-run here by name).
  - Commit: `test(web): keep the debug scene and the test client out of production`.
  - Mutation proofs: the `DEV` guard removed (the debug marker and the dev map assets appear); `client.html` added as a build input (the test fails); the credential read in `live-config.ts` (the planted value appears).
  - Done when: tests green; mutations caught; FR-309, FR-311 moved (95 / 1).
  - Size: M (about 250).

- [ ] **T5'. The web test client page.** FR-310 (close); NFR-56 (web test client); FR-282 (client request ids); FR-284 (client player ids)
  - Depends on: T4'; H7, H9 approved.
  - Note (M5b review): `requestId()` (add it to `ui/web-crypto.ts`, the only `crypto` user) is built here for the client request ids (FR-282); `live-net.ts` has no use for it.
  - Files: `apps/web/client.html` (new), `apps/web/src/ui/client-main.ts` (new), `apps/web/src/core/{client-form,strings}.ts` (new, edit), `apps/web/test/{client-form,client-html}.test.ts` (new), `apps/web/test/strings-language.test.ts` (new names in its lists, D30), `.gitignore` (`.env.local`), `packages/sim/test/traceability.test.ts` (FR-310 out: 96 / 0; both planted-id tests replaced by "the pending set is empty" and a detection test over a synthetic list).
  - Tests first (fake server): a submission body for each kind (round present exactly for `victim` and `absorber`), the faction choices offered (living at N, the victim's candidates, winner candidates without the revealed victim), a retried submission reuses its request id, `Authorization: Bearer` and `Content-Type` sent only on the submission and the own-predictions read, the player-results path keeps the `:` unescaped (`/players/web:p1/results`) and a local id outside FR-297 sends nothing, reply kinds shown as English data inside Spanish templates, results reloaded on a `results` event, a Spanish message when `VITE_MBRG_WEB_CREDENTIAL` is missing; `client.html` has no text nodes or text attributes (NFR-28 rule).
  - Visual: the web test client after one round with stored predictions and results, reviewed by the user.
  - Commit: `feat(web): add the development test client for predictions`.
  - Mutation proofs: `encodeURIComponent` on the player id (the path test); the request id redrawn on a retry; `Authorization` sent on the player-results read; the winner choices including the revealed victim.
  - Done when: tests green; mutations caught; FR-310 moved (96 / 0); `rg` finds it.
  - Size: L (about 550).

- [ ] **T6'. Real-server proofs and the local-run fixture.** FR-303 (real server); FR-307 (real server); FR-308 (real server); FR-310 (real server); NFR-52 (viewer over the network)
  - Depends on: T5'; H6, H12 approved.
  - Note (M5b review, FR-308): the real-server proofs include the runner order of T3': the map files are verified once before the first `public` input; with a served file changed by one byte nothing is drawn and `digest-mismatch` is shown outside the model. `requestId()` of `ui/web-crypto.ts` is built in T5' (web test client), not here.
  - Files: `apps/server/test/{viewer-live,viewer-live-child,client-live}.test.ts` (new), `apps/server/test/fixtures/dev-live-server.ts` (new, hand-run), `apps/server/test/helpers/main-child.ts` (a fixed port option, if needed).
  - Tests first (plan 21.14): in process (harness, fake clock): manual and clock (L2 > 0 and L2 = 0) dev-map matches from round 0 to T, the viewer core equal to the server's `/states/j` and `/records/j` at every N, no request above N (a recording `fetch`), a stream ended by `streams.closeAll()` then reopened with `Last-Event-ID` without gaps or duplicates, a halted match (`map-changed`), the map digest of the served files equal to `mapDigest`; child process: the production `main.ts` with a file database killed by PID mid-match and restarted on the same port, the viewer core ends equal to an uninterrupted run; web test client: the three kinds submitted, a replay with the same request id, own predictions, player results with the raw `:` (a `%3A` path gets 400 `invalid-player-id`), the leaderboard after a scored phase. The fixture: `node --import tsx test/fixtures/dev-live-server.ts` from `apps/server` creates one dev-map match with a fixed fake random seed and the fake clock, prints the viewer and client addresses, and reads `tick <seconds>`, `advance`, `break-map` and `quit` from standard input.
  - Commit: `test(server): watch and predict a live match through the viewer core`.
  - Mutation proofs: the reconnection without the header (the replay starts from the live end: missing events); `applyRecord` skipped (states compared from the record only differ under a planted record); the kill test without the restart (it times out within its own timeout).
  - Done when: tests green on Windows and CI; mutations caught; no id moved.
  - Size: L (about 650).

- [ ] **T7'. Screenshots, browser figures, close M5' and spec 008.** NFR-55
  - Depends on: T1' to T6'.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test retitled to M5': 96 / 0, the pending set empty), `spec.md` (status `implemented` only after the user's acceptance), `plan.md` (sections 11 and 13: M5' closing summary, figures), `tasks.md`, `PROGRESS.md`, `MEMORY.md` (local).
  - Steps: the screenshot set of plan 21.14 at 1920 x 1080 from the T6' fixture (live viewer at round 0, round 1 in phase 1, phase 2 and applied, round T, a halted match, the connection notice, the unknown-match and `need-match` messages; the web test client), listed with their addresses in the PR and reviewed by the user; the browser figures of H11 on the reference PC (pane visible); process checks as M5b T7 plus `npm run build` and the T4' test; `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/src` clean.
  - Commit: `test: close the spec 008 pending set after M5'`.
  - Done when: CI green; counts 96 / 0; screenshots accepted by the user; spec 008 marked `implemented` with the user's OK; `MEMORY.md` updated (next: plan spec 009).
  - Size: S (about 100).
