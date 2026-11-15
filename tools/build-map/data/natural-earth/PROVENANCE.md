# Provenance of the Natural Earth source subset

Made with Natural Earth. Free vector and raster map data at https://www.naturalearthdata.com.

## Source and version
- Source: Natural Earth, 1:10m Cultural Vectors, version **5.1.1** (the text in `source-meta.json`,
  read from the `.VERSION.txt` file of each dataset; both read `5.1.1`).
- Datasets used:
  - `ne_10m_admin_1_states_provinces` (Admin 1 - States, Provinces)
  - `ne_10m_admin_0_countries` (Admin 0 - Countries)
- Files read from each dataset: `.shp`, `.dbf` and `.VERSION.txt` (the other files of the ZIPs are not used).

## Download (2026-10-15)
The links on naturalearthdata.com (`https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/<name>.zip`)
returned HTTP 500 on 2026-10-15. The files were downloaded from Natural Earth's own S3 bucket instead
(decision of the project owner):

| ZIP | URL | Last-Modified | Bytes | SHA-256 |
|---|---|---|---|---|
| `ne_10m_admin_1_states_provinces.zip` | https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip | Fri, 13 May 2022 05:36:15 GMT | 14909524 | `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05` |
| `ne_10m_admin_0_countries.zip` | https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip | Fri, 13 May 2022 05:36:40 GMT | 4930492 | `ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6` |

The ZIPs and the unpacked shapefiles are NEVER committed; only the extraction outputs below are.

## Committed files
- `provinces.json`: every first-level division of the selected countries (DEU, ESP, FRA, ITA, PRT), wherever it
  lies (299 features: DEU 16, ESP 52, FRA 101, ITA 110, PRT 20), whole, with only `adm1_code`, `adm0_a3`, `name`, `name_es`.
- `countries.json`: the five selected country records (`adm0_a3`, `name`, `name_es`), no geometry.
- `other-land.json`: the polygons of the other countries' admin-0 outlines whose own bounding box intersects the
  extraction box (42 countries), whole, with only `adm0_a3`. Decided per polygon, not per country.
- `source-meta.json`: `{ "version": "5.1.1" }`.

## Extraction box
Fixed longitude/latitude rectangle in `../dev-map/extraction-box.json`:

```
"west": -15.55
"south": 33.3
"east": 24.2
"north": 56.7
```

It covers the dev map frame (spec FR-114, W = 2048, margin 2%). The frame is the square around the projected vertices of
the non-excluded provinces (Lambert azimuthal equal-area centred on lon 4.50998, lat 45.277285; vertex extent lon
-9.497..18.517, lat 35.489..55.065, i.e. Lampedusa and Sylt included; Canary Islands, Ceuta, Melilla, Azores, Madeira and the
French overseas regions excluded). Converting every pixel centre of its outermost rows and columns back to
longitude and latitude gives -15.506..24.153 and 33.344..56.679; the box is that rectangle rounded outward with a
margin of about 0.05 degrees. A square frame in this projection reaches farther in longitude than the data does.

## Processing
- Selection: the countries of `../dev-map/grouping.json` (`countries[].country`) and the box above.
- Property trimming: only the properties listed above are kept (fields matched case-insensitively, written lower case).
  The DBF fixed-width padding (spaces or NUL characters) is removed when reading; names are not otherwise trimmed.
- Features and kept polygons are whole: never clipped to the box. Clipping was NOT needed: the output is 9,186,591 bytes
  (limit 10 MB).
- Geometry is never simplified. Every coordinate is rounded to 5 decimal places (about 1 m), so vertices shared by two polygons
  stay identical, and consecutive vertices made equal by that rounding are collapsed into one.
- Output is sorted by `adm1_code` / `adm0_a3` and written in the builder's fixed JSON format (LF, two-space indentation).
  Two runs on the same files give byte-identical output (checked with SHA-256 of each file).

## Command (offline, no network)
Unzip the two ZIPs into one directory, then from the repository root:

```
npm run extract -w @mbrg/build-map -- --ne <directory with the unpacked Natural Earth files>
```

## Approximation of Portugal
Natural Earth has Portuguese districts (and the Azores and Madeira) as first-level divisions. The dev map's five mainland
regions (Norte, Centro, Lisboa, Alentejo, Algarve) are grouped from whole districts, so they only approximate the official
regions wherever those borders do not follow district borders. The grouping table repeats this.

## Licence
Natural Earth data is in the public domain (https://www.naturalearthdata.com/about/terms-of-use/). Credit as
"Made with Natural Earth". No permission is needed to use, copy or modify it.
