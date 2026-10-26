import { encodeEvent } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { raw, head, request } from './helpers/http-client';
import { advanceSteps, bearer, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { baseEnv, withMain } from './helpers/main-child';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS } from './helpers/service-harness';
import { StoreError } from '../src/store/store';

// The event-stream route over a real listener (M3b T5): the headers, the starting number, the errors before the first byte,
// live events and the join from the public data. Fake clock and scheduler (the heartbeat is driven by the test); the reader
// is the hand-written one of helpers/sse-reader.ts.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const ALLOWED = 'https://app.example';
const OTHER = 'https://evil.example';

async function stream(h: ServerHarness, id: string, query = '', headers: Record<string, string> = {}): Promise<SseReader> {
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events${query}`, headers });
  readers.push(reader);
  return reader;
}
const stored = (h: ServerHarness, id: string, after = 0): MatchEvent[] => h.base.store.eventsAfter(id, after);
const dataOf = (events: readonly MatchEvent[]): string[] => events.map((e) => encodeEvent(e));
const corsOf = (headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => k.startsWith('access-control-') || k === 'vary'));
const kind = (text: string): unknown => (JSON.parse(text) as { kind?: unknown }).kind;
const items = (text: string): unknown => (JSON.parse(text) as { items?: unknown }).items;

describe('http event stream: headers and cross-origin rules', () => {
  it('FR-286 (stream headers) 200 with exactly the stream headers, no Content-Length, chunked, and the first byte at once', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const reader = await stream(h, id, '?lastEventId=0');
    expect(reader.status).toBe(200);
    expect(reader.headers['content-type']).toBe('text/event-stream');
    expect(reader.headers['cache-control']).toBe('no-store');
    expect(reader.headers['x-content-type-options']).toBe('nosniff');
    expect(reader.headers['content-length']).toBeUndefined();
    expect(reader.headers['transfer-encoding']).toBe('chunked');
    expect(corsOf(reader.headers)).toStrictEqual({});
    const live = await stream(h, id);
    expect(live.status).toBe(200);
    expect(live.raw()).toBe('');
    expect(h.streams.openCount()).toBe(2);
  });

  it('FR-286 (stream headers) any Origin without Authorization is allowed with `*`', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const origin of [OTHER, ALLOWED, 'null']) {
      const reader = await stream(h, id, '', { origin });
      expect(reader.status).toBe(200);
      expect(corsOf(reader.headers), origin).toStrictEqual({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' });
    }
  });

  it('FR-286 (stream headers) with Authorization only an allowed origin is echoed, with Vary: Origin, and `*` is never sent', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const echoed = await stream(h, id, '', { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect(echoed.status).toBe(200);
    expect(corsOf(echoed.headers)).toStrictEqual({ 'access-control-allow-origin': ALLOWED, vary: 'Origin', 'access-control-expose-headers': 'retry-after' });
    const other = await stream(h, id, '', { origin: OTHER, ...bearer(CLIENT_CREDENTIAL) });
    expect(other.status).toBe(200);
    expect(corsOf(other.headers)).toStrictEqual({});
  });

  it('FR-286 (stream preflight) the preflight listing last-event-id is answered for any origin and allows that header', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const origin of [OTHER, ALLOWED]) {
      const reply = await request(h.port, {
        method: 'OPTIONS',
        path: `/matches/${id}/events`,
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'last-event-id' },
      });
      expect([origin, reply.status, reply.text]).toStrictEqual([origin, 204, '']);
      expect(corsOf(reply.headers), origin).toStrictEqual({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'last-event-id',
        'access-control-max-age': '600',
      });
    }
    expect(h.streams.openCount()).toBe(0);
  });
});

describe('http event stream: the starting number', () => {
  it('FR-289 (stream) lastEventId=0 replays from the creation schedule event, each frame the encoded stored event', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    advanceSteps(h, id, 2);
    const all = stored(h, id);
    expect(all[0]?.type).toBe('schedule');
    const reader = await stream(h, id, '?lastEventId=0');
    const got = await reader.takeEvents(all.length);
    expect(got.map((f) => f.id)).toStrictEqual(all.map((e) => e.seq));
    expect(got.map((f) => f.data)).toStrictEqual(dataOf(all));
    expect(got.map((f) => f.raw).join('')).toBe(reader.raw());
  });

  it('FR-289 (stream) the Last-Event-ID header wins over the parameter, and either alone gives the events after it', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    advanceSteps(h, id, 2);
    const all = stored(h, id);
    const byHeader = await stream(h, id, '?lastEventId=0', { 'last-event-id': '2' });
    expect((await byHeader.takeEvents(all.length - 2)).map((f) => f.id)).toStrictEqual(all.slice(2).map((e) => e.seq));
    const byParameter = await stream(h, id, '?lastEventId=3');
    expect((await byParameter.takeEvents(all.length - 3)).map((f) => f.id)).toStrictEqual(all.slice(3).map((e) => e.seq));
    const headerZero = await stream(h, id, '?lastEventId=5', { 'last-event-id': '0' });
    expect((await headerZero.takeEvents(all.length)).map((f) => f.id)).toStrictEqual(all.map((e) => e.seq));
  });

  it('FR-289 (stream) a number above the latest gives nothing and stays open; so does one beyond the safe range', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const last = stored(h, id).length;
    const above = await stream(h, id, `?lastEventId=${last + 4}`);
    const beyond = await stream(h, id, '?lastEventId=9007199254740992');
    const huge = await stream(h, id, '', { 'last-event-id': '9'.repeat(40) });
    expect([above.status, beyond.status, huge.status]).toStrictEqual([200, 200, 200]);
    advanceSteps(h, id, 1);
    // The events are below the filter: the first frame each stream sends is the heartbeat comment.
    h.scheduler.runTo(START_MS + 14_000);
    for (const reader of [above, beyond, huge]) {
      const frame = await reader.next();
      expect(frame).toMatchObject({ kind: 'comment', text: '' });
      expect(reader.raw()).toBe(':\n\n');
    }
    expect(h.streams.openCount()).toBe(3);
  });

  it('FR-289 (stream) an invalid number is 400 naming the header or the parameter, before any stream byte', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const [query, headers, field] of [
      ['?lastEventId=-1', {}, 'lastEventId'],
      ['?lastEventId=01', {}, 'lastEventId'],
      ['?lastEventId=', {}, 'lastEventId'],
      ['?lastEventId=1.5', {}, 'lastEventId'],
      ['?lastEventId=1e3', {}, 'lastEventId'],
      ['?lastEventId=1&lastEventId=2', {}, 'lastEventId'],
      ['', { 'last-event-id': '01' }, 'Last-Event-ID'],
      ['', { 'last-event-id': 'abc' }, 'Last-Event-ID'],
      ['?lastEventId=1', { 'last-event-id': '-5' }, 'Last-Event-ID'],
    ] as const) {
      const reader = await stream(h, id, query, headers);
      expect([query, reader.status]).toStrictEqual([query, 400]);
      expect(reader.headers['content-type']).toBe('application/json');
      const text = await reader.body();
      expect([kind(text), items(text)], `${query} ${JSON.stringify(headers)}`).toStrictEqual(['invalid-request', [field]]);
    }
    expect(h.streams.openCount()).toBe(0);
  });

  it('FR-289 (stream) two Last-Event-ID header values are 400 naming the header', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const reply = await raw(h.port, [head('GET', `/matches/${id}/events`, {}).replace('\r\n\r\n', '\r\nLast-Event-ID: 1\r\nLast-Event-ID: 2\r\nConnection: close\r\n\r\n')]);
    expect(reply.status).toBe(400);
    expect([kind(reply.body), items(reply.body)]).toStrictEqual(['invalid-request', ['Last-Event-ID']]);
  });

  it('FR-289 (stream) an unknown query parameter is 400 naming it, the first in sorted order', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const [query, name] of [['?foo=1', 'foo'], ['?lastEventId=0&zed=1&abc=2', 'abc'], ['?limit=5', 'limit']] as const) {
      const reader = await stream(h, id, query);
      expect(reader.status).toBe(400);
      const text = await reader.body();
      expect([kind(text), items(text)]).toStrictEqual(['invalid-request', [name]]);
    }
  });
});

describe('http event stream: errors before the first byte', () => {
  it('FR-281 (i) an unknown or malformed match is 404 unknown-match as JSON, nothing streamed', async () => {
    const h = await startReads();
    makeMatch(h);
    for (const id of ['nope', 'x'.repeat(300), '%41', '.', '..']) {
      const reader = await stream(h, id, '?lastEventId=0');
      expect([id, reader.status]).toStrictEqual([id, 404]);
      expect(reader.headers['content-type']).toBe('application/json');
      expect(kind(await reader.body())).toBe('unknown-match');
    }
    expect(h.streams.openCount()).toBe(0);
  });

  it('FR-285 (event stream) the stream route needs no credential and a bad credential does not change the answer', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const headers of [{}, bearer('not-a-credential-0123456789'), bearer(CLIENT_CREDENTIAL), bearer(OPERATOR)]) {
      const reader = await stream(h, id, '', headers);
      expect(reader.status).toBe(200);
    }
  });

  it('FR-280 (Server-Sent Events) any other method on the path is 405 with Allow: GET, OPTIONS', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const reply = await request(h.port, { method, path: `/matches/${id}/events`, ...(method === 'POST' ? { body: {} } : {}) });
      expect([method, reply.status]).toStrictEqual([method, 405]);
      expect(reply.headers.allow).toBe('GET, OPTIONS');
      if (method !== 'HEAD') expect(kind(reply.text)).toBe('method-not-allowed');
    }
    expect((await request(h.port, { path: `/matches/${id}/events/` })).status).toBe(404);
    expect(h.streams.openCount()).toBe(0);
  });

  it('FR-281 (i) a storage failure of the replay read is 503 unavailable as JSON before any stream byte', async () => {
    const h = await startReads({
      wrapStore: (store) => ({
        ...store,
        eventsAfter: () => {
          throw new StoreError('store-failure', 'injected read failure');
        },
      }),
    });
    const { id } = makeMatch(h);
    const reader = await stream(h, id, '?lastEventId=0');
    expect(reader.status).toBe(503);
    expect(reader.headers['content-type']).toBe('application/json');
    expect(kind(await reader.body())).toBe('unavailable');
    expect(h.streams.openCount()).toBe(0);
    // The same server streams once the store reads again: nothing was left half open (the lease went back).
    const live = await stream(h, id);
    expect(live.status).toBe(200);
  });
});

describe('http event stream: live events and joining from the public data', () => {
  it('FR-289 (stream) events committed after the open arrive in order, each frame the encoded stored event', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const live = await stream(h, id);
    advanceSteps(h, id, 3);
    const added = stored(h, id, 1);
    const got = await live.takeEvents(added.length);
    expect(got.map((f) => f.id)).toStrictEqual(added.map((e) => e.seq));
    expect(got.map((f) => f.data)).toStrictEqual(dataOf(added));
    expect(live.raw()).toBe(got.map((f) => f.raw).join(''));
  });

  it('FR-289 (b) the lastSeq of the public data, then a stream with it, misses nothing and repeats nothing', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    advanceSteps(h, id, 2);
    const shown = (await request(h.port, { path: `/matches/${id}` })).json() as { lastSeq: number };
    expect(shown.lastSeq).toBe(publicOf(h, id).lastSeq);
    // A decision lands between the read and the join.
    advanceSteps(h, id, 1);
    const reader = await stream(h, id, `?lastEventId=${shown.lastSeq}`);
    advanceSteps(h, id, 1);
    const expected = stored(h, id, shown.lastSeq);
    expect(expected.length).toBeGreaterThan(2);
    const got = await reader.takeEvents(expected.length);
    expect(got.map((f) => f.id)).toStrictEqual(expected.map((e) => e.seq));
    expect(got.map((f) => f.data)).toStrictEqual(dataOf(expected));
  });
});

describe('http event stream: the entry point', () => {
  it('NFR-52 (network) main.ts builds the hub: a real stream of the started server carries a created match\'s first event', async () => {
    await withMain(baseEnv(), async (_child, port) => {
      const created = await request(port, {
        method: 'POST',
        path: '/matches',
        headers: { authorization: `Bearer ${OPERATOR}`, 'content-type': 'application/json' },
        body: { mapId: 'dev', timing: 'manual', requestId: 'child-1' },
      });
      expect(created.status).toBe(201);
      const matchId = (created.json() as { matchId: string }).matchId;
      const reader = await openStream({ port, path: `/matches/${matchId}/events?lastEventId=0` });
      try {
        expect(reader.status).toBe(200);
        const [first] = await reader.takeEvents(1, 10_000);
        expect(first?.id).toBe(1);
        expect(JSON.parse(first?.data ?? '{}')).toMatchObject({ type: 'schedule', seq: 1, stage: 'phase-1' });
      } finally {
        reader.close();
      }
    });
  }, 60_000);
});
