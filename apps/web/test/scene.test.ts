import { describe, expect, it } from 'vitest';
import { factionOrder, validateMap } from '@mbrg/shared';
import type { MapData } from '@mbrg/shared';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { MatchError, MatchState } from '@mbrg/sim';
import { buildEntryIndex } from '../src/core/entries';
import { appendSample, FRAME_WINDOW, frameStats } from '../src/core/perf';
import { DEBUG_TITLE, pointerInfo, roundSummary, sceneAt, sceneErrorMessage } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { fillTemplate, STRINGS } from '../src/core/strings';
import { inflateStream } from '../src/ui/load';
import { parsePackage } from '../src/core/package';
import { DEV_MAP, DEV_MAP_TEXT, DEV_PRESENTATION, DEV_PRESENTATION_TEXT, devPngBytes } from './helpers/dev-map';

const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The real sim wrapped so every request is recorded, in order. */
function recordingSim(): { sim: SimPort; calls: string[] } {
  const calls: string[] = [];
  const sim: SimPort = {
    totalRounds: (map) => {
      calls.push('total');
      return totalRounds(map);
    },
    getState: (map, seed, round) => {
      calls.push(`state:${String(round)}`);
      return getState(map, seed, round);
    },
    getRounds: (map, seed, round) => {
      calls.push(`rounds:${String(round)}`);
      return getRounds(map, seed, round);
    },
    ownerOf,
  };
  return { sim, calls };
}

function sceneOf(n: number, seed = 1, sim: SimPort = REAL) {
  const r = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, n, sim);
  if (!r.ok) throw new Error(`sceneAt failed: ${JSON.stringify(r.errors)}`);
  return r.value;
}

const landIds = DEV_MAP.territories.filter((t) => t.kind !== 'sea').map((t) => t.id);

describe('FR-152 the displayed state comes from the sim', () => {
  it('FR-152 T is the sim round count and the owners are the owners of the sim state at round N', () => {
    for (let n = 0; n <= 4; n++) {
      const scene = sceneOf(n);
      expect(scene.total).toBe(4);
      expect(scene.round).toBe(n);
      expect(scene.seed).toBe(1);
      const state = getState(DEV_MAP, 1, n);
      if (!state.ok) throw new Error('sim state');
      expect([...scene.owners.keys()]).toStrictEqual(landIds);
      for (const id of landIds) expect(scene.owners.get(id), `round ${n} territory ${id}`).toBe(ownerOf(state.value, id));
    }
  });

  it('FR-152 the owner of each land territory is read with the sim owner lookup, sea zones have none', () => {
    const asked: number[] = [];
    const sim: SimPort = {
      ...REAL,
      ownerOf: (state: MatchState, id: number) => {
        asked.push(id);
        return id * 2;
      },
    };
    const scene = sceneOf(0, 1, sim);
    expect(asked).toStrictEqual(landIds);
    expect(scene.owners.get(landIds[0]!)).toBe(landIds[0]! * 2);
    const sea = DEV_MAP.territories.find((t) => t.kind === 'sea')!;
    expect(scene.owners.has(sea.id)).toBe(false);
  });

  it('FR-152 for N at least 1 the record is the record of round N taken from the records of rounds 1..N; round 0 has none', () => {
    expect(sceneOf(0).record).toBeUndefined();
    expect('record' in sceneOf(0)).toBe(false);
    for (let n = 1; n <= 4; n++) {
      const rounds = getRounds(DEV_MAP, 1, n);
      if (!rounds.ok) throw new Error('sim rounds');
      expect(rounds.value).toHaveLength(n);
      expect(sceneOf(n).record).toStrictEqual(rounds.value[n - 1]);
      expect(sceneOf(n).record!.round).toBe(n);
    }
  });

  it('FR-152 a sim error draws no scene and reports the sim error kind', () => {
    const outOfRange = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 5, REAL);
    expect(outOfRange.ok).toBe(false);
    if (outOfRange.ok) return;
    expect(outOfRange.errors[0]).toStrictEqual({ kind: 'round-out-of-range', round: 5, total: 4 });

    const badSeed = sceneAt(DEV_MAP, DEV_PRESENTATION, -1, 0, REAL);
    expect(badSeed.ok).toBe(false);
    if (!badSeed.ok) expect(badSeed.errors.map((e) => e.kind)).toContain('invalid-seed');

    const broken = clone(DEV_MAP);
    broken.territories[0]!.neighbors.push(999999);
    const invalid = sceneAt(broken, DEV_PRESENTATION, 1, 0, REAL);
    expect(invalid.ok).toBe(false);
    const expected = validateMap(broken);
    if (!invalid.ok && !expected.ok) expect(invalid.errors[0]!.kind).toBe(expected.errors[0]!.kind);
  });

  it('FR-152 the error message is Spanish text that shows the kind', () => {
    const errors: MatchError[] = [{ kind: 'round-out-of-range', round: 5, total: 4 }];
    const message = sceneErrorMessage(errors);
    expect(message).toBe(fillTemplate(STRINGS.simError, { kind: 'round-out-of-range' }));
    expect(message).toContain('round-out-of-range');
    expect(message).not.toContain('{kind}');
    expect(STRINGS.simError).toContain('partida');
  });

  it('FR-152 the round count error of the sim is reported too', () => {
    const failing: SimPort = {
      ...REAL,
      totalRounds: () => ({ ok: false, errors: [{ kind: 'duplicate-id', id: 1 } as never] }),
    };
    const r = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 0, failing);
    expect(r.ok).toBe(false);
  });
});

describe('FR-160 the debug scene asks the sim only for the displayed round', () => {
  it('FR-160 a request for round N calls the sim for T, the state of N and (N >= 1) the records up to N, nothing else', () => {
    const rec = recordingSim();
    sceneOf(3, 7, rec.sim);
    expect(rec.calls).toStrictEqual(['total', 'state:3', 'rounds:3']);
    const first = recordingSim();
    sceneOf(0, 7, first.sim);
    expect(first.calls).toStrictEqual(['total', 'state:0']);
  });

  it('FR-160 stepping 0 -> 1 -> 2 requests only 1, then 2, never 3', () => {
    const rec = recordingSim();
    sceneOf(0, 1, rec.sim);
    const afterZero = rec.calls.length;
    sceneOf(1, 1, rec.sim);
    const afterOne = rec.calls.slice(afterZero);
    expect(afterOne).toStrictEqual(['total', 'state:1', 'rounds:1']);
    sceneOf(2, 1, rec.sim);
    const afterTwo = rec.calls.slice(afterZero + afterOne.length);
    expect(afterTwo).toStrictEqual(['total', 'state:2', 'rounds:2']);
    expect(rec.calls.some((c) => c.endsWith(':3') || c.endsWith(':4'))).toBe(false);
  });

  it('FR-160 a jump to round T requests only T, no intermediate round', () => {
    const rec = recordingSim();
    sceneOf(4, 1, rec.sim);
    expect(rec.calls).toStrictEqual(['total', 'state:4', 'rounds:4']);
  });

  it('FR-160 nothing is cached: the same request asks the sim again, and a scene holds no round after N', () => {
    const rec = recordingSim();
    sceneOf(2, 1, rec.sim);
    sceneOf(2, 1, rec.sim);
    expect(rec.calls).toStrictEqual(['total', 'state:2', 'rounds:2', 'total', 'state:2', 'rounds:2']);
    const scene = sceneOf(2);
    expect(JSON.stringify(scene, (_k, v: unknown) => (v instanceof Map ? [...v] : v))).not.toMatch(/"round":[3-9]/);
  });

  it('FR-160 the requests of an out-of-range round are still limited to that round', () => {
    const rec = recordingSim();
    const r = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 9, rec.sim);
    expect(r.ok).toBe(false);
    expect(rec.calls.every((c) => c === 'total' || c.endsWith(':9'))).toBe(true);
  });
});

describe('FR-155 a round change is one complete state', () => {
  it('FR-155 the scene of a round is the same value whatever was displayed before (no carried state)', () => {
    const fresh = sceneOf(0);
    sceneOf(1);
    sceneOf(4);
    expect(sceneOf(0)).toStrictEqual(fresh);
    const three = sceneOf(3);
    sceneOf(4);
    sceneOf(0);
    expect(sceneOf(3)).toStrictEqual(three);
  });

  it('FR-155 owners, legend, living count and record all describe the same round', () => {
    for (let n = 0; n <= 4; n++) {
      const scene = sceneOf(n);
      const counts = new Map<number, number>();
      for (const owner of scene.owners.values()) counts.set(owner, (counts.get(owner) ?? 0) + 1);
      for (const row of scene.legend) expect(row.territories, `round ${n} faction ${row.faction}`).toBe(counts.get(row.faction) ?? 0);
      expect(scene.living).toBe(scene.legend.filter((r) => r.alive).length);
      expect(scene.living).toBe(5 - n);
      if (scene.record !== undefined) expect(scene.record.round).toBe(n);
    }
  });

  it('FR-155 the scene has no previous-state, transition or progress field', () => {
    for (const n of [0, 1, 4]) {
      const keys = Object.keys(sceneOf(n)).sort();
      expect(keys).toStrictEqual(n === 0 ? ['legend', 'living', 'owners', 'round', 'seed', 'total'] : ['legend', 'living', 'owners', 'record', 'round', 'seed', 'total']);
    }
  });
});

describe('FR-156 debug panel data', () => {
  it('FR-156 the panel is labelled as a debug scene by a UI string', () => {
    expect(DEBUG_TITLE).toBe(STRINGS.debugTitle);
    expect(STRINGS.debugTitle).toBe('Escena de depuración');
  });

  it('FR-156 the legend lists every faction in faction order with id, name, count and alive', () => {
    const scene = sceneOf(0);
    expect(scene.legend.map((r) => r.faction)).toStrictEqual(factionOrder(DEV_MAP));
    for (const row of scene.legend) {
      const p = DEV_PRESENTATION.factions.find((f) => f.id === row.faction)!;
      expect(row.name).toBe(p.name);
      expect(row.alive).toBe(true);
      expect(row.territories).toBeGreaterThan(0);
    }
    expect(scene.legend.reduce((sum, r) => sum + r.territories, 0)).toBe(landIds.length);
    expect(scene.living).toBe(5);
  });

  it('FR-156 an eliminated faction is shown with 0 territories and not alive; the absorber gains the transferred ones', () => {
    const before = sceneOf(0);
    const after = sceneOf(1);
    const record = after.record!;
    const eliminated = after.legend.find((r) => r.faction === record.eliminated)!;
    expect(eliminated.alive).toBe(false);
    expect(eliminated.territories).toBe(0);
    const absorberBefore = before.legend.find((r) => r.faction === record.absorber)!.territories;
    const absorberAfter = after.legend.find((r) => r.faction === record.absorber)!.territories;
    expect(absorberAfter - absorberBefore).toBe(record.transferred.length);
    expect(after.living).toBe(4);
  });

  it('FR-156 the round summary has the eliminated and absorbing names and the number of territories', () => {
    expect(roundSummary(sceneOf(0), DEV_PRESENTATION)).toBeUndefined();
    const scene = sceneOf(2);
    const summary = roundSummary(scene, DEV_PRESENTATION)!;
    const record = scene.record!;
    expect(summary.eliminated).toBe(DEV_PRESENTATION.factions.find((f) => f.id === record.eliminated)!.name);
    expect(summary.absorber).toBe(DEV_PRESENTATION.factions.find((f) => f.id === record.absorber)!.name);
    expect(summary.transferred).toBe(record.transferred.length);
    expect(Object.keys(summary).sort()).toStrictEqual(['absorber', 'eliminated', 'transferred']);
  });

  it('FR-156 the panel data has no field for a round after N: only N, T and the record of N', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      const scene = sceneOf(n);
      expect(scene.round).toBe(n);
      expect(scene.record === undefined || scene.record.round === n).toBe(true);
      const dump = JSON.stringify(scene, (_k, v: unknown) => (v instanceof Map ? [...v] : v));
      const rounds = [...dump.matchAll(/"round":(\d+)/g)].map((m) => Number(m[1]));
      expect(rounds.every((r) => r <= n)).toBe(true);
    }
  });
});

describe('FR-157 pointer readout', () => {
  const imagePromise = parsePackage({ map: DEV_MAP_TEXT, presentation: DEV_PRESENTATION_TEXT, image: devPngBytes() }, inflateStream);

  async function indexAndPoints(): Promise<{
    index: ReturnType<typeof buildEntryIndex>;
    land: { x: number; y: number };
    sea: { x: number; y: number };
    outside: { x: number; y: number };
  }> {
    const r = await imagePromise;
    if (!r.ok) throw new Error('dev package did not parse');
    const { width, height, values } = r.value;
    const index = buildEntryIndex(DEV_MAP as MapData, width, height, values);
    const find = (fill: 'land' | 'sea' | 'outside') => {
      for (let p = 0; p < index.cells.length; p++) {
        if (index.fills[index.cells[p]!] === fill) return { x: p % width, y: Math.floor(p / width) };
      }
      throw new Error(`no ${fill} pixel`);
    };
    return { index, land: find('land'), sea: find('sea'), outside: find('outside') };
  }

  it('FR-157 over land: coordinates, value, fill class, entry name and the owner name at N', async () => {
    const { index, land } = await indexAndPoints();
    for (const n of [0, 2]) {
      const scene = sceneOf(n);
      const info = pointerInfo(index, scene, DEV_PRESENTATION, { x: land.x + 0.5, y: land.y + 0.25 });
      const id = index.ids[index.cells[land.y * index.width + land.x]!]!;
      expect(info.fill).toBe('land');
      expect(info.value).toBe(id);
      expect(info.x).toBe(land.x + 0.5);
      expect(info.y).toBe(land.y + 0.25);
      expect(info.name).toBe(DEV_PRESENTATION.territories.find((t) => t.id === id)!.name);
      const ownerId = scene.owners.get(id)!;
      expect(info.owner).toBe(DEV_PRESENTATION.factions.find((f) => f.id === ownerId)!.name);
      expect(info.text).toBeUndefined();
    }
  });

  it('FR-157 the owner shown follows the displayed round (an absorbed territory shows its new owner)', async () => {
    const { index } = await indexAndPoints();
    const after = sceneOf(1);
    const moved = after.record!.transferred[0]!;
    const entry = index.indexOf.get(moved)!;
    const p = index.cells.indexOf(entry);
    const point = { x: (p % index.width) + 0.5, y: Math.floor(p / index.width) + 0.5 };
    const was = pointerInfo(index, sceneOf(0), DEV_PRESENTATION, point).owner;
    const now = pointerInfo(index, after, DEV_PRESENTATION, point).owner;
    expect(now).toBe(DEV_PRESENTATION.factions.find((f) => f.id === after.record!.absorber)!.name);
    expect(was).not.toBe(now);
  });

  it('FR-157 over a sea zone: its name and value, no owner', async () => {
    const { index, sea } = await indexAndPoints();
    const info = pointerInfo(index, sceneOf(0), DEV_PRESENTATION, { x: sea.x + 0.5, y: sea.y + 0.5 });
    const id = index.ids[index.cells[sea.y * index.width + sea.x]!]!;
    expect(info.fill).toBe('sea');
    expect(info.value).toBe(id);
    expect(info.name).toBe(DEV_PRESENTATION.territories.find((t) => t.id === id)!.name);
    expect(info.owner).toBeUndefined();
  });

  it('FR-157 outside the map: the Spanish "outside the map" text, value 0, no name or owner', async () => {
    const { index, outside } = await indexAndPoints();
    const inside = pointerInfo(index, sceneOf(0), DEV_PRESENTATION, { x: outside.x + 0.5, y: outside.y + 0.5 });
    expect(inside.fill).toBe('outside');
    expect(inside.value).toBe(0);
    expect(inside.text).toBe(STRINGS.outsideMap);
    expect(inside.name).toBeUndefined();
    expect(inside.owner).toBeUndefined();
    for (const p of [{ x: -0.5, y: 3 }, { x: 3, y: -0.01 }, { x: index.width, y: 3 }, { x: 3, y: index.height + 5 }]) {
      const info = pointerInfo(index, sceneOf(0), DEV_PRESENTATION, p);
      expect(info.fill, JSON.stringify(p)).toBe('outside');
      expect(info.text).toBe(STRINGS.outsideMap);
    }
  });

  it('FR-157 the last pixel row and column still read inside the image', async () => {
    const { index } = await indexAndPoints();
    const last = pointerInfo(index, sceneOf(0), DEV_PRESENTATION, { x: index.width - 0.001, y: index.height - 0.001 });
    const expected = index.fills[index.cells[index.cells.length - 1]!];
    expect(last.fill).toBe(expected);
  });
});

describe('FR-158 frame statistics', () => {
  it('FR-158 median and 95th percentile of known samples', () => {
    expect(frameStats([])).toStrictEqual({ count: 0, median: 0, p95: 0 });
    expect(frameStats([5])).toStrictEqual({ count: 1, median: 5, p95: 5 });
    expect(frameStats([3, 1, 2])).toStrictEqual({ count: 3, median: 2, p95: 3 });
    expect(frameStats([4, 1, 3, 2])).toStrictEqual({ count: 4, median: 2.5, p95: 4 });
    const hundred = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(frameStats(hundred)).toStrictEqual({ count: 100, median: 50.5, p95: 95 });
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(frameStats(twenty).p95).toBe(19);
  });

  it('FR-158 only the last 120 frame intervals count', () => {
    expect(FRAME_WINDOW).toBe(120);
    const many = [...Array.from({ length: 300 }, () => 1000), ...Array.from({ length: 120 }, (_, i) => i + 1)];
    const s = frameStats(many);
    expect(s.count).toBe(120);
    expect(s.median).toBe(60.5);
    expect(s.p95).toBe(114);
    let samples: number[] = [];
    for (let i = 1; i <= 130; i++) samples = appendSample(samples, i);
    expect(samples).toHaveLength(120);
    expect(samples[0]).toBe(11);
    expect(samples[119]).toBe(130);
  });

  it('FR-158 the statistics do not change their input and do not depend on its order', () => {
    const input = [9, 2, 7, 4, 5];
    const copy = [...input];
    const a = frameStats(input);
    expect(input).toStrictEqual(copy);
    expect(frameStats([...input].reverse())).toStrictEqual(a);
    expect(appendSample(input, 1)).not.toBe(input);
    expect(input).toStrictEqual(copy);
  });
});
