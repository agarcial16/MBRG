# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Predefined map: Spain by its 52 provinces | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-spain-provinces` | merged (#89) | done |
| Predefined map: the world by countries | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-world-countries` | merged (#89-era; now Robinson via spec 036, #103) | done |
| Spec 028: map importer (vector route) | Full SDD | strong review + medium impl | — | `feat/028-map-importer` | merged (#94) | done (archived in `specs/archive/028-map-importer`) |
| Spec 035: ocean tiles (generic sea splitting in the importer) | Light SDD | strong review + medium impl | — | `feat/035-ocean-tiles` | merged (#101) | done (archived); V4 (viewer: sea-zone border weight, sea-name labels) only if hand runs show the need |
| Spec 033: many factions in the viewer (V2) | Light SDD | antigravity/gemini-4-neon | — | `feat/033-many-factions` | merged (#97); FR-646 importer `viewerLimits` merged (#104) | done (archived in `specs/archive/033-many-factions`) |
| V3, viewer: huge maps on weak devices (future option) | Full SDD | — | — | — | queued (future option from spec 028) | texture tiling of the id image and per-entry tables, or rendering territories as polygon meshes, so a map larger than a device's texture size can still be drawn |
| Spec 034: windowed round timeline and jump-to-round | Light SDD | — | — | `feat/034-round-timeline` | merged (#100) | done (archived in `specs/archive/034-round-timeline`) |
| Spec 032: readable map labels | Light SDD | — | — | `feat/032-readable-labels` | merged (#96) | done (archived in `specs/archive/032-readable-labels`) |
| Spec 036: Robinson projection for world-countries | Light SDD | claude-sonnet-5-5 | this thread | `feat/036-robinson-projection` | merged (#103) | done (archived in `specs/archive/036-robinson-projection`) |
| Landing page and map selection (map preview thumbnails, animation polish) | — | — | — | — | idea | no spec yet; needs a Light SDD spec when picked up |
| Spec 038: map images in Discord (round image by edit + ephemeral `/ff mapa`) | Light SDD | claude-sonnet-5-5 | own thread | `feat/038-round-images-impl` | merged (#108) | done (archived in `specs/archive/038-discord-round-images`); NFR-188/189 relaxed by the user to 1 GB / 15 s |
| Spec 040: faster map capture (label layout limited to the capture camera) | Light SDD | claude-sonnet-5-5 | own thread | `feat/040-capture-perf` | PR open | review + merge; round image ~2.5 s in page (was ~6 s), full map unchanged-ish (raster-bound); a persistent layout cache is the option left for the full map |
| In-page map importer: import a map from the web UI, on top of the spec 028 importer | — | — | — | — | idea | no spec yet; needs a spec (viewer upload + server validation) when picked up |
| Re-register Discord slash commands on deploy (`/ff` replaces `/mbrg`) | — | — | — | — | idea | no spec yet; check for a deploy hook before writing one |
| Spec 037: province-style faction labels at close zoom | Light SDD | antigravity/gemini-4-neon | own thread | `feat/037-faction-labels-zoom` | merged (#107) | done (archived in `specs/archive/037-faction-labels-zoom`) |
| unslop-ui skill + web/bot UI copy pass | Small | antigravity/gemini-4-neon | own thread | `chore/unslop-ui-skill` | merged (#106) | done; use the skill as a final pass on new UI |
