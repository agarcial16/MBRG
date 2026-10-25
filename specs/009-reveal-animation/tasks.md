# Tasks 009 — Reveal animation
**Status: approved by the user on 2026-10-25, with `plan.md` and the spec amendments A1, A2, A3, A5, A6, A7 (recorded in `spec.md` as D11 to D16). The marker of each milestone file is removed by the first task of that milestone.**

Plan: `specs/009-reveal-animation/plan.md`. Spec: `specs/009-reveal-animation/spec.md` (approved 2026-10-21). Any later change goes to the spec first, then the plan, then these tasks.

## Rules for every task
- **Delivery**: each milestone on its own branch (plan section 14) cut from an up-to-date `rewrite`, after the previous milestone is merged; one PR into `rewrite`, squash merge only with the user's OK and CI green. Never push to `main` or `rewrite`. One commit per task unless stated (English, conventional prefix, one line <= 72 chars).
- **Tests first**: write them, see them fail (red) for the right reason, then code. Prove guards by temporary mutation: back the file up first, use the FULL `npm test` (never a filtered run), one mutation chain at a time, in the foreground with a timeout; restore only your own backups; a surviving mutant means a missing test (use non-round constants).
- **Before each commit**: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) green. Quote the path (it contains spaces).
- **Scope**: no new dependency; no change to the map format, the presentation data, the id image, `MatchState`, `RoundRecord`, `packages/*`, `apps/server/src`, `tools/*`, `maps/dev` or any golden of 001 to 008 (each closing task runs `git diff --exit-code rewrite -- packages/shared packages/sim/src packages/protocol apps/server/src tools maps` and checks that no earlier golden file changed). Earlier tests are edited only as plan section 13 lists, with the meaning stated in the commit body.
- **Purity**: tour modules live in `apps/web/src/core`, pure (no DOM, three, clock, timers, randomness other than the σ stream). Only the shells route clock readings; no new importer of `ui/clock.ts`, no timer, no `requestAnimationFrame` outside `ui/frame-loop.ts`.
- **Naming rule** (FR-155 scan): no identifier or code text with `animate`, `animation(s)`, `tween(s)`, `keyframes`, `transitions`, `setTimeout`, `setInterval`; the word `transition` only in `core/address.ts`, `core/playback.ts`, `ui/main.ts`, `ui/url.ts`; no identifier containing `seed` in tour or live modules (the animation key is `sigma`); shader uniforms `uDim`, `uLit` only. Spanish strings and comments may use any word.
- **Language**: code, comments, docs in English; every visible text in `core/strings.ts`, Spanish (NFR-64).
- **Titles rule**: test titles start with the ids they verify; no task title or test title names a pending 009 id before the task that closes it (not even in prose or a closing-state title); a later part of a closed id is named with its part, for example `FR-345 (shell)`. Each task removes the ids it closes from `PENDING_009` in the same commit. Check before every commit (must list only ids already closed):
  `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\b(FR-3(1[6-9]|[2-4][0-9]|5[0-5])|NFR-(5[89]|6[0-4]))\b" apps/*/test packages/*/test tools/*/test`
- **Size**: estimates are changed lines (src + tests; docs and golden JSON apart). Stop and report when a task passes 1.5x its estimate or the branch passes 1.5x its milestone total.
- **Visual tasks** are not done without screenshots of the debug scene (fixed seed + round) reviewed by the user, delivered as an HTML page of before/after pairs under `.claude/review/` (not in git).
- **After each task**: tick it, append to `specs/009-reveal-animation/PROGRESS.md` (what changed, tests run and results, what is untested, next step), update `MEMORY.md` only for durable decisions and lessons, and stop.

## Milestone files
Read only the active one plus these rules.
| Milestone | File | Branch | Closes | Ledger after | Status |
|---|---|---|---|---|---|
| M1 | `tasks-M1.md` | `feat/009-m1-tour-core` | 20 ids (pure tour core) | 20 / 27 | done (merged, #42) |
| M2 | `tasks-M2.md` | `feat/009-m2-tour-decisions` | 10 ids (decisions, driver, goldens) | 30 / 17 | done, PR pending |
| M3 | `tasks-M3.md` | `feat/009-m3-tour-wiring` | 11 ids (live model, panel, debug address) | 41 / 6 | DRAFT |
| M4 | `tasks-M4.md` | `feat/009-m4-tour-drawing` | 5 ids (drawing, debug shell, figures, screenshots) | 46 / 1 | DRAFT |
| M5 | `tasks-M5.md` | `feat/009-m5-live-tours` | NFR-63 (live shell, real-server proofs, close) | 47 / 0 | DRAFT |

Progress per task: `specs/009-reveal-animation/PROGRESS.md`. Spec status stays `approved` until the user accepts M5; it then becomes `implemented`.
