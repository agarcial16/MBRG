# Dev map grouping, seeds and parameters (spec 003b, FR-127)

Natural Earth 5.1.1 admin-1 gives departments (FRA 101), provinces (ESP 52, ITA 110, PRT districts 20) and
states (DEU 16). `grouping.json` groups them into 70 territories; every one of the 299 province codes is
listed exactly once (in a territory or in `excluded`). Names are Spanish and written in the table.
Province codes and names were taken from `../natural-earth/provinces.json`, not from memory (note the source
spellings of some province names, kept as in the data: `Oristrano`, `Crotene`, `Seien-et-Marne`, `Haute-Rhin`; the territories list province codes, and the territory keys are country-prefixed slugs).

| Country | Territories | Rule |
|---|---|---|
| DEU | 16 | One state = one province. |
| ESP | 16 | Autonomous communities by province: Galicia 4, Asturias, Cantabria, Pais Vasco 3, Navarra, La Rioja, Aragon 3, Cataluna 4, Castilla y Leon 9, Madrid, Castilla-La Mancha 5, Extremadura 2, Comunidad Valenciana 3, Murcia, Andalucia 8, Baleares. 48 provinces. |
| FRA | 13 | The 13 metropolitan regions (2016 borders) by department: ARA 12, BFC 8, Bretana 4, Centre-Val de Loire 6, Corse 2, Grand Est 10, Hauts-de-France 5, Ile-de-France 8, Normandie 5, Nouvelle-Aquitaine 12, Occitanie 13, Pays de la Loire 5, PACA 6. 96 departments. |
| ITA | 20 | The 20 regions by province (e.g. Trentino-Alto Adigio = Bozen + Trento, Liguria = Genova + 3, Lombardia 12). 110 provinces. |
| PRT | 5 | Whole districts approximate the NUTS II regions (district borders do not match them): Norte = Viana do Castelo, Braga, Porto, Vila Real, Braganca; Centro = Aveiro, Coimbra, Leiria, Viseu, Guarda, Castelo Branco; Lisboa = Lisboa + Setubal; Alentejo = Santarem + Portalegre + Evora + Beja; Algarve = Faro. Santarem straddles Centro/Alentejo/Lisboa: put in Alentejo (Leziria do Tejo is the largest NUTS II part). |

Excluded (11): Las Palmas and Santa Cruz de Tenerife (Canarias), Ceuta, Melilla, Azores, Madeira, and the five
French overseas departments (Martinique, Guyane, La Reunion, Mayotte, Guadeloupe): all far outside the frame.

`sea-seeds.json`: 17 Spanish-named seeds. The frame is narrow on the west side (Iberia touches it), so the
Atlantic seed sits at lon -10.3, lat 40.5 (a first try at -12 was `seed-outside-frame`).
`params.json`: width 2048, margin 0.02, minPieceSize 40 (FR-127).
