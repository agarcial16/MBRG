### M5 — Live shell, real-server proofs, close (`feat/009-m5-live-tours`; 46 / 1 -> 47 / 0)
**Status: approved with `tasks.md` (2026-10-25); the DRAFT marker was removed by T1 (2026-10-26). A7 is decided (D16). Amendments D18 to D20 (M4 review) apply.** Plan sections 6, 9, 10, 12. Rules of `tasks.md` apply. Estimate about 1,250 changed lines. Branch from `rewrite` (M4 merged as #47).

Titles: NFR-63 first named in T4. Parts: `FR-316 (shell)`, `FR-330 (shell)`, `FR-341 (live)`, `FR-345 (shell)`, `FR-336 (real server)`.

- [x] **T1. Branch and bookkeeping.** Done when: suite green; 46 / 1. Size: S (about 30).

- [x] **T2. Live shell: runner effects, port, panel, skip.** (parts: FR-316, FR-330, FR-341, FR-345 (shell))
  - Files: `apps/web/src/core/live-model.ts` (a field or effect that carries the FR-320 skip, reason `mismatch`, to the port), `apps/web/src/ui/{live-runner,live-main,live-panel}.ts`, `apps/web/test/{live-runner,live-model-tour}.test.ts`.
  - Tests first (recording port): `victim-tour`, `complete-tour` and `play-step` with `tour` reach the port in the same `feed`, before `show`; every `show` between a tour start and its result hook carries `revealing: true`; the result hook triggers one `show` on that frame; navigation during an absorber tour completes it and continues as the 005 rules say; the address camera is written at the tour end only (A7); the live scans stay green (no new live file, no `seed` identifier, no DOM in the runner); a model FR-320 skip (reason `mismatch`) reaches `panelView(..., { mismatch: true })` in development builds and nothing in production; the line lives until the next victim reveal or the round change (recommended; M5 decides and writes it here); the port starts the tour at the feed's handling reading (D11), not at a later reading; optional: widen the FR-330 source scan to `ariaLabel` and `innerHTML` property writes and to the other `ui` files.
  - Commit: `feat(web): play reveal tours in the live viewer`.
  - Mutation proofs: `show` before the effects; `revealing` cleared at the tour start.
  - Done when: tests green; no id moved. Size: M (about 600).

- [ ] **T3. Real-server proofs.** (parts: FR-316, FR-319, FR-336, FR-345, FR-349 (real server))
  - Files: `apps/server/test/viewer-tour.test.ts` (new; harness of M3, fake clock, in-memory store, port 0).
  - Tests first: a clock match, a viewer subscribed before C1 gets one victim tour with the nominal budget; a viewer that reads the public data in phase 2 gets none and shows the name at once; L1 = 5 s -> compressed, L1 = 3 s -> skipped; the application with L2 = 0 and with L2 = 2 s gives `play-step` with an absorber tour after the C2 close; manual timing gives nominal tours; a halt during a tour completes it; no request above N in the request log.
  - Commit: `test(server): prove the reveal tours against the real server`.
  - Mutation proofs: one decision of T2 of M2 changed in `src` (a real-server test fails).
  - Done when: tests green (explicit timeouts; kill by PID in `finally` if a child is used). Size: M (about 500).

- [ ] **T4. Local live run, screenshots, figures, close.** NFR-63
  - Files: traceability (pending set of 009 empty; title test and planted-id test over a synthetic list), PROGRESS, plan figures, `MEMORY.md` (local), `.claude/review/009-m5-live.html` (not in git).
  - Steps: local run with `apps/server/test/fixtures/dev-live-server.ts` and the Vite dev server: a fresh reveal tour, a reload in phase 2, a compressed and a skipped tour with short L1, the absorber tour with L2 = 0 and L2 > 0; one DevTools trace of a live victim tour (first-frame latency); screenshots of plan section 12 item 3; no console errors.
  - Tests first: closing state 47 / 0; `NFR-63` titled checks: goldens and `maps/dev` byte-identical against `rewrite`, the FR-355 equality test present.
  - Commit: `test: close the spec 009 bookkeeping`.
  - Done when: suite, typecheck, `CI=1` green; the user reviewed the page and accepted the parameter values; spec status stays `approved` until the user's acceptance, then `implemented`. Size: S (about 120).
