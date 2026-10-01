# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/), with an `-alpha` suffix while
the API and the scope may still change.

## [0.1.0-alpha] — 2026-10-01

First playable release. A match viewer: press play and watch factions get
wiped out and annexed, round by round.

### Added

- **Deterministic simulation** of the "Clásico" mode (`packages/sim`): each
  round a random faction falls and a neighbour takes all its provinces, until
  one remains. Seeded PRNG (mulberry32), no I/O.
- **Web viewer** (`apps/web`): round-by-round playback with play/pause and speed
  control, absorption animation, event log, live stats, and a shareable seed in
  the URL (`?seed=…`).
- **Rendering**: one continuous block per faction (internal borders hidden),
  EU4-style labels named after each territory, a camera with drag/zoom/minimap,
  and labels that stay legible at any zoom.
- **Labels**: anchored at the pole of inaccessibility, oriented along the real
  corridor, **straight by default** with a **crescent** (a single circular arc)
  only when the straight line doesn't fit, and a guaranteed reading direction.
- **Two languages** (Spanish and English) with a sidebar switcher, a `?lang=`
  override for shared links, and the choice remembered between visits.
- **40 tests** with vitest (engine, map format, label geometry, language
  resolution).

### Known limitations

- **One map only**: the hand-made map is embedded in the source. The image
  importer (Phase 2) doesn't exist yet, so you can't upload your own.
- **No server**: the whole match is computed in the browser from the URL seed,
  so anyone with the link can work out the coming rounds. Harmless for a
  viewer, but it **breaks any prediction or bet** — which is why this release
  has none, and why Phase 3 (precompute server-side, reveal round by round)
  exists to fix it.
- **No persistence**: no history, rankings or round schedule.
- **No Discord**: the bot is Phase 4.

[0.1.0-alpha]: https://github.com/agarcial16/MBRG/releases/tag/v0.1.0-alpha
