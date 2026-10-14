# MBRG Constitution

1. **Minimal stack.** TypeScript + Vite + Three.js (WebGL). Every new dependency needs a written justification and user approval.
2. **The spec rules.** No code without an approved spec in `specs/`. If code and spec diverge, fix one of them in the same commit.
3. **Logic apart from interface.** `shared` and `sim` are pure and deterministic: seeded RNG, no I/O, no DOM, no `Math.random()` or `Date.now()`. The UI only consumes their state.
4. **Tests with what exists.** Every `sim` rule has a test using the existing runner (Vitest); no extra test or mocking libraries are installed. `npm test` is green before every commit.
5. **User data protected.** Tokens, Discord ids and predictions are never committed or logged. Secrets live in environment variables. A future round never reaches the client.
6. **Language.** Code, comments, docs and commits in English. The UI is in Spanish, with strings isolated in a single module so other languages can be added later.
