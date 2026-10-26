import { describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex } from '../src/core/entries';
import { legendLine, livingLine, perfLines, pointerLines, recordLine, roundStatus, seedLine } from '../src/core/panel-text';
import { frameStats } from '../src/core/perf';
import { pointerInfo, sceneAt } from '../src/core/scene';
import { STRINGS } from '../src/core/strings';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { inflateStream } from '../src/ui/load';
import { decodeIdPng } from '../src/core/png';

const sim = { totalRounds, getState, getRounds, ownerOf };

function sceneOf(n: number, seed = 7) {
  const r = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, n, sim);
  if (!r.ok) throw new Error('sceneAt failed');
  return r.value;
}

/** No placeholder may survive in a finished text. */
const filled = (text: string): boolean => !/\{\w+\}/.test(text);

describe('FR-156 panel texts', () => {
  it('FR-156 the header names the seed, N and T and the number of living factions', () => {
    const scene = sceneOf(2);
    expect(seedLine(scene)).toContain('7');
    expect(roundStatus(scene)).toContain('2');
    expect(roundStatus(scene)).toContain(String(scene.total));
    expect(livingLine(scene)).toContain(String(scene.living));
    for (const text of [seedLine(scene), roundStatus(scene), livingLine(scene)]) expect(filled(text), text).toBe(true);
  });

  it('FR-156 living factions fall by one each round', () => {
    expect(sceneOf(0).living - sceneOf(1).living).toBe(1);
    expect(livingLine(sceneOf(0))).not.toBe(livingLine(sceneOf(1)));
  });

  it('FR-156 the record line names the eliminated and the absorbing faction and the transferred count', () => {
    const scene = sceneOf(1);
    const line = recordLine(scene, DEV_PRESENTATION);
    const record = scene.record!;
    const name = (id: number): string => DEV_PRESENTATION.factions.find((f) => f.id === id)!.name;
    expect(line).toContain(name(record.eliminated));
    expect(line).toContain(name(record.absorber));
    expect(line).toContain(String(record.transferred.length));
    expect(filled(line)).toBe(true);
  });

  it('FR-156 round 0 has no record: the line says so and names no faction elimination', () => {
    const line = recordLine(sceneOf(0), DEV_PRESENTATION);
    expect(line).toBe(STRINGS.noRecord);
  });

  it('FR-156 a legend line has the id, name, territory count and the alive or eliminated state', () => {
    const scene = sceneOf(4);
    const rows = scene.legend.map((row) => ({ row, text: legendLine(row) }));
    for (const { row, text } of rows) {
      expect(text).toContain(String(row.faction));
      expect(text).toContain(row.name);
      expect(text).toContain(String(row.territories));
      expect(text).toContain(row.alive ? STRINGS.stateAlive : STRINGS.stateEliminated);
      expect(text).not.toContain(row.alive ? STRINGS.stateEliminated : STRINGS.stateAlive);
      expect(filled(text), text).toBe(true);
    }
    expect(rows.filter(({ row }) => row.alive)).toHaveLength(scene.living);
  });

  it('FR-156 no panel text mentions a round after N: the texts depend on the scene alone', () => {
    const scene = sceneOf(2);
    const texts = [seedLine(scene), roundStatus(scene), livingLine(scene), recordLine(scene, DEV_PRESENTATION), ...scene.legend.map(legendLine)];
    expect(texts.join('\n')).not.toMatch(/\{/);
    const again = sceneOf(2);
    expect([seedLine(again), roundStatus(again), livingLine(again), recordLine(again, DEV_PRESENTATION), ...again.legend.map(legendLine)]).toStrictEqual(texts);
  });
});

describe('FR-330 the debug record line during the tours', () => {
  const names = (): string[] => DEV_PRESENTATION.factions.map((f) => f.name);
  const nameOf = (id: number): string => DEV_PRESENTATION.factions.find((f) => f.id === id)?.name ?? '';

  it('FR-330 before the victim stop the record line says "revelando…" and names neither the victim nor the absorber nor the count', () => {
    for (const n of [1, 2, 3, 4]) {
      const scene = sceneOf(n);
      const line = recordLine(scene, DEV_PRESENTATION, { revealing: true, absorbing: true });
      expect(line, `round ${String(n)}`).toContain('revelando…');
      for (const name of names()) expect(line, name).not.toContain(name);
      expect(line).not.toMatch(/\d/);
      expect(filled(line)).toBe(true);
      // `revealing` alone hides the same things (the victim tour is the first of the chain).
      expect(recordLine(scene, DEV_PRESENTATION, { revealing: true })).toBe(line);
    }
  });

  it('FR-330 after the victim stop the victim shows and the absorber stays hidden until the absorber tour ends', () => {
    for (const n of [1, 2, 3, 4]) {
      const scene = sceneOf(n);
      const record = scene.record!;
      const line = recordLine(scene, DEV_PRESENTATION, { absorbing: true });
      expect(line).toContain(nameOf(record.eliminated));
      expect(line).toContain('revelando…');
      expect(line).not.toContain(nameOf(record.absorber));
      expect(line).not.toMatch(/\d/);
      expect(filled(line)).toBe(true);
    }
  });

  it('FR-330 with no tour state, or with both flags off, the record line is the one of FR-156; round 0 stays "no record"', () => {
    const scene = sceneOf(2);
    expect(recordLine(scene, DEV_PRESENTATION, undefined)).toBe(recordLine(scene, DEV_PRESENTATION));
    expect(recordLine(scene, DEV_PRESENTATION, {})).toBe(recordLine(scene, DEV_PRESENTATION));
    expect(recordLine(scene, DEV_PRESENTATION, { revealing: false, absorbing: false })).toBe(recordLine(scene, DEV_PRESENTATION));
    expect(recordLine(sceneOf(0), DEV_PRESENTATION, { revealing: true, absorbing: true })).toBe(STRINGS.noRecord);
  });
});

describe('FR-157 pointer texts', () => {
  async function index() {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    return buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  }

  it('FR-157 without a pointer the panel shows the idle text', async () => {
    expect(pointerLines(undefined)).toStrictEqual([STRINGS.pointerIdle]);
  });

  it('FR-157 over land: coordinates, value, fill class, name and owner', async () => {
    const idx = await index();
    const scene = sceneOf(0);
    const land = DEV_MAP.territories.find((t) => t.kind !== 'sea')!;
    let found: { x: number; y: number } | undefined;
    for (let y = 0; y < idx.height && !found; y += 7) {
      for (let x = 0; x < idx.width; x += 7) {
        if (idx.ids[idx.cells[y * idx.width + x]!] === land.id) {
          found = { x: x + 0.5, y: y + 0.5 };
          break;
        }
      }
    }
    expect(found).toBeDefined();
    const info = pointerInfo(idx, scene, DEV_PRESENTATION, found!);
    const lines = pointerLines(info).join('\n');
    expect(lines).toContain(found!.x.toFixed(1));
    expect(lines).toContain(String(land.id));
    expect(lines).toContain(STRINGS.fillLand);
    expect(lines).toContain(info.name!);
    expect(lines).toContain(info.owner!);
    expect(filled(lines)).toBe(true);
  });

  it('FR-157 outside the map: the Spanish outside text and no name or owner', async () => {
    const idx = await index();
    const info = pointerInfo(idx, sceneOf(0), DEV_PRESENTATION, { x: -5, y: -5 });
    const lines = pointerLines(info);
    expect(lines.join('\n')).toContain(STRINGS.outsideMap);
    expect(lines.join('\n')).not.toContain(STRINGS.fillLand);
  });

  it('FR-157 over the sea: sea fill class, a name and no owner line', async () => {
    const idx = await index();
    const sea = DEV_MAP.territories.find((t) => t.kind === 'sea')!;
    let found: { x: number; y: number } | undefined;
    for (let y = 0; y < idx.height && !found; y += 7) {
      for (let x = 0; x < idx.width; x += 7) {
        if (idx.ids[idx.cells[y * idx.width + x]!] === sea.id) {
          found = { x: x + 0.5, y: y + 0.5 };
          break;
        }
      }
    }
    const info = pointerInfo(idx, sceneOf(0), DEV_PRESENTATION, found!);
    const text = pointerLines(info).join('\n');
    expect(text).toContain(STRINGS.fillSea);
    expect(info.owner).toBeUndefined();
    expect(text).not.toContain(STRINGS.pointerOwner.split('{')[0]!);
  });
});

describe('FR-158 timing texts', () => {
  it('FR-158 before any measurement every figure reads as missing, never as zero', () => {
    const text = perfLines({ frames: frameStats([]) }).join('\n');
    expect(text).toContain(STRINGS.perfNone);
    expect(text).not.toMatch(/\b0\.0\b/);
    expect(filled(text)).toBe(true);
  });

  it('FR-158 load time, last round change time, median and p95 are shown in milliseconds with one decimal', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const text = perfLines({ load: 812.34, roundChange: 3.21, frames: frameStats(samples) }).join('\n');
    expect(text).toContain('812.3');
    expect(text).toContain('3.2');
    expect(text).toContain('50.5');
    expect(text).toContain('95.0');
    expect(text).toContain('100');
    expect(filled(text)).toBe(true);
  });
});

describe('FR-190 the labels and front time of the last round change', () => {
  it('FR-190 without the figure the three 004 lines stay and no extra line appears', () => {
    expect(perfLines({ frames: frameStats([]) })).toHaveLength(3);
    expect(perfLines({ load: 1, roundChange: 2, frames: frameStats([1]) })).toHaveLength(3);
  });

  it('FR-190 with the figure one more line shows it in milliseconds with one decimal, the 004 lines unchanged', () => {
    const without = perfLines({ load: 812.34, roundChange: 3.21, frames: frameStats([4, 5]) });
    const withLabels = perfLines({ load: 812.34, roundChange: 3.21, labels: 47.26, frames: frameStats([4, 5]) });
    expect(withLabels).toHaveLength(4);
    expect(withLabels.slice(0, 3)).toStrictEqual(without);
    expect(withLabels[3]).toContain('47.3');
    expect(withLabels[3]).toContain(STRINGS.perfLabels.split('{')[0]!);
    expect(perfLines({ labels: 0, frames: frameStats([]) })).toHaveLength(4);
  });
});
