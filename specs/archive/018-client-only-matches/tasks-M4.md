### M4 — Twin, secrecy, ledger, compatibility (4 / 4)
Depends on M3. Tests and documentation only, except fixes they force.

- [x] **T4.1. Twin test.** NFR-101
  - Files: `apps/server/test/service-client-twins.test.ts`.
  - Done when: two creations with the same fake random source, one open and one client-only, give the same match id, commitment, host token, records, states, events and step results through a full scripted run, and views differing only by `clientOnly`; the draw order (secret, match id, host token) is pinned.
- [x] **T4.2. Secrecy and log scan.** NFR-100, FR-501
  - Files: `apps/server/test/client-only-secrecy.test.ts`.
  - Done when: a full client-only run (create, refused join, refused submit, owner submit, finish) and its open twin with the same submissions give byte-identical reads, event stream and log lines except the `clientOnly` member (so nothing about the owning namespace is published beyond the public player ids 008 already shows), and a scan of every read, event, error reply and log line finds no credential text and no host token; the existing 008/011 secrecy and absorber-uniformity tests pass unchanged; no future round, absorber, pending state or seed becomes readable.
- [x] **T4.3. Ledger.** FR-490..506, NFR-100..104
  - Files: `packages/sim/test/traceability.test.ts` and test titles naming each id.
  - Done when: the ledger lists the new ids as required and each appears in a test title (FR-504 is the contract for the later web spec: listed as not testable here, with its reason); the ledger test is green.
- [x] **T4.4. Compatibility pass and documentation.** NFR-102, FR-502
  - Files: `specs/archive/018-client-only-matches/PROGRESS.md`, the protocol docs where `POST /matches`, the error list and the match view are described (found by grep at the start of the task), `CHANGELOG.md`.
  - Done when: every 008/011/014 golden is byte-identical (`git diff --exit-code main` over the golden folders), the list of changed tests in PROGRESS is complete and justified, `npm test`, `npm run typecheck` and `CI=1 npm test` are green, the docs describe `joinPolicy`, `clientOnly` and `joins-closed`.
