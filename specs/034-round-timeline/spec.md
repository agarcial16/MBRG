# Spec 034 — Windowed round timeline and jump-to-round
Status: draft
Tier: Light SDD (`apps/web`). Ids outside the traceability ledger: FR-660..FR-666, NFR-170..NFR-172. Amends spec 010 (FR-364) and spec 013 (FR-442, FR-444).

## Context and goal
**What exists today:** The match viewer's round selector (defined in spec 010 FR-364, amended in spec 013 FR-441/442/444/445, and restyled as a connected horizontal rail in spec 031) renders a button for every round from `0` ("Inicio") through the latest applied round (plus one disabled button for the round currently in play) inside a single horizontally scrolling strip, beside the `« ‹ › »` navigation buttons (first, previous, next, last), camera reset ("Vista"), and tour skip ("Saltar"). On desktop, the command panel container allows horizontal overflow when the strip grows past the panel width (~10+ rounds): in a 52-faction match (51 rounds), the entire bottom panel scrolls horizontally, clipping the stage, prediction/result, and winner text lines on the left while forcing tedious horizontal scrolling to reach earlier rounds. There is also no way in the live viewer to jump directly to an intermediate round without stepping repeatedly.

**Goal:** Replace the ever-growing horizontal round strip with a fixed-capacity sliding window of round buttons that stays within the command panel width, fix the panel horizontal-overflow bug so panel text never scrolls or clips, clarify arrow navigation vs window shifting, and add a spoiler-safe jump-to-round control for long matches (50–200+ rounds).

## Users
- Players and spectators reviewing past rounds or following long matches (e.g. Spain 52 provinces, World 193 countries) on desktop and phone.

## User stories
- US-1. As a spectator in a long match, I want the round selector to show a compact sliding window of round numbers that stays inside the panel so that the panel never scrolls horizontally or clips text.
- US-2. As a spectator reviewing an earlier moment in a 50+ round match, I want to shift the visible round window or jump directly to a round number so that I do not have to press the previous arrow dozens of times.
- US-3. As a player in an ongoing match, I want the round selector and jump control to show and accept only rounds played so far so that the match length or future rounds are never spoiled.

## Definitions
- **Playable range**: round `0` ("Inicio", state before round 1) through `applied` (latest applied round). While a round is actively in play, `applied + 1` may appear as a non-selectable in-play indicator.
- **Window**: the contiguous slice of at most `N` round buttons rendered at once in the round strip.

## Functional requirements
- FR-660: WHILE the match screen displays the round selector, THE SYSTEM SHALL render a sliding window of at most `N` round buttons (`N` sized to fit the panel without overflow: ~9–10 on desktop, ~5–6 on phone; exact count in OQ1) covering contiguous rounds within the playable range, sliding automatically so that the currently displayed round stays visible inside the window and older round numbers rotate out to the left as new rounds are applied.
- FR-661: THE SYSTEM SHALL keep "Inicio" (round `0`) reachable at all times regardless of the active window position, either pinned outside the sliding window or via the first-round control (`«`) (pinned vs first-button-only in OQ2).
- FR-662: WHEN the user activates the navigation arrows, THE SYSTEM SHALL separate or define the exact role of round stepping (first `«`, previous `‹`, next `›`, last `»`) versus shifting the visible round window without changing the displayed round (behavior in OQ3), and SHALL disable each control when at its respective boundary (round `0` / left edge of the window, or `applied` / right edge of the playable window).
- FR-663: THE SYSTEM SHALL provide a compact jump-to-round control (presentation in OQ4) that accepts integers from `0` ("Inicio") to `applied`: WHEN the user submits a valid integer in `[0, applied]`, THE SYSTEM SHALL display that round and slide the window to contain it; IF the submitted value is empty, non-numeric, negative, or greater than `applied`, THEN THE SYSTEM SHALL keep the current round unchanged and display a plain Spanish validation message stating the valid range `0` to `applied`.
- FR-664: THE SYSTEM SHALL keep the round selector, navigation controls, and jump-to-round control strictly inside the width of the command panel on both desktop (`>= 1024 px`) and phone (`< 1024 px`) layouts so that the command panel never scrolls horizontally and none of its text lines (stage, prediction, result, victim, winner, notices) are clipped or horizontally shifted, including in matches with 50+ or 200+ rounds.
- FR-665: THE SYSTEM SHALL preserve global keyboard shortcuts (`ArrowLeft` previous, `ArrowRight` next, `Home` Inicio, `End` latest applied) when focus is outside text inputs, suspend them while focus is inside the jump-to-round input, support `Enter` to submit and `Escape` to cancel/blur the jump control, mark the displayed round with `aria-current="true"` and descriptive Spanish `aria-label`s, maintain visible focus outlines, and preserve accessible phone touch targets (at least 44 × 44 CSS px for controls; compact strip row within FR-445).
- FR-666: THE SYSTEM SHALL enforce the anti-spoiler invariant across the timeline and jump control: no round beyond `applied` is ever selectable or accepted (only `applied + 1` may appear as a disabled in-play indicator while active), and the match's total round count is never exposed in the window, jump-to-round placeholder/limits, validation message, or accessible labels before the match finishes.

## Non-functional requirements
- NFR-170: Window calculation (visible slice, sliding on selection or live advance, window shift bounds) and jump-to-round input parsing/validation SHALL be pure, deterministic functions tested in Node with no DOM or ambient state, verified at 0, 1, 10, 52, and 250+ rounds.
- NFR-171: Every new user-visible string (labels, placeholders, validation messages, accessible names) SHALL live in the single Spanish strings module in a dedicated spec 034 block; styling SHALL reuse existing `--hud-*` tokens (WCAG AA contrast >= 4.5:1 normal text, >= 3:1 large text and outlines), self-hosted fonts, and respect `prefers-reduced-motion: reduce`.
- NFR-172: Existing match/spectator routes, anti-spoiler scans, reveal tour timing/goldens, phone dock height budget (FR-445: <= 40 % tall / 45 % short), and keyboard focus stability across per-second refreshes SHALL remain unchanged; diff restricted to `apps/web` and `specs/034-round-timeline/`.

## Edge cases
- Match at round `0` (before round 1) or with fewer than `N` rounds: only the existing playable rounds appear, no empty placeholder slots, and window-shift controls are disabled.
- Live round advances while the user is viewing the live round: the window slides right by one so the new live round stays visible.
- Live round advances while the user is replaying an earlier round: the displayed round stays unchanged (no forced jump to live) and the right-edge shift/last controls reflect the newly applied round.
- Pending round in play (`applied + 1`): shown at the right edge of the window when the window reaches the end, visibly distinct and disabled; typing `applied + 1` in the jump control is rejected as not yet played.
- Typing leading/trailing whitespace, non-digits, decimals, signs (`+`/`-`), or numbers above `applied` in the jump input: rejected cleanly without changing the displayed round or leaking the match total.
- 3-digit round numbers (`100`–`250` on large maps like World): round buttons remain legible and never cause horizontal panel overflow.

## Out of scope
- Server, protocol, simulator, bot, or map format changes.
- Search by faction name or event text inside the round strip (chronicle and factions search already exist in the left column / dock tabs).
- Playback speed, autoplay scrubbing, or timeline zoom.
- New runtime or build dependencies.

## Done criteria
1. Pure unit tests written first (seen red, then green) covering window slicing, sliding, boundary/shift clamping, jump-to-round parsing/validation, anti-spoiler bounds, strings, and layout/overflow rules; `npm test` and `npm run typecheck` green.
2. Desktop (1280 × 720) and phone (390 × 844) before/after screenshots of a long match (50+ rounds) showing the windowed strip, jump control, and unclipped panel text saved under `.claude/review/034-round-timeline/`, posted in the thread with a before/after slider widget per viewport.
3. Diff restricted to `apps/web` and `specs/034-round-timeline/`; PR opened into `main`.

## Open questions
- OQ1: [NEEDS CLARIFICATION] How many numbered round buttons should be visible at once — e.g. **9** (or **10**) on desktop and **5** (or **6**) on phone, or sized dynamically to the available panel width?
- OQ2: [NEEDS CLARIFICATION] Should **"Inicio"** stay permanently pinned to the left of the sliding window (always visible beside the `N` numbered rounds), or slide out of the window while remaining one click away via `«` (`Home`)?
- OQ3: [NEEDS CLARIFICATION] Should `« ‹ › »` keep stepping the displayed round (first / previous / next / last) while adding small window-pager arrows flanking the round numbers to shift the visible window without changing the displayed round, OR should `‹` / `›` shift the window directly (and if so, how should single-round stepping work)?
- OQ4: [NEEDS CLARIFICATION] Which presentation do you prefer for the jump-to-round control: (a) an always-visible compact numeric input (`#` / `Ir a…`) inline in the controls bar, (b) a compact toggle button (`Ir a ronda` / magnifying glass) that opens a small inline input or popover, or (c) clicking the `Ronda N` label to edit and jump?
- OQ5: [NEEDS CLARIFICATION] Should mouse wheel or touch swipe over the round strip also shift the visible window, or only the arrows and jump-to-round control?
