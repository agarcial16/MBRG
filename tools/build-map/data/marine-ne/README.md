# Marine areas for sea-tile names (Natural Earth)

`ne_10m_geography_marine_polys.geojson` is the names file of the importer's sea tiling (spec 035,
`params.tiling.names`): named sea, gulf, bay and strait polygons that give the tiles of a map their
real names (for example "mar de Alborán", "Golfo de León", "mar Tirreno").

## Licence and attribution

Natural Earth is **public domain**: "You may use the maps in any manner, including modifying the
content and design, electronic dissemination, and offset printing." No permission is needed and
crediting is not required; the citation Natural Earth suggests is: **Made with Natural Earth. Free
vector and raster map data @ naturalearthdata.com.** (Terms: https://www.naturalearthdata.com/about/terms-of-use/;
the repository's `LICENSE.md` of 2026-11-24 says "Everything here is public domain.") It is a
curation input file, never part of a map package, and never an npm dependency.

## Provenance

- Source: `nvkelso/natural-earth-vector`, `geojson/ne_10m_geography_marine_polys.geojson` (repository
  version `5.2.0-pre` on 2026-11-24), downloaded unchanged.
- 306 features (7 oceans, 71 seas, 60 bays, 61 gulfs, 36 straits and others); 295 have a Spanish name
  (`name_es`); the rest, and the few Spanish names that are English in the source (for example
  "Viscount Melville Sound"), are used as they are: the importer takes the first valid name of
  `["name_es", "name"]`, and a curation may point at an edited copy.
- Size 1,692,635 bytes; SHA-256 `53f865e8ffa966cdd402145c82c5cd14ee7ce974cd0eb9a3f59f03a4cfd2d66c`.
- Coordinates in degrees (CRS84), `Polygon` and `MultiPolygon`; the oceans are cut at the
  antimeridian.

## Use

In a curation file (`params.tiling`), with the path relative to the curation file:

```json
"tiling": { "names": { "file": "tools/build-map/data/marine-ne/ne_10m_geography_marine_polys.geojson", "nameProperty": ["name_es", "name"] } }
```

Each tile takes the name of the polygon covering most of it, the smallest polygon winning each pixel;
tiles outside every polygon keep their sea's name; a name used by several tiles is numbered. A
`laea` map ignores polygons with any vertex beyond 90 degrees of arc from its centre (the great
oceans), so their tiles take their sea's name.
