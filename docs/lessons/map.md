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
- A whole-planet frame in the builder's own LAEA is a disk that fits the square (side ~4.16 with 2% margin): no projection change is needed for a world map; the square corners fall outside the sphere and become sea.
- Natural Earth 5.1.1 membership fields cannot be a rule by themselves (Israel is typed `Disputed`, China/France/USA are `Country` with `SOV_A3` like `US1`): state the rule explicitly (the world map uses 193 UN members + the two observers + Taiwan + Kosovo).
- A whole-world map needs 1:50m admin-0: 1:10m world geometry is ~42 MB in the builder's fixed JSON format (over the 10 MB convention) and its detail is sub-pixel at 6.4 km/px.
- One ocean seed per body does not survive BFS zones at world scale: the Mediterranean seed exits Gibraltar in fewer steps than a mid-Atlantic seed and claims the whole North Atlantic; split the Atlantic into Norte/Sur seeds so each body keeps its zone.
- Micro-countries at world scale: measure pixel counts first (rasterize each feature alone), then merge 0-px landlocked enclaves into the surrounding country (Natural Earth gives that country a polygon hole for them) or omit 0-px islands to background land; never invent pixels.
