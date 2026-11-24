# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Predefined map: Spain by its 52 provinces | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-spain-provinces` | merged (#89) | done |
| Predefined map: the world by countries | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-world-countries` | in review | PR into `main`; user reviews the preview image and the PR |
| Spec 028: map importer (vector route) | Full SDD | strong review + medium impl | — | `feat/028-map-importer` | merged (#94) | done (archived in `specs/archive/028-map-importer`) |
| V1, viewer: graceful refusal of a map it cannot draw | Light SDD | — | — | — | done: counts by spec 029, texture size and palette already had messages | none; close the row |
| Spec 033: many factions in the viewer (V2) | Light SDD | antigravity/gemini-4-neon | — | `feat/033-many-factions` | merged (#97) | done; FR-646 (importer viewerLimits 255 -> 65,535) follow-up now that #94 is in main |
| V3, viewer: huge maps on weak devices (future option) | Full SDD | — | — | — | queued (future option from spec 028) | texture tiling of the id image and per-entry tables, or rendering territories as polygon meshes, so a map larger than a device's texture size can still be drawn |
| Spec 034: windowed round timeline and jump-to-round | Light SDD | — | — | `feat/034-round-timeline` | merged (#100) | done (archived in `specs/archive/034-round-timeline`) |
| Spec 032: readable map labels | Light SDD | — | — | `feat/032-readable-labels` | merged (#96) | done (archived in `specs/archive/032-readable-labels`) |
