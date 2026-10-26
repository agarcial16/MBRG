import type { MapData } from '@mbrg/shared';

/** Builds a map with symmetric adjacency. Territory ids are 1..n; owners[i] owns territory i+1. */
export function mapFrom(owners: number[], edges: [number, number][]): MapData {
  const territories = owners.map((owner, i) => ({ id: i + 1, owner, neighbors: [] as number[] }));
  for (const [a, b] of edges) {
    territories[a - 1]!.neighbors.push(b);
    territories[b - 1]!.neighbors.push(a);
  }
  return { territories };
}

/** Two factions (10 and 20), one territory each. */
export const pairMap = (): MapData => mapFrom([10, 20], [[1, 2]]);

/** Line 1-2-3-4, one faction per territory (factions 1..4). */
export const lineMap = (): MapData =>
  mapFrom(
    [1, 2, 3, 4],
    [
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  );

/** Ring of 6 territories, one faction each (factions 1..6). */
export const ringMap = (): MapData =>
  mapFrom(
    [1, 2, 3, 4, 5, 6],
    [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 1],
    ],
  );

/** Grid of w x h territories, one faction each; ids and factions row-major from 1. */
export function gridMap(w: number, h: number): MapData {
  const owners = Array.from({ length: w * h }, (_, i) => i + 1);
  const edges: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = y * w + x + 1;
      if (x + 1 < w) edges.push([id, id + 1]);
      if (y + 1 < h) edges.push([id, id + w]);
    }
  }
  return mapFrom(owners, edges);
}
