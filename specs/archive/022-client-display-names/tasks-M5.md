### M5 — Twin, secrecy, ledger, compatibility (4 / 4)
Plan section 7. Depends on M4. Secrecy and determinism: planner and reviewer on Opus. Rebase on `main` before T5.3 (spec 021 may extend the ledger).

- [x] **T5.1. Twin test.** NFR-114
  - Files: `apps/server/test/service-client-name-twins.test.ts` (new).
  - Done when: two runs with the same fake random source and the same predictions, one without names and one with (a client-only match), give the same draws (lengths, bytes, order), match id, commitment, records, steps, events, states, results and secret; every read is equal except the `name` member of scored rows; a third run of an open match is unchanged; the no-name run equals the pinned bytes of the 018 twin where that test pins them.
- [x] **T5.2. Secrecy scan.** NFR-112, NFR-113, FR-534, FR-535
  - Files: `apps/server/test/client-name-secrecy.test.ts` (new).
  - Done when: on a real-listener run with a planted name no other text contains: before scoring no reply, event, stream frame, log line or error body (including the probe of `player-results` for the planted id and a refused submission) contains it or the fact that the member predicted; the probe is byte-identical to the probe of an id that never predicted; after scoring only leaderboard, phase results, phase winners and own-player reads contain it; no log line of the whole run contains it; a source scan shows `clientNames(` called only from those service functions and `client_names` only in the statements of T3.5; the purge of the match removes every trace (read of a closed file database).
- [x] **T5.3. Ledger.** all ids
  - Files: `packages/sim/test/traceability.test.ts`.
  - Done when: FR-530..539 and NFR-112..116 are added to the id ranges and the independent `all` list, the literal range and count pins are recomputed from the file as it is after the rebase (not copied from this task), `PENDING_022` is the ids closed by the later milestones and `DONE_022` the rest with its pin test; every id named in a test title exists; the file's change is listed in PROGRESS. FR-537 and FR-538 close in M6 and M7 (the ledger entries move then).
- [x] **T5.4. Compatibility and docs.** NFR-114
  - Files: `apps/server/test/client-name-compat.test.ts` (new).
  - Done when: the 008, 011, 014 and 018 goldens keep their SHA-256, every pinned sim/shared/map/tour file is byte-identical (the pin of `protected-files`), the route table is the same 19 routes, `GET /config` bytes are unchanged and name nothing of the feature; a body without `name`, an open match and a client-only match without names behave as before (cross-checked with the existing 018 tests, all green unmodified); the spec and plan are the description of `name` and `client_names` (the repository has no other protocol document); `git diff --exit-code main -- <protected paths>` is clean.
