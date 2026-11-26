# Spec 038 — Progress

## 2026-11-26 — Spec approved
- Spec written and approved by the user in the spec thread ("aprobado"). Tier: Light SDD (bot + viewer capture mode; no server change).
- Decisions: round image every round zoomed on the annexation, edited into the round announcement; option (b) dropped; map command ephemeral, no publish button; screenshot of the viewer via `puppeteer-core` (approved) + `chrome-headless-shell`, launched per capture, one at a time.
- Not implemented yet; no code changed.
- Branch: `feat/038-discord-round-images`. State: spec approved. Next step: one implementer (Light SDD), tests first, FR-713..FR-726 / NFR-187..NFR-191; then one reviewer.

## 2026-11-26 — Implementation (one implementer, Light SDD)
- **Viewer** (`apps/web`): `core/capture.ts` (address `?capture=1&match=&round=&frame=round|full`, annexation box, camera, marks), `chooseScene` returns `capture` before any other scene, `ui/capture-load.ts` (reads only through `canRequest`: a round above the applied rounds is refused before any state/record/map request, NFR-187), `ui/capture-main.ts` (no panel, fixed camera, `data-capture` = `ready` | `error` on `<html>`), `MapViewInput.start.{marks,cameraFor}`.
- **Bot** (`apps/bot`): `core/capture.ts` (URL, sizes, PNG header size, LRU), `io/capture.ts` (service: FIFO one-at-a-time, 32-entry LRU, browser closed after 10 s idle, 20 s limit, over-10 MB retaken at half size once, `reveal`/`request` anti-spoiler guard), `io/capture-chrome.ts` (puppeteer-core, headless shell), follower adds the image by editing the announcement, `/ff mapa` (ephemeral image), `MBRG_CHROME_PATH`, images off + one `images-disabled` log when viewer URL or Chrome path is missing. `puppeteer-core` 25.19.0 added (approved).
- **Decision on FR-714 (marks)**: the viewer shows, at the end of its reveal tours, the absorber lit and the rest dimmed (`TOUR_PARAMS.dimMax`). Capture mode draws the state AFTER round k with the absorber lit and the rest dimmed the same way: the victim's former territories are part of the absorber's land, so they are lit with it. Round 0 has no marks. Both frame kinds carry the marks (FR-714 is about capture mode for k >= 1).
- **Tests** (written before the code of each part): `apps/web/test/capture.test.ts`, `capture-load.test.ts`; `apps/bot/test/core-capture.test.ts`, `io-capture.test.ts`, `bot-flow-capture.test.ts`, `discord-translate-image.test.ts`; two scan lists updated (`live-entry` fake actions, `strings-language` LIVE_KINDS += `capture`). `npm run typecheck` and `npm test` green.
- **Real runs** (`apps/bot/test/real/capture-real.ts`, manual): real server + production build of the viewer + chrome-headless-shell 158 on Windows 11, SwiftShader WebGL. Images in `.claude/review/038/` (gitignored). Times include queue + browser start when cold; memory = peak SUM of working sets of all `chrome-headless-shell.exe` processes sampled every 120 ms (shared pages counted per process, so it overstates).

| capture | time | peak memory |
|---|---|---|
| world-countries round image 1600x900, cold (browser starts) | 5.5-6.6 s | ~650 MB |
| world-countries round image, warm | 5.2-6.0 s | ~670 MB |
| world-countries full map 4096x2179 | ~11.6 s | ~850-920 MB |
| dev map round image / full map 2048x2048 | 2.9 s / 3.5 s | ~560 / ~625 MB |
| idle (10 s after the last capture) | n/a | 0 MB (no process) |
| reference: blank page / blank page with a WebGL canvas | n/a | 227 / 329 MB |

- **NFR-188 / NFR-189 are NOT met on this machine.** Time: 5.5-6.6 s cold for the world round image against <= 5 s. Memory: ~650 MB against <= 200 MB; a blank Chrome page alone is 227 MB by the same measure, so 200 MB cannot be reached with Chrome. Where the time goes (world round image): page JS ~3.9 s (label layout: territory tiers ~0.9 s + faction layout ~2.2 s, inside `createMapView`, i.e. the viewer's own code), software WebGL first frame ~1.6 s, browser/page/screenshot < 0.5 s. Tried without effect: `--in-process-gpu`, `--single-process` (-120 MB, +0.5 s, unstable), disabled features. Gained: one paint instead of two (`cameraFor`), polling 50 ms. Idle cost (0 MB) and the 20 s limit hold (full world map 11.6 s).
- Observation: the annexation frame holds EVERY territory of the absorber (spec). On world-countries an absorber with distant islands (round 3: Peru, which owns Pacific island territories) gives a wide frame mostly of ocean. Not changed; an option for a follow-up is to frame the main pieces only.
- Untested: real Discord (never automated); Linux; the 10 MB retry with real files (fake driver only); more than 3 rounds of a real match.
- Branch `feat/038-round-images-impl`. State: implemented, PR open, spec `Status: implemented` and moved to `specs/archive/`. Next step: review; the user decides whether to relax NFR-188/189 or open a perf follow-up (cache/optimize label layout for capture, or frame by main pieces).
