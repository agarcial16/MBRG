# AGENTS.md

## Status (2026-09-30)
- **Phase 0 DONE**: TypeScript monorepo scaffolded; `packages/shared` + `packages/sim` implemented, building and fully tested (30 tests).
- **Git**: configured (`user.name: agarc`, `user.email: angel.garcia29@alu.uclm.es`); root commit `812b82d` = Phase 0.
- Working path contains spaces (`MBRG - Map Battle Royale Game`) — quote paths in shell commands.
- The design plan lived only in a prior conversation; the sections below are its agreed decisions and the source of truth for them.

## Commands (verified 2026-09-30)
- `npm install` — installs deps and links workspace packages. The `apps/*` glob matches nothing yet; that is expected until Phase 3.
- `npm run build` — `tsc -b` (TypeScript project references, emits `packages/*/dist`). Build before consuming a package's `dist` output.
- `npm test` — `vitest run`. Tests live in `packages/*/test/**/*.test.ts`; they import `@mbrg/shared` through a vitest alias to its **source**, so no build is needed before testing.
- `npm run test:watch`, `npm run clean` (`tsc -b --clean`).
- No linter/formatter yet — do not invent one; add it as an explicit task later.

## Where things live
- Rules = `packages/sim/src/engine.ts`: `step(map, state)` = one round of Clásico (pure, returns a new state), `simulate()` = full match, `forkMatch()` = influence fork, `createInitialMatch()` = round 0.
- PRNG = `packages/sim/src/rng.ts` (mulberry32; `snapshot()` persists/resumes the state).
- Map format + validation + adjacency = `packages/shared/src/{map,validate,adjacency}.ts`; match/state types = `packages/shared/src/match.ts`.
- Test fixtures = `packages/sim/test/fixtures/maps.ts` (the A–E sample from the design docs, an island map, a chain map for weighting tests).
- `MatchState` is plain JSON on purpose (server will persist/transport it); maps are treated as **immutable during a match** (the engine caches graph data in a `WeakMap`).

## Game (context)
"Battle Royale" for RTS-style maps (EU4 / RISK style): each round a faction is randomly eliminated and a neighbor absorbs its provinces, until 1 faction remains. Players are spectators who predict/bet (eventual Discord integration) with almost no direct control.

## Agreed decisions (do not relitigate)
- **Stack**: TypeScript monorepo — chosen so the same deterministic sim runs in tests, server, bot and browser. Requirement: eventual 2D → 3D map rendering (Three.js: swap the render layer, never rewrite the sim).
- **Planned layout** (NOT created yet): `packages/sim`, `packages/map-tools`, `packages/shared`, `apps/server`, `apps/bot`, `apps/web`.
- **MVP map**: the user's own handmade 4–5 province map — ask them for the image. Big / real-world maps come later via the Phase 2 importer.
- **Pacing**: each match is precomputed from a seed and revealed round-by-round (not fast real-time).
- **Discord**: user has zero bot experience — Phase 4 must include from-scratch setup guidance (app creation, token, invite, hosting).
- **First mode**: "Clásico". Other modes (Reparto, Provincia-a-provincia, Fog of War, drama slider) land in Phase 5.

## Mode "Clásico" rules (MVP)
Each round:
1. Pick a random alive faction (uniform default; province-count-weighted picking is an optional "drama" setting).
2. Neighbor factions = union of adjacency over ALL of the dying faction's provinces (excluding itself).
3. The random chosen neighbor receives ALL provinces of the eliminated faction.
4. Repeat until 1 faction remains.

Handle from day one: islands (maritime link or immunity rule), non-contiguous factions.

## Hard invariants
- `sim` must be pure and deterministic: seeded RNG only (never `Math.random()` or `Date.now()`), no I/O. This is what enables shareable replays, full match precomputation, and "influence" actions (a fork = re-seed from current state).
- The server only sends state up to round N; future rounds must NEVER reach the client (spectators would cheat on predictions by inspecting network traffic).
- Map import: colors are detection-only and get discarded. The JSON stores territories + polygons + adjacency; the engine assigns display colors per match. Uploaders never choose aesthetic colors.
- Import modes: (A) one unique flat color per region — robust, recommended; (B) closed borders on white (coloring-book style) — works on most maps found online; known failure mode is gaps in borders leaking the fill → the validation screen must flag suspicious borders.

## Phases
0 ✅ done — monorepo + `sim` with tests + MapFormat v1 →
1 playable MVP (absorption animation, speed controls, event log, seed sharing) →
2 image importer + validation screen →
3 server + prediction/points system (macro: winner; micro: who dies / who annexes) →
4 Discord bot + bets + leaderboards + influences →
5 game modes (Reparto, Provincia-a-provincia, drama slider, events, Fog of War) →
6 Three.js 3D rendering →
7 in-browser map editor (Warzone-style).

## Language
- The user communicates in Spanish → respond in Spanish.
