import type { MapFormatV1 } from '@mbrg/shared';

const rect = (x: number, y: number, w = 30, h = 30): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/**
 * Hand-made 5-territory map mirroring the A–E example from the design docs:
 * A–B, A–E, B–C, B–E, C–D, D–E (symmetric).
 */
export const aeMap: MapFormatV1 = {
  version: 1,
  name: 'A–E sample',
  width: 160,
  height: 120,
  territories: [
    { id: 'A', neighbors: ['B', 'E'], polygon: [[0, 0], [40, 0], [40, 30], [0, 35]] },
    { id: 'B', neighbors: ['A', 'C', 'E'], polygon: [[40, 0], [100, 0], [100, 45], [40, 30]] },
    { id: 'C', neighbors: ['B', 'D'], polygon: [[100, 0], [150, 0], [155, 50], [100, 45]] },
    { id: 'D', neighbors: ['C', 'E'], polygon: [[100, 45], [155, 50], [160, 110], [95, 115]] },
    { id: 'E', neighbors: ['A', 'B', 'D'], polygon: [[0, 35], [40, 30], [100, 45], [95, 115], [0, 110]] },
  ],
};

/** Two connected mainland territories + one isolated island. */
export const islandMap: MapFormatV1 = {
  version: 1,
  name: 'island sample',
  width: 200,
  height: 100,
  territories: [
    { id: 'MAIN1', neighbors: ['MAIN2'], polygon: rect(0, 0, 40, 60) },
    { id: 'MAIN2', neighbors: ['MAIN1'], polygon: rect(40, 0, 40, 60) },
    { id: 'ISLE', neighbors: [], polygon: rect(150, 40, 20, 20) },
  ],
};

/** Graph for weighting tests. Not used through `createInitialMatch` (factions are crafted). */
export const chainMap: MapFormatV1 = {
  version: 1,
  name: 'chain sample',
  territories: [
    { id: 'T1', neighbors: ['T2'], polygon: rect(0, 0, 10, 10) },
    { id: 'T2', neighbors: ['T1', 'T3'], polygon: rect(10, 0, 10, 10) },
    { id: 'T3', neighbors: ['T2', 'T4'], polygon: rect(20, 0, 10, 10) },
    { id: 'T4', neighbors: ['T3', 'T5'], polygon: rect(30, 0, 10, 10) },
    { id: 'T5', neighbors: ['T4', 'T6'], polygon: rect(40, 0, 10, 10) },
    { id: 'T6', neighbors: ['T5', 'T7'], polygon: rect(50, 0, 10, 10) },
    { id: 'T7', neighbors: ['T6'], polygon: rect(60, 0, 10, 10) },
  ],
};
