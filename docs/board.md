# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Versioned agent config (AGENTS, MEMORY, agents, sdd skill, lessons, board, archive, OpenCode agents) | small | claude-sonnet-5-5 | chore-agent-config | `chore/agent-config` | merged (#73) | done |
| Before/after widget rule for visual tasks | small | claude-sonnet-5-5 | chore-agent-config | `chore/visual-widget-rule` | PR open | user reviews and merges |
| e2e test automation: real server + bot + fake Discord at handler level, scripted match with text transcript, embeds drawn as an HTML preview with screenshots in the thread | Light SDD | glm-5.3 implements, claude-sonnet-5-5 reviews | feat-023-e2e-harness | `feat/023-e2e-harness` | merged (#75) | done |
| Close spec 023 on the board, worktree lesson | small | deepseek-v4.1-flash | chore-close-023 | `chore/close-023` | PR open | user merges |
