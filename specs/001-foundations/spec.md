# Spec 001 — Foundations
Status: implemented

## Context and goal
MBRG is a spectator "battle royale" on RTS-style maps: each round one faction is eliminated and a neighboring faction absorbs all its territory, until a single faction remains. Players only predict outcomes; they never control factions.

This spec lays the foundations of the rewrite:
1. A **map format** that describes territories, their initial owner and their adjacency, plus a strict **validation** that rejects malformed maps.
2. A **simulation** of mode `classic` (shown to players as "Clásico"), rewritten from scratch, that is fully deterministic from a map and a seed and stores ownership per territory.
3. **Continuous integration** that type-checks and tests every change before it is merged.

Why: every later step (viewer, server, predictions, bot, other modes) depends on one trustworthy, reproducible engine and one well-defined map contract. Determinism makes matches reproducible and allows revealing a match round by round without ever exposing future rounds.

Flagged per AGENTS.md "ask first": this spec **defines** the map format and the match state for the first time. Any later change to either needs explicit approval.

## Users
- **Spectator / predictor** (indirect): needs matches that are fair (uniform randomness), reproducible and impossible to spoil in advance.
- **Developer** of later components (viewer, server, bot, map builder): needs a stable map contract, clear validation errors and a sim that can produce the state at any past round.

## User stories
- US-1. As a developer, I want a map to be validated strictly, with all errors reported at once, so that I can fix a broken map in one pass and never run a match on invalid data.
- US-2. As a developer, I want the same map and seed to always produce the same match so that matches are reproducible and verifiable.
- US-3. As a developer, I want to obtain the state at round N from map + seed + N, for any past round in any order, so that a server can reveal rounds progressively (and rewind) without sending future rounds to the client.
- US-4. As a spectator, I want each round's elimination and absorption to be chosen uniformly at random so that no faction is secretly favoured.
- US-5. As a developer, I want each round to produce a serializable record of what changed so that viewers and bots can show and announce it.
- US-6. As a developer, I want every proposed change to be type-checked and tested automatically so that broken code cannot be merged.

## Definitions
- **Territory**: indivisible map unit, identified by a unique territory id. Has a list of neighbor territory ids.
- **Faction**: owner of territories, identified by a faction id. Factions are not declared separately: the factions of a map are the distinct valid owner ids of its territories. In this spec a map has no names or colours, only ids.
- **Id**: identifier of a territory or a faction: an integer from 1 to 16,777,215 (24 bits), with 0 reserved (FR-3). The range keeps ids compatible with the future id-bitmap built offline. Territory ids and faction ids follow the same rule but are separate namespaces (FR-8).
- **Position**: the 0-based index of a territory in the map's territory list. Used to name territories whose id is missing, invalid or duplicated.
- **Map order**: the order of territories in the map's territory list. The map order of a faction is the position of the first territory it owns. Lists of territories or factions "in map order" are sorted by that order.
- **Seed**: an unsigned 32-bit integer (0 to 4,294,967,295 inclusive) that, with the map, fully determines a match.
- **Neighbor territories**: two distinct territories that list each other as neighbors (mutual link). A one-way link or a link to an unknown id does not make two territories neighbors.
- **Neighbor factions of F**: the distinct living factions, other than F, that own at least one territory neighboring any territory owned by F (union over all of F's territories).
- **Living faction**: a faction that owns at least one territory.
- **Round**: round 0 is the initial state; it is not played. For k ≥ 1, round k is the k-th elimination. "The state at round k" is the state after k eliminations.
- **Total rounds (T)**: the number of rounds of a match. A valid map with F factions has T = F − 1.
- **Match**: the full sequence of rounds 1..T produced by one map and one seed, ending when exactly one living faction remains.
- **Match state**: plain, serializable data holding the round number and the owner of every territory.
- **Round record**: plain, serializable data describing one played round: round number, eliminated faction, absorbing faction, and the territories that changed owner.
- **Engine version**: the version of the validation and simulation code. Reproducibility is guaranteed only within one engine version (NFR-2).

## Functional requirements

### Map format
- FR-1: THE SYSTEM SHALL define a map as an object with exactly one field, `territories`, whose value is a list of territory objects. *(Confirmed by the user.)*
- FR-2: THE SYSTEM SHALL define a territory object as having exactly three fields: `id` (its territory id), `owner` (the faction id of its initial owner) and `neighbors` (a list of territory ids). *(Field names confirmed by the user.)*
- FR-3: THE SYSTEM SHALL accept as a valid id, for both territory ids and faction ids, only a value of number type that is an integer from 1 to 16,777,215 (2^24 − 1) inclusive; 0 is reserved and is never a valid id. Text (including numeric text such as "1" and empty text), null, booleans, lists, objects, NaN, infinities, non-integer numbers, 0, negative zero, negative numbers and numbers greater than 16,777,215 SHALL never be valid ids. An invalid id is reported with the error kind of the field that holds it (FR-15, FR-16, FR-18); no separate error kind exists for it.
- FR-4: THE SYSTEM SHALL NOT include names, colours, geometry or a format version field in the map format of this spec; a map that contains any of them is rejected with unknown-field errors (FR-19).
- FR-5: THE SYSTEM SHALL require every territory to have exactly one initial owner (no neutral, sea or unowned territories).
- FR-6: THE SYSTEM SHALL require each faction to own exactly one territory at the start of the match.
- FR-7: THE SYSTEM SHALL treat map order (the order of the territory list and of each neighbor list) as part of the input: all ordered outputs of this spec follow map order, and reordering a map may change the match produced for a given seed. A rebuilt map whose order differs is a different map.
- FR-8: THE SYSTEM SHALL keep territory ids and faction ids as separate namespaces, so a faction id may equal a territory id without error.

### Map validation
- FR-9: WHEN a map is validated, THE SYSTEM SHALL first run the structural checks (FR-12 to FR-20) and report every violation found; IF any blocking error (marked "blocking" in FR-10) is found, THEN THE SYSTEM SHALL skip the relational checks (FR-21 to FR-27); otherwise it SHALL run all relational checks and report every violation found together with the structural ones.
- FR-10: THE SYSTEM SHALL report each error as structured data: an error kind plus the data listed below, so that tools can display or test it without parsing text. The error kind names are normative identifiers:

  | Kind | Phase | Data |
  |---|---|---|
  | `invalid-map` | structural, blocking | none |
  | `invalid-territories` | structural, blocking | none |
  | `invalid-territory` | structural, blocking | position |
  | `invalid-territory-id` | structural, blocking | position |
  | `invalid-neighbors` | structural, blocking | position, id if valid |
  | `duplicate-territory-id` | structural, blocking | id, positions (ascending) |
  | `missing-owner` | structural | position, id if valid |
  | `invalid-owner` | structural | position, id if valid |
  | `unknown-field` | structural | location (top level, or position and id if valid), field name |
  | `unknown-neighbor` | relational | territory id, unknown neighbor id |
  | `self-neighbor` | relational | territory id |
  | `duplicate-neighbor` | relational | territory id, repeated neighbor id |
  | `asymmetric-adjacency` | relational | listing territory id A, listed territory id B |
  | `multiple-initial-territories` | relational | faction id, territory ids (map order) |
  | `too-few-factions` | relational | number of factions found |
  | `disconnected-map` | relational | connected groups (FR-27) |

- FR-11: THE SYSTEM SHALL order the reported errors first by kind, in the order of the table in FR-10, and then by map order of the first territory each error names (an error naming the top level comes before any territory); errors of one kind on the same territory SHALL follow the order of that territory's neighbor list, and `unknown-field` errors of the same location SHALL be ordered by field name (code-unit order).
- FR-12: IF the map is not an object, THEN THE SYSTEM SHALL report an `invalid-map` error and no other error.
- FR-13: IF the map has no `territories` field or its value is not a list, THEN THE SYSTEM SHALL report an `invalid-territories` error.
- FR-14: IF an entry of the territory list is not an object, THEN THE SYSTEM SHALL report an `invalid-territory` error naming its position.
- FR-15: IF a territory has no `id` field or its value is not a valid id (FR-3), THEN THE SYSTEM SHALL report an `invalid-territory-id` error naming its position.
- FR-16: IF a territory has no `neighbors` field, its value is not a list, or any entry of the list is not a valid id (FR-3), THEN THE SYSTEM SHALL report one `invalid-neighbors` error for that territory.
- FR-17: IF a territory has no `owner` field or its value is null, THEN THE SYSTEM SHALL report a `missing-owner` error naming the territory.
- FR-18: IF a territory's `owner` is present, not null and not a valid id (FR-3), THEN THE SYSTEM SHALL report an `invalid-owner` error naming the territory.
- FR-19: IF the map object or any territory object contains a field not defined by FR-1 or FR-2, THEN THE SYSTEM SHALL report one `unknown-field` error per unknown field, naming its location and field name, without ignoring or removing the field.
- FR-20: IF two or more territories share the same valid id, THEN THE SYSTEM SHALL report one `duplicate-territory-id` error per repeated id, naming the id and the positions of all territories that share it.
- FR-21: IF a territory lists a neighbor id that is not the id of any territory in the map, THEN THE SYSTEM SHALL report an `unknown-neighbor` error naming both ids, and SHALL NOT report an `asymmetric-adjacency` error for that link.
- FR-22: IF a territory lists its own id as a neighbor, THEN THE SYSTEM SHALL report a `self-neighbor` error naming the id.
- FR-23: IF a territory lists the same neighbor id more than once, THEN THE SYSTEM SHALL report one `duplicate-neighbor` error per repeated id, naming the territory and the repeated id; repeats are never silently deduplicated.
- FR-24: IF an existing territory A lists a different existing territory B as a neighbor but B does not list A, THEN THE SYSTEM SHALL report an `asymmetric-adjacency` error naming A and B.
- FR-25: IF a faction is the valid owner of more than one territory, THEN THE SYSTEM SHALL report a `multiple-initial-territories` error naming the faction and all its territories in map order.
- FR-26: IF the number of distinct valid owner ids in the map is less than 2, THEN THE SYSTEM SHALL report a `too-few-factions` error with that number; territories with a missing or invalid owner do not count.
- FR-27: IF the map has 2 or more territories and not every territory is reachable from every other through neighbor territories (mutual links only), THEN THE SYSTEM SHALL report one `disconnected-map` error listing every connected group, groups ordered by their first territory in map order and each group as the full list of its territory ids in map order.
- FR-28: THE SYSTEM SHALL never modify or auto-correct a map during validation; validation only reports.
- FR-29: IF a map fails validation, THEN THE SYSTEM SHALL refuse to start a match with it and return the validation errors.

### Simulation, mode `classic`
- FR-30: THE SYSTEM SHALL identify the mode of this spec as `classic` in all data and code; "Clásico" is only its UI string.
- FR-31: THE SYSTEM SHALL accept as seed only a number that is an integer from 0 to 4,294,967,295 inclusive; negative zero is accepted and treated as 0.
- FR-32: IF the seed is not of number type (including numeric text such as "42"), is NaN or infinite, is not an integer, is negative or is greater than 4,294,967,295, THEN THE SYSTEM SHALL report an `invalid-seed` error and SHALL NOT start the match.
- FR-33: WHEN a match starts from a valid map and a valid seed, THE SYSTEM SHALL produce the state at round 0 in which every territory is owned by its initial owner from the map.
- FR-34: THE SYSTEM SHALL expose in each match state the owner of every territory, retrievable by territory id; a match state SHALL NOT contain a list of territories per faction.
- FR-35: WHEN a round is played WHILE two or more factions are alive, THE SYSTEM SHALL choose the eliminated faction uniformly at random among all living factions, taken in map order.
- FR-36: WHEN a faction has been chosen for elimination, THE SYSTEM SHALL choose the absorbing faction uniformly at random among the eliminated faction's neighbor factions, taken in map order, with no weighting (not by border length, size or any other factor).
- FR-37: WHEN the absorbing faction is chosen, THE SYSTEM SHALL transfer every territory of the eliminated faction to the absorbing faction, leaving all other territories unchanged.
- FR-38: IF the faction chosen for elimination has no living neighbor faction, THEN THE SYSTEM SHALL stop and report an `isolated-faction` error naming the faction and the round, without producing a partial round.
- FR-39: THE SYSTEM SHALL provide an internal operation, not part of the interface offered to clients, that plays one round from a given match state and seed on a map that has passed every check except connectivity (FR-27), so that FR-38 can be tested with a hand-built state.
- FR-40: WHEN a round is played, THE SYSTEM SHALL produce a round record with: the round number, the eliminated faction id, the absorbing faction id, and the ids of the territories that changed owner, in map order.
- FR-41: WHILE exactly one faction is alive, THE SYSTEM SHALL consider the match finished and SHALL NOT play further rounds.
- FR-42: THE SYSTEM SHALL provide a way to obtain the total rounds T of a valid map (T = number of factions − 1), without a seed.
- FR-43: THE SYSTEM SHALL provide a way to obtain the match state at round N given only the map, the seed and N, for any N from 0 to T; the state at round 0 is the initial state.
- FR-44: THE SYSTEM SHALL provide, separately from FR-43, a way to obtain the list of round records 1..N in round order given only the map, the seed and N, for any N from 0 to T; for N = 0 the list is empty.
- FR-45: IF the requested round N is not of number type (including numeric text), is NaN or infinite, is not an integer or is negative, THEN THE SYSTEM SHALL report an `invalid-round` error; negative zero is accepted and treated as 0.
- FR-46: IF the map is valid and the requested round N is an integer greater than T, THEN THE SYSTEM SHALL report a `round-out-of-range` error naming N and T.
- FR-47: WHEN the state or the records are requested with invalid inputs, THE SYSTEM SHALL return no state and no records, and SHALL report together, in this order: all map validation errors, the `invalid-seed` error if any, and the `invalid-round` error if any; `round-out-of-range` is reported only when the map is valid and N is otherwise valid.
- FR-48: THE SYSTEM SHALL return from the interfaces of FR-43 and FR-44 only data about rounds 0..N: no state, record, count of remaining rounds or winner of any round after N. (T is available separately through FR-42.)
- FR-49: THE SYSTEM SHALL NOT include the seed or the internal state of the pseudo-random generator in any match state or round record.
- FR-50: THE SYSTEM SHALL return the same result for the same (map, seed, N) regardless of which rounds were requested before or in which order (forward, backward or random access), since each result depends only on its inputs.
- FR-51: THE SYSTEM SHALL produce identical match states and round records for identical map (including map order) and seed, on every run, within one engine version, on the runtime used by CI.
- FR-52: THE SYSTEM SHALL derive all randomness from the seed through a seeded pseudo-random generator, never from system randomness or the clock.
- FR-53: THE SYSTEM SHALL represent match states and round records so that serializing them to JSON and parsing them back yields a value deep-equal to the original, including the type of every id (an integer id must not come back as text, nor the reverse).
- FR-54: THE SYSTEM SHALL produce the state at round N equal to the state obtained by applying the round records 1..N, in order, to the state at round 0.

### Continuous integration
- FR-55: WHEN a pull request targeting `main` or `rewrite` is opened or updated, or a commit is pushed to `main` or `rewrite`, THE SYSTEM SHALL run the type check and the full test suite automatically.
- FR-56: IF the type check or any test fails, THEN THE SYSTEM SHALL mark the check as failed on that pull request or commit.

## Non-functional requirements
- NFR-1 (Purity): map validation and simulation perform no I/O, no DOM access and no reads of the clock or system randomness. Verified by a test that runs validation and a full match while the clock and system randomness are replaced by functions that throw, and by a test that scans the validation and simulation source for references to I/O, DOM, clock or system-randomness APIs and fails if any is found.
- NFR-2 (Determinism and engine version): a fixed set of (map, seed) reference cases has its full match committed as expected output (golden files), and tests verify the sim reproduces it exactly. Golden files pin the current engine behaviour; any change to the pseudo-random generator or the picking algorithm must update them deliberately in the same change. No algorithm versioning is provided in this spec.
- NFR-3 (Scale): validating and computing the full match of a valid 500-territory map (500 factions, 20 × 25 grid with 4-way adjacency) completes in under 1 second in the CI test run. The threshold is deliberately generous (well above the expected cost) so the test can gate CI without being flaky. No maximum map size is imposed by this spec.
- NFR-4 (Anti-spoiler): the round-N interfaces return only data for rounds 0..N (FR-48) and never the seed (FR-49). Rule for later specs: while a match is in progress the seed must not reach the client, because map + seed + N lets anyone compute future rounds; once the match is finished the seed may be revealed to verify or replay it. The mechanism belongs to the server spec.
- NFR-5 (Fairness): on a fixed test map of at least 4 factions in which at least one faction has 2 or more neighbor factions, over the 10,000 matches with seeds 0 to 9,999: (a) in round 1 and in round 2, the position of the eliminated faction among the living factions in map order follows a uniform distribution; (b) in round 1, for every eliminated faction with 2 or more neighbor factions, the absorbing faction, counted only over the matches where that faction was eliminated, follows a uniform distribution over its neighbor factions. Each observed frequency must be within ±3 percentage points of expected for (a) and ±5 for (b). The seed range is fixed, so the result is deterministic.
- NFR-6 (Language): all error kinds, record and state field names and mode identifiers are English; no UI strings are produced by this spec. Verified by a test asserting that every error kind produced is one of the identifiers listed in this spec (FR-10, FR-32, FR-38, FR-45, FR-46).

## Edge cases
- Map with exactly 2 factions: T = 1; the survivor owns every territory after round 1.
- Empty territory list: only `too-few-factions` (0); no `disconnected-map` (fewer than 2 territories).
- Single territory with a valid owner: only `too-few-factions` (1); the map is trivially connected.
- Map that is not an object (e.g. a list or null): only `invalid-map`.
- Territory list entry that is a number: `invalid-territory`; relational checks are skipped.
- Two territories with the same id: `duplicate-territory-id` (blocking), because every reference to that id would be ambiguous; relational errors appear only after it is fixed.
- All territories owned by one faction (2+ territories): both `multiple-initial-territories` and `too-few-factions` (1).
- Territories with null owner: `missing-owner` each; they do not count toward `too-few-factions`.
- Territory with an empty neighbor list in a map of 2+ territories: covered by `disconnected-map` (it forms its own group).
- A lists unknown id X: only `unknown-neighbor`, no `asymmetric-adjacency`.
- A lists B, B does not list A, map of only A and B: `asymmetric-adjacency` (A, B) and `disconnected-map` with groups [A] and [B], because one-way links do not connect.
- Map with several relational errors at once: all are reported in one result, in the order of FR-11.
- A neighbor listed twice by the same territory: `duplicate-neighbor` (FR-23), never silently deduplicated.
- Map split into 3 groups: one `disconnected-map` error listing the 3 groups with all their territories.
- A faction id equal to a territory id: valid (FR-8).
- Ids 1 and 16,777,215: valid. Ids 0, -0, -1, 16,777,216, 1.5, "1" or "": invalid (FR-3), reported as `invalid-territory-id`, `invalid-neighbors` or `invalid-owner` depending on the field.
- Seed 0, -0 and 4,294,967,295: valid (-0 behaves as 0). Seed -1, 4,294,967,296, 1.5, NaN, Infinity, "42" or null: `invalid-seed`.
- Round -0: treated as 0. Round 1.5, NaN, Infinity, "2": `invalid-round`. Round T + 1 on a valid map: `round-out-of-range`.
- Invalid map, invalid seed and invalid round together: all map errors, then `invalid-seed`, then `invalid-round`; no `round-out-of-range`.
- Map with a top-level "version" field and a territory with an extra "name" field: two `unknown-field` errors, reported together with the other errors of the same map; the fields are never ignored or stripped.
- Isolated faction during a match: with a validated (connected) map this cannot happen, because absorption keeps a connected map connected; FR-38 is defensive and tested through FR-39 with a hand-built state.
- Island or disconnected region: rejected at validation (FR-27), not handled during the match.
- A faction absorbed in round k later becomes the eliminated faction: all territories it has accumulated move together to its absorber.
- Request for round 0: the state is the initial state; the records list is empty.
- Request for round T: a single faction owns every territory.
- Requesting round 5, then round 2, then round 5 again (rewind): each result is identical to a fresh request.
- The same map with territories reordered and the same seed: may produce a different match (FR-7).
- Same seed on two different maps: no relation required between the matches.

## Out of scope
- Viewer, map builder, importers (GeoJSON, flat-colour PNG, Azgaar), server, Discord bot, predictions.
- When and how the seed is published after a match ends (server spec); this spec only states the rule (NFR-4).
- Determinism tests on runtimes other than the one used by CI (e.g. browsers).
- Territory or faction names, colours, geometry, labels.
- Factions starting with more than one territory, neutral or sea territories (would change the map format; later spec).
- Weighted randomness (by border length, size, etc.) and any mode other than `classic` (e.g. Reparto, province-by-province, wounded faction survives).
- Algorithm versioning (running old matches with an old engine).
- **Future work — islands and archipelagos**: disconnected regions should eventually be allowed, with isolated factions able to "jump" to land like any other faction. Designed in a later spec; until then they are an error.
- Branch protection (making the CI check required for merging): a manual repository setting, not part of this spec.
- Linter and formatting checks in CI.

## Done criteria
- Every FR and NFR above has at least one automated test that references its id, except FR-55 and FR-56, which are shown by a demonstrated CI run: one passing and one intentionally failing pull request, the latter showing a failed check.
- Validation tests cover each error kind individually, a map with every structural error kind at once, and a map with every relational error kind at once, asserting the exact error list and order (FR-9 to FR-27), including a map with 3 or more disconnected groups.
- An unknown-field test passes: a map with a top-level "version" field and a territory with an extra field yields exactly one `unknown-field` error per extra field alongside the other errors of the same map, and the input map is deep-equal to a copy taken before validation (FR-19, FR-4, FR-28).
- Seed and round tests cover both seed bounds, -0, and each invalid case listed in Edge cases (FR-31, FR-32, FR-45, FR-46, FR-47).
- Golden tests: at least 3 reference (map, seed) pairs with committed expected round records reproduce identically (FR-51, NFR-2).
- A test confirms state(N) equals the round-0 state plus records 1..N for every N of a reference match (FR-54), and that requests in backward and random order give the same results (FR-50).
- The isolated-faction test passes through the internal operation of FR-39 (FR-38).
- The fairness (NFR-5), scale (NFR-3), purity (NFR-1) and language (NFR-6) tests pass.
- A JSON round-trip test passes for states and records, including id types (FR-53).
- Type check and test suite pass locally and in CI on the merged pull request.
- `MEMORY.md` updated with the state and decisions of this spec.

## Open questions
- Resolved: map top level = an object with only `territories` (a list, which keeps map order), and territory fields named `id`, `owner`, `neighbors` (US spelling) (FR-1, FR-2, confirmed by the user during planning). Discarded: territories keyed by id (loses explicit order, and JSON keys are always text).
- Resolved: the id type is integer 1..16,777,215 with 0 reserved (FR-3, user decision during planning).
