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
