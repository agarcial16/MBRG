# Lessons: Discord bot (`apps/bot`)
- A test waiting for an exact post count (`=== N`) is racy: wait for the full deterministic count.
- The countdown comes from the server's schedule anchors (c1/c2 and reportedTime), never from the pace (a forced phase breaks it).
- Discord edits at ~1 per second per message are at the rate-limit edge: one edit in flight, skip a tick.
- The Discord token is typed by the user in their own terminal, never in chat.
- Never drive real Discord from automation (ToS; bots cannot press buttons or run slash commands). Test automation = one start command + a fake Discord at handler level.
- Client-only matches: the bot creates them; the viewer closes their join door (spec 020); the lobby message carries a viewer link (spec 021).
- The e2e harness (spec 023, `test/e2e/`): the plan's outcomes are PINNED (a golden), not recomputed — a change to the dev map, `@mbrg/sim` or the seeds fails the test on purpose and the fixture is re-pinned. `boot()` takes any `{ url }`: the fake server or the real in-process one.
