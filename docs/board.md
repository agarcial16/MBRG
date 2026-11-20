# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 027: ranking by time window (last 7 / 30 days) over the community matches | Full SDD | claude-sonnet-5-5 implements (M1-M3), claude-opus-5-5 reviews | — | `feat/027-ranking-windows` | M1-M3 implemented and reviewed (approve x3, note A fixed, note doc-line added) | PR open, the user's hand run (semana, mes, all time, two orders each, another server) and acceptance, then status implemented and archive |
