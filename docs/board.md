# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 028: map importer (vector route) | Full SDD | strong review + medium impl | — | `feat/028-map-importer` | M1–M3 implemented, all 36 ids closed, automated checks green | final strong-tier review, then PR and user hand runs 1 & 2 |
| V1, viewer: graceful refusal of a map it cannot draw | Light SDD | — | — | — | queued (follow-up from spec 028) | make every viewer limit (> 65,535 entries, > 255 factions, texture size above device max, failed colour assignment) a Spanish message naming what the map needs and what the device or viewer offers, drawing nothing, before any operator lists a package with a viewer-limit warning |
| V2, viewer: many factions | Light SDD | — | — | — | queued (follow-up from spec 028) | wider owner table and deterministic procedural palette from map and presentation data only so up to 9,999 factions get distinct colours where they touch, plus faction names, labels, legend and leaderboard at thousands of factions |
| V3, viewer: huge maps on weak devices (future option) | Full SDD | — | — | — | queued (future option from spec 028) | texture tiling of the id image and per-entry tables, or rendering territories as polygon meshes, so a map larger than a device's texture size can still be drawn |
