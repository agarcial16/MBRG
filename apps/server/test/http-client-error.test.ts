import { afterEach, describe, expect, it } from 'vitest';
import { answerClientError, clientErrorStatus } from '../src/http/client-error';
import { head, raw } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';

// Replies Node writes itself (a header block over 8,192 bytes, a malformed request, a request that took too long) carry the
// fixed headers and the closed JSON body like every other reply (NFR-52 network, plan 18.4b), and no CORS headers.

afterEach(closeAllServers);

const FIXED = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close' };

describe('client errors answered by the platform', () => {
  it('NFR-52 (network) a header block over 8,192 bytes is 431 with the fixed headers, a JSON body and no CORS headers', async () => {
    const h = await startServer();
    const over = await raw(h.port, [head('GET', '/ping', { 'x-fill': 'a'.repeat(9000), origin: 'https://app.example' })]);
    expect(over.status).toBe(431);
    expect(over.headers).toMatchObject(FIXED);
    expect(over.headers['content-length']).toBe(String(Buffer.byteLength(over.body)));
    expect(over.body).toBe('{"kind":"invalid-request"}');
    expect(Object.keys(over.headers).filter((name) => name.startsWith('access-control-'))).toStrictEqual([]);
    expect(over.closed).toBe(true);
  });

  it('NFR-52 (network) a malformed request line is 400 with the same headers and body', async () => {
    const h = await startServer();
    const bad = await raw(h.port, ['GET /ping HTTP/9.9 junk\r\nHost: x\r\n\r\n']);
    expect(bad.status).toBe(400);
    expect(bad.headers).toMatchObject(FIXED);
    expect(bad.body).toBe('{"kind":"invalid-request"}');
  });

  it('NFR-52 (network) the status of a platform error: header overflow 431, request timeout 408, anything else 400', () => {
    expect(clientErrorStatus('HPE_HEADER_OVERFLOW')).toBe(431);
    expect(clientErrorStatus('ERR_HTTP_REQUEST_TIMEOUT')).toBe(408);
    expect(clientErrorStatus('HPE_INVALID_METHOD')).toBe(400);
    expect(clientErrorStatus(undefined)).toBe(400);
  });

  it('NFR-52 (network) a request timeout is answered 408 with the fixed headers; a socket already written to is only closed', () => {
    const written: string[] = [];
    let ended = 0;
    let destroyed = 0;
    const socket = {
      writable: true,
      bytesWritten: 0,
      end: (text: string) => {
        written.push(text);
        ended += 1;
      },
      destroy: () => {
        destroyed += 1;
      },
    };
    answerClientError(Object.assign(new Error('x'), { code: 'ERR_HTTP_REQUEST_TIMEOUT' }), socket as never);
    expect(ended).toBe(1);
    const text = written[0] as string;
    expect(text.startsWith('HTTP/1.1 408 Request Timeout\r\n')).toBe(true);
    for (const line of ['Content-Type: application/json', 'Cache-Control: no-store', 'X-Content-Type-Options: nosniff', 'Connection: close', 'Content-Length: 26']) {
      expect(text).toContain(`\r\n${line}\r\n`);
    }
    expect(text.endsWith('\r\n\r\n{"kind":"invalid-request"}')).toBe(true);
    const busy = { ...socket, bytesWritten: 10 };
    answerClientError(new Error('x'), busy as never);
    expect([ended, destroyed]).toStrictEqual([1, 1]);
    const dead = { ...socket, writable: false };
    answerClientError(new Error('x'), dead as never);
    expect([ended, destroyed]).toStrictEqual([1, 2]);
  });
});
