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

The build width resolves ~9.2 km per pixel at the equator of the Robinson world (spec 036; it was ~6.4
km per pixel in the Lambert disk before). Rasterizing the final map gives, among the smallest:
Maldives 1 px, San Marino 1, Liechtenstein 1, Grenada 2, Marshall Islands 2, Seychelles 2, St Kitts
and Nevis 3, Malta 3, Palau 3 — all kept; a pixel is a pixel and the map does not invent
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

- `params.json`: width 4352, margin 2%, S = 1, `projection: "robinson"`. The whole-planet frame needs the
  width: at 2048 half the island nations of the Pacific lose their last pixel. Robinson spends fewer
  pixels on land than the Lambert disk (the world is ~2:1 inside a square image, the rest is sea), so
  the width was measured, not inherited: at 4096 the Maldives rasterize to 0 px (a country would
  vanish and the map would break), 4352 keeps all 193 (Maldives, San Marino and Liechtenstein at 1 px).
  The sampling is not monotone in the width (5120 loses the Maldives again): a change of width or margin
  needs this count redone. S = 1 because no piece may be removed.
- The projection is Robinson (spec 036, the builder's `projection: "robinson"`; user feedback on the
  first version: the Lambert disk was "un poco rara para jugarlo en 2d"). Central meridian 0, no
  longitude wrapping (Natural Earth is split at 180), the builder's usual square frame: the world is
  ~1.97:1, so it fills the width and about half of the height, the rest (above the north pole line and
  below Antarctica) is sea. Robinson is neither equal-area nor conformal; sizes are slightly off at
  high latitudes, which is what a flat world map looks like. The first version used Lambert
  azimuthal equal-area (a disk, no wrapped longitudes).
- `sea-seeds.json`: 8 seeds — Océano Pacífico, Océano Atlántico Norte, Océano Atlántico Sur,
  Océano Índico, Océano Ártico, Océano Antártico, Mar Mediterráneo, and (spec 036, last so the other
  sea ids stay put) Océano Pacífico Occidental: a flat map cuts the Pacific at 180 degrees, and without
  a second Pacific seed the western Pacific (Japan, Philippines, Fiji, New Zealand) fell to the Indian
  and Arctic zones. Two Atlantic seeds are needed:
  with one, the Mediterranean seed (which exits Gibraltar in fewer BFS steps) claims the whole North
  Atlantic; Norte and Sur keep each ocean body with its own zone. The Mediterranean keeps its own
  basin (the seed sits south of Sicily); water no seed reaches (the Black Sea behind the closed
  Bosphorus, the Caspian, small lakes-as-holes) joins the nearest zone by the builder's
  enclosed-water rule, as on the dev map. 193 factions + 8 sea zones: the package stays under every
  viewer limit (193 < the 255-entry colour table, ids.png well under 2 MB).

## Rebuild

```
npx tsx tools/build-map/src/cli/build.ts --data=tools/build-map/data/world-countries --out=maps/world-countries
```

(or `npm run build-map -w @mbrg/build-map -- -- --data=... --out=...`). The committed package must
stay byte-identical; the rebuild test in `tools/build-map/test/world-map.test.ts` proves it.

## Spec 036: what changed against the Lambert package (measured 2026-11-24)

Same 193 factions and 193 land territories (ids, owners, order), same 7 original sea ids; the presentation
differs only by the new sea zone 201. Contact adjacency (4-connected pixel contact, FR-108) differs at
the scale of a pixel, listed in full:

- Land pairs removed (1): Azerbaiyán / Turquía (the 9 km Nakhchivan border no longer touches in a pixel).
- Land pairs added (2): Botsuana / Zambia (pixel contact at the Kazungula quadripoint) and Dinamarca / Suecia
  (the Öresund strait is narrower than one pixel).
- Land-sea links: 31 removed, 33 added. Mostly the Pacific split (East Asia, Oceania, the Pacific islands,
  Russia, Canada and the USA link to Océano Pacífico / Océano Pacífico Occidental instead of Índico, Ártico
  and Antártico), plus the Atlántico Norte / Sur border (Guinea, Guyana and Surinam lose Norte; Guinea-Bisáu,
  Guyana and Venezuela gain Sur) and Perú gaining Antártico. Sea-sea links (2 removed, 3 added): Pacífico-Ártico and Índico-Ártico
  removed; Pacífico-Atlántico Norte, Índico-Pacífico Occidental and Ártico-Pacífico Occidental added.
