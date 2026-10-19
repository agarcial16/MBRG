/**
 * The dev-map layout run shared by the Node tests and the browser console (plan D11): territory placement once
 * (aspect 3) and faction placement of seed 1 at rounds 0..T (aspect 4), each state placed from scratch.
 * In a browser: `await import('/test/helpers/label-digest-run.ts')` from the Vite dev server, then `devLayoutDigest()`.
 */
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../../src/core/entries';
import type { EntryIndex } from '../../src/core/entries';
import { layoutDigest } from '../../src/core/label-digest';
import { placeFactions, placeTerritories } from '../../src/core/label-place';
import type { FactionLayout, TerritoryLayout } from '../../src/core/label-place';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { decodeIdPng } from '../../src/core/png';
import { buildPieceIndex } from '../../src/core/regions';
import type { PieceIndex } from '../../src/core/regions';
import { sceneAt } from '../../src/core/scene';
import type { SimPort } from '../../src/core/scene';
import { SHAPE_PARAMS } from '../../src/core/shape-params';
import { inflateStream } from '../../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './dev-map';

export const DEV_FACTION_ASPECT = 4;
export const DEV_TERRITORY_ASPECT = 3;
export const DEV_SEED = 1;
const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };

export interface DevRun {
  index: EntryIndex;
  p: PieceIndex;
  factionAspects: Map<number, number>;
  territoryAspects: number[];
  /** Number of rounds T of the dev map (rounds 0..T exist). */
  rounds: number;
  /** Owner table (faction index per entry) of each round 0..T of seed 1. */
  tables: Uint8Array[];
  territories: TerritoryLayout;
  /** Each round placed from that state alone. */
  factions: FactionLayout[];
  /** Wall time in ms of the territory placement and of each faction placement. */
  territoryMs: number;
  factionMs: number[];
}

export async function devRun(): Promise<DevRun> {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  const index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  const p = buildPieceIndex(index);
  const factionIndex = factionIndexOf(DEV_MAP);
  const factionAspects = new Map<number, number>([...factionIndex.values()].map((f) => [f, DEV_FACTION_ASPECT]));
  const territoryAspects: number[] = [];
  for (let e = 0; e < index.fills.length; e++) territoryAspects.push(index.fills[e] === 'land' ? DEV_TERRITORY_ASPECT : 0);
  const total = totalRounds(DEV_MAP);
  if (!total.ok) throw new Error('rounds');
  const tables: Uint8Array[] = [];
  for (let round = 0; round <= total.value; round++) {
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, DEV_SEED, round, REAL);
    if (!scene.ok) throw new Error('scene');
    tables.push(ownerTable(index, scene.value.owners, factionIndex));
  }
  const t0 = performance.now();
  const territories = placeTerritories(p, territoryAspects, LABEL_PARAMS, SHAPE_PARAMS);
  const territoryMs = performance.now() - t0;
  const factions: FactionLayout[] = [];
  const factionMs: number[] = [];
  for (const owners of tables) {
    const t1 = performance.now();
    factions.push(placeFactions(p, owners, factionAspects, LABEL_PARAMS, SHAPE_PARAMS));
    factionMs.push(performance.now() - t1);
  }
  return { index, p, factionAspects, territoryAspects, rounds: total.value, tables, territories, factions, territoryMs, factionMs };
}

/** The D11 digest of the dev-map placement. */
export async function devLayoutDigest(): Promise<string> {
  const run = await devRun();
  return layoutDigest(run.territories, run.factions);
}
