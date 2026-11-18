### M5 — Bot opt-in (2 / 2)
Depends on M3 (the server must accept the member). Touches only the create call of `apps/bot` (spec 017 changes embeds there in parallel): rebase on `main` before starting and keep the diff small.

- [x] **T5.1. Create with `joinPolicy: 'client'` and the credential.** FR-505
  - Files: `apps/bot/src/io/server-client.ts` (the `create` call only) and a new `apps/bot/test/bot-create-client-only.test.ts`.
  - Done when: `/mbrg create` sends `POST /matches` with the body member `joinPolicy: 'client'` and `Authorization: Bearer <discord credential>` (asserted on the request the fake server receives); no code path changes matches the bot already follows (they stay open); the note in spec 012 NFR-89 (credential only on predictions) is updated to mention the create call (R8); `git diff --stat` shows only the call and tests under `apps/bot`.
- [x] **T5.2. Older server refusal.** FR-505
  - Files: same test file, and the create call's error mapping (the place the create error becomes the bot's message, which may sit outside `server-client.ts`; the diff stays limited to that mapping).
  - Done when: when the server answers the creation with `invalid-request` naming `joinPolicy`, the bot reports its existing "server unavailable" message, sends no second creation and follows no match; a test with a fake older server asserts exactly one request.
