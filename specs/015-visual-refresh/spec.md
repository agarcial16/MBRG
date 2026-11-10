# Spec 015 — Visual refresh (one look: the dark table)
Status: draft (awaiting the user's approval; revised 2026-11-10: chip keeps points, FR-432, FR-433). Tier: Light SDD (UI, visual design). Depends on 010 and 013 (the branch builds on 013's HUD; rebase onto `rewrite` once PR #57 is merged). Ids continue 014: FR-422 onwards, NFR-84 onwards. Amends 010 FR-368 (terra incognita).

## Goal
Make the viewer read as one coherent thing instead of three styles glued together (a parchment wallpaper with dragons, dark wood panels, a flat vector map). Direction "D", chosen by the user from prototypes (`specs/015-visual-refresh/prototype/desk-D-mesa-con-mar-vivo.png`, `phone-D-mesa-con-mar-vivo.png`): the map is a lit table. The map keeps its bright sea and its faction colours at the centre and fades into a dark wood background, so it no longer looks like a rectangle pasted on a wallpaper. The server, the protocol, the sim and the map format do not change.

## Requirements
**Background and map**
- FR-422: Where the map does not cover the screen, THE SYSTEM SHALL draw a dark wood tone with a soft vignette instead of the parchment tile. The parchment tile and its dragons are no longer drawn (the asset may stay in the repository). This replaces the texture of 010 FR-368.
- FR-423: THE SYSTEM SHALL fade the edge of the map image into that background over a soft band at every zoom and on every viewport, so no hard rectangle edge is visible. Picking, labels and the camera clamp stay as they are.
- FR-424: The map's sea colour, land colour and faction palette stay as they are (the "lively sea" of the prototype); only the edge fade and the background change on the map side.

**HUD**
- FR-425: On the desk layout the HUD panels use a darker, slightly translucent wood with a blur; on the phone the dock stays opaque and keeps its gilt frame.
- FR-426: The wax-red seals (the player chip and the "Enviada" seal) become a gilt outline on the wood, no red fill.
- FR-427: The player chip shows the player's name and points ("Ana · 0 pts"), without the "Tú:" prefix and without the rank. The rank stays in the leaderboard panel, the Ranking tab and the chip's accessible label.
- FR-428: In the top bar, the round, the phase and the countdown are vertically centred in the bar, on the desk and on the phone. The countdown is horizontally centred on the bar on both layouts; a long player name is shortened with an ellipsis before it can push the countdown.
- FR-429: The player chip's visible box is no taller than its text needs and is vertically centred in the top bar (it no longer fills the bar's height on the phone); its touch area stays at least 44 px on the phone.
- FR-430: The "Tu predicción" panel shows exactly the two lines of its frame at the top: the extra rule above the prediction block (`.hud-predict` top border) is removed.
- FR-431: The start, create, join and lobby screens use the same dark table background and vignette instead of the flat grey.
- FR-432: The leaderboard (panel and Ranking tab) lists every player who has joined, with 0 points from the moment they join, even if they have not predicted anything. The viewer completes the server's leaderboard (which lists only players with scores) with the players list it already reads for the lobby, so the server does not change. Players with equal points share the same rank; a new player appears as soon as the `player-joined` event arrives.
- FR-433: In the leaderboard, the viewer's own row is marked with their name and "(tú)" and is pinned as today, so the player always knows who they are; other rows show the name only.

## Non-functional requirements
- NFR-84: Text on the new background and panels keeps WCAG AA contrast (4.5:1; 3:1 for large text and icons).
- NFR-85: The edge fade is static work: no extra per-frame cost beyond the 010 budget.
- NFR-86: No change in `packages/*`, `apps/server`, the 009 goldens or the hit-testing; the only strings that change are the player chip text and the leaderboard row marker, in `core/strings.ts`. FR-432 uses reads the server already offers (players list, leaderboard); a leaderboard that lists players with 0 points by itself would be a server change (Full SDD) and stays out of this spec.
- NFR-87: Reduced motion, focus order and touch targets keep following 010 NFR-65 to NFR-67.

## Out of scope
- The map label typography (the bold white sans-serif) and any new faction palette: open for a later spec.
- New map art, new textures, a light theme.
- Layout changes beyond the items above.

## Open questions
- OQ1 (closed by the user): the chip keeps the points (FR-427).
- OQ2: Whether to try a slightly warmer or cooler dark tone for the background is left to the screenshot review.

## Done criteria
1. Tests: pure parts (chip text, top-bar rules, background and fade parameters) have unit tests per id; CSS rules are covered by scans like in 010/013.
2. Reviewed screenshots, before and after, at 1280x720, 1024x720 and 390x844: match (phase 1, results), lobby, create, join. Listed defects fixed.
3. The user's hand run on the real viewer (and a phone if possible).
4. One PR into `rewrite`; split only if the branch passes ~3,000 changed lines.
