### M2 — Pure decisions (2 / 2)
Plan section 5. Depends on M1.

- [x] **T2.1. `submissionName`.** FR-531, FR-532, NFR-116
  - Files: `apps/server/src/core/client-name.ts` (new), test `apps/server/test/core-client-name.test.ts`.
  - Done when (red first): table test over caller (client with a namespace, player) x name (absent, present): absent gives `none` for both; a client with a name gives `store` with that name; a player with a name gives `refuse` with `invalid-request` naming `name` (plan PD1); no other output; the function takes parameters only (the existing `core-purity.test.ts` glob covers the file and stays green); mutation proof: the player branch removed fails a test.
- [x] **T2.2. `withClientNames`.** FR-533, NFR-116
  - Files: same module, same test file.
  - Done when: it returns a new map (the inputs are not changed), player names first and client names only for ids not already present; empty inputs give an empty map; an id in both keeps the player name; mutation proof: swapping the precedence fails a test.
