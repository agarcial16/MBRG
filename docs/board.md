# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Spec 024: server history for communities (M1 store the community key; M2 history read; M3 bot and e2e) | Full SDD | claude-sonnet-5-5 implements, claude-opus-5-5 reviews | feat-024-server-history | `feat/024-server-history` | M1 done, Opus review passed; M2 T2.1–T2.4 committed, T2.5 (twins) left; implementer paused on the Claude 5-hour limit | after the limit reset: finish T2.5, Opus review of M2, then M3; one PR at the end of M3 |
| Spec 025: server ranking | Full SDD | claude-opus-5-5 plans (opencode-go/glm-5.3 fallback, Opus review before approval) | — | — | spec approved, no plan yet | plan + tasks after 024 M3 |
