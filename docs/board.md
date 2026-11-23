# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 028: the map importer (image in, playable map out) | Full SDD | claude-opus-5-5 drafts the spec, the user approves | — | — | queued (the roadmap's next big feature) | spec draft for the user's approval |
| Predefined map: Spain by its 52 provinces | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-spain-provinces` | merged (#89) | done |
| Predefined map: the world by countries | content (no spec) | opencode-go/glm-5.3 implements | this thread | `feat/map-world-countries` | in review | PR into `main`; user reviews the preview image and the PR |
| Spec 033: many factions in the viewer (V2) | Light SDD | antigravity/gemini-4-neon | PR #97 | `feat/033-many-factions` | review-ready (`apps/web` done; FR-646 waits for PR #94) | reviewer pass before merge |
