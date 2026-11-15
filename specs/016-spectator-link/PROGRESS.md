# Progress — spec 016

## 2026-11-15 — FR-470, FR-471 (single step)
- FR-470: `chooseScene` marks `spectate=1` (exactly one value "1") as `spectate: true`; `enter` passes it to `live`; `startMatchEntry(matchId, spectate)` opens the scene with no read, no door, no token use/adoption/deletion; `syncLiveAddress` keeps `&spectate=1`. The live parser ignores unknown params already (no change to its strictness).
- FR-471: cause = a spectator tap sets a notice (`noOfferText('not-joined')`) that equals the panel line from `offerText`; `playHud` now drops a notice equal to the line (also fixes the same duplicate for "behind"/"closed"). The notice still creates the panel for a spectator.
- FR ids start at 470 because spec 012 (branch feat/012-discord-bot) already uses FR-451..469.
- Tests: live-address, live-entry, play-view, play-session, play-shell updated/added (written first). typecheck green; full `npm test`: 335 files, 5315 passed, 4 skipped. `apps/web/test/package.test.ts` (FR-132) failed intermittently when run alone, also without these changes (flaky, path with spaces); it passed in the full run.
- Untested: no browser, so no screenshots.
- Next: reviewer; hand check of `?match=<id>&spectate=1`.
