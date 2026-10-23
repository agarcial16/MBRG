import { encodeEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceSteps, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';

// FR-288 (stream) FR-289 (stream, late join): a viewer that read the public data and then subscribes with its `lastSeq`
// gets exactly the events after it, whatever the stage it joined in: nothing missed, nothing repeated.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

describe('the event stream: late join from the public data', () => {
  it('FR-288 (stream) FR-289 (stream, late join) a stream opened with the lastSeq of the public data at phase-2 gets exactly the later events', async () => {
    const h = await startReads();
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    advanceSteps(h, id, 1);
    const shown = publicOf(h, id);
    expect(shown.stage).toBe('phase-2');
    expect(shown.victim?.seq).toBe(3);
    expect(shown.lastSeq).toBe(4);
    const late = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=${shown.lastSeq}` });
    readers.push(late);
    expect(late.status).toBe(200);
    // Nothing is replayed: the victim-revealed event (seq 3) is in the public data already.
    expect(late.raw()).toBe('');
    advanceSteps(h, id, 11);
    const stored = h.base.store.eventsAfter(id, 4);
    expect(stored[0]?.type).toBe('phase-closed');
    const got = await late.takeEvents(stored.length);
    expect(got.map((f) => f.id)).toStrictEqual(stored.map((e) => e.seq));
    expect(got.map((f) => f.data)).toStrictEqual(stored.map((e) => encodeEvent(e)));
    expect(late.raw()).toBe(got.map((f) => f.raw).join(''));
    expect(stored[stored.length - 1]?.type).toBe('match-finished');
  }, 30_000);

  it('FR-288 (stream) FR-289 (stream, late join) a joiner at every boundary of a match, by parameter or by header, misses and repeats nothing', async () => {
    const h = await startReads({ limits: { anonymousStreams: 100 } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const joiners: { from: number; reader: SseReader }[] = [];
    for (let decision = 0; decision <= 12; decision += 1) {
      const from = publicOf(h, id).lastSeq;
      const byHeader = decision % 2 === 1;
      const reader = await openStream({
        port: h.port,
        path: byHeader ? `/matches/${id}/events` : `/matches/${id}/events?lastEventId=${from}`,
        headers: byHeader ? { 'last-event-id': String(from) } : {},
      });
      readers.push(reader);
      joiners.push({ from, reader });
      if (decision < 12) advanceSteps(h, id, 1);
    }
    const all = h.base.store.eventsAfter(id, 0);
    expect(all).toHaveLength(publicOf(h, id).lastSeq);
    expect(new Set(joiners.map((j) => j.from)).size).toBe(13);
    for (const { from, reader } of joiners) {
      const want = all.slice(from);
      const got = await reader.takeEvents(want.length);
      expect(got.map((f) => f.id), `from ${from}`).toStrictEqual(want.map((e) => e.seq));
      expect(got.map((f) => f.data), `from ${from}`).toStrictEqual(want.map((e) => encodeEvent(e)));
      expect(reader.raw(), `from ${from}`).toBe(got.map((f) => f.raw).join(''));
    }
  }, 60_000);
});
