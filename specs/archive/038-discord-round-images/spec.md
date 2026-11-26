# Spec 038 — Map images in Discord
Status: implemented
Tier: Light SDD (Discord bot + a viewer capture mode; no server, protocol, sim or shared change, no access to unrevealed rounds). Depends on 012 (bot), 017 (embeds), 021 (viewer link). Ids: FR-713..FR-726, NFR-187..NFR-191 (highest in use: FR-712, NFR-186).

## Context and goal
Today the bot announces each round in text and embeds only; to see the map a player opens the viewer. Players want to see the map in Discord itself: the annexation of each round, and the current map on demand. The image must look like the viewer (its colours, borders and labels): it is a screenshot of the viewer, not a new drawing, and the bot adds no text to it.

User decisions (2026-11-26, this thread): (a) an image every round, zoomed on the annexation; (b) periodic full-map images dropped (the command covers it); (c) a command showing the current map, visible only to the caller, no "publish" button for now; the bot takes the screenshot with a headless browser (`puppeteer-core` + `chrome-headless-shell`, dependency approved), launched only per capture; the viewer gets a capture mode.

## User stories
- US-1. As a spectator in the channel, I want each round's annexation shown as an image so that I see what happened without opening the viewer.
- US-2. As a player, I want to ask for the current map privately so that I can check the situation without spamming the channel.
- US-3. As the operator, I want the capture to cost nothing while idle and never block or break the match announcements.

## Definitions
- **Revealed round**: a round whose `round-applied` event the bot has received. The image of round k shows the state after round k.
- **Annexation frame**: the smallest rectangle holding every territory of the absorber after round k (the victim's former territories included), widened by the margins of FR-716.
- **Capture mode**: a viewer mode with no interface chrome (HUD, buttons, dock, timeline), a fixed camera given by the caller, no animation, that signals when the frame is fully drawn.

## Functional requirements
Viewer capture mode
- FR-713: WHEN the viewer is opened in capture mode for match M at round k, THE SYSTEM SHALL draw the map state after round k with the viewer's normal colours, borders and labels, and no interface chrome.
- FR-714: WHILE in capture mode for round k ≥ 1, THE SYSTEM SHALL mark the victim's former territories and the absorber of round k the way the viewer shows them at the end of its reveal animation.
- FR-715: WHEN the frame of FR-713 is complete (map, labels, marks), THE SYSTEM SHALL expose a "ready" signal readable by the capturing browser; IF the match or round cannot be shown, THEN it SHALL expose an "error" signal instead.
- FR-716: THE SYSTEM SHALL accept a camera frame in capture mode: either the full map, or the annexation frame of round k with a margin of 15 % of its larger side on each side, at least 20 % of the map width wide, kept inside the map bounds.

Round image (a)
- FR-717: WHEN the bot receives `round-applied` for round k of a followed match, THE SYSTEM SHALL capture the annexation frame of round k and attach it as the image of that round's announcement.
- FR-718: THE SYSTEM SHALL post the round announcement without waiting for the capture, and add the image to it by an edit when ready; IF the capture fails or exceeds 20 s, THEN the announcement SHALL stay as it is (no image, no error text in the channel) and the failure is logged.
- FR-719: THE SYSTEM SHALL never request a capture for a round greater than the last revealed round it has received for that match.

Current map command (c)
- FR-720: WHEN a user runs the map subcommand in a channel with a followed match, THE SYSTEM SHALL reply only to that user (ephemeral) with a full-map capture of the last revealed round of that match, with no publish button.
- FR-721: IF the channel has no followed match, THEN THE SYSTEM SHALL reply privately with one sentence saying so; IF no round is revealed yet, the capture SHALL show round 0 (the starting map).
- FR-722: IF the capture fails or exceeds 20 s, THEN THE SYSTEM SHALL reply privately with one sentence saying the map is not available right now.

Image, cache, resources
- FR-723: THE SYSTEM SHALL produce PNG images: the round image at 1600 × 900; the full map at the map's own aspect with its longer side min(map longer side, 4096) px; every file under 10 MB (Discord's limit) — IF a file is over, it is re-captured at half size once, else dropped as a failure.
- FR-724: THE SYSTEM SHALL keep captures in a memory cache keyed by (match, round, frame kind), at most 32 entries, least recently used evicted; a cached image is served with no new capture.
- FR-725: THE SYSTEM SHALL run at most one browser and one capture at a time (others queue, FIFO); the browser is started for a capture and closed after 10 s without a queued capture.
- FR-726: IF the viewer address or the browser path is not configured, THEN THE SYSTEM SHALL disable images (round announcements as today; the command answers "not available") and log it once at startup.

## Non-functional requirements
- NFR-187: Anti-spoiler: a capture can only show rounds the server already published; capture mode adds no way to read a later round (checked by a test that asks for round k+1 and gets the "error" signal).
- NFR-188: Idle cost: with no capture in the last 10 s, no browser process runs (0 MB). Peak memory of the browser during a capture of `maps/world-countries` ≤ 1 GB, as the sum of the working sets of its processes (measured once, recorded in PROGRESS). Relaxed from 200 MB on 2026-11-26 by the user: a blank Chrome page alone is 227 MB, so 200 MB is not reachable with Chrome.
- NFR-189: A capture of `maps/world-countries` (cold start included) takes ≤ 15 s on the dev machine, full-map image included (measured, recorded). Relaxed from 5 s on 2026-11-26 by the user; getting to 5 s is the performance follow-up on the board.
- NFR-190: Determinism: the same (match, round, frame kind) gives the same framing and the same labels (the image may differ in antialiasing only).
- NFR-191: No Discord user id, guild id or community key appears in a capture URL, log line or cache key.

## Edge cases
- A round is applied while a capture is queued: captures run in order; each uses its own round number.
- The match finishes: the final round gets its image like any other; the command keeps working on a finished followed match (last round).
- Very large maps (world-1815, municipal maps): the round frame is still 1600 × 900; the full map is capped at 4096 px on its longer side.
- Annexation frame larger than the map's aspect allows: the frame is the full map.
- The bot restarts mid-match: the cache is empty; the next round is captured normally.
- Message edit forbidden (missing permission) or image rejected by Discord: the announcement stays without image (FR-718).

## Out of scope
- Periodic full-map posts (option b), a "publish to channel" button, per-server image settings.
- Images drawn without a browser; the server producing or serving images.
- Animated images (GIF/video), images of history entries or finished-match replays.

## Done criteria
- All FR/NFR traced to tests; `npm test` and `npm run typecheck` green.
- Fake-Discord flow tests: image edit after `round-applied`, failure path, ephemeral command, no-match sentence, cache hit, queue order, idle shutdown.
- A real capture (local server + viewer + headless shell) of dev map and world-countries saved under `.claude/review/038/` and shown to the user; NFR-188/189 measured.
- `MEMORY.md`, `docs/board.md`, `docs/lessons/bot.md` updated; spec set to implemented and archived.

## Open questions
- None (setup note: the bot host needs `chrome-headless-shell` installed and its path configured; the viewer URL is the existing one).
