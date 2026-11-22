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
- Node 24 `TextDecoder('windows-1252')` decodes 0x80..0x9F as ISO-8859-1 (e.g. 0x80 -> U+0080, not the euro sign): use an explicit Windows-1252 table when decoding DBF text.
- Importer units form by `columns.key` before `select` filters run: multi-period / date-ranged sources need a per-period unique key (never a country code shared across periods) or `conflicting-unit-property` fires regardless of the filter.
- Equal Earth antimeridian rings: wrap longitudes per view as `lon - lon0` into `(-180, 180]`, place vertices sitting exactly on the view's antimeridian (`±180`) on the ring's own side for both framing and rasterization (avoiding full-width stripes), and centre insets that straddle the antimeridian on the narrower arc.
- Adjacent polygons that share a border must share the same vertices on both sides; a long chord against sub-chords produces 1-pixel water notches at ulp level.
- Sea assignment with zero source pixels must short-circuit after reachability and `gapFill` (otherwise the nearest-zone search scans the whole raster per pixel).
