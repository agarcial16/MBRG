# World map data (maps/world-countries)

Source data and builder inputs for the predefined world map: every sovereign country as one faction
and one land territory, plus a handful of ocean zones at world scale.

## Faction set (the membership rule)

193 factions, one per sovereign country. The rule: **the 193 UN member states plus the two UN
observer states (the Holy See and the State of Palestine) plus Taiwan and Kosovo** — 197 countries in
the source data. Natural Earth 5.1.1 admin-0 encodes that set with two quirks worth stating: it types
Israel (a UN member) as `Disputed` and China, France, the USA and six other multi-unit states as
`Country`, so its own `TYPE` field cannot be the rule; the 197 above is. Two features Natural Earth
types `Sovereign country` are NOT in the set and stay background land: **Somaliland** and
**Northern Cyprus** (not in the standard sovereign set; both documented here). Antarctica, Greenland
and the other dependencies are background land too.

## Licence and source

Natural Earth cultural vectors, version **5.1.1** (`natural-earth/source-meta.json`). The data is
public domain; credit as "Made with Natural Earth" — no permission is needed to use, copy or modify
it. Two scales are used:

- **`ne_10m_admin_1_states_provinces`** — required input of the repo's extract command (the command
  always reads it); its output for this map is discarded. Same ZIP, version and SHA-256 as the dev
  map subset: see `../natural-earth/PROVENANCE.md`.
- **`ne_50m_admin_0_countries`** — the map's geometry and names. Downloaded (2026-11-21) from
  Natural Earth's S3 bucket, `https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip`
  (Last-Modified `Fri, 13 May 2022 05:41:42 GMT`, 799,734 bytes, SHA-256
  `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139`, `VERSION.txt` reads `5.1.1`,
  the same release train as the 1:10m ZIPs). The 1:50m scale is Natural Earth's own choice for a
  whole-world map at this width, and the only scale whose committed subset fits the repo's 10 MB
  convention: at 1:10m the 197 country outlines alone are ~42 MB in the builder's fixed JSON format.
  The extract command hardcodes the 1:10m file names, so the 1:50m `.shp`/`.dbf`/`.VERSION.txt`
  were provided to it under those fixed names (a staging directory; the files themselves are
  unmodified and never committed).

## How this subset was produced (offline, data preparation)

Step 1, the repo's own extraction command, run twice into scratch directories (a world box:
lon -180..180, lat -90..90, kept as `dev-map/extraction-box.json`):

```
npm run extract -w @mbrg/build-map -- --ne <staged directory> --data=<scratch>/a-selected
# grouping: the 197 countries above; -> country records with name/name_es + 45 background features
npm run extract -w @mbrg/build-map -- --ne <staged directory> --data=<scratch>/b-geometry
# grouping: empty; -> the geometry of all 242 admin-0 features (whole, 5-decimal coordinates)
```

Step 2, post-processing (one-off, documented here because the builder is not extended):
- `provinces.json`: the 197 country features, each with `adm1_code` set to its own country code and
  `adm0_a3` set to that same code — the data-only rewrite that makes each country one "province"
  (the mirror image of what the Spain map did per province). Geometry is verbatim from the second
  extraction; `name`/`name_es` are grafted from the first (Natural Earth carries full official
  Spanish names, so no name surgery was needed).
- `countries.json`: the 193 faction records of the first extraction, nothing else.
- `other-land.json`: the 45 background features of the first extraction plus Nauru and Tuvalu (see
  below), sorted by `adm0_a3`, geometry verbatim.
- `dev-map/grouping.json`: 193 countries, one territory per country (key = the lower-case code),
  `excluded: []`.

## The micro-country decisions (measured, then decided per case)

The build width resolves ~6.4 km per pixel (1 px ~ 41 km², equal-area). Rasterizing every feature
alone at that width gives, among others: Maldives 1 px, San Marino 2, Liechtenstein 4, Seychelles 4,
Malta 6, Palau 8, Tonga 9, Singapore 10 — all kept; a pixel is a pixel and the map does not invent
or take any away (`minPieceSize` = 1, so the cleanup removes nothing). Four countries rasterize to
nothing:

| Country | Decision | Why |
|---|---|---|
| Vatican (VAT, 0.44 km²) | merged into Italy's territory | 0 px; landlocked enclave inside Italy; its `adm0_a3` is rewritten to `ITA` and it is a second province of the territory Italia |
| Monaco (MCO, 2 km²) | merged into France's territory | 0 px; landlocked enclave inside France; same mechanism, second province of Francia |
| Nauru (NRU, 21 km²) | omitted to background land | 0 px; an island with no adjacent country to merge into honestly |
| Tuvalu (TUV, atolls) | omitted to background land | 0 px; every islet is far below one pixel; no adjacent country |

Nauru and Tuvalu stay in `other-land.json` (background, id 0): at this scale that is what they are.

## Parameters and choices

- `params.json`: width 4096, margin 2%, S = 1. The whole-planet frame needs the width: at 2048 the
  image is ~12.9 km/px and half the island nations of the Pacific lose their last pixel; 4096
  (~6.4 km/px) keeps every country that Natural Earth 1:50m resolves. S = 1 because no piece may be
  removed: the smallest countries are 1-2 px pieces of themselves.
- The projection is the builder's own (Lambert azimuthal equal-area). At world scale it renders the
  whole planet as a disk that fits the square frame with ~2% margin (the frame corners, outside the
  sphere, are sea): no broken poles, no wrapped longitudes, every country whole — the equal-area
  property keeps relative country sizes true, and the angular distortion concentrates in the
  mid-Pacific rim where the least land sits (New Zealand and Hawaii are thin but present). The
  build and its self-check pass with this projection; nothing else was needed.
- `sea-seeds.json`: 7 seeds — Océano Pacífico, Océano Atlántico Norte, Océano Atlántico Sur,
  Océano Índico, Océano Ártico, Océano Antártico, Mar Mediterráneo. Two Atlantic seeds are needed:
  with one, the Mediterranean seed (which exits Gibraltar in fewer BFS steps) claims the whole North
  Atlantic; Norte and Sur keep each ocean body with its own zone. The Mediterranean keeps its own
  basin (the seed sits south of Sicily); water no seed reaches (the Black Sea behind the closed
  Bosphorus, the Caspian, small lakes-as-holes) joins the nearest zone by the builder's
  enclosed-water rule, as on the dev map. 193 factions + 7 sea zones: the package stays under every
  viewer limit (193 < the 255-entry colour table, ids.png well under 2 MB).

## Rebuild

```
npx tsx tools/build-map/src/cli/build.ts --data=tools/build-map/data/world-countries --out=maps/world-countries
```

(or `npm run build-map -w @mbrg/build-map -- -- --data=... --out=...`). The committed package must
stay byte-identical; the rebuild test in `tools/build-map/test/world-map.test.ts` proves it.
