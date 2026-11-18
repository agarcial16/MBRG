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
