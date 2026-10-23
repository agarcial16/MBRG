import { errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { SECRETS } from './helpers/core-timelines';
import { OPERATOR, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The replay read of the service (M3b T4; FR-281 (i), FR-289 (d), (e)): the stored events with a number above n and the
// stored last number, nothing for a stream without a number, `unknown-match`, `unavailable` on a storage failure, and no
// write whatever happens.

const SECRET = SECRETS['ascending-00-1f'];
const UNAVAILABLE = { ok: false, error: errorReply('unavailable') };

function start(timing: unknown = 'manual'): { h: Harness; id: string } {
  const h = serviceHarness({ secret: SECRET });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing }) });
  if (!out.ok) throw new Error('creation failed');
  return { h, id: out.reply.matchId };
}
const advance = (h: Harness, id: string, round: number, step: StepKind): void => {
  const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round, step } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};

/** The store with every write refusing: a read that wrote would throw. */
const readOnly = (base: Store): Store => {
  const refuse = (): never => {
    throw new Error('a write was attempted');
  };
  return { ...base, putMatch: refuse, putState: refuse, putRecord: refuse, putStep: refuse, putPrediction: refuse, appendEvents: refuse, memoPut: refuse, memoPurge: refuse, transaction: refuse } as Store;
};

describe('service events: the replay read', () => {
  it('FR-281 (i) the events after n come back in order with the stored last number', () => {
    const { h, id } = start();
    advance(h, id, 1, 'phase-1-close');
    advance(h, id, 1, 'phase-2-close');
    const stored = h.store.eventsAfter(id, 0);
    expect(stored.map((e) => e.seq)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    const all = h.service.eventsAfter(id, 0);
    expect(all).toStrictEqual({ ok: true, reply: { lastSeq: 6, events: stored } });
    for (const n of [1, 2, 3, 4, 5]) expect(h.service.eventsAfter(id, n), String(n)).toStrictEqual({ ok: true, reply: { lastSeq: 6, events: stored.slice(n) } });
    h.close();
  });

  it('FR-281 (i) a number at or above the last one gives no events and the stored last number; no number gives no events too', () => {
    const { h, id } = start();
    advance(h, id, 1, 'phase-1-close');
    const last = h.store.getMatch(id)!.match.lastSeq;
    for (const n of [last, last + 1, 1_000, Number.MAX_SAFE_INTEGER]) {
      expect(h.service.eventsAfter(id, n), String(n)).toStrictEqual({ ok: true, reply: { lastSeq: last, events: [] } });
    }
    expect(h.service.eventsAfter(id, undefined)).toStrictEqual({ ok: true, reply: { lastSeq: last, events: [] } });
    h.close();
  });

  it('FR-281 (i) the creation events are in the replay from 0 (a clock match stores its schedule first)', () => {
    const { h, id } = start({ i: 120, l1: 30, l2: 10 });
    const out = h.service.eventsAfter(id, 0);
    expect(out.ok && out.reply.events.map((e: MatchEvent) => e.type)).toStrictEqual(['schedule']);
    h.close();
  });

  it('FR-281 (i) an unknown match, or an id that is not a text, is unknown-match', () => {
    const { h } = start();
    for (const id of ['nope', '', 'x'.repeat(200), 5 as unknown as string]) {
      expect(h.service.eventsAfter(id, 0), String(id)).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
      expect(h.service.eventsAfter(id, undefined), String(id)).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    }
    h.close();
  });

  it('FR-281 (i) a number that is not a whole number from 0 is a programming error of the caller', () => {
    const { h, id } = start();
    for (const n of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => h.service.eventsAfter(id, n), String(n)).toThrow(RangeError);
    h.close();
  });

  it('FR-292 (reads) a storage failure of the replay read is unavailable, whichever read fails', () => {
    const { h, id } = start();
    advance(h, id, 1, 'phase-1-close');
    const fail = (): never => {
      throw new StoreError('store-failure', 'injected read failure');
    };
    const failing = (patch: Partial<Store>): MatchService =>
      createMatchService({ store: { ...h.store, ...patch } as Store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings });
    expect(failing({ eventsAfter: fail }).eventsAfter(id, 0)).toStrictEqual(UNAVAILABLE);
    expect(failing({ getMatch: fail }).eventsAfter(id, 0)).toStrictEqual(UNAVAILABLE);
    expect(failing({ getMatch: fail }).eventsAfter(id, undefined)).toStrictEqual(UNAVAILABLE);
    // A closed connection is a storage failure too.
    const closed = serviceHarness({ store: openStore(':memory:') });
    closed.store.close();
    expect(closed.service.eventsAfter(id, 0)).toStrictEqual(UNAVAILABLE);
    h.close();
  });

  it('FR-292 (reads) a programming error of the replay read is not hidden as unavailable', () => {
    const { h, id } = start();
    const wrong = createMatchService({
      store: { ...h.store, eventsAfter: () => { throw new RangeError('inconsistent stored data'); } } as Store,
      clock: h.clock,
      maps: createMapCatalog(h.settings.maps),
      settings: h.settings,
    });
    expect(() => wrong.eventsAfter(id, 0)).toThrow(RangeError);
    h.close();
  });

  it('FR-281 (i) the replay read writes nothing', () => {
    const { h, id } = start();
    advance(h, id, 1, 'phase-1-close');
    const before = h.store.eventsAfter(id, 0);
    const reader = createMatchService({ store: readOnly(h.store), clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings });
    for (const n of [undefined, 0, 1, 99]) expect(reader.eventsAfter(id, n).ok, String(n)).toBe(true);
    expect(reader.eventsAfter('nope', 0).ok).toBe(false);
    expect(h.store.eventsAfter(id, 0)).toStrictEqual(before);
    h.close();
  });
});
