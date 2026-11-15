// NFR-32, pure part: what a round step recomputes, and the dev-map timings of the label layout and the colour
// front, logged and not asserted (a timing in a unit test would be flaky). The browser figures are measured by
// hand and recorded in the pull request (plan section 12).
import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { frontField } from '../src/core/front';
import { LABEL_PARAMS } from '../src/core/label-params';
import { factionBoxes, territoryBoxes } from '../src/core/label-layout';
import type { FactionBoxes } from '../src/core/label-layout';
import { labelTexts, roundLabels } from '../src/core/label-input';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { stepScenes } from '../src/core/step';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
const P = LABEL_PARAMS;
const ASPECT_FACTION = 4;
const ASPECT_TERRITORY = 3;

describe('NFR-32 what a round step of the dev map recomputes, with timings logged', () => {
  let index: EntryIndex;
  let pieces: PieceIndex;
  const factionIndex = factionIndexOf(DEV_MAP);
  const factionAspects = new Map<number, number>([...factionIndex.values()].map((f) => [f, ASPECT_FACTION]));
  const aspects: number[] = [];
  const scene = (round: number) => {
    const s = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, round, REAL);
    if (!s.ok) throw new Error('scene');
    return s.value;
  };
  const tableOf = (round: number): Uint8Array => ownerTable(index, scene(round).owners, factionIndex);

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    for (let e = 0; e < index.fills.length; e++) aspects.push(index.fills[e] === 'land' ? ASPECT_TERRITORY : 0);
  });

  it('NFR-32 the piece index and the territory boxes are built once, at load (time logged)', () => {
    const t0 = performance.now();
    pieces = buildPieceIndex(index);
    const indexMs = performance.now() - t0;
    const t1 = performance.now();
    const boxes = territoryBoxes(pieces, aspects, P);
    const territoryMs = performance.now() - t1;
    console.log(`labels-perf: piece index ${indexMs.toFixed(0)} ms, territory boxes ${territoryMs.toFixed(0)} ms (once per load)`);
    expect(pieces.entries).toBe(index.fills.length);
    expect(boxes.filter((b) => b !== undefined).length).toBeGreaterThan(50);
  });

  it('NFR-32 a round step recomputes only the changed factions, forward and backward (times logged)', () => {
    const texts = labelTexts(DEV_MAP, DEV_PRESENTATION, factionIndex);
    const territoryLayout = territoryBoxes(pieces, aspects, P);
    const tables = [0, 1, 2, 3, 4].map(tableOf);
    const full = tables.map((table) => factionBoxes(pieces, table, factionAspects, P));
    const rows: string[] = [];
    let steps = 0;
    for (let from = 0; from <= 4; from++) {
      for (const to of [from - 1, from + 1]) {
        if (to < 0 || to > 4) continue;
        steps++;
        const earlierScene = scene(from);
        const stepped = stepScenes(DEV_MAP, DEV_PRESENTATION, 1, earlierScene, to, REAL);
        if (!stepped.ok) throw new Error('step');
        const data = stepped.value.data;
        const transferred = new Set<number>();
        for (const id of data.transferred) transferred.add(index.indexOf.get(id)!);
        const earlier = to > from ? tables[from]! : tables[to]!;
        const absorber = factionIndex.get(data.absorber)!;

        const t0 = performance.now();
        const boxes: FactionBoxes = factionBoxes(pieces, tables[to]!, factionAspects, P, full[from]);
        const labels = roundLabels(texts, tables[to]!, boxes, territoryLayout);
        const t1 = performance.now();
        const field = frontField(pieces, transferred, earlier, absorber);
        const t2 = performance.now();
        rows.push(
          `${from}->${to}: labels ${(t1 - t0).toFixed(0)} ms (recomputed ${boxes.recomputed.length}), front ${(t2 - t1).toFixed(0)} ms, total ${(t2 - t0).toFixed(0)} ms`,
        );
        expect(labels.factions.length).toBeGreaterThan(0);
        expect(field.values.length).toBeGreaterThan(0);
        // only the absorber changes (and, going back, the faction that comes back)
        expect(boxes.recomputed.length, `step ${from} -> ${to}`).toBeLessThanOrEqual(to > from ? 1 : 2);
        // the reuse gives the labels of a full recomputation
        expect(boxes.labels, `step ${from} -> ${to}`).toStrictEqual(full[to]!.labels);
      }
    }
    expect(steps).toBe(8);
    console.log(`labels-perf (seed 1, warm):\n  ${rows.join('\n  ')}`);
  });

  it('NFR-32 a jump recomputes the factions whose main region changed (time logged)', () => {
    const from = factionBoxes(pieces, tableOf(0), factionAspects, P);
    const target = tableOf(4);
    const t0 = performance.now();
    const boxes = factionBoxes(pieces, target, factionAspects, P, from);
    console.log(`labels-perf: jump 0->4 ${(performance.now() - t0).toFixed(0)} ms (recomputed ${boxes.recomputed.length})`);
    expect(boxes.recomputed.length).toBeLessThanOrEqual(boxes.labels.size);
  });
});
