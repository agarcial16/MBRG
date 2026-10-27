// Reading the archive on demand (spec 010 FR-362): a viewer that joined late holds no record of the earlier rounds; when the user asks
// for the facts that need them, the model reads them one at a time, newest first, never above N, and stops when none is missing.
import { describe, expect, it } from 'vitest';
import type { LiveEffect } from '../src/core/live-model';
import { missingRecords } from '../src/core/live-stats';
import { Driver, eventsOfRound, requestRounds, scripted, type Scripted } from './helpers/scripted-match';

const recordReads = (effects: readonly LiveEffect[]): number[] => effects.filter((e) => e.type === 'read-record').map((e) => (e as { round: number }).round);

async function joined(s: Scripted, n: number): Promise<Driver> {
  const d = new Driver(s);
  await d.load(n);
  return d;
}

describe('FR-362 the archive is read on demand', () => {
  it('FR-362 a late joiner reads no record until the archive is asked for', async () => {
    const s = await scripted();
    const d = await joined(s, 3);
    expect(recordReads(d.effects)).toStrictEqual([]);
    expect(missingRecords(d.model, 3)).toStrictEqual([3, 2, 1]);
  });

  it('FR-362 asking for the archive reads every missing record once, newest first, and the model ends with all of them equal to the server', async () => {
    const s = await scripted();
    const d = await joined(s, 3);
    await d.feed({ type: 'archive', at: d.at });
    expect(recordReads(d.effects)).toStrictEqual([3, 2, 1]);
    expect(missingRecords(d.model, 3)).toStrictEqual([]);
    for (const k of [1, 2, 3]) expect(d.model.records.get(k)).toStrictEqual(s.records[k - 1]);
    expect(d.model.asking).toBeUndefined();
  });

  it('FR-362 it never asks for a round above N, and a model that already holds everything asks for nothing', async () => {
    const s = await scripted();
    const d = await joined(s, 2);
    await d.feed({ type: 'archive', at: d.at });
    expect(Math.max(...recordReads(d.effects))).toBeLessThanOrEqual(d.model.applied);
    expect(recordReads(d.effects)).toStrictEqual([2, 1]);
    const before = d.effects.length;
    await d.feed({ type: 'archive', at: d.at });
    expect(d.effects.length).toBe(before);
    const full = new Driver(s);
    await full.load(0);
    for (let k = 1; k <= 2; k++) await full.events(eventsOfRound(s, k));
    await full.feed({ type: 'archive', at: full.at });
    expect(recordReads(full.effects)).toStrictEqual([]);
  });

  it('FR-362 one read at a time: a second ask while a read is in flight sends nothing more, and the rest follow when it is answered', async () => {
    const s = await scripted();
    const d = await joined(s, 3);
    d.holdReads = true;
    await d.feed({ type: 'archive', at: d.at });
    await d.feed({ type: 'archive', at: d.at });
    expect(requestRounds(d.effects).length).toBe(1);
    expect(d.model.asking).toBe(3);
    d.holdReads = false;
    await d.release();
    expect(recordReads(d.effects)).toStrictEqual([3, 2, 1]);
    expect(missingRecords(d.model, 3)).toStrictEqual([]);
  });

  it('FR-362 before the first public data the ask is ignored', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.feed({ type: 'archive', at: d.at });
    expect(d.effects).toStrictEqual([]);
    expect(d.model.archive).toBe(false);
  });

  it('FR-362 a failed read is asked again by the schedule and the archive goes on from there', async () => {
    const s = await scripted();
    const d = await joined(s, 2);
    d.failures.push({ outcome: 'retry' });
    await d.feed({ type: 'archive', at: d.at });
    expect(d.model.wait).toBeDefined();
    expect(d.model.asking).toBe(2);
    await d.feed({ type: 'tick', at: d.model.wait!.until });
    expect(missingRecords(d.model, 2)).toStrictEqual([]);
  });
});
