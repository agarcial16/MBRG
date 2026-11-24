# Spec 034 — Windowed round timeline and jump-to-round
Status: implemented (approved by user: "apruebo ... 034", 2026-11-23)
Tier: Light SDD (`apps/web`). Ids outside the traceability ledger: FR-660..FR-666, NFR-170..NFR-172. Amends spec 010 (FR-364) and spec 013 (FR-442, FR-444).

## Context and goal
**What exists today:** The match viewer's round selector (defined in spec 010 FR-364, amended in spec 013 FR-441/442/444/445, and restyled as a connected horizontal rail in spec 031) renders a button for every round from `0` ("Inicio") through the latest applied round (plus one disabled button for the round currently in play) inside a single horizontally scrolling strip, beside the `« ‹ › »` navigation buttons (first, previous, next, last), camera reset ("Vista"), and tour skip ("Saltar"). On desktop, the command panel container allows horizontal overflow when the strip grows past the panel width (~10+ rounds): in a 52-faction match (51 rounds), the entire bottom panel scrolls horizontally, clipping the stage, prediction/result, and winner text lines on the left while forcing tedious horizontal scrolling to reach earlier rounds. There is also no way in the live viewer to jump directly to an intermediate round without stepping repeatedly.

**Goal:** Replace the ever-growing horizontal round strip with a dynamically sized sliding window of numbered round buttons alongside a permanently pinned "Inicio" chip, fix the panel horizontal-overflow bug so panel text never scrolls or clips, keep `« ‹ › »` stepping rounds while adding window-pager arrows plus wheel/swipe window shifting, and turn the `Ronda N` label into a spoiler-safe click-to-jump numeric input for long matches (50–200+ rounds).

## Users
- Players and spectators reviewing past rounds or following long matches (e.g. Spain 52 provinces, World 193 countries) on desktop and phone.

## User stories
- US-1. As a spectator in a long match, I want the round selector to show as many numbered round buttons as fit the panel width without overflow so that the panel never scrolls horizontally or clips text.
- US-2. As a spectator reviewing an earlier moment in a 50+ round match, I want to shift the visible round window (via pager arrows, mouse wheel, or touch swipe) or click `Ronda N` to jump directly to a round number so that I do not have to press the previous arrow dozens of times.
- US-3. As a player in an ongoing match, I want the round selector and jump control to show and accept only rounds played so far so that the match length or future rounds are never spoiled.

## Definitions
- **Playable range**: round `0` ("Inicio", state before round 1) through `applied` (latest applied round). While a round is actively in play, `applied + 1` may appear as a non-selectable in-play indicator.
- **Window**: the contiguous slice of at most `N` numbered round buttons (from `1` through `applied`, plus `applied + 1` when in play) rendered at once between the window-pager arrows, where `N` is computed dynamically from the available strip width (~9–10 on desktop, ~5–6 on phone) and recomputed on resize.

## Functional requirements
- FR-660: WHILE the match screen displays the round selector, THE SYSTEM SHALL compute the window capacity `N` dynamically from the available strip width (recomputed on viewport/panel resize, fitting ~9–10 buttons on desktop and ~5–6 on phone without overflow) and render a sliding window of at most `N` contiguous numbered round buttons (`1`..`applied`, plus disabled `applied + 1` while in play); the window SHALL slide automatically so that the currently displayed round (when `>= 1`) stays visible and older round numbers rotate out to the left as new rounds are applied.
- FR-661: THE SYSTEM SHALL pin the "Inicio" (round `0`) button permanently to the left of the sliding numbered window so that round `0` is always visible and clickable regardless of the active window position, while keeping the `«` (`Home`) control navigating to round `0`.
- FR-662: WHEN the user activates the existing `«`, `‹`, `›`, `»` buttons, THE SYSTEM SHALL step the displayed round (first / previous / next / last applied) and automatically slide the window to keep the displayed round visible; THE SYSTEM SHALL additionally provide compact window-pager arrows flanking the numbered round buttons that shift the visible window left or right without changing the displayed round, and SHALL also shift the window on mouse wheel over the round buttons (desktop) and horizontal touch swipe over the round strip (phone, without scrolling the page or panning/zooming the map); each step or pager control SHALL be disabled at its respective boundary.
- FR-663 (amended after hand test): WHEN the user clicks or activates the `Ronda N` label (interactive whenever `applied >= 1`), THE SYSTEM SHALL turn it in place into a visually distinct inline jump box (separated from the adjacent "Inicio" chip so "Inicio" is not mistaken for confirm) containing a compact digits-only numeric input (`inputmode="numeric"`, blocking or stripping non-digit characters as typed and on paste, pre-filled with the displayed round) and an explicit confirm button (`Ir`): WHEN the user submits via `Enter`, activates the confirm button (`Ir`), or leaves the jump box (blur / click or tap outside) with a number typed, THE SYSTEM SHALL clamp it to `[0, applied]` (below `1`, e.g. `0` or less, jumps to "Inicio" round `0`; above `applied` jumps to `applied`), display that round, slide the window to contain it, and restore the label; WHEN the user leaves or submits with an empty input, or presses `Escape`, THE SYSTEM SHALL close the jump box and restore the label without changing the round (no validation error message is shown).
- FR-664: THE SYSTEM SHALL keep the pinned "Inicio" chip, window-pager arrows, numbered round window, `Ronda N` jump trigger/input, and navigation controls strictly inside the width of the command panel on both desktop (`>= 1024 px`) and phone (`< 1024 px`) layouts so that the command panel never scrolls horizontally and none of its text lines (stage, prediction, result, victim, winner, notices) are clipped or horizontally shifted, including in matches with 50+ or 200+ rounds.
- FR-665: THE SYSTEM SHALL preserve global keyboard shortcuts (`ArrowLeft` previous, `ArrowRight` next, `Home` Inicio, `End` latest applied) when focus is outside text inputs, suspend them while focus is inside the jump-to-round input, support `Enter` to submit and `Escape` to cancel, mark the displayed round with `aria-current="true"` and descriptive Spanish `aria-label`s (including the `Ronda N` jump trigger and window-pager arrows), maintain visible focus outlines, and preserve accessible phone touch targets (at least 44 × 44 CSS px for controls; compact strip row within FR-445).
- FR-666: THE SYSTEM SHALL enforce the anti-spoiler invariant across the timeline and jump control: no round beyond `applied` is ever selectable or accepted (only `applied + 1` may appear as a disabled in-play indicator while active), and the match's total round count is never exposed in the window, jump-to-round placeholder/limits, or accessible labels before the match finishes.

## Non-functional requirements
- NFR-170: Window capacity calculation (from available width), window slicing, sliding on selection or live advance, window shift bounds (pager arrows, wheel, swipe), and jump-to-round digits sanitization and clamping SHALL be pure, deterministic functions tested in Node with no DOM or ambient state, verified at 0, 1, 10, 52, and 250+ rounds and across desktop and phone widths.
- NFR-171: Every new user-visible string (labels, placeholders, accessible names) SHALL live in the single Spanish strings module in a dedicated spec 034 block; styling SHALL reuse existing `--hud-*` tokens (WCAG AA contrast >= 4.5:1 normal text, >= 3:1 large text and outlines), self-hosted fonts, and respect `prefers-reduced-motion: reduce`.
- NFR-172: Existing match/spectator routes, anti-spoiler scans, reveal tour timing/goldens, phone dock height budget (FR-445: <= 40 % tall / 45 % short), and keyboard focus stability across per-second refreshes SHALL remain unchanged; diff restricted to `apps/web` and `specs/archive/034-round-timeline/`.

## Edge cases
- Match at round `0` (before round 1) or with fewer than `N` numbered rounds: "Inicio" is pinned on the left, only existing numbered rounds appear (no empty placeholder slots), and both window-pager arrows are disabled.
- Viewing "Inicio" (round `0`) when `applied >= 1`: the jump trigger stays reachable (showing `Ronda 0` without repeating the word "Inicio", preserving FR-445) so the user can still jump directly to any round `1..applied`.
- Live round advances while the user is viewing the live round: the window slides right by one so the new live round stays visible.
- Live round advances while the user is replaying an earlier round: the displayed round stays unchanged (no forced jump to live) and the right-edge pager/last controls reflect the newly applied round.
- Pending round in play (`applied + 1`): shown at the right edge of the window when the window reaches the end, visibly distinct and disabled; typing `applied + 1` or higher in the jump input clamps to `applied` (amended after hand test).
- Typing or pasting non-digits, `0` or less, numbers above `applied`, leaving the box, or submitting an empty value in the jump input (amended after hand test): non-digits are blocked/stripped on typing and paste; `0` or less jumps to "Inicio" (round `0`); numbers above `applied` jump to `applied`; leaving the box (blur / click or tap outside) with a number typed applies the jump just like `Enter` or clicking `Ir`; empty input or `Escape` closes without jumping or showing an error.
- 3-digit round numbers (`100`–`250` on large maps like World): round buttons remain legible, dynamic `N` accounts for button width, and the panel never overflows horizontally.
- Viewport resize (e.g. rotating phone or resizing desktop window): `N` recomputes and the window adjusts while keeping the displayed round visible.

## Out of scope
- Server, protocol, simulator, bot, or map format changes.
- Search by faction name or event text inside the round strip (chronicle and factions search already exist in the left column / dock tabs).
- Playback speed, autoplay scrubbing, or timeline zoom.
- New runtime or build dependencies.

## Done criteria
1. Pure unit tests written first (seen red, then green) covering dynamic capacity `N`, window slicing, sliding, boundary/shift clamping (pager/wheel/swipe), jump-to-round parsing/validation, anti-spoiler bounds, strings, and layout/overflow rules; `npm test` and `npm run typecheck` green.
2. Desktop (1280 × 720) and phone (390 × 844) before/after screenshots of a long match (50+ rounds) showing the pinned "Inicio", dynamic windowed strip, pager arrows, jump input, and unclipped panel text saved under `.claude/review/034-round-timeline/`, posted in the thread with a before/after slider widget per viewport.
3. Diff restricted to `apps/web` and `specs/archive/034-round-timeline/`; PR opened into `main`.

## Open questions
None.
