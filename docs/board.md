# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 025: per-Discord-server ranking (M1 engine; M2 service + route + proofs; M3 bot + e2e) | Full SDD | claude-sonnet-5-5 implements, claude-opus-5-5 reviews | feat-025-server-ranking | `feat/025-server-ranking` | all milestones implemented and reviewed; user hand run accepted (history + ranking) | closing PR (status implemented, archive, MEMORY, e2e nit) |
| History embed presentation pass: top on one line with medals, viewer link merged into the asker's line, winner bold, ordinal computed from the snapshot total | small | opencode-go/glm-5.3 implements, claude-sonnet-5-5 reviews | — | — | queued (mockup approved by the user on 2026-11-20) | after 024 and 025 land on `main` |
