import { describe, expect, it, vi } from 'vitest';
import { encodeError, mapDigestBytes, rateLimited, type MapFileName } from '@mbrg/protocol';
import { createLiveNet, type DigestApi, type StreamEnd, type StreamHandlers } from '../src/ui/live-net';
import { reduce, startLive, type LiveEffect, type LiveInput, type LiveModel } from '../src/core/live-model';
import { createFakeServer, frameText, type FakeServer } from './helpers/fake-server';
import { MATCH_ID, eventsFrom, eventsOfRound, publicAt, recordReply, scripted, stateReply, type Scripted } from './helpers/scripted-match';

const BASE = 'https://mbrg.test';
const DEV_DIGEST = '4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679';
const REAL: DigestApi = {
  available: () => true,
  sha256Hex: async (bytes) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};

async function setup(n = 3): Promise<{ s: Scripted; server: FakeServer; net: ReturnType<typeof createLiveNet> }> {
  const s = await scripted();
  const server = await createFakeServer(s, n);
  return { s, server, net: createLiveNet({ base: BASE, fetch: server.fetch, digest: REAL }) };
}

const handlers = (log: string[] = [], frames: unknown[] = []): StreamHandlers => ({
  opened: () => log.push('opened'),
  bytes: () => log.push('bytes'),
  frame: (data) => frames.push(data),
});
const start = (after: number, via: 'parameter' | 'header') => ({ after, via });

describe('FR-307 (transport) the reads are credential-free GETs', () => {
  it('FR-307 (transport) every read uses credentials omit and no custom header, and names the documented path', async () => {
    const { s, server, net } = await setup(3);
    const pub = await net.readPublic(MATCH_ID);
    expect(pub.ok && pub.value).toStrictEqual(publicAt(s, 3, { mapDigest: server.mapDigest }));
    const state = await net.readState(MATCH_ID, 2);
    expect(state.ok && state.value).toStrictEqual(stateReply(s, 2));
    const record = await net.readRecord(MATCH_ID, 2);
    expect(record.ok && record.value).toStrictEqual(recordReply(s, 2));
    const files = await net.readMapFiles('dev', server.mapDigest);
    expect(files.ok).toBe(true);
    expect(server.requests.map((r) => r.url)).toStrictEqual([
      `${BASE}/matches/${MATCH_ID}`,
      `${BASE}/matches/${MATCH_ID}/states/2`,
      `${BASE}/matches/${MATCH_ID}/records/2`,
      `${BASE}/maps/dev/map.json`,
      `${BASE}/maps/dev/ids.png`,
      `${BASE}/maps/dev/presentation.json`,
    ]);
    for (const r of server.requests) {
      expect(r.credentials, r.url).toBe('omit');
      expect(r.headers, r.url).toStrictEqual({});
    }
  });

  it('FR-307 (transport) a trailing slash on the server origin is dropped', async () => {
    const { server } = await setup(1);
    const net = createLiveNet({ base: `${BASE}/`, fetch: server.fetch, digest: REAL });
    await net.readState(MATCH_ID, 0);
    expect(server.requests[0]?.url).toBe(`${BASE}/matches/${MATCH_ID}/states/0`);
  });

  it('FR-307 (transport) failures are classified: unknown-match is fatal, a 503, a 429 with Retry-After, a network fault and an unreadable reply are retried', async () => {
    const { server, net } = await setup(3);
    server.forced.push({ status: 404, body: encodeError({ kind: 'unknown-match' }) });
    expect(await net.readPublic(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'unknown-match' });
    server.forced.push({ status: 503, body: encodeError({ kind: 'unavailable' }) });
    expect(await net.readState(MATCH_ID, 1)).toStrictEqual({ ok: false, outcome: 'retry' });
    server.forced.push({ status: 429, body: encodeError(rateLimited(7)), headers: { 'retry-after': '7' } });
    expect(await net.readRecord(MATCH_ID, 1)).toStrictEqual({ ok: false, outcome: 'retry', retryAfterMs: 7000 });
    server.forced.push('network');
    expect(await net.readPublic(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'retry' });
    server.forced.push({ status: 200, body: 'not json' });
    expect(await net.readPublic(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'retry' });
    server.forced.push({ status: 200, body: '{"matchId":"x"}' });
    expect(await net.readPublic(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'retry' });
    server.forced.push({ status: 404, body: '<html>' });
    expect(await net.readState(MATCH_ID, 1)).toStrictEqual({ ok: false, outcome: 'retry' });
    // A round above N is a plain 404 reply of the server: retried like any other refusal, never fatal.
    expect(await net.readState(MATCH_ID, 9)).toStrictEqual({ ok: false, outcome: 'retry' });
    // An unknown match from a path other than a 404 is not fatal.
    server.forced.push({ status: 500, body: encodeError({ kind: 'unknown-match' }) });
    expect(await net.readState(MATCH_ID, 1)).toStrictEqual({ ok: false, outcome: 'retry' });
  });
});

describe('FR-308 the map files are checked against the announced digest', () => {
  it('FR-308 the digest of the raw bytes of the dev map files is the pinned literal', async () => {
    const { server } = await setup(0);
    expect(server.mapDigest).toBe(DEV_DIGEST);
    expect(await REAL.sha256Hex(mapDigestBytes(server.files))).toBe(DEV_DIGEST);
  });

  it('FR-308 the files are read as bytes, in the order of the digest, and returned when the digest matches', async () => {
    const { server, net } = await setup(0);
    const read = await net.readMapFiles('dev', DEV_DIGEST);
    if (!read.ok) throw new Error('read');
    for (const name of Object.keys(server.files) as MapFileName[]) expect([...read.value[name]]).toStrictEqual([...server.files[name]]);
  });

  it('FR-308 a changed byte of any file gives digest-mismatch and no file', async () => {
    for (const name of ['map.json', 'ids.png', 'presentation.json'] as const) {
      const { server, net } = await setup(0);
      const file = server.files[name];
      const last = file.length - 1;
      file[last] = (file[last] as number) ^ 1;
      expect(await net.readMapFiles('dev', DEV_DIGEST), name).toStrictEqual({ ok: false, outcome: 'fatal', fatal: 'digest-mismatch' });
    }
  });

  it('FR-308 the digest is over the bytes, not the decoded text: a file that decodes to the same text with other bytes does not match', async () => {
    const { server, net } = await setup(0);
    // A byte order mark in front changes the bytes but not what a text decoder shows.
    const text = server.files['map.json'];
    server.files['map.json'] = new Uint8Array([0xef, 0xbb, 0xbf, ...text]);
    expect(await net.readMapFiles('dev', DEV_DIGEST)).toStrictEqual({ ok: false, outcome: 'fatal', fatal: 'digest-mismatch' });
  });

  it('FR-308 without a digest function the answer is insecure-origin and no request is sent (fail closed)', async () => {
    const { server } = await setup(2);
    const net = createLiveNet({ base: BASE, fetch: server.fetch, digest: { available: () => false, sha256Hex: REAL.sha256Hex } });
    expect(await net.readPublic(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'fatal', fatal: 'insecure-origin' });
    expect(await net.readMapFiles('dev', DEV_DIGEST)).toStrictEqual({ ok: false, outcome: 'fatal', fatal: 'insecure-origin' });
    expect(server.requests).toStrictEqual([]);
  });

  it('FR-308 a file that cannot be read is a failure to retry, not a mismatch', async () => {
    const { server, net } = await setup(0);
    server.forced.push({ status: 200, body: 'x' }, { status: 503, body: encodeError({ kind: 'unavailable' }) });
    expect(await net.readMapFiles('dev', DEV_DIGEST)).toStrictEqual({ ok: false, outcome: 'retry' });
  });
});

describe('FR-289 (d) (transport) the stream is read over fetch', () => {
  it('FR-289 (d) (transport) the first connection carries lastEventId and no header; a reconnection carries the header and no parameter', async () => {
    const { server, net } = await setup(2);
    const control = new AbortController();
    const first = net.openStream(MATCH_ID, start(17, 'parameter'), handlers(), control.signal);
    await vi.waitFor(() => expect(server.streams()).toBe(1));
    const second = net.openStream(MATCH_ID, start(21, 'header'), handlers(), control.signal);
    await vi.waitFor(() => expect(server.streams()).toBe(2));
    const [one, two] = server.requests;
    expect(one?.path).toBe(`/matches/${MATCH_ID}/events`);
    expect(one?.query).toBe('?lastEventId=17');
    expect(one?.headers).toStrictEqual({});
    expect(two?.path).toBe(`/matches/${MATCH_ID}/events`);
    expect(two?.query).toBe('');
    expect(two?.headers).toStrictEqual({ 'last-event-id': '21' });
    for (const r of server.requests) expect(r.credentials).toBe('omit');
    control.abort();
    expect(await first).toStrictEqual({ type: 'aborted' });
    expect(await second).toStrictEqual({ type: 'aborted' });
  });

  it('FR-289 (d) (transport) frames cut anywhere in a chunk reach the handlers as parsed data, heartbeats count as bytes only, a bad body is null', async () => {
    const { s, server, net } = await setup(2);
    const log: string[] = [];
    const frames: unknown[] = [];
    const control = new AbortController();
    const running = net.openStream(MATCH_ID, start(1, 'parameter'), handlers(log, frames), control.signal);
    await vi.waitFor(() => expect(server.streams()).toBe(1));
    const events = eventsOfRound(s, 1);
    const text = frameText(events[0]) + ': heartbeat\n\n' + frameText(events[1]) + 'id: 9\ndata: {oops\n\n';
    const cut = Math.floor(frameText(events[0]).length / 2);
    server.push(text.slice(0, cut));
    server.push(text.slice(cut));
    await vi.waitFor(() => expect(frames).toHaveLength(3));
    expect(frames).toStrictEqual([events[0], events[1], null]);
    expect(log[0]).toBe('opened');
    expect(log.filter((x) => x === 'opened')).toHaveLength(1);
    expect(log.filter((x) => x === 'bytes')).toHaveLength(2);
    control.abort();
    expect(await running).toStrictEqual({ type: 'aborted' });
  });

  it('FR-289 (d) (transport) a body that ends or errors after opening is a drop', async () => {
    const { server, net } = await setup(2);
    for (const how of ['end', 'fail'] as const) {
      const log: string[] = [];
      const running = net.openStream(MATCH_ID, start(1, 'header'), handlers(log), new AbortController().signal);
      await vi.waitFor(() => expect(log).toContain('opened'));
      server[how]();
      const done: StreamEnd = await running;
      expect(done, how).toStrictEqual({ type: 'dropped' });
    }
  });

  it('FR-307 (transport) a stream that never opens is a failure classified like a read: unknown-match fatal, 503 and 429 with Retry-After retried, a network fault retried', async () => {
    const { server, net } = await setup(2);
    const never = handlers();
    const signal = new AbortController().signal;
    server.forced.push({ status: 404, body: encodeError({ kind: 'unknown-match' }) });
    expect(await net.openStream(MATCH_ID, start(1, 'parameter'), never, signal)).toStrictEqual({ type: 'failed', failure: { ok: false, outcome: 'unknown-match' } });
    server.forced.push({ status: 503, body: encodeError({ kind: 'unavailable' }) });
    expect(await net.openStream(MATCH_ID, start(1, 'header'), never, signal)).toStrictEqual({ type: 'failed', failure: { ok: false, outcome: 'retry' } });
    server.forced.push({ status: 429, body: encodeError(rateLimited(3)), headers: { 'retry-after': '3' } });
    expect(await net.openStream(MATCH_ID, start(1, 'header'), never, signal)).toStrictEqual({ type: 'failed', failure: { ok: false, outcome: 'retry', retryAfterMs: 3000 } });
    server.forced.push('network');
    expect(await net.openStream(MATCH_ID, start(1, 'header'), never, signal)).toStrictEqual({ type: 'failed', failure: { ok: false, outcome: 'retry' } });
    expect(server.streams()).toBe(0);
  });
});

/** A small runner like the one M5' builds: it runs the effects of the model against the net and feeds the results back. */
function watch(server: FakeServer) {
  let model: LiveModel = startLive(MATCH_ID).model;
  let clock = 1000;
  const appliedAtRequest: number[] = [];
  const net = createLiveNet({
    base: BASE,
    fetch: (input, init) => (appliedAtRequest.push(model.applied), server.fetch(input, init)),
    digest: REAL,
  });
  let stream = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  const now = (): number => (clock += 10);

  const feed = (input: LiveInput): void => {
    chain = chain.then(async () => {
      const out = reduce(model, input);
      model = out.model;
      for (const effect of out.effects) await run(effect);
    });
  };

  async function run(effect: LiveEffect): Promise<void> {
    if (effect.type === 'read-public') {
      const r = await net.readPublic(MATCH_ID);
      if (r.ok) feed({ type: 'public', at: now(), match: r.value });
    } else if (effect.type === 'read-state') {
      const r = await net.readState(MATCH_ID, effect.round);
      if (r.ok) feed({ type: 'state', at: now(), reply: r.value });
    } else if (effect.type === 'read-record') {
      const r = await net.readRecord(MATCH_ID, effect.round);
      if (r.ok) feed({ type: 'record', at: now(), reply: r.value });
    } else if (effect.type === 'hash-state') {
      feed({ type: 'digest', at: now(), digest: await REAL.sha256Hex(new TextEncoder().encode(effect.text)) });
    } else if (effect.type === 'open-stream') {
      stream = new AbortController();
      const into: StreamHandlers = {
        opened: () => feed({ type: 'opened', at: now() }),
        bytes: () => feed({ type: 'bytes', at: now() }),
        frame: (data) => feed({ type: 'event', at: now(), data }),
      };
      void net.openStream(MATCH_ID, effect, into, stream.signal);
    } else if (effect.type === 'close-stream') {
      stream.abort();
    }
  }

  return { feed, appliedAtRequest, model: () => model, start: () => void run({ type: 'read-public' }) };
}

describe('FR-254 (client requests) the transport never names a round above N', () => {
  it('FR-254 (client requests) over a scripted whole match with browsing, every state and record request names a round at most the N of that moment', async () => {
    const s = await scripted();
    // Joined at round 2: only that state is held, so browsing has to read the earlier ones.
    const server = await createFakeServer(s, 2);
    const run = watch(server);
    run.start();
    await vi.waitFor(() => expect(server.streams()).toBe(1));
    const browse = async (k: number): Promise<void> => {
      for (const action of ['first', 'next', 'next', 'last', 'previous', 'last'] as const) run.feed({ type: 'navigate', at: 5000, action });
      await vi.waitFor(() => expect(run.model().displayed).toBe(k), { timeout: 4000 });
    };
    await browse(2);
    for (let k = 3; k <= s.total; k++) {
      server.n = k;
      for (const event of eventsOfRound(s, k)) server.push(frameText(event));
      await vi.waitFor(() => expect(run.model().applied).toBe(k), { timeout: 4000 });
      await browse(k);
    }
    await vi.waitFor(() => expect(run.model().phase).toBe('closed'), { timeout: 4000 });
    expect(run.model().stage).toBe('finished');
    const named = server.requests.flatMap((r, i) => (r.round === undefined ? [] : [{ round: r.round, applied: run.appliedAtRequest[i] as number }]));
    // Not vacuous: browsing read earlier states and records.
    expect(server.requests.some((r) => r.path.includes('/states/'))).toBe(true);
    expect(server.requests.some((r) => r.path.includes('/records/'))).toBe(true);
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const { round, applied } of named) expect(round).toBeLessThanOrEqual(applied);
  });
});

