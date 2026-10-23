import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, parseBodyBytes } from '../src/http/body';
import { raw, head, request } from './helpers/http-client';
import { PLANTED, closeAllServers, errorBody, startServer } from './helpers/server-harness';

// The bounded body reader (M3a' T2'a): a pure parse of the bytes, then the same rules over a real socket: a declared length
// above 4,096 is answered before any body byte is sent, a chunked body is cut at 4,096, exactly 4,096 is read.

afterEach(closeAllServers);

const bytes = (text: string): Uint8Array => Buffer.from(text, 'utf8');
const INVALID_BODY = { kind: 'error', error: { kind: 'invalid-request', items: ['body'] } };

/** A JSON object text of exactly `size` bytes. */
const objectOfSize = (size: number): string => {
  const filler = size - '{"a":""}'.length;
  return `{"a":"${'x'.repeat(filler)}"}`;
};

describe('body parsing (pure)', () => {
  it('FR-296 (transport) the limit is 4,096 bytes: 4,096 is read and 4,097 is too-large', () => {
    expect(MAX_BODY_BYTES).toBe(4096);
    const exact = parseBodyBytes(bytes(objectOfSize(4096)));
    expect(exact.kind).toBe('body');
    expect(parseBodyBytes(bytes(objectOfSize(4097)))).toStrictEqual({ kind: 'error', error: { kind: 'too-large' } });
    expect(parseBodyBytes(bytes(objectOfSize(4095))).kind).toBe('body');
  });

  it('FR-296 (transport) valid JSON objects pass, anything else is invalid-request naming body', () => {
    expect(parseBodyBytes(bytes('{"a":1,"b":[1,2]}'))).toStrictEqual({ kind: 'body', value: { a: 1, b: [1, 2] } });
    expect(parseBodyBytes(bytes(' \n{"a":1}\t '))).toStrictEqual({ kind: 'body', value: { a: 1 } });
    for (const text of ['', ' ', '[]', '[{"a":1}]', 'null', '1', '"text"', 'true', '{', '{"a":}', "{'a':1}", '{"a":1}{"b":2}', '{"a":1,}', 'undefined', '﻿{"a":1}']) {
      expect(parseBodyBytes(bytes(text)), JSON.stringify(text)).toStrictEqual(INVALID_BODY);
    }
  });

  it('FR-296 (transport) bytes that are not UTF-8 are invalid-request, whatever the JSON would be', () => {
    for (const invalid of [[0xc3, 0x28], [0xff], [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe2, 0x82, 0x22, 0x7d], [0xed, 0xa0, 0x80]]) {
      expect(parseBodyBytes(Uint8Array.from(invalid)), invalid.join(',')).toStrictEqual(INVALID_BODY);
    }
    expect(parseBodyBytes(bytes('{"a":"é€"}'))).toStrictEqual({ kind: 'body', value: { a: 'é€' } });
  });

  it('FR-296 (transport) a __proto__ member is an own property of the parsed object, not a prototype', () => {
    const parsed = parseBodyBytes(bytes('{"__proto__":{"polluted":true}}'));
    if (parsed.kind !== 'body') throw new Error('expected a body');
    expect(Object.prototype.hasOwnProperty.call(parsed.value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(parsed.value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('body reading over a real socket', () => {
  it('FR-296 (transport) a body of exactly 4,096 bytes is read, 4,095 too', async () => {
    const h = await startServer();
    for (const size of [4096, 4095, 100]) {
      const reply = await request(h.port, { method: 'POST', path: '/echo', body: objectOfSize(size) });
      expect([size, reply.status, reply.text]).toStrictEqual([size, 200, '{"keys":1}']);
    }
  });

  it('FR-296 (transport) Content-Length 4,097 is answered 413 with no body byte sent, and the connection closes', async () => {
    const h = await startServer();
    const reply = await raw(h.port, [head('POST', '/echo', { 'content-length': '4097', 'content-type': 'application/json' })]);
    expect(reply.status).toBe(413);
    expect(reply.body).toBe(errorBody('too-large'));
    expect(reply.headers.connection).toBe('close');
    expect(reply.closed).toBe(true);
    expect(h.logs).toStrictEqual([]);
  });

  it('FR-296 (transport) a body of 4,097 bytes sent in full is 413 as well, without the client library', async () => {
    const h = await startServer();
    const reply = await raw(h.port, [head('POST', '/echo', { 'content-length': '4097' }), objectOfSize(4097)]);
    expect(reply.status).toBe(413);
  });

  it('FR-296 (transport) a chunked body is counted as it arrives: 4,096 is read, a byte more is 413', async () => {
    const h = await startServer();
    const chunked = (text: string, size: number): (string | Buffer)[] => {
      const parts: (string | Buffer)[] = [head('POST', '/echo', { 'transfer-encoding': 'chunked', connection: 'close' })];
      for (let at = 0; at < text.length; at += size) {
        const piece = text.slice(at, at + size);
        parts.push(`${piece.length.toString(16)}\r\n${piece}\r\n`);
      }
      parts.push('0\r\n\r\n');
      return parts;
    };
    const exact = await raw(h.port, chunked(objectOfSize(4096), 1000));
    expect(exact.status).toBe(200);
    expect(exact.body).toContain('{"keys":1}');
    const over = await raw(h.port, chunked(objectOfSize(4097), 1000));
    expect(over.status).toBe(413);
    expect(over.body).toContain(errorBody('too-large'));
    // The cut happens at the chunk that passes the limit: three chunks of 1,500 (4,500 bytes) are refused too.
    expect((await raw(h.port, chunked(objectOfSize(4500), 1500))).status).toBe(413);
    // The answer comes as soon as the count passes 4,096, without waiting for the end of the body (no final chunk is sent).
    const open = await raw(h.port, [head('POST', '/echo', { 'transfer-encoding': 'chunked' }), `1001\r\n${'x'.repeat(4097)}\r\n`], 1500);
    expect(open.status).toBe(413);
    expect(open.closed).toBe(true);
    expect(h.logs).toStrictEqual([]);
  });

  it('FR-296 (transport) invalid UTF-8, a JSON syntax error, an array, null and an empty body are invalid-request naming body', async () => {
    const h = await startServer();
    const bad: [string, Buffer | string][] = [
      ['invalid utf-8', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])],
      ['syntax', `{"a":${PLANTED}}`],
      ['array', '[1,2]'],
      ['null', 'null'],
      ['empty', ''],
      ['number', '12'],
    ];
    for (const [name, body] of bad) {
      const reply = await request(h.port, { method: 'POST', path: '/echo', body, headers: { 'content-length': String(Buffer.byteLength(body)) } });
      expect([name, reply.status, reply.text]).toStrictEqual([name, 400, '{"kind":"invalid-request","items":["body"]}']);
      expect(reply.text).not.toContain(PLANTED);
    }
    // A POST with no body at all (no length, no chunking) is an empty body.
    const none = await raw(h.port, [head('POST', '/echo', { connection: 'close' })]);
    expect(none.status).toBe(400);
    expect(JSON.stringify(h.logs)).not.toContain(PLANTED);
    expect(h.logs).toStrictEqual([]);
  });

  it('FR-296 (transport) a route without a body ignores one, and a client that leaves mid-body costs nothing', async () => {
    const h = await startServer();
    const ignored = await request(h.port, { path: '/ping', headers: { 'content-length': '4' }, body: 'abcd' });
    expect(ignored.status).toBe(200);
    // The client promises 100 bytes, sends 10 and goes away: no reply is possible, nothing is logged, the server lives on.
    const left = await raw(h.port, [head('POST', '/echo', { 'content-length': '100' }), '{"a":"xxxx'], 300);
    expect(left.status).toBe(0);
    expect(h.logs).toStrictEqual([]);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
  });
});
