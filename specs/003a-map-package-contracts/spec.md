# Spec 003a — Map package contracts
Status: approved

## Context and goal
Roadmap step 2 is "viewer on a real map". The viewer cannot be judged without a real map at target scale (lesson: 4x4 test maps hid every real bug), so step 2 is split into: **003a map package contracts** (this spec), **003b builder and dev map**, 004 viewer (static rendering, camera, debug scene, instant round stepping, performance at real scale) and 005 labels and transitions.

This spec defines the **map package** and its two new data contracts, with pure validation checks that cross-check them against the map:
1. The **presentation data**: names of factions and map entries and optional preferred faction colours, kept outside the map.
2. The **id image contract**: one pixel = one map entry id or background, how a value is split into three 8-bit channels, and the rule that adjacency in the map equals 4-connected pixel contact in the image. The check works on decoded pixel values; how the image is stored as a file is defined in 003b (FR-105). Two pure functions of this contract (value encoding/decoding, FR-106, and contact derivation, FR-108) are exposed for reuse by 003b and 004.

Why: names and colours are needed by the viewer and by spectators, but the map and sim contracts of 001/002 must not change; one id image gives every territory border exactly once, so shared borders have no seams or gaps (lesson: shared borders need identical vertices); and adjacency read from that same image can never disagree with what the viewer draws. These contracts are small and stable, need no dependency and no source data, and let 003b and 004 build on merged, tested validators.

### Scope split (final decision)
The former spec 003 (dev map and map builder) was split by the user's decision (option A) into two specs, with every requirement id unchanged and each id in exactly one spec:
- **003a Map package contracts (this spec)**: FR-82 to FR-104, FR-106 to FR-110, NFR-15, NFR-18, NFR-19, NFR-22. Implemented and merged first.
- **003b Builder and dev map**: FR-105, FR-111 to FR-131, NFR-14, NFR-16, NFR-17, NFR-20, NFR-21, NFR-23. Depends on 003a. 003b stays one spec by the user's decision.
- FR-105 (PNG file format) moved to 003b because only the builder writes the file and only 003b may add a PNG library; this spec's contract is on decoded values. The clause "the builder takes no seed or round as input" moved from FR-83 to 003b FR-112.

## Depends on
- Spec 001 (map format, ids, map validation, purity, language and traceability checks) and spec 002 (sea zones, `kind`, factions as owners of land entries, map validation with land + sea connectivity), both merged; their behaviour is unchanged (NFR-22).

## Enables
- Spec 003b: the builder runs this spec's checks on every build, derives links with the contact function of FR-108 and reads/writes PNG channels with the encode/decode functions of FR-106.
- Spec 004: the viewer relies on the presentation data, the value encoding of FR-106 and the "Contract for later specs" section.

## Compatibility, "ask first" items and numbering
- **Map format and match state: unchanged.** The map of specs 001/002 gains no field (001 FR-4 still holds: no names, colours, geometry or version in the map). `MatchState` and `RoundRecord` do not change. Map validation (001/002) does not change.
- **Ask first (AGENTS.md), new formats: approved in principle by the user.** The presentation data (separate from the map) and the id image value contract are new formats, defined fully here (FR-84 to FR-90, FR-106 to FR-108); they need the user's approval of this spec before implementation.
- **No new dependency.** Everything in this spec is pure, deterministic code under 001 NFR-1 (no I/O, DOM, clock or system randomness).
- **Numbering.** Ids continue after spec 002 and are shared with 003b: FR-82 to FR-131 and NFR-14 to NFR-23, unique across all specs (the traceability check matches ids by test title over every spec). No 001/002 id is retired or reused. No id above FR-131 or NFR-23 exists.

### Spec 001/002 items touched by this spec
| Item | Change | By |
|---|---|---|
| 002 Out of scope "How the id bitmap encodes sea zones and background pixels" | Now decided: sea zones are ordinary ids; 0 is background (outside the map). | FR-106 |
| 002 Definitions "Id 0 and sea" | Consistent: 0 stays reserved; in the id image it means "not part of the map". | FR-106 |
| 001/002 Out of scope "names and colours" | Now in scope **outside the map**, in the presentation data; the map format still has none. | FR-84 to FR-90 |
| 002 NFR-13 (traceability) | Refined: the expected list grows to FR-131 / NFR-23, with the 003b ids pending until 003b; the self-trace pin becomes FR-55, FR-56, NFR-13, NFR-19. Retired ids unchanged. | NFR-19 |
| 002 traceability test file | May be edited, only as NFR-19 requires; every other 001/002 test file and every golden stays untouched. | NFR-22 |
| 001 NFR-1, NFR-6 and 002 NFR-12 (purity, language) | Extended to the new checks and functions. | NFR-15, NFR-18 |

## Users
- **Developer** of the builder (003b), the viewer (004) and later components: needs an id image contract that can be sampled without ambiguity, names to show while debugging, and checks that reject a broken package.
- **Spectator / predictor** (indirect): needs recognisable factions and territories, and a map whose adjacency matches what is drawn.

## User stories
- US-2. As a developer, I want names and preferred colours in a separate, validated artifact so that the map and sim contracts stay unchanged.
- US-3. As a developer, I want adjacency to be defined by the same id image the viewer draws so that territories sharing a pixel edge are adjacent in the game and territories that share no pixel edge are not; territories touching only at a corner are drawn touching but are never linked.

(US-1, US-4 and US-5 are in 003b.)

## Definitions
- **Map**: the territory list of specs 001/002 (entries, owners, neighbors, `kind`), unchanged.
- **Map package**: a map plus its id image and its presentation data. The three always travel together.
- **Object** (in presentation data): a non-null value of object type that is not a list (array). A list is never an object, as for the map in 001.
- **Id image**: a raster image of width W and height H in which each pixel holds either the id of one map entry (land territory or sea zone) or 0.
- **Pixel values**: the decoded id image given to the checks and functions of this spec: a list (plain array) or a typed array of W × H numbers in row-major order.
- **Pixel coordinates**: pixel (x, y) with x from 0 (left, west) to W − 1 and y from 0 (top, north) to H − 1. **Row-major order**: by y, then by x.
- **Background**: pixels with value 0: not part of the map (outside the region, other land, water with no sea zone).
- **4-adjacent pixels**: two pixels sharing an edge ((x, y) with (x ± 1, y) or (x, y ± 1)). Pixels touching only at a corner are not 4-adjacent.
- **Contact** between values A and B (A ≠ B, both non-zero): at least one pair of 4-adjacent pixels whose values are A and B.
- **Piece**: a maximal set of pixels of the same non-zero value connected through 4-adjacent pixels (lesson: a region is a 4-connected piece, not a colour). A map entry may have several pieces (islands, exclaves).
- **Map unit**: one pixel of the id image. Every length or size stored by the map package or by later specs about the map is in map units, never in screen pixels.
- **Presentation data**: the artifact holding the name of every faction and every map entry, and optional preferred colours of factions (FR-84 to FR-90).
- **Faction, faction order, land territory, sea zone, linked**: as in spec 002. "Faction order" without a round means faction order at round 0.
- **Pending ids**: requirement ids of 003b that the traceability check does not yet require while 003a is implemented (NFR-19).

## Functional requirements

### Map package
- FR-82: THE SYSTEM SHALL define a map package as three artifacts: a map in the format of specs 001/002, unchanged; an id image (FR-106 to FR-108; its file format is 003b FR-105); and presentation data (FR-84 to FR-90). Map validation (001/002) SHALL be applied to the map unchanged, and neither new artifact SHALL add a field to the map, to the match state or to the round record. "Three artifacts" is a definition and is not tested on its own; this requirement is verified by a test on a valid package fixture (map, presentation data, pixel values) asserting that map validation, the presentation check (FR-91) and the id image check (FR-109) each return no error and leave their inputs deep-equal to copies taken before, and that the same map with a `name` or `color` field on an entry still fails map validation with `unknown-field` (001 FR-4, FR-19).
- FR-83: THE SYSTEM SHALL keep every artifact of a map package independent of any match: no seed, round, match state or round record appears in it, and the same package serves every match played on the map. Verified by a test that presentation data with a top-level `seed` and `round` field yields one `presentation-unknown-field` for each, that a map with a top-level `round` field fails map validation with `unknown-field`, and that the presentation check and the id image check, which take no seed or round parameter, return equal results when called twice on the same inputs.

### Presentation data format
- FR-84: THE SYSTEM SHALL define presentation data as an object (Definitions) with exactly two fields, `factions` and `territories`, each a list of objects.
- FR-85: THE SYSTEM SHALL define a faction entry as an object with the fields `id` (a faction id, valid per 001 FR-3), `name` (FR-87) and, optionally, `color` (FR-88).
- FR-86: THE SYSTEM SHALL define a territory entry as an object with exactly the fields `id` (the territory id of a map entry of any kind, land or sea, valid per 001 FR-3) and `name` (FR-87); a territory entry has no `color`.
- FR-87: THE SYSTEM SHALL accept as a valid name only a value of text type that meets all of:
  1. it is well-formed text (no unpaired surrogate code unit);
  2. it has 1 to 80 Unicode code points;
  3. it is equal to its Unicode NFC normalization;
  4. it has no leading or trailing Unicode White_Space character;
  5. it contains no character of general category Cc (the C0 and C1 controls U+0000 to U+001F and U+007F to U+009F, which include tab, line feed, carriage return, vertical tab, form feed and next line U+0085), Cf (format, e.g. zero-width joiner, soft hyphen, byte order mark, bidirectional controls), Cs (surrogate) or Co (private use);
  6. it contains, anywhere, neither U+2028 LINE SEPARATOR nor U+2029 PARAGRAPH SEPARATOR (these line breaks are categories Zl and Zp, not Cc, so rule 5 does not cover them);
  7. it contains no noncharacter: U+FDD0 to U+FDEF and the last two code points of every plane (U+FFFE, U+FFFF, U+1FFFE, U+1FFFF, … U+10FFFE, U+10FFFF), 66 code points in total.

  Inner White_Space, including repeated inner spaces, is allowed. Unassigned code points (Cn) other than the noncharacters of rule 7 are not rejected. Character properties and NFC are those of the runtime's built-in Unicode data, which SHALL be Unicode 15.1 or later; a test SHALL verify this on the running runtime by asserting that U+2FFC (first assigned in Unicode 15.1) is not of category Cn, so the result is the same on every supported runtime for names made only of characters assigned in Unicode 15.1. A check never normalizes, trims or otherwise changes a name (FR-104). (Informative: the obligation of the 003b builder to fail rather than repair names is 003b FR-121.)
- FR-88: THE SYSTEM SHALL accept as a valid colour only a value of text type of exactly 7 characters: `#` followed by 6 lowercase hexadecimal digits (`0`-`9`, `a`-`f`), meaning red, green and blue in 8 bits each, in the sRGB colour space. An absent `color` field means "no preferred colour"; a present field with any other value (including null, uppercase digits, 3-digit forms and colour names) is invalid.
- FR-89: THE SYSTEM SHALL determine field presence in presentation data by own-property presence, as 001/002 do for the map (inherited properties are ignored), and SHALL allow no field other than those of FR-84 to FR-86: in particular no label anchor, position, size, geometry, translation or version field.
- FR-90: THE SYSTEM SHALL require presentation data to hold exactly one faction entry for every faction of the map and exactly one territory entry for every map entry (land territories and sea zones), and no entry for anything else. The order of the lists carries no meaning for validation.

### Presentation validation
- FR-91: THE SYSTEM SHALL provide a presentation check that takes a map and presentation data; IF the map fails map validation (001/002), THEN it SHALL return exactly the map validation errors and run no presentation check; otherwise it SHALL return the presentation errors of FR-92.
- FR-92: THE SYSTEM SHALL report presentation errors as structured data with the following kinds, phases and data fields; the kind names and data field names are normative identifiers, in English with US spelling (`color`, never `colour`). "List" (`list`) is the text `factions` or `territories`; positions are 0-based list indexes.

  | Kind (`kind`) | Phase | Data fields |
  |---|---|---|
  | `invalid-presentation` | structural, blocking | none |
  | `invalid-presentation-list` | structural, blocking | `list` |
  | `invalid-presentation-entry` | structural, blocking | `list`, `position` |
  | `invalid-presentation-id` | structural, blocking | `list`, `position` |
  | `duplicate-presentation-id` | structural, blocking | `list`, `id`, `positions` (ascending) |
  | `invalid-name` | structural, non-blocking | `list`, `position`, `id` if valid |
  | `invalid-color` | structural, non-blocking | `list` (always `factions`), `position`, `id` if valid |
  | `presentation-unknown-field` | structural, non-blocking | `location`, `field` |
  | `unknown-presentation-id` | relational | `list`, `id` |
  | `missing-presentation` | relational | `list`, `id` |
  | `duplicate-faction-name` | relational | `name`, `factions` (faction ids, faction order) |
  | `duplicate-color` | relational | `color`, `factions` (faction ids, faction order) |

  `location` names either the top level (`at`: `presentation`) or an entry (`at`: `entry`, with `list`, `position` and `id` if valid). "`id` if valid" means, as in 001/002, that the field `id` is present only when the entry is an object with an own `id` field holding a valid id (001 FR-3); otherwise it is omitted (not present with an empty value) and the error carries the list and position only.

- FR-93: WHEN presentation data is checked against a valid map, THE SYSTEM SHALL first run every structural check and report every violation; IF any blocking error is found, THEN it SHALL skip the relational checks; otherwise it SHALL run every relational check and report its violations together with the structural ones.
- FR-94: THE SYSTEM SHALL order presentation errors first by kind in the order of the table of FR-92; then errors naming the top level first, then `factions` before `territories`; then: for `duplicate-presentation-id`, by the first (lowest) position at which the duplicated id appears in the list; for every other structural kind and for `unknown-presentation-id`, by position in the list; for `missing-presentation`, by faction order (factions) or map order (territories); for `duplicate-faction-name` and `duplicate-color`, by faction order of the first faction named; `presentation-unknown-field` errors of the same location by field name in code-unit order.
- FR-95: IF the presentation data is not an object (Definitions; in particular null, a list or a primitive), THEN THE SYSTEM SHALL report `invalid-presentation` and no other error; IF `factions` or `territories` is missing or not a list, THEN it SHALL report one `invalid-presentation-list` naming that list.
- FR-96: IF a list element is not an object (Definitions; a nested list included), THEN THE SYSTEM SHALL report `invalid-presentation-entry`; IF an entry's `id` is missing or not a valid id (001 FR-3), `invalid-presentation-id`; IF two or more entries of the same list share a valid id, one `duplicate-presentation-id` per repeated id. Faction ids and territory ids are separate namespaces (001 FR-8): equal ids in different lists are not duplicates.
- FR-97: IF an entry's `name` is missing or not valid (FR-87), THEN THE SYSTEM SHALL report `invalid-name` for that entry.
- FR-98: IF a faction entry has an own `color` field whose value is not valid (FR-88), THEN THE SYSTEM SHALL report `invalid-color` for that entry.
- FR-99: IF the presentation object or any entry has a field not defined by FR-84 to FR-86 (including `color` on a territory entry), THEN THE SYSTEM SHALL report one `presentation-unknown-field` per such field, without ignoring or removing it.
- FR-100: IF a faction entry's id is not a faction of the map, or a territory entry's id is not the id of a map entry, THEN THE SYSTEM SHALL report `unknown-presentation-id` naming the list and id.
- FR-101: IF a faction of the map has no faction entry, or a map entry (land or sea) has no territory entry, THEN THE SYSTEM SHALL report `missing-presentation` naming the list and id.
- FR-102: IF two or more faction entries whose ids are factions of the map have equal valid names (exact code-point comparison), THEN THE SYSTEM SHALL report one `duplicate-faction-name` per repeated name, listing those faction ids in faction order. Faction entries whose id is not a faction of the map (already `unknown-presentation-id`) or whose name is invalid (already `invalid-name`) take no part. Territory names may repeat, and a faction name may equal a territory name (no error).
- FR-103: IF two or more faction entries whose ids are factions of the map have equal valid colours, THEN THE SYSTEM SHALL report one `duplicate-color` per repeated colour, listing those faction ids in faction order. Faction entries whose id is not a faction of the map, whose colour is invalid or who have no `color` take no part.
- FR-104: THE SYSTEM SHALL never modify or auto-correct the map, the presentation data or the id image during any check or function of this spec; checks only report.

### Id image contract
(FR-105, the PNG file format of the id image, is in 003b.)
- FR-106: THE SYSTEM SHALL encode each pixel's value as R × 65,536 + G × 256 + B, where R, G and B are the pixel's three 8-bit channels, 0 means background (not part of the map) and any other value is the id of a map entry; sea zones are encoded like land territories, by their ordinary id. THE SYSTEM SHALL provide, as contract surface reused by 003b (PNG reading and writing) and 004, two pure functions: **encode**, from a value 0 to 16,777,215 to its channels (R, G, B), and **decode**, from three channels, each an integer 0 to 255, to the value; decode(encode(v)) = v for every such v, and encode(decode(R, G, B)) = (R, G, B) for every such triple. Verified at least on these pairs: 0 ↔ (0, 0, 0), 1 ↔ (0, 0, 1), 255 ↔ (0, 0, 255), 256 ↔ (0, 1, 0), 65,535 ↔ (0, 255, 255), 65,536 ↔ (1, 0, 0), 16,777,215 ↔ (255, 255, 255). Outside these domains (a value that is not an integer from 0 to 16,777,215, −0, a channel that is not an integer from 0 to 255, or a channel that is −0) each function reports `invalid-image` (or an equivalent structured error) and returns no result; it never clamps or wraps.
- FR-107: THE SYSTEM SHALL require every non-zero pixel value to be the id of a map entry, and every map entry (land and sea) to have at least one pixel.
- FR-108: THE SYSTEM SHALL require that two distinct map entries are linked in the map (mutual neighbors) if and only if they have contact in the id image (Definitions): adjacency is exactly 4-connected pixel contact. Corner-only touching and touching through background pixels never create a link, a single pair of 4-adjacent pixels does, and a link written in the map without contact is not allowed (`extra-adjacency`, FR-110). Straits are therefore represented in the image, never by hand-written links: either through sea zones (002), where land entries on both shores touch the same sea zone, or by painting a bridge of land-entry pixels across the strait, which creates contact. THE SYSTEM SHALL provide, as contract surface reused by the id image check and by the 003b builder (FR-118), a pure **contact function** that takes W, H and pixel values (Definitions) and returns the set of unordered pairs {A, B} of distinct non-zero values that have contact; it needs no map. On input that meets the `invalid-image` condition of FR-110 it reports `invalid-image` and returns no result.
- FR-109: THE SYSTEM SHALL provide an id image check that takes a map, a width W, a height H and pixel values (Definitions); IF the map fails map validation, THEN it SHALL return exactly the map validation errors; otherwise it SHALL return the errors of FR-110. The check works on decoded values and does not read or decode files. It sets no performance requirement (the time limit at real scale is 003b NFR-16).
- FR-110: THE SYSTEM SHALL report id image errors as structured data, ordered by kind in the order of this table and then as stated per kind; kind and data field names are normative identifiers:

  | Kind (`kind`) | Blocking | Data fields | Condition and order |
  |---|---|---|---|
  | `invalid-image` | yes | none | W or H is not of number type or not an integer ≥ 1; the pixel values are neither a list (plain array) nor a typed array; the number of values is not W × H; or any value is not of number type (e.g. text, null, a BigInt, or a missing element of a sparse list), is not an integer (NaN, infinities, fractions), is negative zero, or is outside 0 to 16,777,215. Consistent with 001 FR-3 except that 0 is allowed (background). Reported alone. |
  | `unknown-pixel-id` | no | `id`, `pixelCount`, `firstPixel` (`x`, `y`) | A non-zero value that is not a map entry id; one error per such value, ordered by first pixel in row-major order. |
  | `missing-territory-pixels` | no | `territory` | A map entry with no pixel; map order. |
  | `missing-adjacency` | no | `a`, `b` | Entries `a` and `b` have contact but are not linked; `a` before `b` in map order; ordered by the map position of `a`, then the map position of `b` (as 001/002 order by map position, not by id value). |
  | `extra-adjacency` | no | `a`, `b` | Entries `a` and `b` are linked but have no contact; same order. |

  Contact for `missing-adjacency` and `extra-adjacency` is the contact function of FR-108 restricted to pairs whose values are both map entry ids: a pixel holding an unknown id (reported once as `unknown-pixel-id`) creates no contact and yields no adjacency error, exactly like background. A map entry with no pixel has no contact, so it yields `missing-territory-pixels` and, in addition, one `extra-adjacency` for each of its links.

## Non-functional requirements
- NFR-15 (Shared purity): the presentation check, the id image check, the encode/decode functions (FR-106), the contact function (FR-108) and any helper they use meet 001 NFR-1 (no I/O, DOM, clock or system randomness). Verified by the existing source scan, whose scanned set already includes their sources (the 001/002 purity test file is not edited), and by a run-time test in a new test file that calls all of them on valid and invalid inputs while the clock and system randomness are replaced by functions that throw.
- NFR-18 (Language): all new error kinds and data field names are English and are listed in the literal lists of a new language test that applies the rule of 001 NFR-6 and 002 NFR-12 to them (the 001/002 language test file is not edited). Confirmed interpretation of constitution rule 6 (user decision): names in the presentation data (Spanish today) are map data, not UI strings; they are not moved to, and do not affect, the UI strings module. 003b applies the same rule to its own outputs (cross-reference there).
- NFR-19 (Traceability, refines 002 NFR-13): the traceability check expects every id from FR-1 to FR-131 and NFR-1 to NFR-23, except the retired FR-6 and FR-25, in at least one test title, and still rejects retired ids; its expected list ends at FR-131 and NFR-23. Until 003b removes it (003b "NFR-19 completion", which also extends the scanned sources to the builder's tests), the check SHALL exempt exactly the pending ids of 003b (FR-105, FR-111 to FR-131, NFR-14, NFR-16, NFR-17, NFR-20, NFR-21, NFR-23), pinned by a test that asserts this exact set; every other id is required. The NFR-19 trace is carried by the 002 traceability test file (which does not scan itself): its tests on the expected list and on the pending set name NFR-19 in their titles, and its pinned self-trace set SHALL be exactly FR-55, FR-56, NFR-13 and NFR-19, asserted by a test of exactly that set. Titles of meta-tests that plant ids in synthetic sources name no real id.
- NFR-22 (No regression): the 001 and 002 tests pass and keep the meaning of their assertions; the golden files are byte-identical (not regenerated); every 001/002 test file other than the 002 traceability test file is unchanged. The 002 traceability test file MAY be edited only as NFR-19 requires (expected range constant, pending set and its pin, self-trace pin, NFR-19 tests). Map validation, the sim interface, `MatchState` and `RoundRecord` are unchanged. 003b must keep this true (cross-reference there).

## Contract for later specs (informative here)
These points carry no id in this spec and are neither implemented nor traced here. Specs 004 and 005 must adopt them as their own numbered requirements, traced by their own tests; changing them requires changing this section first.
- **Colours (spec 004).** A faction's preferred colour, when given, is used as given. Factions without one get a colour computed only from the map and the presentation data (never from seed, round or time), the same on every run, such that no two factions that are direct candidates of each other at round 0 (land neighbours or sharing a sea zone, 002 Definitions) have the same colour. How colours behave after absorptions, the palette, and how sea and background are drawn are decided in spec 004.
- **Id image sampling (spec 004).** The viewer reads id values exactly (no filtering, mipmaps, colour conversion or premultiplied alpha), decodes them with the decode function of FR-106 and treats 0 as outside the map.
- **Labels (spec 005).** Label placement is computed in the browser from the id image; the map package stores no label anchors or geometry. Any label size ever stored is in map units (Definitions), never in screen pixels.
- **Builder libraries (spec 004).** The viewer neither depends on nor ships the libraries approved for the 003b builder unless a later spec says so (003b NFR-20).

## Edge cases
- A faction entry whose id is not the owner of any land territory of the map is `unknown-presentation-id`, even if that id equals a territory id (separate namespaces).
- Presentation data with a territory entry for a sea zone: required (FR-90); missing it is `missing-presentation`.
- Presentation data that is a list (`[]`), null or a number: only `invalid-presentation` (FR-95). `factions` given as an object instead of a list: `invalid-presentation-list`. A list element that is a list: `invalid-presentation-entry` (FR-96).
- `color: null`, `"#FFFFFF"`, `"#fff"`, `"red"`: `invalid-color`. No `color` field: valid, no preference.
- `color` on a territory entry: `presentation-unknown-field`.
- A `color` or `name` inherited from the prototype (not own): treated as absent (FR-89).
- Name `""`, `" España"`, `"España\n"`, an 81-code-point name, a decomposed (non-NFC) `"España"`, a name containing U+0085 (next line), U+2028 or U+2029 in the middle, U+200D (zero-width joiner), U+00AD (soft hyphen), U+FEFF, U+E000 (private use), U+FDD0, U+FFFE, U+FFFF, U+10FFFF or an unpaired surrogate: `invalid-name`. A name with an 80-code-point astral string (160 code units): valid. `"Castilla  y León"` (two inner spaces): valid. Names "España" and "españa": not duplicates (exact comparison).
- A faction named "Portugal" and a territory named "Portugal": valid (FR-102).
- An `invalid-name` or `invalid-color` entry whose `id` is missing or invalid: the error carries list and position only (no `id` field), alongside `invalid-presentation-id`.
- Ids 7 at positions 4 and 1 and id 3 at positions 2 and 5 of `factions`: `duplicate-presentation-id` for 7 (first position 1) before the one for 3 (first position 2) (FR-94).
- Two faction entries with the same name where one id is not a faction of the map: `unknown-presentation-id` for that one, no `duplicate-faction-name` (FR-102). Same rule for colours (FR-103).
- Two factions with the same preferred colour: `duplicate-color`, even if they are far apart on the map.
- Presentation data not an object, plus an invalid map: only the map errors (FR-91).
- Duplicate ids in `factions` and an unknown id in `territories`: only structural errors, because `duplicate-presentation-id` is blocking (FR-93).
- Id image with W × H different from the number of values: only `invalid-image`.
- Id image with a value 16,777,216, −1, 1.5, −0, NaN, `"1"` or a BigInt, with a hole in a sparse list, with W given as `"2"`, or with pixel values given as a plain object: `invalid-image`. Pixel values given as a typed array (e.g. 32-bit unsigned integers) with valid values: accepted like a plain list.
- Values using all three channels (1, 255, 256, 65,535, 65,536, 16,777,215): encode and decode exactly per FR-106.
- Four territories meeting at a quadripoint, drawn as the 2 × 2 image `A B / C D`: A–B, A–C, B–D and C–D have contact; A–D and B–C touch only at a corner, so they have no contact, are drawn touching but are never linked; if the map links A and D, `extra-adjacency` (FR-108).
- Two territories separated by a one-pixel line of background (e.g. an inland gap or lake drawn as background): no contact through it.
- Two land territories on opposite shores of a strait drawn as a sea zone: not linked to each other; each is linked to the sea zone. Linking them directly in the map without a painted land bridge: `extra-adjacency` (FR-108).
- Two territories touching through a single pair of 4-adjacent pixels (rasterization artefact): contact, so they must be linked (FR-108). This is accepted; the 003b builder derives links from contact (003b FR-118), so its maps always agree with their images.
- An unknown id U touching entries A and B: one `unknown-pixel-id` for U; no adjacency error involves U, and A and B are compared only by their own contact. The contact function itself still returns pairs with U (it needs no map).
- A linked entry with no pixel: `missing-territory-pixels` plus one `extra-adjacency` per link.
- A map entry with several pieces (island territory, exclave): valid; its contacts are the union over all its pieces.
- An id image valid against one map and checked against another map with the same ids but different links: `missing-adjacency` / `extra-adjacency` as applicable.

## Out of scope
- The id image file format and any file reading, writing, encoding or decoding (003b FR-105, FR-122, FR-125).
- The builder, the extraction step, source data and the dev map (003b).
- Any performance requirement on the checks or functions of this spec (the real-scale limit is 003b NFR-16).
- All rendering: viewer, camera, colours on screen, borders, labels, transitions (specs 004, 005).
- Translations of names (one name per entry, in Spanish); i18n of map data.
- Label anchors, label geometry or sizes, territory centroids, border geometry or any vector geometry in the package.
- Weighting the game by area, border length or pixel count.
- A minimum contact length for adjacency (one pixel pair is enough, FR-108).
- Hand-written links without pixel contact (FR-108).
- Changes to the map format, map validation, `MatchState`, `RoundRecord` or the sim.
- Any new dependency.
- Server, Discord bot, predictions.

## Done criteria
- Every id of this spec (FR-82 to FR-104, FR-106 to FR-110, NFR-15, NFR-18, NFR-19, NFR-22) has at least one automated test referencing it in its title.
- The traceability check follows NFR-19: it expects FR-1..FR-131 and NFR-1..NFR-23 minus FR-6/FR-25 minus the pending ids, and the pending set equals exactly the 003b ids (FR-105, FR-111 to FR-131, NFR-14, NFR-16, NFR-17, NFR-20, NFR-21, NFR-23), which stay pending at the end of 003a. A test asserts that the pinned self-trace set equals exactly FR-55, FR-56, NFR-13 and NFR-19.
- Presentation check tests cover each error kind individually with its exact data field names, a presentation with every structural kind except `invalid-presentation` at once (which FR-95 reports alone, tested separately) and one with every relational kind at once (exact list and order, FR-92 to FR-94, including the first-position order of `duplicate-presentation-id`), lists and nested lists treated as non-objects, "`id` if valid" data, the participation rules of FR-102 and FR-103, a faction name equal to a territory name, the blocking rule, an invalid map (map errors only), own-property presence, every edge case listed for names and colours, and the runtime Unicode 15.1 check of FR-87.
- FR-82 and FR-83 tests as stated in those requirements.
- Encode/decode tests cover every pair listed in FR-106 and both round-trip properties; contact function tests cover the quadripoint `A B / C D`, touching through background, a single-pixel contact, several pieces, and plain-list and typed-array input.
- Id image check tests cover each error kind with its exact data field names, an invalid map, every `invalid-image` input listed in the edge cases, corner-only touching, touching through background, a strait drawn as a sea zone, a single-pixel contact, a map entry with several pieces, an unknown id touching map entries, and a linked entry with no pixel.
- The new checks and functions pass the source scan and the run-time purity test with throwing clock and randomness (NFR-15), and the new language test includes every new kind and data field name (NFR-18); 001/002 tests and goldens pass as NFR-22 states, with only the 002 traceability test file edited.
- No dependency added; type check and test suite pass locally and in CI on the merged pull request; `MEMORY.md` updated.

## Open questions
- None open. Q1 (behaviour of encode, decode and the contact function outside their domain) was resolved by the user: each reports `invalid-image` (or an equivalent structured error) and returns no result, never clamping or wrapping (FR-106, FR-108). The error data field names chosen in FR-92 and FR-110 were reviewed and accepted by the user.

- Resolved by the user: map format and sim contract unchanged; names and preferred colours in a separate presentation artifact cross-checked by a new pure check; colours optional, otherwise assigned deterministically by the viewer so neighbouring factions differ (contract only); no label anchors or geometry stored; label sizes, if ever stored, in map units; split into 003a/003b (option A). Traceability ends at FR-131 and NFR-23 (no FR-132 to FR-134, NFR-24 or NFR-25). NFR-22 means assertions keep their meaning; only the 002 traceability test file may be edited (NFR-19). Self-trace pin exactly FR-55, FR-56, NFR-13, NFR-19. Encode/decode and contact derivation are contract functions (FR-106, FR-108). Pixel values as plain or typed arrays; non-number, non-integer and −0 values are `invalid-image`; no performance requirement here. Adjacency is exactly 4-connected contact; no hand-written links; straits via sea zones or painted bridges. Names reject U+2028/U+2029 and noncharacters; inner repeated spaces allowed. Spanish names are map data, not UI strings (NFR-18).
- Resolved by default with the spec: field names `factions`, `territories`, `id`, `name`, `color` (US spelling, like `neighbors`); colours as `#rrggbb` lowercase; names 1-80 code points, NFC, trimmed, no control characters; faction names unique, territory names may repeat and may equal a faction name; preferred colours unique; one Spanish name per entry (no translations); lists are never objects. Resolved in clarification (technical): names also exclude Cf, Cs and Co characters and are never repaired by checks (FR-87) or by the builder (003b FR-121); duplicate name/colour checks consider only entries whose id is a faction of the map (FR-102, FR-103); unknown pixel ids create no contact (FR-110); "Contract for later specs" is informative and adopted by 004/005 with their own ids.
