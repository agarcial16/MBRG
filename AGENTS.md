# AGENTS.md
MBRG: spectator "battle royale" for RTS-style maps. Each round a faction is eliminated and a neighbor absorbs its territory. Players predict; they never control.
Read `MEMORY.md` first, then `docs/lessons/<area>.md` (web, bot, server, map) for the area you touch. `docs/constitution.md` always applies.

## Stack & layout
- TypeScript, Vite, Three.js (WebGL), Vitest, npm workspaces.
- `packages/shared`: types, map format, validation. `packages/sim`: pure rules. `packages/protocol`: wire types.
- `apps/web`: viewer. `apps/server`: matches, predictions, store. `apps/bot`: Discord bot. `tools/build-map`: offline map build (GeoJSON/PNG -> `map.json` + `ids.png`).
- Working path contains spaces: quote it in shell commands.

## Commands
- `npm install` · `npm run dev` · `npm run build`
- `npm run typecheck` · `npm test`

## Conventions
- Code, comments and docs in English. UI strings live in one module (Spanish for now).
- `shared`/`sim`: pure, deterministic, no DOM, no I/O, no `Math.random()`/`Date.now()`.
- State is plain JSON; ownership is stored per territory, not per faction.
- No linter yet; do not add one without a task.

## Workflow (SDD, three tiers by risk)
Flow, templates, plan/tasks rules: `.claude/skills/sdd/SKILL.md`.
- **Full SDD**: anything touching `packages/sim`, `packages/shared`, `packages/protocol`, `apps/server` or the secrecy of future rounds. Spec -> approval -> plan + tasks -> approval -> `feat/...` branch -> PR -> squash merge.
- **Light SDD** (UI, visual design, animation, the Discord bot, tools): one-page spec -> approval -> one `feat/...` branch -> one implementer, one reviewer at the end -> PR -> squash merge.
- **Small changes** (fixes, copy, config, docs, a single-file tweak): no spec; one session implements with tests, the user reviews the PR.
- Commits: English, conventional prefix, one line (<=72 chars), body only if the why is not obvious. CI (typecheck + test) must pass before merging.
- The feature PR itself sets `Status: implemented` in the spec and updates `MEMORY.md` and `docs/board.md`: no separate docs PR. Implemented specs are moved to `specs/archive/`.

## Models (tiers)
Rules name a tier, never a model. One table maps tiers to models.
| Tier | Use | Primary | Fallbacks in order |
|---|---|---|---|
| `strong` | Full-SDD coordination; planner/reviewer touching secrecy, determinism, persistence, milestone sign-off | `claude-opus-5-5` | `antigravity/gemini-4-neon` (thought `medium`; `high` only for high-risk plans/reviews) → `opencode-go/glm-5.3` (orchestrate & review only, never implement; Opus/Neon review before merge) |
| `medium-core` | Implementer on core/protected paths (`packages/sim`, `shared`, `protocol`, secrecy in `apps/server`) | `claude-sonnet-5-5` | `antigravity/gemini-4-neon` (`medium`); DeepSeek barred here, GLM emergency only |
| `medium-general` | Implementer outside core (`tools/`, `apps/bot`, non-secret `apps/server`, Light SDD, docs/tests) | `claude-sonnet-5-5` | `opencode-go/deepseek-v4.1-flash` (reviewed by `strong`) → `antigravity/gemini-4-argon` (`medium`) |
| `medium-ui` | UI, visual design, CSS/WebGL (`apps/web`) | `antigravity/gemini-4-neon` (`medium`; `gemini-4-argon` for scoped tweaks) | `claude-sonnet-5-5` → `opencode-go/deepseek-v4.1-flash` (scoped tweaks) |
| `mechanical` | Status marks, renames, copy, file moves, run tests and summarize, code search | `claude-haiku-5-5` | `antigravity/gemini-4-hydrogen` (`low`) → `opencode-go/deepseek-v4.1-flash` |
| `image` | Visual exploration and art mockups | `antigravity` (Gemini image generation) | HTML + headless Chrome, for pixel-faithful Discord mocks |
- Default Antigravity `thought_level` is `medium` (`low` for `mechanical`; reserve `high` for high-risk `strong` plans/reviews). Prefer Gemini models on Antigravity (its Claude models drain quota quickly); its quota is separate from Claude and OpenCode.
- GLM-5.3 is reserved for orchestration and reviews — never long implementation milestones (it burns OpenCode Go weekly quota too fast).
- DeepSeek V4.1 Flash is the default OpenCode Go implementer outside core paths (always reviewed by `strong`); it never reviews and never touches `sim`, `shared`, `protocol` or secrecy paths.
- Antigravity delegate harness rule: never end a turn while a background shell command is running (ending the turn ends the delegated run); use `WaitMsBeforeAsync: 10000`, keep the turn alive via `manage_task` until done, and commit+push each finished chunk.
- Optional cross-family second reviewer (e.g. GLM or Gemini 4 Neon reviewing Sonnet work).
- OpenCode agents for the fallback: `.opencode/agents/`.

## Orchestration
- One long-lived orchestrator chat (T3) classifies each request, writes a brief (<= ~20 lines: goal, file paths + line ranges, branch, done criteria) and launches one child task per task with T3 `delegate_task` (`isolation: worktree`), so the orchestrator is notified when it finishes; the child still has its own thread the user can open and type in. It reads no code; state lives in `docs/board.md`.
- Approvals are typed in the child thread, or quoted literally in the brief; an approval typed in the orchestrator chat is not valid for a child. When a child stops for approval, the orchestrator relays it to the user and passes the user's answer to the child quoted literally.
- Child final report <= 300 words: PR URL, head SHA, test results, decisions for the user. Detail goes to `PROGRESS.md`.
- Handover rule: the last `PROGRESS.md` entry always states branch, state and next step, so another model can resume from it alone.

## Cost discipline
- One session per spec or milestone; a new session starts from a short handover (state, branch, next step), not from a long history.
- Mutation proofs: only the affected tests per mutant; the full suite once at the end. Reviewers do not rerun the full suite when the implementer's report and CI show it green; they rerun only what they doubt and the protected-path checks.
- Do not re-read what is already known: pass file paths and line ranges in briefs.

## Testing & verification
- Run `npm test` and `npm run typecheck` before every commit.
- Visual tasks are not done without reviewed screenshots of the debug scene (fixed seed + round).
- Future rounds must never reach the client.
- Visual checks (viewer, embed previews, mobile view): save a small set of screenshots (desktop + mobile of the affected area) under `.claude/review/<task>/` (gitignored) and post them in your own thread chat as Markdown images with the absolute path, one short caption each: `![caption](C:/abs/path.png)`. Posting a path costs no tokens: do not Read images back unless you need to check them yourself. VISUAL tasks only: also post in your chat a before/after widget (T3 `html_preview` then `html_render`, inline HTML, theme CSS variables): a draggable slider over the before and after screenshots of the same view, one per viewport (desktop, mobile). Non-visual tasks make no widget.

## Boundaries
- ✅ Always: follow the approved spec; after each task append to `specs/<id>/PROGRESS.md` (what changed, tests run and results, what is untested, next step); keep tests green.
- ⚠️ Ask first: new dependency; changes to the map format or `MatchState`; deleting files outside the task.
- 🚫 Never: commit secrets; Full- or Light-SDD code without an approved spec; push directly to `main`; skip hooks.
- 🚫 Never link or junction `node_modules` (or any workspace folder) into another directory, and never `git worktree remove --force` one that has such links: git follows them and deletes the real files. A worktree gets its own `npm install`.

## Memory
- `MEMORY.md` (~4 KB max): current state (3 lines), decisions with why, limits, general lessons. Area lessons go to `docs/lessons/<area>.md`; per-spec detail to `PROGRESS.md`; live tasks to `docs/board.md`.
- Update it in the feature PR. Summarize or delete what no longer adds value. Never store secrets or personal data.
