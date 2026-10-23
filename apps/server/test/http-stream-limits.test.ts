import { afterEach, describe, expect, it } from 'vitest';
import { request } from './helpers/http-client';
import { bearer, makeMatch, startReads } from './helpers/http-reads-kit';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';
import { StoreError } from '../src/store/store';

// The open-stream limits on the wire (M3b T5; FR-299 (b), (c), (e), D28; FR-301 order): the gauge is checked at stage 1 with the
// per-minute admission, a refusal is 429 with `Retry-After` and `retryAfter`, counts nowhere, and a place goes back when a
// request ends without a stream or a stream closes. Limits are lowered through the settings of the harness.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

async function stream(h: ServerHarness, id: string, headers: Record<string, string> = {}, query = ''): Promise<SseReader> {
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events${query}`, headers });
  readers.push(reader);
  return reader;
}

/** Waits (real time) until the hub reports `count` open streams: a client's disconnect reaches the server a moment later. */
async function waitOpen(h: ServerHarness, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (h.streams.openCount() !== count) {
    if (Date.now() > deadline) throw new Error(`open streams: ${h.streams.openCount()}, wanted ${count}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const refusal = async (reader: SseReader): Promise<{ kind: unknown; retryAfter: unknown }> => {
  const parsed = JSON.parse(await reader.body()) as { kind: unknown; retryAfter: unknown };
  return { kind: parsed.kind, retryAfter: parsed.retryAfter };
};

describe('http event stream limits: the open-stream gauge', () => {
  it('FR-299 (stream limits, HTTP) the sixth anonymous stream is 429 with Retry-After 15 and retryAfter 15; one closing admits it again', async () => {
    const h = await startReads();
    const { id } = makeMatch(h);
    const open: SseReader[] = [];
    for (let i = 0; i < 5; i += 1) {
      const reader = await stream(h, id);
      expect(reader.status).toBe(200);
      open.push(reader);
    }
    const sixth = await stream(h, id);
    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBe('15');
    expect(sixth.headers['content-type']).toBe('application/json');
    expect(await refusal(sixth)).toStrictEqual({ kind: 'rate-limited', retryAfter: 15 });
    expect(h.streams.openCount()).toBe(5);
    open[0]?.close();
    await waitOpen(h, 4);
    const again = await stream(h, id);
    expect(again.status).toBe(200);
    expect(h.streams.openCount()).toBe(5);
  });

  it('FR-299 (stream limits, HTTP) a refusal by the gauge cancels the read ticket: the per-minute count is unchanged', async () => {
    // anonymous: 4 reads per minute; two streams take two of them, the refused third must take none.
    const h = await startReads({ limits: { anonymous: 4, anonymousStreams: 2 } });
    const { id } = makeMatch(h);
    expect((await stream(h, id)).status).toBe(200);
    expect((await stream(h, id)).status).toBe(200);
    expect((await stream(h, id)).status).toBe(429);
    expect((await request(h.port, { path: '/matches' })).status).toBe(200);
    expect((await request(h.port, { path: '/matches' })).status).toBe(200);
    const last = await request(h.port, { path: '/matches' });
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBe('60');
  });

  it('FR-299 (stream limits, HTTP) opening a stream is one read of the per-minute limit: with that limit used up it is refused with the per-minute wait', async () => {
    const h = await startReads({ limits: { anonymous: 2 } });
    const { id } = makeMatch(h);
    expect((await stream(h, id)).status).toBe(200);
    expect((await request(h.port, { path: '/matches' })).status).toBe(200);
    h.clock.advance(7_000);
    const refused = await stream(h, id);
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('53');
    expect(await refusal(refused)).toStrictEqual({ kind: 'rate-limited', retryAfter: 53 });
    // The gauge place of the refused request went back at once: the gauge has room for the rest of the five.
    expect(h.streams.openCount()).toBe(1);
  });

  it('FR-299 (stream limits, HTTP) when both limits refuse, the wait is the larger one', async () => {
    const h = await startReads({ limits: { anonymous: 1, anonymousStreams: 1 } });
    const { id } = makeMatch(h);
    expect((await stream(h, id)).status).toBe(200);
    const both = await stream(h, id);
    expect(both.status).toBe(429);
    expect(both.headers['retry-after']).toBe('60');
    h.clock.advance(50_000);
    // Per-minute wait 10 s, gauge 15 s: the larger is sent.
    const later = await stream(h, id);
    expect(later.status).toBe(429);
    expect(later.headers['retry-after']).toBe('15');
  });

  it('FR-299 (stream limits, HTTP) a client credential at its own limit is refused while the address is still free, and the reverse', async () => {
    const h = await startReads({ limits: { streams: 1, anonymousStreams: 2 } });
    const { id } = makeMatch(h);
    const own = bearer(CLIENT_CREDENTIAL);
    expect((await stream(h, id, own)).status).toBe(200);
    const second = await stream(h, id, own);
    expect(second.status).toBe(429);
    expect(await refusal(second)).toStrictEqual({ kind: 'rate-limited', retryAfter: 15 });
    // The address has all its places: two anonymous streams fit, the third does not.
    expect((await stream(h, id)).status).toBe(200);
    expect((await stream(h, id)).status).toBe(200);
    expect((await stream(h, id)).status).toBe(429);
    // The operator has a credential gauge of its own.
    expect((await stream(h, id, bearer(OPERATOR))).status).toBe(200);
    expect((await stream(h, id, bearer(OPERATOR))).status).toBe(429);
    expect(h.streams.openCount()).toBe(4);
  });

  it('FR-299 (stream limits, HTTP) a host token or a token nothing confirms counts as anonymous on the stream route', async () => {
    const h = await startReads({ limits: { anonymousStreams: 1 } });
    const { id, hostToken } = makeMatch(h);
    expect((await stream(h, id, bearer(hostToken))).status).toBe(200);
    expect((await stream(h, id, bearer('a-token-nothing-knows-0123456789'))).status).toBe(429);
    expect((await stream(h, id)).status).toBe(429);
  });

  it('FR-299 (stream limits, HTTP) a 404 or a 400 on the stream route gives its place back: six refusals, then a stream is accepted', async () => {
    const h = await startReads({ limits: { anonymousStreams: 1 } });
    const { id } = makeMatch(h);
    for (let i = 0; i < 6; i += 1) {
      const missing = await stream(h, `nope-${i}`);
      expect(missing.status).toBe(404);
      await missing.body();
    }
    for (let i = 0; i < 6; i += 1) {
      const bad = await stream(h, id, {}, '?lastEventId=-1');
      expect(bad.status).toBe(400);
      await bad.body();
    }
    expect((await stream(h, id)).status).toBe(200);
    expect(h.streams.openCount()).toBe(1);
  });

  it('FR-299 (stream limits, HTTP) a client that disconnects gives its place back', async () => {
    const h = await startReads({ limits: { anonymousStreams: 1 } });
    const { id } = makeMatch(h);
    const first = await stream(h, id);
    expect(first.status).toBe(200);
    expect((await stream(h, id)).status).toBe(429);
    first.close();
    await waitOpen(h, 0);
    expect((await stream(h, id)).status).toBe(200);
  });

  it('FR-299 (stream limits, HTTP) a storage failure at the open gives its place back too', async () => {
    let failing = true;
    const h = await startReads({
      limits: { anonymousStreams: 1 },
      wrapStore: (store) => ({
        ...store,
        eventsAfter: (matchId, seq) => {
          if (failing) throw new StoreError('store-failure', 'injected read failure');
          return store.eventsAfter(matchId, seq);
        },
      }),
    });
    const { id } = makeMatch(h);
    for (let i = 0; i < 3; i += 1) {
      const reader = await stream(h, id, {}, '?lastEventId=0');
      expect(reader.status).toBe(503);
      await reader.body();
    }
    failing = false;
    expect((await stream(h, id, {}, '?lastEventId=0')).status).toBe(200);
  });

  it('FR-301 (order, stream route) rate-limited comes before unknown-match and before a bad query', async () => {
    const h = await startReads({ limits: { anonymousStreams: 1 } });
    const { id } = makeMatch(h);
    expect((await stream(h, id)).status).toBe(200);
    const unknown = await stream(h, 'nope');
    expect(unknown.status).toBe(429);
    expect((await refusal(unknown)).kind).toBe('rate-limited');
    const bad = await stream(h, id, {}, '?lastEventId=-1&zed=1');
    expect(bad.status).toBe(429);
    expect((await refusal(bad)).kind).toBe('rate-limited');
    // The order of the other answers: 404 unknown-path, then 400, then 404 unknown-match, for a free address.
    const free = await startReads();
    makeMatch(free);
    const noMatch = await stream(free, 'nope', {}, '?lastEventId=-1');
    expect(noMatch.status).toBe(400);
    expect((await stream(free, 'nope')).status).toBe(404);
  });
});
