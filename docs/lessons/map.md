# Lessons: sim, shared, map building
Read before touching `packages/shared`, `packages/sim` or `tools/build-map`.

- Read `kind`/`owner` from `unknown` input with the own-property rule everywhere (validation and sim).
- Sea is explicit; never infer "dark = border". Spec the label layout before coding it.
- Avoid the word "transition" as a whole word in core files (a scan forbids it): use "step".
- Test fixtures must mimic real file quirks (NUL-padded DBF); run real data early. Tiny ASCII tests hid real bugs: test at real scale.
- A fixture built for a tunable value (e.g. `offLandHeight`) uses a literal, not the constant.
- Perf: profile the candidate COUNT, not the per-test cost.
- Render tests of faction labels need scale <= 1.5 (alpha is 0 from scale 2).
- Portugal has no label arc: known limit.
- One faction per selected country: a per-province map needs each province's `adm0_a3` rewritten to its own `adm1_code` in the data (no builder change). The committed dev-map subset is only valid inside the dev extraction box: a new frame reaching the Western Sahara needs its own extraction (without `SAH`/`MRT` a 17k-px phantom sea appears there).
- A straight frame edge in LAEA bows relative to the parallels: compute an extraction box from ALL outermost pixel centres (up to 0.6 degrees above the corners), never from the four corners.
- Tiny factions can vanish under the dev map's S = 40 (Melilla is 8 px at 1536): set `minPieceSize` per map from measured pixel counts before authoring seeds.
- `npm run` swallows `--data`-style flags without a doubled `--`; run CLIs via `npx tsx <file>` to be safe.
- A whole-planet frame in the builder's own LAEA is a disk that fits the square (side ~4.16 with 2% margin): no projection change is needed for a world map; the square corners fall outside the sphere and become sea.
- Natural Earth 5.1.1 membership fields cannot be a rule by themselves (Israel is typed `Disputed`, China/France/USA are `Country` with `SOV_A3` like `US1`): state the rule explicitly (the world map uses 193 UN members + the two observers + Taiwan + Kosovo).
- A whole-world map needs 1:50m admin-0: 1:10m world geometry is ~42 MB in the builder's fixed JSON format (over the 10 MB convention) and its detail is sub-pixel at 6.4 km/px.
- One ocean seed per body does not survive BFS zones at world scale: the Mediterranean seed exits Gibraltar in fewer steps than a mid-Atlantic seed and claims the whole North Atlantic; split the Atlantic into Norte/Sur seeds so each body keeps its zone.
- Micro-countries at world scale: measure pixel counts first (rasterize each feature alone), then merge 0-px landlocked enclaves into the surrounding country (Natural Earth gives that country a polygon hole for them) or omit 0-px islands to background land; never invent pixels.
- Node 24 `TextDecoder('windows-1252')` decodes 0x80..0x9F as ISO-8859-1 (e.g. 0x80 -> U+0080, not the euro sign): use an explicit Windows-1252 table when decoding DBF text.
- Importer units form by `columns.key` before `select` filters run: multi-period / date-ranged sources need a per-period unique key (never a country code shared across periods) or `conflicting-unit-property` fires regardless of the filter.
- Equal Earth antimeridian rings: wrap longitudes per view as `lon - lon0` into `(-180, 180]`, place vertices sitting exactly on the view's antimeridian (`±180`) on the ring's own side for both framing and rasterization (avoiding full-width stripes), and centre insets that straddle the antimeridian on the narrower arc.
- Adjacent polygons that share a border must share the same vertices on both sides; a long chord against sub-chords produces 1-pixel water notches at ulp level.
- Sea assignment with zero source pixels must short-circuit after reachability and `gapFill` (otherwise the nearest-zone search scans the whole raster per pixel).
