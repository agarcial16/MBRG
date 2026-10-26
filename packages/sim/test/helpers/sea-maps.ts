import type { MapData, MapEntry } from '@mbrg/shared';

/** One entry of a sea fixture: a land territory with its owner, or a sea zone (no owner). */
export type SeaSpec = { id: number; owner: number } | { id: number; sea: true };

/**
 * Builds a map from land/sea entries and mutual links (both sides list each other).
 * `oneWay` pairs are listed on the first entry only (a link the second entry does not confirm).
 */
export function seaMapFrom(specs: SeaSpec[], links: [number, number][], oneWay: [number, number][] = []): MapData {
  const entries = specs.map((s): MapEntry => {
    const neighbors: number[] = [];
    return 'sea' in s ? { id: s.id, neighbors, kind: 'sea' } : { id: s.id, owner: s.owner, neighbors };
  });
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const [a, b] of links) {
    byId.get(a)!.neighbors.push(b);
    byId.get(b)!.neighbors.push(a);
  }
  for (const [a, b] of oneWay) byId.get(a)!.neighbors.push(b);
  return { territories: entries };
}

export const land = (id: number, owner: number): SeaSpec => ({ id, owner });
export const sea = (id: number): SeaSpec => ({ id, sea: true });

/**
 * NFR-9 golden maps. Territory ids: land 1.., sea zones 101..; faction ids are the owners.
 */

/** Continent line A(10)-B(20)-C(30); island D(40) on zone 101 with A; islands E(50), F(60) on zone 102 with C. */
export const isleMap = (): MapData =>
  seaMapFrom(
    [land(1, 10), land(2, 20), land(3, 30), land(4, 40), land(5, 50), land(6, 60), sea(101), sea(102)],
    [[1, 2], [2, 3], [1, 101], [4, 101], [3, 102], [5, 102], [6, 102]],
  );

/**
 * Denmark case: Germany G(10) land to Jutland (territory 2) and Poland P(30); Denmark (20) owns
 * Jutland and Zealand (territory 4); Zealand and Sweden (50) sit on Kattegat (zone 101).
 */
export const denmarkMap = (): MapData =>
  seaMapFrom(
    [land(1, 10), land(2, 20), land(3, 30), land(4, 20), land(5, 50), sea(101)],
    [[1, 2], [1, 3], [2, 4], [4, 101], [5, 101]],
  );

/**
 * Open-ocean chain 101-102-103-104; zones 102 and 103 touch no land. X(10) is alone on 101;
 * Z(30), W(40) and continent C1(50) share 104; C2(60) is C1's land neighbor.
 */
export const oceanMap = (): MapData =>
  seaMapFrom(
    [land(1, 10), land(3, 30), land(4, 40), land(5, 50), land(6, 60), sea(101), sea(102), sea(103), sea(104)],
    [[101, 102], [102, 103], [103, 104], [1, 101], [3, 104], [4, 104], [5, 104], [5, 6]],
  );

/**
 * Japan case: faction J(10) owns islands 4, 5, 6 on zones 101, 102, 103 (no land link between
 * them); continent line A(20)-B(30)-C(40) touches one zone each.
 */
export const japanMap = (): MapData =>
  seaMapFrom(
    [land(1, 20), land(2, 30), land(3, 40), land(4, 10), land(5, 10), land(6, 10), sea(101), sea(102), sea(103)],
    [[1, 2], [2, 3], [1, 101], [2, 102], [3, 103], [4, 101], [5, 102], [6, 103]],
  );
