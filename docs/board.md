# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 027: ranking by time window (last 7 / 30 days) over the community matches | Full SDD | claude-sonnet-5-5 implements (M1-M3), claude-opus-5-5 reviews | — | feat/027-ranking-windows | implemented M1-M3, M1/M2 reviewed; M3 pending its review | final review, PR, the user's acceptance (then status implemented and the spec moves to `specs/archive/`) |
