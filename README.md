# MBRG — Map Battle Royale Game

A **Battle Royale for EU4 / RISK-style maps**: every round one faction is
wiped out at random, and a neighbour swallows **all** of its provinces, until
only one is left standing.

The point isn't to play — it's to **spectate and predict**. The whole match is
computed from a seed, so everyone with the link already knows how it ends…
which is exactly why this release is a viewer and not a betting game (yet).

![A match in progress](docs/captura-ronda2.png)

## Status: `v0.1.0-alpha`

First playable release, and a first release on principle:

- ✅ One map (hand-made, embedded in the source)
- ✅ Deterministic simulation of the "Clásico" mode
- ✅ Round-by-round playback with animation, event log and live stats
- ✅ Shareable seed via the URL
- ✅ Spanish and English interface
- ❌ **No server** (no history, rankings or round schedule)
- ❌ **No predictions or bets** (coming in Phase 3)
- ❌ **No Discord** (Phase 4)
- ❌ **No custom maps** (the image importer is Phase 2)

### One important warning

The seed lives in the URL and the match is computed **in your browser**. That
means anyone with the link can read the seed and work out the coming rounds —
i.e. **spoilers**. For a viewer that's harmless, but it **breaks betting
completely**: which is why this version ships no betting at all, and why
Phase 3 (precompute on the server, reveal one round at a time) is precisely
what fixes it.

## How to play

1. Open the [live demo](https://agarcial16.github.io/MBRG/).
2. Press **▶**. Each round a faction falls and a neighbour takes it whole.
3. Change the **seed** and hit *Apply* to generate a different match.
4. Share the URL: it carries the seed, so whoever opens it sees **exactly your
   match**.

![The match at the start](docs/captura-inicio.png)

Controls: mouse wheel or pinch to zoom, drag to pan, double-click to zoom in,
and the minimap in the corner to jump around.

The interface speaks Spanish and English — pick one in the sidebar, or force it
with `?lang=en` / `?lang=es` in the link. The choice is remembered.

## Running it locally

```bash
npm install       # install dependencies and link the workspace packages
npm run dev       # dev server → http://localhost:5173
npm run build     # compile the packages (tsc -b) and the web app (vite build)
npm test          # tests (vitest run, no build needed first)
npm run test:watch
npm run typecheck
```

## Structure

A TypeScript monorepo using npm workspaces. The same deterministic simulation
runs in the tests, the server, the bot and the browser — only the render layer
is meant to be swappable (e.g. for Three.js later on).

| Path | What's in it |
| --- | --- |
| `packages/shared` | Map format (`MapFormatV1`), validation, adjacency, match types |
| `packages/sim` | The engine: `step()` (one round), `simulate()` (whole match), seeded PRNG |
| `apps/web` | The viewer: canvas renderer, playback, camera, minimap, log, stats, i18n |

## "Clásico" rules

Each round:

1. A living faction is picked **at random**.
2. Its candidate neighbours are those sharing a border with **any** of its
   provinces.
3. One of them takes **all** of its provinces.
4. Repeat until a single faction remains.

## Roadmap

| Version | What it brings |
| --- | --- |
| `v0.1.0-alpha` | The above: one map, no server |
| `v0.2.0` | **Map importer**: upload an image, turn it into a playable map |
| `v0.3.0` | **Server + predictions**: place bets, score points, keep rankings |
| `v0.4.0` | **Discord bot**: play from the chat, per-server leaderboards |
| `v1.0` | Multiple game modes, map editor, 3D |

## License

[MIT](LICENSE) © 2026 Ángel García
