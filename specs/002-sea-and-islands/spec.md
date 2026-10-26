# Spec 002 — Sea and islands
Status: implemented

## Context and goal
Spec 001 only accepts maps in which every territory is land, every faction starts with exactly one territory, and the whole map is connected by land. Real maps have seas, islands and countries made of several provinces (Japan, Denmark). Spec 001 lists "islands and archipelagos" as future work and rejects them today as `disconnected-map`.

This spec extends the map format and mode `classic` so that:
1. A map may contain **sea zones**: entries with no owner that never change during a match but connect land across water.
2. A faction may start with **several land territories**, contiguous or not.
3. The sea always counts for absorption: the eliminated faction can be absorbed by any faction it touches by land **or** with which it shares a sea zone, all in one uniform pick. Only if no such faction exists (every land territory linked to its land or touching its coast already belongs to it) does the reach widen across the sea, one sea hop at a time, until some living faction is found.

Why: the dev map and every later real map (Natural Earth, Azgaar) have islands, and countries are made of several provinces. Without this the engine cannot run a match on them. Factions facing each other across a sea at a reasonable distance (one shared sea zone) are natural rivals, so they compete on equal terms with land neighbours; farther jumps are a last resort so every match can finish. The sea rule is purely graph-based (no geometry), so matches stay fully deterministic and reproducible.

## Compatibility, "ask first" items and numbering
- **Ask first (AGENTS.md), map format: approved by the user.** The map format gains one optional entry field, `kind` (FR-57, FR-58). No version field is added (001 FR-4 unchanged). This is the only format change.
- **`MatchState` and `RoundRecord` do not change** (types, field names and meaning of each field). Sea zones simply never appear in them (FR-72, FR-79).
- **Backward compatibility (normative, NFR-7, NFR-8).** Every map valid under spec 001 stays valid and produces exactly the same match for every seed and round; the 001 golden files stay byte-identical and are not regenerated. This holds because a 001-valid map has no `kind` field (it would be an `unknown-field` error under 001), hence no sea zones: every coast is empty, so the absorption candidates are exactly 001's neighbor factions, in the same order, chosen with the same single uniform pick (FR-75, FR-76).
- **Maps with sea zones** may play differently from a reading of 001 that ignored the sea: this is intended (a faction with land neighbours can also be absorbed by, or absorb, factions across a shared sea zone).
- **Numbering.** Requirement ids continue after spec 001 (FR-57 to FR-81, NFR-7 to NFR-13) so that ids used in test names stay unique across specs. Every 001 requirement not listed below remains in force, read with the definitions of this spec. The ids of removed 001 requirements (FR-6, FR-25) are **retired**: never reused and excluded from traceability (NFR-13). Ids of 001 requirements that are replaced or refined stay in force under their id, with the meaning given here.

### Spec 001 requirements changed by this spec
| 001 id | Change | Replaced or refined by |
|---|---|---|
| FR-2 | Changed: optional `kind` field; sea entries have no `owner`. | FR-57, FR-58 |
| FR-5 | Relaxed: only land territories need an owner; sea zones have none. Neutral land is still not allowed. | FR-59 |
| FR-6 | **Removed** (id retired, NFR-13): a faction may start with any number of land territories. | FR-60 |
| FR-7 | Refined: sea zones count in map order, but moving a sea zone never changes the match. | FR-62 |
| FR-9 | Refined: its structural checks are 001 FR-12 to FR-20 as changed here plus FR-61, FR-65 to FR-68; its relational checks are 001 FR-21 to FR-24 plus FR-70 and FR-71 (FR-25 removed); its blocking marks are those of FR-64 instead of FR-10. `invalid-kind` and `sea-owner` never block. | FR-64, FR-66 |
| FR-10 | Changed table: removes `multiple-initial-territories`, adds `invalid-kind` and `sea-owner` (both non-blocking). | FR-64 |
| FR-11 | Unchanged wording; it now applies to the table of FR-64. | FR-64 |
| FR-14, FR-15, FR-16, FR-20 to FR-24 | Refined: "territory" means any entry, whatever its kind. | FR-61 |
| FR-17, FR-18 | Refined: owner checks apply only to land entries. | FR-65 |
| FR-19 (and its citation in FR-4) | Changed: `kind` is a defined field. | FR-68 |
| FR-25 | **Removed** (id retired, NFR-13) together with the error kind `multiple-initial-territories`. | FR-69 |
| FR-26 | Refined: only owners of land entries count as factions. | FR-70 |
| FR-27 | Refined: connectivity runs over all entries (land, sea, invalid-kind) together. | FR-71 |
| FR-33, FR-34 | Refined: the match state holds land territories only. | FR-72 |
| FR-35 | Refined: "map order" of factions is read as faction order (Definitions), since a faction may own several territories. Behaviour on 001 maps is unchanged. | Definitions |
| FR-36 | Changed: candidates are land-neighbor factions plus factions sharing a sea zone, as one group, each faction once; the reach widens through the sea only if that group is empty. | FR-75, FR-76, FR-77 |
| FR-37, FR-40 | Refined: only land territories are transferred and listed. | FR-79 |
| FR-38 | Refined: an isolated faction has no candidate even after widening through every reachable sea zone; on maps without sea zones this is exactly 001's condition. | FR-78 |
| FR-39 | Refined: "every check except connectivity" means every check except FR-71. Complemented by a second internal operation for candidates. | FR-78, FR-81 |
| FR-41, FR-42 | Refined: "faction" and "alive" are read with this spec's definitions (land owners only). | FR-80 |
| NFR-6 | Refined: the literal list of error kinds changes. | NFR-12 |
| Done criterion "every FR and NFR has a test" | Refined: the expected id list grows and excludes retired ids. | NFR-13 |
| Definitions | Territory, entry, faction, neighbor factions, living faction and faction order are restated below. | Definitions |
| Edge case "All territories owned by one faction: `multiple-initial-territories` and `too-few-factions` (1)" | **Superseded**: only `too-few-factions` (1). | FR-69, Edge cases |
| Edge case "Isolated faction ... because absorption keeps a connected map connected" | **Superseded justification**: the conclusion (cannot happen on a valid map) still holds, by the sea-reach argument in Edge cases. | FR-78, Edge cases |
| Edge case "Island or disconnected region: rejected" | **Superseded** while the island is linked through the sea. | FR-71, FR-76, FR-77 |
| Out of scope "factions with more than one territory", "sea territories", future work "islands and archipelagos" | Now in scope (neutral land stays out of scope). | FR-60, FR-71, FR-76, FR-77 |

## Users
- **Spectator / predictor** (indirect): wants matches on real maps with islands and multi-province countries, still fair and reproducible.
- **Developer** of the map builder, viewer, server and bot: needs a format that marks sea explicitly, a stable rule for crossing the sea, and no change to the state and record contracts already in use.

## User stories
- US-1. As a developer, I want to mark entries as sea so that water is explicit in the map and never inferred.
- US-2. As a developer, I want a map with islands linked by sea zones to be valid, and a map with land unreachable even through the sea to still be rejected.
- US-3. As a developer, I want a faction to start with several territories (contiguous or not) so that countries made of several provinces or islands can be modelled.
- US-4. As a spectator, I want factions that share a sea zone to compete as rivals on equal terms with land neighbours, and an isolated faction to be absorbed by the nearest factions across the sea when its whole zone is gone, so that matches feel natural and always finish.
- US-5. As a developer, I want every map that worked under spec 001 to play exactly the same match so that existing goldens, tests and predictions stay valid.

## Definitions
These replace or extend the definitions of spec 001.
- **Entry**: any element of the map's `territories` list. An entry that is not an object is reported as `invalid-territory` (001 FR-14) and has no kind. An entry that is an object has exactly one kind: land, sea or invalid (the last makes the map invalid). Entry ids follow the territory id rule and namespace of 001 (FR-3, FR-8); "territory id" means the id of an entry of any kind.
- **Kind** of an object entry: land if the entry has no own `kind` field or its value is the text `"land"`; sea if its value is the text `"sea"`; any other value is invalid (FR-58). An entry of invalid kind is called an **invalid-kind entry**.
- **Land territory**: an entry of kind land. It has an owner and may change owner.
- **Sea zone**: an entry of kind sea. It has no owner, never changes, is never eliminated and is not part of the match state.
- **Territory (in spec 001 text)**: 001 used "territory" for every element of the list. Under this spec it is read as:
  - **any entry** (land, sea or invalid-kind; for FR-14 also non-object elements) in the format, id, neighbor, ordering and connectivity rules: 001 FR-1, FR-3, FR-7, FR-8, FR-9, FR-11, FR-14, FR-15, FR-16, FR-19 (as FR-68), FR-20 to FR-24, FR-27 (as FR-71), FR-28, and the definitions of position and map order of entries;
  - **land territory** in every owner, faction and match rule: 001 FR-5 (as FR-59), FR-17, FR-18 (as FR-65), FR-26 (as FR-70), FR-33 to FR-44, FR-54, and the definitions of faction, living faction, neighbor factions, match state and round record.
- **Position** and **map order**: as in 001, counted over all entries of the list, sea zones included.
- **Linked**: two distinct entries that list each other as neighbors (mutual link, as in 001). One-way links and links to unknown ids link nothing. There is no separate faction-to-sea link: a faction **touches** a sea zone when at least one land territory it owns is linked to that zone. On a valid map every link is mutual (one-way links are `asymmetric-adjacency` errors), so "touches" and "shares a sea zone" are symmetric relations: if E shares a zone with F, F shares it with E.
- **Faction**: a distinct valid owner id of a land territory. Owners written on sea or invalid-kind entries are errors (FR-66, FR-67) and never define a faction.
- **Living faction**: a faction that owns at least one land territory in the current state.
- **Faction order**: the order of factions by the position of the first land territory each owns in the current state (the faction order rule of 001, FR-35, unchanged). A faction that owns several land territories is placed by the first of them in the list, wherever its other territories are; sea zones do not affect it. Lists of factions "in faction order" are sorted by it.
- **Land-neighbor factions of F**: the distinct living factions, other than F, that own at least one land territory linked to any land territory owned by F (union over all of F's land territories). This is exactly 001's "neighbor factions".
- **Coast of F**: the set of sea zones touched by F. A faction with no linked sea zone has an empty coast.
- **Sea-sharing factions of F**: the distinct living factions, other than F, that touch at least one zone of F's coast.
- **Direct candidates of F**: the union of the land-neighbor factions and the sea-sharing factions of F, as a set: a faction that is both, or that shares several zones with F, appears once.
- **Sea distance** of a sea zone z from F: the least number of sea-to-sea links on a path that starts at a zone of F's coast, ends at z and visits only sea zones. Coast zones have sea distance 0. A zone that cannot be reached this way has no sea distance.
- **Sea reach of F at distance d** (d ≥ 0): the set of sea zones whose sea distance from F is at most d.
- **Widened candidates of F at distance d** (d ≥ 1): the distinct living factions, other than F, that touch at least one zone in the sea reach of F at distance d.
- **Absorption candidates of E**: the direct candidates of E if there is at least one; otherwise the widened candidates of E at the smallest d ≥ 1 for which they are not empty; otherwise none.
- **Total rounds (T)**: number of factions − 1 (unchanged).
- **Id 0 and sea**: id 0 stays reserved and never valid (001 FR-3). The 001 planning rationale that reserved 0 for "no territory (sea/background pixels)" in the future id bitmap is partly superseded: under this spec sea zones are entries with ordinary non-zero ids. How the id bitmap encodes sea zones and background is out of scope.

## Functional requirements

### Map format
- FR-57 (replaces 001 FR-2): THE SYSTEM SHALL define an entry as an object with the fields `id` (territory id) and `neighbors` (list of territory ids), plus: for a land territory, `owner` (faction id of its initial owner) and optionally `kind` with value `"land"`; for a sea zone, `kind` with value `"sea"` and no `owner` field.
- FR-58: THE SYSTEM SHALL determine the kind of an object entry from its own `kind` field, using own-property presence as 001 does for every field (inherited properties are ignored): no own `kind` field means land; the text `"land"` means land; the text `"sea"` means sea; any other value of a present `kind` field (including undefined in non-JSON input, null, empty text, text differing in case such as `"Sea"`, numbers, booleans, lists and objects) is invalid (FR-66).
- FR-59 (replaces 001 FR-5): THE SYSTEM SHALL require every land territory to have exactly one initial owner, and every sea zone to have none; neutral (unowned) land remains invalid.
- FR-60 (removes 001 FR-6): THE SYSTEM SHALL allow a faction to own any number (one or more) of land territories at the start of the match, without requiring them to be linked to each other by land or by sea (exclaves allowed); only the whole-map connectivity of FR-71 applies.
- FR-61 (refines 001 FR-14, FR-15, FR-16, FR-20 to FR-24): THE SYSTEM SHALL apply 001 FR-14 to every element of the list, and the id and neighbor rules (001 FR-3, FR-8, FR-15, FR-16, FR-20 to FR-24) to every object entry whatever its kind (land, sea or invalid), so that all entries share one id namespace, a neighbor list may mix land and sea ids, and a sea zone or invalid-kind entry with a missing or invalid id is reported as `invalid-territory-id`, one whose `neighbors` is missing or not a list of valid ids as `invalid-neighbors`, and one whose id repeats another entry's id as `duplicate-territory-id`.
- FR-62 (refines 001 FR-7): THE SYSTEM SHALL count sea zones in positions and map order, so they take part in error ordering (001 FR-11), in the position data of errors, and in the order of `disconnected-map` groups and of the ids inside each group (FR-71). Faction order and the match depend only on the relative order of land territories; therefore moving a sea zone to another position in the list, with nothing else changed, SHALL leave the match state and round records of every seed and round deep-equal.
- FR-63: THE SYSTEM SHALL produce, for a map, the same validation result and the same match as for the identical map in which `"kind": "land"` is added to or removed from any land territory.

### Map validation
- FR-64 (replaces the 001 FR-10 table and refines 001 FR-9): THE SYSTEM SHALL report validation errors with the following kinds, phases and data; error ordering follows 001 FR-11 using this table's order. 001 FR-9 applies with these references: the structural checks are 001 FR-12 to FR-20 as changed by FR-59, FR-61 and FR-65 to FR-68; the relational checks are 001 FR-21 to FR-24, FR-70 and FR-71; only the errors marked blocking in this table cause the relational checks to be skipped.

  | Kind | Phase | Data |
  |---|---|---|
  | `invalid-map` | structural, blocking | none |
  | `invalid-territories` | structural, blocking | none |
  | `invalid-territory` | structural, blocking | position |
  | `invalid-territory-id` | structural, blocking | position |
  | `invalid-neighbors` | structural, blocking | position, id if valid |
  | `duplicate-territory-id` | structural, blocking | id, positions (ascending) |
  | `invalid-kind` | structural, non-blocking | position, id if valid |
  | `missing-owner` | structural, non-blocking | position, id if valid |
  | `invalid-owner` | structural, non-blocking | position, id if valid |
  | `sea-owner` | structural, non-blocking | position, id if valid |
  | `unknown-field` | structural, non-blocking | location (top level, or position and id if valid), field name |
  | `unknown-neighbor` | relational | territory id, unknown neighbor id |
  | `self-neighbor` | relational | territory id |
  | `duplicate-neighbor` | relational | territory id, repeated neighbor id |
  | `asymmetric-adjacency` | relational | listing territory id A, listed territory id B |
  | `too-few-factions` | relational | number of factions found |
  | `disconnected-map` | relational | connected groups (FR-71) |

- FR-65 (refines 001 FR-17, FR-18): THE SYSTEM SHALL run the `missing-owner` and `invalid-owner` checks only on land territories (object entries with no own `kind` field or with `kind` `"land"`).
- FR-66: IF an object entry has an own `kind` field whose value is not the text `"land"` or `"sea"` (FR-58), THEN THE SYSTEM SHALL report one `invalid-kind` error naming the entry, SHALL NOT run any owner check on that entry (no `missing-owner`, `invalid-owner` or `sea-owner`), and SHALL NOT count its owner as a faction. `invalid-kind` is non-blocking: by itself it never causes the relational checks to be skipped. WHEN the relational checks run (no blocking error anywhere in the map, 001 FR-9 as referenced by FR-64), the entry's id and neighbor links SHALL count for `unknown-neighbor`, `self-neighbor`, `duplicate-neighbor`, `asymmetric-adjacency` and `disconnected-map` exactly as for any other entry. IF the map also has a blocking error on any entry, THEN 001 FR-9 applies unchanged: only the structural errors, `invalid-kind` included, are reported.
- FR-67: IF a sea zone has an own `owner` field, whatever its value (including undefined in non-JSON input, null and a valid id), THEN THE SYSTEM SHALL report one `sea-owner` error naming the entry, and SHALL NOT count that value as a faction.
- FR-68 (replaces 001 FR-19): IF the map object contains a field other than `territories`, or an object entry contains a field other than `id`, `owner`, `neighbors` and `kind`, THEN THE SYSTEM SHALL report one `unknown-field` error per such field, as in 001; an `owner` field on a sea zone is reported only as `sea-owner` (FR-67), never as `unknown-field`.
- FR-69 (removes 001 FR-25): THE SYSTEM SHALL NOT report any error because a faction owns more than one land territory; the error kind `multiple-initial-territories` no longer exists and is never reported.
- FR-70 (refines 001 FR-26): IF the number of distinct valid owner ids of land territories is less than 2, THEN THE SYSTEM SHALL report a `too-few-factions` error with that number; sea zones, invalid-kind entries and land territories with a missing or invalid owner do not count.
- FR-71 (refines 001 FR-27): IF the map has 2 or more entries and not every entry is reachable from every other through linked entries of any kind (land, sea and invalid-kind entries alike, mutual links only), THEN THE SYSTEM SHALL report one `disconnected-map` error listing every connected group as in 001 FR-27, groups and their ids including sea zones; land linked to the rest only through sea zones is connected.

### Simulation, mode `classic`
- FR-72 (refines 001 FR-33, FR-34): THE SYSTEM SHALL hold in each match state the owner of every land territory, in map order, and no entry for any sea zone; looking up the owner of a sea zone id (001 FR-34) SHALL return no owner, exactly as for an unknown id. The match state type does not change.
- FR-73: THE SYSTEM SHALL never change, eliminate or count as a faction any sea zone during a match.
- FR-74: THE SYSTEM SHALL keep the mode identifier `classic` for all maps, with or without sea zones.
- FR-75 (replaces 001 FR-36): WHEN a faction E has been chosen for elimination, THE SYSTEM SHALL choose the absorbing faction uniformly at random among the absorption candidates of E, each distinct faction present once, taken in faction order, with no weighting (not by whether it is reached by land or by sea, number of shared zones or links, sea distance, border length, size or any other factor), by one uniform pick over that candidate list made exactly as in 001: the same index-picking procedure, from the same per-round random stream, right after the elimination pick, and with no extra pick while widening, however many distances are tried.
- FR-76: WHEN the absorption candidates of E are computed, THE SYSTEM SHALL first form the direct candidates of E (its land-neighbor factions and its sea-sharing factions together, in one group) and, if that group is not empty, SHALL use it as the absorption candidates without any widening; on a map without sea zones this group is exactly 001's neighbor factions, so the round is identical to 001.
- FR-77: IF the direct candidates of E are empty, THEN THE SYSTEM SHALL widen the reach through the sea starting at d = 1, adding in one step every sea zone at sea distance d, and SHALL use the first non-empty set of widened candidates at distance d as the absorption candidates; while that set is empty and some sea zone has sea distance d + 1, it SHALL increase d by one.
- FR-78 (refines 001 FR-38): IF the direct candidates of E are empty and no widened candidates exist at any distance (no sea zone is left to add), THEN THE SYSTEM SHALL stop and report an `isolated-faction` error naming the faction and the round, without producing a partial round. On a valid (connected) map this cannot happen; it is tested through the internal operation of 001 FR-39 with a map that passes every check except connectivity (FR-71), both without sea zones (001 behaviour) and with sea zones.
- FR-79 (refines 001 FR-37, FR-40): WHEN the absorbing faction is chosen, THE SYSTEM SHALL transfer every land territory of the eliminated faction to it, leaving all other land territories unchanged, and SHALL list in the round record's transferred territories exactly those land territory ids in map order; the round record shape does not change, sea zone ids never appear in it, and no field records whether the sea was crossed.
- FR-80 (refines 001 FR-41, FR-42): THE SYSTEM SHALL keep T = number of factions − 1 (FR-70 definition of faction) and SHALL consider the match finished when exactly one living faction remains, whatever the number of land territories each faction starts with.
- FR-81: THE SYSTEM SHALL provide an internal operation, not part of the interface offered to clients and not stored in any match state or round record, that, given a map that has passed every check except connectivity (FR-71), a match state and a living faction E, returns the absorption candidates of E in faction order together with how they were found: direct, widened at distance d (with the value of d), or none; so that FR-75 to FR-78 and NFR-7, NFR-9 to NFR-11 can be verified without changing the round record.

## Non-functional requirements
- NFR-7 (Backward compatibility, matches): every map valid under spec 001 is valid under this spec and, for every valid seed and round, its match state and round records are deep-equal to those of spec 001. Such maps have no `kind` field, hence no sea zones, so every coast is empty and FR-76 reduces to 001 FR-36. Verified by: the 001 golden files kept byte-identical (not regenerated) and still passing; tests that run the 001 reference maps also with `"kind": "land"` added to every entry (FR-63); and a test that, on maps without sea zones (including factions with several territories), for every round of a reference match the candidates returned by the operation of FR-81 for the eliminated faction are direct and equal its land-neighbor factions in faction order.
- NFR-8 (Backward compatibility, validation): (a) For every map in which no object entry has an own `kind` field, the error list is exactly the 001 error list with every `multiple-initial-territories` error removed (all object entries are land, so every other check, phase and blocking mark behaves as in 001). (b) Maps in which some entry has a `kind` field were always invalid under 001 (`unknown-field`); their result is defined by FR-58 and FR-64 to FR-71 and differs from 001 also in these ways: no `unknown-field` for `kind`; a sea zone without owner gets no `missing-owner`; a sea zone with an `owner` field gets `sea-owner` instead of any owner check, and that owner no longer counts as a faction, so `too-few-factions` may appear or report a different number; an invalid-kind entry gets `invalid-kind`, no owner check, and its owner no longer counts as a faction (same effect on `too-few-factions`). Because `invalid-kind` and `sea-owner` are non-blocking, whether the relational checks run is the same as under 001 for every map. Verified by: the 001 validation tests passing unchanged, except those asserting `multiple-initial-territories`, which are rewritten to assert its absence (NFR-13); and one test per difference listed in (b), asserting the exact 002 error list for that map.
- NFR-9 (Determinism with sea): at least 4 new reference (map, seed) pairs have their full match committed as golden files, and tests verify the sim reproduces them exactly (001 FR-51, NFR-2). Because round records do not show how candidates were found (FR-79), each pair also has a test that rebuilds the state before a named round k of that match and asserts, through the operation of FR-81 applied to round k's eliminated faction, the property the pair exists for: (i) the eliminated faction has no land-neighbor faction, its candidates are direct, and the recorded absorber is a sea-sharing faction; (ii) its direct candidates include at least one faction that is only a land neighbour and at least one that is only sea-sharing (e.g. the Denmark example); (iii) its candidates were found by widening at distance 2 or more; (iv) on a map where at least one faction owns 2 or more land territories at round 0, two of which are not linked to each other through that faction's own land (asserted on the map), round k's record transfers 2 or more territories. In addition, hand-built fixtures assert through the operation of FR-81 widening at exactly distance 1 and exactly distance 2.
- NFR-10 (Fairness through the sea, no double counting): on a fixed test map with exactly 4 factions in which faction E has exactly 3 direct candidates — one only a land neighbour, one only sea-sharing (sharing 2 or more zones with E), and one both a land neighbour and sea-sharing — over the 10,000 matches with seeds 0 to 9,999, the absorbing faction in round 1, counted only over the matches where E was eliminated in round 1, follows a uniform distribution over the 3 candidates within ±5 percentage points. The test first asserts, through the operation of FR-81 on the round-0 state, that E's candidates are direct and are exactly those 3 factions.
- NFR-11 (Scale with sea): validating and computing the full match of the following map completes in under 1 second in the CI test run: 500 land territories, numbered 0 to 499 in list order, each owned by a different faction (500 factions), with no link between two land territories; 100 sea zones, numbered 0 to 99, forming a 10 × 10 grid (row by row) in which each zone is linked to its orthogonal grid neighbours (4-way); sea zone k linked to land territories 5k to 5k + 4, so each sea zone touches exactly 5 land territories and each land territory touches exactly one sea zone. The test also asserts that the map is valid and has no land-to-land link, so in every round every faction's land-neighbor factions are empty and its candidates come only from sea-sharing or widening.
- NFR-12 (Purity and language): 001 NFR-1 and NFR-6 apply to all new behaviour; the literal list of error kinds used by the language test contains `invalid-kind` and `sea-owner` and no longer contains `multiple-initial-territories`.
- NFR-13 (Traceability with retired ids): the automated traceability check expects every id from FR-1 to FR-81 and from NFR-1 to NFR-13 to appear in at least one test title, except the retired ids FR-6 and FR-25, and fails if a retired id appears in any test title. Tests that asserted 001 FR-6 or FR-25 are rewritten under FR-60 and FR-69 to assert the new behaviour. Tests titled with a replaced or refined 001 id (e.g. FR-2, FR-10, FR-36) assert the behaviour as changed by this spec. Verified by the traceability check itself and by a test that its expected list contains FR-81 and NFR-13 and does not contain FR-6 or FR-25.

## Edge cases
- A 001 map (no `kind` anywhere, one territory per faction, all land): same validation result and same match for every seed; same golden files.
- The same map with `"kind": "land"` on some or all entries: identical results (FR-63).
- Sea zone with `owner: 3`, or with `owner: null`: `sea-owner`; the value is not a faction.
- Sea zone without `owner`: valid; no `missing-owner`.
- Land territory with `kind: "land"` and no owner: `missing-owner`.
- `kind: "Sea"`, `kind: ""`, `kind: null`, `kind: 1`, `kind: "neutral"`, or a present `kind` whose value is undefined (non-JSON input): `invalid-kind`; no owner check on that entry; its owner does not count for `too-few-factions`; relational checks still run if there is no blocking error.
- A `kind` field inherited rather than own (non-JSON input): ignored, as for every other field in 001; the entry is land.
- Invalid-kind entry listing an unknown id, itself, a repeated id or a one-way link, with no blocking error in the map: `invalid-kind` plus `unknown-neighbor` / `self-neighbor` / `duplicate-neighbor` / `asymmetric-adjacency`, all in one pass.
- Invalid-kind entry on one entry and a blocking error on another (e.g. `invalid-neighbors` or a duplicate id): only structural errors are reported, `invalid-kind` included; no relational error (001 FR-9).
- Invalid-kind entry that is the only link between two parts of the map: counts for connectivity (no `disconnected-map` from it); the map is still invalid because of `invalid-kind`.
- Map whose only owners are on invalid-kind entries: `invalid-kind` for each, plus `too-few-factions` with the number of valid land owners.
- Entry with invalid kind and an extra field `name`: `invalid-kind` and `unknown-field` (`name`); `owner` on it is never `unknown-field`.
- Sea zone with a missing or invalid id, or with the same id as another entry: `invalid-territory-id` / `duplicate-territory-id` (blocking, FR-61), as for land; a land and a sea entry with the same id are duplicates.
- Sea zone whose `neighbors` is missing or contains an invalid id: `invalid-neighbors` (blocking, FR-61).
- Sea zone listing a land territory that does not list it back: `asymmetric-adjacency`, as for land; that one-way link makes the faction neither touch the zone nor share it.
- Map of only sea zones: `too-few-factions` (0), plus `disconnected-map` if they are not all linked.
- One faction's land plus any number of sea zones: `too-few-factions` (1).
- All land owned by one faction (2+ land territories): only `too-few-factions` (1); no longer `multiple-initial-territories`.
- Two factions on two islands linked only through one shared sea zone: valid, T = 1; round 1's absorber is the other faction through the sea.
- Two land groups with no link even through the sea: `disconnected-map`, groups listing land and sea ids.
- Sea zone with an empty neighbor list in a map of 2+ entries: its own group in `disconnected-map`.
- The same map with one sea zone moved to another position: same match for every seed; errors may name different positions and `disconnected-map` groups may be listed in a different order (FR-62).
- Open-ocean sea zones linked only to other sea zones: valid if the map is connected; they are in nobody's coast and only matter when widening.
- Lake or inland sea touched by two or more factions: it is a sea zone like any other, so those factions share it and are direct candidates of each other. A sea zone touched by a single faction (bay) adds nobody to its direct candidates.
- Denmark (land-linked to Germany; its islands touch a sea zone that Sweden also touches): direct candidates of Denmark = {Germany, Sweden}, each with probability 1/2. If Germany also touches that sea zone, Germany still counts once (still 1/2 each). Symmetrically, Denmark is a candidate when Sweden is eliminated.
- A faction that shares several sea zones with E, or is both a land neighbour and sea-sharing: one candidate, one share of the uniform pick.
- Faction with land neighbours and an empty coast (landlocked): candidates are its land neighbours only, even if those neighbours have coasts.
- Faction with land neighbours whose coast zones touch no other living faction: candidates are its land neighbours only; no widening, because the group is not empty.
- Faction made of several islands (Japan): one faction, valid; its coast is the union of the coasts of all its islands; all its land territories move together when it is absorbed.
- Exclave: a faction owning a land territory enclosed by another faction's land: valid (FR-60); the enclosing faction is a land neighbour.
- Faction order at round 0 with multi-territory factions: with land listed (sea zones anywhere in between) as Y, X, Y, Z, X, where X's last territory is an exclave enclosed by Z, the order is Y, X, Z; with land listed as Y, Y, Z, X, Z, where X's only territory is an exclave late in the list, the order is Y, Z, X.
- Faction E with no land neighbour and no other living faction touching its coast: this happens only when every land territory linked to E's land or touching E's coast already belongs to E (land is never unowned, so the factions that held it were absorbed into E, or there were none). The reach widens one sea hop at a time until it finds living factions (FR-77); all factions found at that distance compete uniformly, however many zones each touches.
- During widening, a faction is a candidate at the first distance at which it touches any reached zone; distances do not weight the pick.
- Candidates are always recomputed from the current state: after an absorption a faction may gain or lose land neighbours, coast zones and sea-sharing factions between rounds.
- A land-to-land link across a strait written by the map author: treated as a land link; the faction is a direct candidate either way.
- Owner lookup (001 FR-34) on a sea zone id: no owner, same as an unknown id.
- Isolated faction during a match: impossible on a valid map. Take E's land plus every sea zone reachable from E's coast through sea zones; another living faction exists and the map is connected, so some link leaves that set. It cannot reach a sea zone (it would be in the set), so it reaches another faction's land: from E's land that faction is a land neighbour, from a zone at sea distance d it is a direct candidate (d = 0) or a widened candidate at distance d. This replaces 001's justification ("absorption keeps a connected map connected"). FR-78 is defensive and tested with a hand-built, disconnected map through the internal operation.

## Out of scope
- Viewer, map builder, importers (GeoJSON, flat-colour PNG, Azgaar), server, Discord bot, predictions.
- Names and colours, including how sea is drawn (e.g. as the dominant colour).
- How the id bitmap encodes sea zones and background pixels (see the "Id 0 and sea" definition); decided in the map builder or viewer spec.
- Impassable land, capturable or neutral land, any other entry kind beyond land and sea.
- Weighting absorption by land versus sea, sea distance, number of shared zones, border length or size; any limit on sea distance; preferring land neighbours over sea-sharing factions.
- A field in the round record saying the absorption crossed the sea, or the path used.
- A map format version field.
- Modes other than `classic`.

## Done criteria
- Every FR-57..FR-81 and NFR-7..NFR-13 has at least one automated test that references its id; the traceability check follows NFR-13 (expects FR-1..FR-81 and NFR-1..NFR-13 except the retired FR-6 and FR-25, and rejects retired ids in test titles); tests that asserted 001 FR-6/FR-25 are replaced by tests of FR-60/FR-69.
- The 001 golden files are unchanged (byte-identical, not regenerated) and still pass; at least 4 new golden files with sea pass, each with its FR-81 property test (NFR-7, NFR-9).
- Validation tests cover `invalid-kind` (including undefined and inherited `kind`) and `sea-owner` individually; `invalid-kind` together with relational errors on the same entry (non-blocking, one pass); `invalid-kind` together with a blocking error on another entry (no relational errors); a sea zone with an invalid id and with invalid neighbors; a map with every structural error kind at once and a map with every relational error kind at once (exact list and order per FR-64); a disconnected map whose groups include sea zones; and one test per NFR-8 (b) difference.
- Sim tests cover: a faction with no land neighbour absorbed through a shared zone; a mixed group of land-neighbor and sea-sharing factions (Denmark example); a faction counted once when both land neighbour and sea-sharing, or sharing several zones; a faction with land neighbours and an unshared coast (no widening); widening to exactly distance 1 and exactly distance 2; multi-territory factions including round 1 transferring several territories; faction order at round 0 for both multi-territory examples in Edge cases; moving a sea zone leaves the match unchanged (FR-62); owner lookup on a sea zone id; FR-78 through the internal operation with and without sea zones; candidates equal land neighbours on maps without sea zones (NFR-7).
- Fairness (NFR-10), scale (NFR-11), purity and language (NFR-12) tests pass; 001 tests (fairness, scale, purity, round-trip) still pass.
- Type check and test suite pass locally and in CI on the merged pull request; `MEMORY.md` updated.

## Open questions
None open.
- Resolved (user decisions): sea as an entry with `kind: "sea"` and no `owner` (format change approved); the sea always counts: candidates are land-neighbor factions plus factions sharing a sea zone, in one uniform pick; only if that group is empty, widen one sea hop at a time (all zones at the next distance in one step) until a living faction is found; `invalid-kind` is non-blocking (by itself it never skips the relational checks; its links count, its owner counts for no faction); connectivity over land + sea; multi-territory factions included; `MatchState` and `RoundRecord` unchanged, sea absent from both; maps without sea play exactly as under 001.
- Resolved by default (accepted): a faction's land need not be contiguous, by land or through the sea, and exclaves are allowed (FR-60); a sea zone with `owner: null` is `sea-owner` because the field is present (FR-67); new error kind names `invalid-kind` and `sea-owner`; numbering continues from 001; sea never changes owner and is never eliminated; a faction is alive while it owns land; sea never counts toward `too-few-factions`; T = factions − 1; mode stays `classic`; sea zones outside `owners` and part of map order; sea zones with no land neighbour are allowed if the map is connected; new goldens with sea are added.
- Resolved by technical criteria (review round 2): field presence is own-property presence, so a present `kind` or `owner` with value undefined is a present field (invalid kind; `sea-owner` on a sea zone), consistent with 001's handling of `owner: undefined`; removed 001 ids FR-6 and FR-25 are retired and rejected in test titles (NFR-13), while replaced or refined ids stay traced with their new meaning; how candidates were found is observable only through an internal operation (FR-81), never in the round record.
- Stated consequences (no decision needed): each faction counts once in the pick however it is reached; links are entry-to-entry and mutual, so "shares a sea zone" is symmetric and a one-way land–sea link makes the faction not touch that zone; lakes and inland seas marked as sea connect the factions around them; moving a sea zone never changes a match.
