# Board
Live work, one row per task; the orchestrator updates it, the feature PR closes its row. Detail lives in each spec's `PROGRESS.md`.

| task | tier | model | thread | branch | state | next step |
|---|---|---|---|---|---|---|
| Versioned agent config (AGENTS, MEMORY, agents, sdd skill, lessons, board, archive, OpenCode agents) | small | claude-sonnet-5-5 | chore-agent-config | `chore/agent-config` | merged (#73) | done |
| Before/after widget rule for visual tasks | small | claude-sonnet-5-5 | chore-agent-config | `chore/visual-widget-rule` | PR open | user reviews and merges |
| e2e test automation: real server + bot + fake Discord at handler level, scripted match with text transcript, embeds drawn as an HTML preview with screenshots in the thread | Light SDD | glm-5.3 implements, claude-sonnet-5-5 reviews | - | - | queued (PR #73 merged) | TEMPORARY: final report includes token usage per run (implementer, reviewer) to compare with a pre-#73 spec; remove this note after the comparison |
