# Spain map data (maps/spain-provinces)

Source data and builder inputs for the predefined Spain map: 52 provinces as 52 factions
(one faction and one land territory per Spanish admin-1 division, the two autonomous cities
included: 50 provinces + Ceuta + Melilla = Natural Earth's 52 Spanish admin-1 features).

## Licence and source

Natural Earth 1:10m cultural vectors, version **5.1.1** (`natural-earth/source-meta.json`).
The data is public domain; credit as "Made with Natural Earth" — no permission is needed to
use, copy or modify it. The same ZIPs, versions and SHA-256 hashes as the dev map subset:
see `../natural-earth/PROVENANCE.md`. The ZIPs are never committed.

## How this subset was produced (offline, data preparation)

Step 1, the repo's own extraction command (the same as the dev map's, with a Spain-only
grouping and a Spain box, run into a scratch directory, not into this one):

```
npm run extract -w @mbrg/build-map -- --ne <dir with ne_10m_admin_1_states_provinces.{shp,dbf,VERSION.txt}
                                            and ne_10m_admin_0_countries.{shp,dbf,VERSION.txt}>
        --data=<scratch>/spain-extract     # grouping: ESP only; box: see dev-map/extraction-box.json
```

The extraction box (lon -21.6..6.0, lat 25.6..45.65) covers the whole build frame: the
frame's straight projected edges bow relative to the parallels, so the box is the rectangle
of the outermost pixel centres (lon -21.49..5.79, lat 25.70..45.59) rounded outward. Unlike
the dev map's box, it reaches the Western Sahara coast, so the per-polygon admin-0 selection
keeps
`SAH` (Western Sahara) and `MRT` (Mauritania) — without them, the Saharan corner of the frame
rasterized as a phantom 17,466-px sea pocket joined to Mar de Canarias. Other land kept:
AND, DZA, FRA, GIB, MAR, MRT, PRT, SAH. The extracted 52 ESP province features are
byte-identical to the committed dev-map subset's ESP features (the same source, the same
extraction), so the dev map's Spain geometry is reused, not re-derived.

Step 2, post-processing (one-off, documented here because the builder is not extended):
- `provinces.json`: each feature's `adm0_a3` is rewritten to its own `adm1_code`. The builder
  makes one faction per selected country, so this data-only rewrite makes each province its
  own "country" and yields 52 factions. Nothing else is changed (geometry, `name` and
  `name_es` stay verbatim). Do not re-run `extract` into this directory: it would write
  `adm0_a3: "ESP"` (one faction) and lose the rewrite.
- `countries.json`: one synthetic country record per province, `name`/`name_es` the display
  name. Where Natural Earth 5.1.1 carries pre-2011 Spanish spellings, the current official
  form is used instead: Gerona→Girona, Lérida→Lleida, La Coruña→A Coruña, Orense→Ourense.
  The territory `name` in the grouping table is the same string, so faction and territory
  names agree.
- `dev-map/grouping.json`: one selected country, one key, one name and one province per
  province; nothing excluded. Keys are ASCII slugs (`es-alava` ... `es-zaragoza`).
- `dev-map/extraction-box.json`: the box of step 1, kept so the frame-coverage test can read it.

The `dev-map` subdirectory name is fixed by the builder CLI (`src/io/read-inputs.ts` reads
`dev-map/*.json` under `--data`); it does not mean this is the dev map. No builder source was
changed for this map.

## Parameters and choices

- `params.json`: width 1536, margin 2%, S = 4. The frame (2,147 km square) holds the peninsula,
  the Balearics and the Canaries in one square (the builder has no inset support; keeping the
  Canaries in-frame was the choice recorded for this map). 1536 px gives 1.40 km/px, close to
  the dev map's 1.22 km/px at 2048. S = 4 instead of the dev map's 40 because Melilla (8 px at
  this width) and Ceuta (21 px) are far below 40 px; with S = 40 they would be absorbed and the
  build would fail with `vanished-entry`. With S = 4 the cleanup still removes 1-3 px noise.
- `sea-seeds.json`: 7 Spanish-named seeds — Mar Cantábrico, Océano Atlántico, Mar de Canarias,
  Golfo de Cádiz, Mar de Alborán, Mar Balear, Mar Mediterráneo (52 land + 7 sea = 59 entries).

## Rebuild

```
npm run build-map -w @mbrg/build-map -- -- --data=tools/build-map/data/spain-provinces --out=maps/spain-provinces
```

(watch the `--`: npm swallows `--data` without it; `npx tsx tools/build-map/src/cli/build.ts
--data=... --out=...` also works). The committed package must stay byte-identical; the rebuild
test in `tools/build-map/test/spain-map.test.ts` proves it.
