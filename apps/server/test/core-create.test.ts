import { describe, expect, it } from 'vitest';
import { encodeEvent, encodePublicMatch } from '@mbrg/protocol';
import type { Timing } from '@mbrg/protocol';
import { createLobby, createMatch, creationEvents, lobbyEvents } from '../src/core/create';
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

// A public match starts as a lobby: no clock, no anchors, no round yet; its first event is a `schedule` event of stage `lobby`
// (the lobby part of the creation rules; the ids are closed by the service tasks).
describe('lobby creation', () => {
  const input = (timing: Timing) => ({ matchId: 'm', mapId: 'dev', mapDigest: 'd'.repeat(64), timing, commitment: 'c'.repeat(64), now: T0 + 4_321.9 });
  const lobby = (timing: Timing): CoreMatch => {
    const r = createLobby(input(timing), { map: devMap(), sha256 });
    if (!r.ok) throw new Error('lobby creation failed');
    return r.view;
  };

  it('a lobby is in stage lobby with no applied round, the state at round 0, no anchors and no event yet', () => {
    const view = lobby(CLOCK);
    expect(view.stage).toBe('lobby');
    expect(view.appliedRounds).toBe(0);
    expect(view.state.round).toBe(0);
    expect(view.anchors).toBeNull();
    expect(view.lastSeq).toBe(0);
    expect(view.createdAt).toBe(T0 + 4_321);
    expect(view.lastStepMs).toBe(T0 + 4_321);
    expect(view.timing).toStrictEqual(CLOCK);
  });

  it('a lobby holds the same map data as a match created from the same input (only stage, anchors differ)', () => {
    const match = created(CLOCK);
    const view = createLobby({ ...input(CLOCK), now: T0 }, { map: devMap(), sha256 });
    if (!view.ok) throw new Error('lobby creation failed');
    expect(view.view).toStrictEqual({ ...match, stage: 'lobby', anchors: null });
  });

  it('a lobby of a manual match is the same as one with a clock except for the timing', () => {
    expect(lobby('manual')).toStrictEqual({ ...lobby(CLOCK), timing: 'manual' });
  });

  it('a map with errors is refused as for a match', () => {
    const r = createLobby(input(CLOCK), { map: { not: 'a map' }, sha256 });
    expect(r.ok).toBe(false);
    expect(createMatch(input(CLOCK), { map: { not: 'a map' }, sha256 })).toStrictEqual(r);
  });

  it('the lobby event is a schedule event, seq 1, stage lobby, with no anchors and the reported time', () => {
    const out = lobbyEvents(lobby(CLOCK), T0 + 9);
    expect(out.events).toStrictEqual([{ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: T0 + 9 }]);
    expect(Object.keys(out.events[0]!)).toStrictEqual(['type', 'seq', 'stage', 'reportedTime']);
    expect(out.view.lastSeq).toBe(1);
    expect(() => encodeEvent(out.events[0]!)).not.toThrow();
  });

  it('the lobby view after its event is encodable with a player count of 0, and not without the event', () => {
    const before = lobby(CLOCK);
    expect(() => encodePublicMatch({ ...publicOf(before, T0), playerCount: 0 })).toThrow();
    const out = lobbyEvents(before, T0);
    const body = JSON.parse(encodePublicMatch({ ...publicOf(out.view, T0), playerCount: 0 }));
    expect(body.stage).toBe('lobby');
    expect(body.playerCount).toBe(0);
    expect(body).not.toHaveProperty('schedule');
  });

  it('nothing else changes in the view, the input is not modified and a second event is refused', () => {
    const before = lobby(CLOCK);
    const snapshot = JSON.stringify(before);
    const out = lobbyEvents(before, T0);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(out.view).toStrictEqual({ ...before, lastSeq: 1 });
    expect(() => lobbyEvents(out.view, T0)).toThrow(RangeError);
  });

  it('a view that is not a lobby does not get a lobby event', () => {
    expect(() => lobbyEvents(created(CLOCK), T0)).toThrow(RangeError);
  });
});
