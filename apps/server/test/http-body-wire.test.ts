import { afterEach, describe, expect, it } from 'vitest';
import { head, raw } from './helpers/http-client';
import { closeAllServers, errorBody, startServer } from './helpers/server-harness';

// FR-298 on the wire (M3a' review fix): every request that carries a body is bounded to 4,096 bytes, whatever the route,
// and a reply sent while a body over the limit is still unread closes the connection (so the platform never drains it).

afterEach(closeAllServers);

const chunk = (text: string): string => `${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`;
const chunked = (method: string, path: string, text: string, extra: Record<string, string> = {}): (string | Buffer)[] => [
  head(method, path, { 'transfer-encoding': 'chunked', ...extra }),
  `${chunk(text)}0\r\n\r\n`,
];
/** A JSON object whose encoded size is exactly `size` bytes. */
const objectOfSize = (size: number): string => `{"a":"${'x'.repeat(size - 8)}"}`;

describe('FR-298 (wire) a body is bounded on every route', () => {
  it('a chunked body over 4,096 bytes sent to a route without a body is 413 and the connection closes', async () => {
    const h = await startServer();
    const reply = await raw(h.port, chunked('GET', '/ping', 'x'.repeat(10_000)));
    expect(reply.status).toBe(413);
    expect(reply.body).toBe(errorBody('too-large'));
    expect(reply.headers.connection).toBe('close');
    expect(reply.closed).toBe(true);
  });

  it('a declared length over 4,096 and a chunked body over 4,096 are both 413 on a route without a body', async () => {
    const h = await startServer();
    const declared = await raw(h.port, [head('GET', '/ping', { 'content-length': '5000' })]);
    expect(declared.status).toBe(413);
    expect(declared.closed).toBe(true);
    const streamed = await raw(h.port, chunked('GET', '/ping', 'x'.repeat(4097)));
    expect(streamed.status).toBe(413);
  });

  it('a small body sent to a route without a body is ignored: the request is answered normally', async () => {
    const h = await startServer();
    const small = await raw(h.port, [head('GET', '/ping', { 'content-length': '5', connection: 'close' }), 'hello']);
    expect(small.status).toBe(200);
    const streamed = await raw(h.port, chunked('GET', '/ping', 'hello', { connection: 'close' }));
    expect(streamed.status).toBe(200);
  });

  it('a chunked body over 4,096 bytes sent to a body route is still 413 and closes', async () => {
    const h = await startServer();
    const reply = await raw(h.port, chunked('POST', '/echo', 'x'.repeat(6000)));
    expect(reply.status).toBe(413);
    expect(reply.closed).toBe(true);
  });

  it('exactly 4,096 bytes are accepted on a body route, declared and chunked; one more byte is not', async () => {
    const h = await startServer();
    const exact = objectOfSize(4096);
    expect(Buffer.byteLength(exact)).toBe(4096);
    const declared = await raw(h.port, [head('POST', '/echo', { 'content-length': '4096', connection: 'close' }), exact]);
    expect(declared.status).toBe(200);
    const streamed = await raw(h.port, chunked('POST', '/echo', exact, { connection: 'close' }));
    expect(streamed.status).toBe(200);
    const over = await raw(h.port, chunked('POST', '/echo', objectOfSize(4097), { connection: 'close' }));
    expect(over.status).toBe(413);
  });

  it('exactly 4,096 bytes sent to a route without a body are accepted and ignored', async () => {
    const h = await startServer();
    const streamed = await raw(h.port, chunked('GET', '/ping', 'x'.repeat(4096), { connection: 'close' }));
    expect(streamed.status).toBe(200);
  });
});

describe('FR-298 (wire) a reply sent before the body stage closes the connection when a large body is unread', () => {
  const big = { 'content-length': '1000000000' };

  it('429, 404, 405 and the preflight 204 with an unread declared body of a billion bytes close the connection', async () => {
    const h = await startServer({ limits: { anonymous: 3 } });
    const cases: [number, string, string][] = [
      [404, 'POST', '/nope'],
      [405, 'POST', '/read-only'],
      [204, 'OPTIONS', '/ping'],
      [429, 'POST', '/echo'],
    ];
    for (const [status, method, path] of cases) {
      const reply = await raw(h.port, [head(method, path, big)]);
      expect([method, path, reply.status, reply.headers.connection, reply.closed]).toStrictEqual([method, path, status, 'close', true]);
    }
  });

  it('the same replies with an unread chunked body close the connection (its size is unknown)', async () => {
    const h = await startServer({ limits: { anonymous: 1 } });
    // The body is never terminated: the reply must not wait for it.
    const open = (method: string, path: string): Promise<Awaited<ReturnType<typeof raw>>> =>
      raw(h.port, [head(method, path, { 'transfer-encoding': 'chunked' }), `${chunk('x'.repeat(100))}`]);
    const unknown = await open('POST', '/nope');
    expect([unknown.status, unknown.headers.connection, unknown.closed]).toStrictEqual([404, 'close', true]);
    const refused = await open('POST', '/echo');
    expect([refused.status, refused.headers.connection, refused.closed]).toStrictEqual([429, 'close', true]);
  });

  it('a reply to a request with no body or a small one keeps the connection open', async () => {
    const h = await startServer();
    const none = await raw(h.port, [head('GET', '/ping')], 400);
    expect([none.status, none.closed, none.headers.connection]).toStrictEqual([200, false, 'keep-alive']);
    const small = await raw(h.port, [head('POST', '/nope', { 'content-length': '10' }), 'abcdefghij'], 400);
    expect([small.status, small.closed, small.headers.connection]).toStrictEqual([404, false, 'keep-alive']);
  });
});
