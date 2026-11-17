### M1 — Protocol (3 / 3)
Plan sections 2, 3 and 7. No dependency.

- [x] **T1.1. `name` in the submission body.** FR-530
  - Files: `packages/protocol/src/wire.ts` (`SubmissionBody.name?`, `SUBMISSION_FIELDS` gains `name`), `read.ts` (`readSubmission`), tests `packages/protocol/test/read.test.ts`.
  - Done when (red first): a body with a valid `name` returns it trimmed and NFC (value member present only when sent); a body without it returns exactly the old value (no `name` key); a non-string, empty, 25-code-point, forbidden-character, double-space or over-long (more than 256 units) `name` is `invalid-request` naming `name` and no hint of the rule; `name` is checked after `requestId` and before unknown fields (a body with a bad `requestId` and a bad `name` names `requestId`; a bad `name` and an unknown member names `name`); `invalid-player-id` still comes after every structural problem; the key list pin of `SUBMISSION_FIELDS` is updated and listed in PROGRESS.
- [x] **T1.2. Content digest pins.** FR-530, NFR-114
  - Files: tests `packages/protocol/test/canonical.test.ts` (and the service memo test file if a pin lives there).
  - Done when: `canonicalBody` of a submission without `name` equals the text produced by the code at `main` (a literal pinned in the test, taken from `main` before the change) and its sha256 is the pinned digest; with `name` the text differs and the member is in sorted position; the same body with a different `name` and the same `requestId` has a different digest; `requestId` stays the only member left out.
- [x] **T1.3. Winners may be client players (found in M4).** FR-533
  - Files: `packages/protocol/src/encode.ts` (`encodePhaseWinner`), `decode.ts` (`phaseWinner`), `page.ts` (the `phase-winners` cursor key), tests `decode-result-names.test.ts`, `page.test.ts`.
  - Done when: a winners item with a client player id (`discord:123`) encodes, decodes and pages by its cursor; a malformed id is still refused; a joined player id works as before (every existing 011 winners test green).
