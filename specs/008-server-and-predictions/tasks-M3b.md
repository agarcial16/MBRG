### M3b and M3b' (approved by the user on 2026-10-23)

Plan section 19. **Approved by the user on 2026-10-23**: E1 to E10 (plan 19.13) and the spec clarification D28 (recorded in `spec.md` Decisions in T1's docs commit). The rules of `tasks.md` apply; sizes are changed lines (src + tests), plan 19.14.

**Titles rule (this file).** No task title or test title of M3b names FR-287 or NFR-49; no title of M3b' T2' or T3' names NFR-49. Earlier tasks cite the done neighbour id with a part name (`FR-289 (stream framing)`, `FR-299 (stream limits)`, `FR-290 (stream)`), as M3a did. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\b(FR-287|NFR-49)\b" apps/*/test packages/*/test tools/*/test` (must find nothing before the task that closes the id).

**Hand-offs from M3a'** (delivered facts the tasks rely on; plan sections 13 and 18):
- `service.subscribe(listener)` runs listeners after the commit, synchronously, in registration order; a throwing listener is ignored (FR-290). `store.eventsAfter(matchId, seq)` returns the stored events with a larger seq, in order, unpaged.
- `createServer({ service, settings, clock, log, routes? })`, option keys pinned in `http-pipeline.test.ts` (line 394); the pipeline of plan 18.2; `Reply` kinds `success`, `file`, `error`; `ReplyTarget.closeAfter` adds `Connection: close` while a body over 4,096 is unread.
- `limitKeys(identity, class, address, limits)` and `createLimiter()` (pure); a host token is resolved only for a route with `hostParam` (advance).
- `cors.ts` answers a credential-free GET preflight with `*`, `Allow-Methods: GET`, no `Allow-Headers`.
- `createShutdown` closes idle connections, hooks `res` 'close' for connections that go idle later, waits `SHUTDOWN_GRACE_MS` (5,000) through the scheduler, then `closeAllConnections`; logs `shutdown-start`, `shutdown-done` (`forced`), `shutdown-forced`.
- `SETTING_VARIABLES` (13) is pinned in `server-settings.test.ts`, `service-settings.test.ts` and `service-seam.test.ts`; `helpers/main-child.ts` raises the anonymous limit for child tests.
- `test/fixtures/kill-child.ts` prints its stop point and blocks (`Atomics.wait`) so the parent kills it by PID; `withTempDirAsync` in `helpers/http-reads-kit.ts`.

## M3b (`feat/008-m3b-event-stream`, T1 to T6; no id moved, 76 / 20)

- [ ] **T1. Branch, docs, bookkeeping targets.** NFR-55
  - Depends on: M3a' merged (PR #33); plan section 19 and this file approved; D28 approved (E3).
  - Files: `specs/008-server-and-predictions/{spec,plan,tasks,tasks-M3b}.md` (D28 in the spec's Decisions, only if approved), `packages/sim/test/traceability.test.ts` (comments only).
  - Tests first: counts stay 76 / 20; comments state the targets (M3b T6 76 / 20; M3b' T2' 77 / 19, T4' 78 / 18).
  - Commits: `docs: plan spec 008 milestone M3b`; `test: prepare the spec 008 bookkeeping for M3b`.
  - Mutation proof: none (no logic).
  - Done when: suite, typecheck and `CI=1` green; no id moved.
  - Size: S (about 40).

- [ ] **T2. Event encoders, stream framing, the starting number and the stream preflight (pure).** FR-257 (event encoders); FR-289 (stream framing), FR-289 (d), (e) (number reading), FR-289 (f) (heartbeat frame); FR-286 (stream preflight); NFR-51 (http modules)
  - Depends on: T1.
  - Files: `packages/protocol/src/{wire,encode,index}.ts`, `packages/protocol/test/encode-events.test.ts`, `apps/server/src/http/{sse,cors}.ts`, `apps/server/test/{http-sse,http-cors}.test.ts`, `apps/server/test/http-purity.test.ts` (`sse.ts` joins the pure set).
  - Tests first: `encodeEvent` writes each of the 7 types in its `EVENT_KEYS` order whatever the input order, omits an absent optional `schedule`, refuses an extra, inherited or `null` member and an unknown `type`; `JSON.parse(encodeEvent(e))` deep-equals `e` for every event a scripted dev-map match stores (manual and clock timing, a halt); `frameOf(41, json)` is exactly `id: 41\ndata: <json>\n\n` and refuses a json with CR or LF; `HEARTBEAT_FRAME` is `:\n\n` (no `id`, no `data`); `readStreamStart`: header only, parameter only, both (the header wins), `0`, `41`, 2^53 - 1, `9007199254740992` (beyond), and invalid `-1`, `01`, `1.5`, `1e3`, ``, ` 1`, two header values, each naming `Last-Event-ID` or `lastEventId`; CORS: a GET preflight listing `last-event-id` gets `*` and `Access-Control-Allow-Headers: last-event-id`; listing `last-event-id, authorization` follows the credentialed rule; the earlier preflight cases are unchanged.
  - Commit: `feat(server): encode events and frame the event stream`.
  - Mutation proofs (full suite): two keys of `victim-revealed` swapped in `EVENT_KEYS`; an extra member accepted; the blank line dropped from the frame; the parameter preferred to the header; a leading zero accepted; `Allow-Headers` missing from the stream preflight.
  - Done when: tests green; mutations caught; no id moved; `rg` finds `FR-289 (stream framing)`.
  - Size: M (about 450).

- [ ] **T3. Stream limit settings and the open-stream gauge.** FR-299 (stream limits: settings, gauge); FR-299 (b), (f); FR-260 (15 variables); NFR-51 (http modules)
  - Depends on: T1 (D28 recorded), T2.
  - Files: `apps/server/src/service/settings.ts`, `apps/server/src/http/limits.ts`, `apps/server/test/{server-settings,service-settings,service-seam,http-limits}.test.ts`, `apps/server/test/helpers/main-child.ts` (raises the two new limits for child tests).
  - Tests first: `SETTING_VARIABLES` is the 15-name list (the 13 plus `MBRG_LIMIT_STREAMS`, `MBRG_LIMIT_ANONYMOUS_STREAMS`), none seed-like; defaults 50 and 5; values 1 to 1,000,000 accepted, `0`, `01`, `1000001`, text refused naming the variable only; the FR-260 environment scans cover the 15; gauge: `open` refuses when any key holds its limit, a lease counts under every key, `release` is idempotent (a second call changes nothing), a refused open records nothing; `streamKeys`: operator and client by credential digest at `streams`, anonymous, candidate and host by address at `anonymousStreams`; a gauge with no open lease holds no key.
  - Commit: `feat(server): add the stream limits and the open-stream gauge`.
  - Mutation proofs: default 5 -> 6; `release` decrementing twice; host token counted under a credential key; a refused open still counting.
  - Done when: tests green; mutations caught; no id moved; `rg` finds `FR-299 (stream limits)`.
  - Size: M (about 300).

- [ ] **T4. The replay read and the stream hub.** FR-281 (i) (service read); FR-289 (d), (e) (hub), FR-289 (f) (heartbeat); FR-290 (stream, hub); NFR-52
  - Depends on: T2, T3.
  - Files: `apps/server/src/service/matches.ts` (`eventsAfter`), `apps/server/src/http/streams.ts`, `apps/server/test/{service-events,http-streams}.test.ts`, `apps/server/test/{service-seam,service-create}.test.ts` (pinned service method lists gain `eventsAfter`), `apps/server/test/http-purity.test.ts` (`streams.ts` joins the platform set).
  - Tests first: `eventsAfter` gives the stored events after n and `lastSeq`, `unknown-match`, `unavailable` under the fault seam, writes nothing. Hub with fake responses (`writeHead`, `write`, `end`, `destroy`, `writableLength`, 'close') and the fake scheduler and clock: `open` with n writes the replay as one write after the headers, then live events; without n only events committed after the open; an advance made synchronously right after `open` returns reaches the stream exactly once (no gap: kills a deferred registration); the subscriber fed an old event (seq <= last) writes nothing; two matches never see each other's events; one decision is one write per stream, the same bytes for every stream of the match; heartbeat: none with no stream, `:\n\n` at +14,000 on the fake clock and every 14,000 after, never more than 15,000 apart, none after the last stream closes; a stream above 1 MiB buffered is destroyed and its lease released once; a `write` that throws closes only that stream; `closeAll` ends every stream, cancels the heartbeat, unsubscribes and makes `open` answer `unavailable`; the lease is released once per stream on 'close'.
  - Commit: `feat(server): add the event stream hub`.
  - Mutation proofs: registration deferred by a microtask (the no-gap test); the seq filter removed; heartbeat interval 15,001; heartbeat frame with an `id`; the buffer limit ignored; `closeAll` without unsubscribing.
  - Done when: tests green; mutations caught; no id moved; `rg` finds `FR-289 (f) (heartbeat)`, `FR-290 (stream, hub)`.
  - Size: L (about 650).

- [ ] **T5. The event-stream route over HTTP and the hand-written reader.** FR-280 (Server-Sent Events); FR-281 (i); FR-285 (event stream); FR-286 (stream headers); FR-289 (stream); FR-299 (stream limits, HTTP); FR-301 (order, stream route); NFR-52 (network)
  - Depends on: T4.
  - Files: `apps/server/src/http/{router,server}.ts`, `apps/server/src/main.ts`, `apps/server/test/{http-stream,http-stream-limits}.test.ts`, `apps/server/test/helpers/{sse-reader,server-harness}.ts`, `apps/server/test/http-pipeline.test.ts` (SERVER_OPTION_KEYS gains `streams`).
  - Tests first (real listener, port 0, fake clock and scheduler): 200 with exactly the headers of 19.2 and no `Content-Length`; any `Origin` without `Authorization` gets `*`, with `Authorization` only an allowed origin (Vary); the preflight with `last-event-id` on the wire; `lastEventId=0` replays from the creation `schedule` event, the header wins over the parameter, a number above the latest gives nothing and stays open, beyond the safe range likewise, invalid values 400 naming the field, an unknown parameter 400, an unknown or malformed match 404 JSON, `POST .../events` 405 with `Allow: GET, OPTIONS`, a storage failure 503 before any stream byte; live events after the open; the public data's `lastSeq` then a subscription with it misses nothing (FR-289 (b)); limits on the wire (limits lowered through settings): the sixth anonymous stream is 429 with `Retry-After: 15` and `retryAfter`, its read ticket cancelled (the per-minute count is unchanged), admitted again after one stream closes; a client credential at its own limit while the address is free; a 404 or 400 on the stream route releases its lease (six 404s then a stream is accepted); a client that disconnects releases its lease; `rate-limited` before `unknown-match` (FR-301 order); `main.ts` builds the hub (a child-process test reads one event from a real stream).
  - Commit: `feat(server): serve the event stream`.
  - Mutation proofs: the gauge checked after routing; the lease kept after a 404; the read ticket not cancelled on a gauge refusal; the header ignored; `*` sent with `Authorization`; `Retry-After` from the per-minute wait only.
  - Done when: tests green; mutations caught; no id moved; `rg` finds `FR-281 (i)`, `FR-299 (stream limits, HTTP)`. Checkpoint: if the branch passes about 3,000 changed lines here, the limit wire tests move to M3b' T2' (plan 19.12).
  - Size: L (about 650).

- [ ] **T6. Close M3b: ledger, process checks, PR.** NFR-55
  - Depends on: T1 to T5.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test retitled to M3b: still 76 / 20, the 20 later ids as a literal list), `specs/008-server-and-predictions/plan.md` (sections 11 and 13: M3b closing summary, figures, open parts), `PROGRESS.md`, `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden` clean; `git diff --stat rewrite` only planned files; no `package.json`, lockfile or `.nvmrc` change; scans: `node:http` only under `src/http`, timers only in `scheduler.ts`, no logging outside `main.ts` and the log sink, no production import of `store/faults.ts`; the PR lists E1 to E10 as decided, D28, the ledger and the figures. Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 008 pending set after M3b`.
  - Done when: CI green; counts 76 / 20; `MEMORY.md` updated (next: M3b').
  - Size: S (about 80).

## M3b' (`feat/008-m3b2-stream-proofs-and-load`, from `rewrite` after M3b is merged; T1' to T5'; 78 / 18)

- [ ] **T1'. Branch and bookkeeping targets.** NFR-55
  - Depends on: M3b merged.
  - Files: `packages/sim/test/traceability.test.ts` (comments: T2' 77 / 19, T4' 78 / 18).
  - Commit: `test: prepare the spec 008 bookkeeping for M3b'`.
  - Done when: suite, typecheck, `CI=1` green; no id moved.
  - Size: S (about 30).

- [ ] **T2'. Event content and order on the wire.** FR-287 (close; letter (d) is M4); FR-288 (stream); FR-290 (stream); FR-257, NFR-47 (a) (stream twins); NFR-47 (c) (stream bytes); FR-259 (stream); FR-302 (events)
  - Depends on: T1'.
  - Files: `apps/server/test/{stream-order,stream-twins,stream-late-join}.test.ts`, `apps/server/test/server-log-scan.test.ts` (the scan also reads the stream bytes), `packages/sim/test/traceability.test.ts` (FR-287 out of `PENDING_008`, 77 / 19; the planted pending-id test switches from `FR-287` to `FR-303`).
  - Tests first: one stream from `lastEventId=0` over full dev-map matches through HTTP: manual timing (three advances per round), clock timing with L2 > 0 and with L2 = 0, a manual advance in every stage, a late step after a forward jump; for every decision the exact type sequence of plan 19.8 (no `schedule` after round T, `match-finished` last; a map change gives `match-halted` only), sequence numbers contiguous and equal to the stored ones, each `data` byte-equal to `encodeEvent` of the stored event; `victim-revealed` carries every FR-288 field and equals the public data's `victim` of the same moment; a late joiner (public data at `phase-2`, then a stream with its `lastSeq`) gets exactly the later events; a phase-1 close whose transaction fails (fault seam) sends nothing but heartbeats, and the retry 3 s later sends the events with the stored numbers; twins (test-only seed source, same public data, different victim before C1, then same victim and different absorber before A): byte-identical stream bytes up to each reveal; the stream bytes before the finish contain no secret or round seed in any of the NFR-47 (c) encodings, and the secret appears first in `match-finished`; every `schedule`, `victim-revealed`, `match-finished`, `match-halted` event carries a reported time that never decreases.
  - Commit: `test(server): pin the event order and content of the stream`.
  - Mutation proofs: the hub writing a decision's events in reverse; publication moved before the commit (the fault test sees events never stored); `encodeEvent` replaced by `JSON.stringify` of a reordered object; a `schedule` event after round T (core mutation, the goldens and this test both fail).
  - Done when: tests green; mutations caught; FR-287 moved (77 / 19); `rg` finds FR-287.
  - Size: L (about 550).

- [ ] **T3'. Shutdown, restart and kills with open streams.** FR-289 (stream, shutdown and restart); FR-294 (stream replay); NFR-57 (replay); NFR-52 (network)
  - Depends on: T2'.
  - Files: `apps/server/src/http/shutdown.ts` (`streams` dependency), `apps/server/src/main.ts`, `apps/server/test/{server-shutdown,stream-restart}.test.ts`, `apps/server/test/fixtures/kill-child.ts` (a blocking listener registered before the hub, so the kill falls after `COMMIT` and before publication), `apps/server/test/helpers/main-child.ts`.
  - Tests first: shutdown with three open streams and no request in flight ends before the grace, logs `shutdown-done` with `forced: false`, the readers see the end of their streams, `service.close()` runs once, the heartbeat is cancelled; a stream opened on a kept-alive connection during the shutdown is 503 `unavailable`; a slow request in flight still gets its grace; a file database: events committed with no stream open, restart, a stream with `Last-Event-ID` of the last event seen gets the rest with their original numbers, no duplicate; a child killed after `COMMIT` and before publication of a phase-1 close: after restart the replay holds `phase-closed`, `victim-revealed`, `schedule` once, and the step is not performed again; a child killed during the late step of `start()` (blocking listener at its publication): the next restart performs nothing again and the replay is complete.
  - Commit: `feat(server): end the streams at shutdown and replay after restarts`.
  - Mutation proofs: `closeAll` not called at shutdown (the shutdown waits the grace, `forced: true`); a stream accepted during the shutdown; replay from `seq >= n` (a duplicate).
  - Done when: tests green, the kill tests run on Windows and Linux CI; mutations caught; no id moved.
  - Size: L (about 500).

- [ ] **T4'. The NFR-49 procedure.** NFR-49 (close: pure part and smoke run)
  - Depends on: T3'.
  - Files: `apps/server/scripts/{load,load-stats}.ts`, `apps/server/test/{load-stats,load-smoke}.test.ts`, `packages/sim/test/traceability.test.ts` (NFR-49 out of `PENDING_008`, 78 / 18).
  - Tests first: `load-stats`: p95 by nearest rank on known lists (including 1 and 20 items, non-round values), the delay of a step is measured to the LAST stream's receipt of its last event, a missing receipt, an early close and a non-200 reply each count as failures, the summary keys; smoke: `node --import tsx scripts/load.ts --smoke` in a child exits 0 and prints one summary JSON line with no failure (explicit `{ timeout: 60_000 }`, no target asserted).
  - Hand run (not in CI): `node --import tsx scripts/load.ts` alone on the reference PC (plan 19.9); record p95, worst step delay, restart time, Node version and machine load in plan section 13 and the PR; a missed target stops for an exact fix or a spec change.
  - Commit: `feat(server): add the NFR-49 load procedure`.
  - Mutation proofs: p95 as the median; a missing receipt ignored; the delay to the first stream instead of the last.
  - Done when: tests green; figures recorded; NFR-49 moved (78 / 18); `rg` finds NFR-49.
  - Size: L (about 550).

- [ ] **T5'. Close M3b': ledger, process checks, PR.** NFR-55
  - Depends on: T1' to T4'.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test: 78 / 18, FR-287 and NFR-49 pinned done, the 18 later ids as a literal list), `plan.md` (sections 11 and 13: M3b' closing summary, the FR-287 (d) hand-off to M4), `PROGRESS.md`, `MEMORY.md` (local).
  - Steps: as M3b T6; the PR carries the NFR-49 figures.
  - Commit: `test: pin the spec 008 pending set after M3b'`.
  - Done when: CI green; counts 78 / 18; `MEMORY.md` updated (next: detail M4).
  - Size: S (about 100).
