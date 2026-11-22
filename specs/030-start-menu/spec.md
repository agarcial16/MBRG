# Spec 030 — Start menu landing
Status: implemented (direction C + Logo 1 + static rotating atlas simplification picked by the user on 2026-11-21). Tier: Light SDD (UI, visual design). Ids outside the traceability ledger: FR-610..FR-616, NFR-140..NFR-142.

## Context and goal
Today the viewer's root route (`/`) opens the debug scene in development builds and a bare centred card over an empty dark gradient in production builds. Replace the root route with a proper game landing screen ("direction C"): an anchored left console carrying the FactionFall identity, pitch and match/spectator entry input, set against a full-bleed static mid-round atlas on the right that rotates deterministically per visit. Every existing match, lobby, prediction and spectator route stays unchanged.

## Users
- Visitors opening the viewer root URL with a match link, spectator link or match code.
- Hosts starting a new match from the viewer.
- Developers opening the debug scene (`?seed=...`) or test client in development builds.

## User stories
- US-1. As a visitor, I want to paste a match link, match code or spectator link on the landing page so that I enter the exact viewer flow without extra steps.
- US-2. As a first-time visitor, I want to immediately see FactionFall's brand identity, one-line Spanish pitch and an atmospheric map visual so that I understand what the game is.
- US-3. As a returning visitor, I want the background atlas to rotate deterministically across mid-round map plates on each visit so that the landing feels varied while staying static and spoiler-free.

## Definitions
- **Atlas plate**: a static pre-rendered mid-round image of a predefined map, identified by a catalog entry (`id`, `mapId`, `round`, asset path).
- **Root route**: the viewer entry URL (`/`) with neither a `match` nor a `seed` query parameter.

## Functional requirements
- FR-610: WHEN a visitor opens the root address (`/` with no `match` and no `seed` parameter), THE SYSTEM SHALL show the start menu landing in both development and production builds; `?seed=...` SHALL keep opening the debug scene in development builds (and the need-match message in production), and `?match=...` (with or without `&spectate=1`) SHALL keep routing identically to the existing viewer flows.
- FR-611: THE SYSTEM SHALL render an anchored left console with: (a) Logo 1 (a flat polygonal map divided into muted regions topped by a golden crown) as a crisp, scalable inline SVG; (b) the `FactionFall` title and `MAP BATTLE ROYALE` subtitle; (c) a one-line Spanish pitch; and (d) Spanish-only copy with no unimplemented language switcher.
- FR-612: WHEN a visitor enters a 16-character match code, a match URL or a spectator URL (`spectate=1`) in the landing input ("Pega tu enlace de partida o espectador…") and submits, THE SYSTEM SHALL route to the existing match or spectator flow (preserving `spectate=1` and dropping unrelated query parameters); IF the text is empty or invalid, THEN THE SYSTEM SHALL stop submission before any network request and show a Spanish error message.
- FR-613: THE SYSTEM SHALL keep match creation ("Crear nueva partida", backed by the existing public config form) reachable from the landing console, and in development builds only SHALL keep links to the debug scene (`?seed=1`) and the web test client (`/client.html`).
- FR-614: THE SYSTEM SHALL display a full-bleed static mid-round atlas render on the right side (blending into the dark backdrop behind the left console) together with a subtle caption naming the map and round shown; plates are keyed by `mapId` (using the `dev` map today so Spain and World maps plug into the catalog when they merge) and never connect to a live match.
- FR-615: WHEN a visitor opens the landing screen, THE SYSTEM SHALL pick the static atlas plate deterministically from the catalog (interleaved across distinct `mapId`s so consecutive visits cycle through different maps and rounds without repeating) via a pure function using no `Math.random()`, advancing a stored visit counter per visit and falling back cleanly to index 0 when storage is unavailable.
- FR-616: THE SYSTEM SHALL adapt the landing to desktop (`>= 1024 px`) and phone (`< 1024 px`) layouts via `data-layout` (no width media queries), keeping phone touch targets at least 44 px and avoiding horizontal overflow or clipped controls.

## Non-functional requirements
- NFR-140: Every user-visible string lives in the viewer strings module in Spanish, placed in a separate spec 030 block; all other viewer source files stay ASCII-only with no text literals in DOM sinks.
- NFR-141: The landing stylesheet uses only the viewer's `--hud-*` dark/gilt colour tokens (contrast >= 4.5:1 for normal text, >= 3:1 for large text and outlines), self-hosted fonts (`Cormorant SC`, `Spectral`), visible keyboard focus outlines, and respects `prefers-reduced-motion: reduce`.
- NFR-142: Link parsing and atlas rotation are pure deterministic functions tested in Node; the production build stays free of the simulator, debug markers, dev map JSON/PNG assets and credentials; existing match/spectator routes and HUD panels remain untouched.

## Edge cases
- Leading/trailing whitespace or URL fragments on pasted match or spectator links: trimmed and handled cleanly; invalid `spectate` values (`spectate=0`, `spectate=true`, repeated `spectate`) do not enable spectator mode.
- Pasted link containing both `seed` and `match`: refused before navigation.
- Browser storage unavailable or throwing (private browsing / sandbox): visit counter falls back to 0 without throwing.
- Catalog with a single `mapId` today vs multiple `mapId`s later: single-map catalog cycles through all plates of that map; multi-map catalog interleaves maps deterministically.
- Very narrow phone viewport (360–390 px wide): atlas stacks cleanly above/behind the console with readable contrast and 44 px+ interactive controls.

## Out of scope
- Live match streaming or live simulation on the landing page.
- Language switching / i18n.
- Changes to `packages/*`, `apps/server`, `apps/bot`, `tools/*`, `maps/*`, or the match HUD panels/camera (owned by spec 031).
- New runtime or build dependencies.

## Done criteria
1. Unit tests written first covering pasted link/spectator routing, deterministic atlas rotation (single-map and multi-map interleaving, storage fallback), landing strings, and stylesheet/shell scans; `npm test` and `npm run typecheck` green.
2. Desktop (1280 x 720) and mobile (390 x 844) before/after screenshots captured under `.claude/review/030-start-menu/`, posted in the thread with a before/after slider widget per viewport.
3. Diff restricted to `apps/web` and `specs/030-start-menu/`; PR opened into `main`.
