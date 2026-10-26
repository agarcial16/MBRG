import { describe, expect, it } from 'vitest';
import { encodePublicMatch } from '@mbrg/protocol';
import type { Timing } from '@mbrg/protocol';
import { createMatch, creationEvents } from '../src/core/create';
import { publicOf } from '../src/core/view';
import type { CoreMatch } from '../src/core/view';
import { sha256 } from './helpers/core-driver';
import { devMap } from './helpers/digests';

// FR-289 (c): the first event of a match is a `schedule` event (stage `phase-1`, anchors when the clock runs), stored with
// the creation. The core builds it; the shell (M2b service) stores it in the creation transaction. Other parts of FR-289
// (numbering by the store, replay, heartbeat) are traced by their own tasks.

const T0 = 1_700_000_000_000;
const CLOCK: Timing = { i: 100, l1: 30, l2: 20 };

function created(timing: Timing): CoreMatch {
  const r = createMatch({ matchId: 'm', mapId: 'dev', mapDigest: 'd'.repeat(64), timing, commitment: 'c'.repeat(64), now: T0 }, { map: devMap(), sha256 });
  if (!r.ok) throw new Error('creation failed');
  return r.view;
}

describe('creation event', () => {
  it('FR-289 (c) a match with a clock starts with one schedule event, seq 1, stage phase-1, the anchors C1, C2 and A', () => {
    const before = created(CLOCK);
    const out = creationEvents(before, T0 + 7);
    expect(out.events).toStrictEqual([
      { type: 'schedule', seq: 1, stage: 'phase-1', schedule: { c1: T0 + 50_000, c2: T0 + 80_000, a: T0 + 100_000 }, reportedTime: T0 + 7 },
    ]);
  });

  it('FR-289 (c) a manual match has the schedule event without anchors (no `schedule` field at all)', () => {
    const out = creationEvents(created('manual'), T0);
    expect(out.events).toHaveLength(1);
    const event = out.events[0]!;
    expect(event.type).toBe('schedule');
    expect(event.seq).toBe(1);
    expect(Object.keys(event)).toStrictEqual(['type', 'seq', 'stage', 'reportedTime']);
    expect(event).toHaveProperty('stage', 'phase-1');
  });

  it('FR-289 (c) the returned view has lastSeq 1 and encodePublicMatch accepts it (a view with lastSeq 0 is refused)', () => {
    const before = created(CLOCK);
    expect(before.lastSeq).toBe(0);
    expect(() => encodePublicMatch(publicOf(before, T0))).toThrow();
    const out = creationEvents(before, T0);
    expect(out.view.lastSeq).toBe(1);
    expect(() => encodePublicMatch(publicOf(out.view, T0))).not.toThrow();
    expect(JSON.parse(encodePublicMatch(publicOf(out.view, T0))).lastSeq).toBe(1);
  });

  it('FR-289 (c) nothing else changes in the view and the input view is not modified', () => {
    const before = created(CLOCK);
    const snapshot = JSON.stringify(before);
    const out = creationEvents(before, T0);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(out.view).toStrictEqual({ ...before, lastSeq: 1 });
  });

  it('FR-289 (c) a view that already holds an event is refused: the creation event is the first one', () => {
    const once = creationEvents(created(CLOCK), T0).view;
    expect(() => creationEvents(once, T0)).toThrow(RangeError);
  });
});
