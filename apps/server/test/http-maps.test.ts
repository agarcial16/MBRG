import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MAP_FILE_NAMES, mapDigestBytes } from '@mbrg/protocol';
import type { MapFileName } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_DIR } from './helpers/digests';
import { head, raw } from './helpers/http-client';
import { get, kindOf, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { closeAllServers, errorBody } from './helpers/server-harness';
import { writeMapPackage } from './helpers/service-harness';

// The three map files over a real listener (M3a' T3', FR-281 (j), FR-285): the bytes as stored, the package digest the viewer
// computes over the downloaded bytes, the content types, the lengths, and the paths that must not reach the file system.

afterEach(closeAllServers);

const bytesOf = async (h: Awaited<ReturnType<typeof startReads>>, path: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> => {
  const reply = await raw(h.port, [head('GET', path, { connection: 'close' })]);
  return { status: reply.status, headers: reply.headers, body: Buffer.from(reply.body, 'latin1') };
};

const CONTENT_TYPE: Record<MapFileName, string> = { 'map.json': 'application/json', 'ids.png': 'image/png', 'presentation.json': 'application/json' };

describe('http map files', () => {
  it('FR-285 FR-281 (HTTP) the three files answer 200 without Authorization with the bytes on disk, their length and their content type', async () => {
    const h = await startReads();
    for (const name of MAP_FILE_NAMES) {
      const disk = readFileSync(join(DEV_DIR, name));
      const reply = await bytesOf(h, `/maps/dev/${name}`);
      expect([name, reply.status]).toStrictEqual([name, 200]);
      expect(reply.body.equals(disk), `${name} bytes`).toBe(true);
      expect(reply.headers['content-length']).toBe(String(disk.length));
      expect(reply.headers['content-type']).toBe(CONTENT_TYPE[name]);
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('FR-285 (digest rule over HTTP) the package digest over the downloaded bytes equals the map digest of the match', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const files = {} as Record<MapFileName, Uint8Array>;
    for (const name of MAP_FILE_NAMES) files[name] = Uint8Array.from((await bytesOf(h, `/maps/dev/${name}`)).body);
    const digest = createHash('sha256').update(mapDigestBytes(files)).digest('hex');
    expect(digest).toBe(publicOf(h, m.id).mapDigest);
    // A single changed byte of a downloaded file does not verify.
    const tampered = { ...files, 'map.json': Uint8Array.from(files['map.json'], (b, i) => (i === 10 ? b ^ 1 : b)) };
    expect(createHash('sha256').update(mapDigestBytes(tampered)).digest('hex')).not.toBe(publicOf(h, m.id).mapDigest);
  });

  it('FR-281 (HTTP) an unlisted or malformed map id is unknown-map 404 and another file name is unknown-path 404', async () => {
    const h = await startReads();
    for (const id of ['other', 'DEV', 'dev.', '__proto__', 'constructor', 'toString', '%64ev', '..', '.', 'a%2Fb', '%2e%2e', 'x'.repeat(100)]) {
      const reply = await get(h, `/maps/${id}/map.json`);
      expect([id, reply.status, reply.text]).toStrictEqual([id, 404, errorBody('unknown-map')]);
    }
    for (const file of ['other.txt', 'map.json.bak', 'MAP.JSON', 'map.json%00', '..', '.', '..%2Fmap.json', '%2e%2e%2fmap.json', 'map.json%20', 'ids.PNG', 'package.json', 'constructor', '__proto__']) {
      const reply = await get(h, `/maps/dev/${file}`);
      expect([file, reply.status, reply.text]).toStrictEqual([file, 404, errorBody('unknown-path')]);
    }
    // Segment counts that are not /maps/{id}/{file}.
    for (const path of ['/maps', '/maps/', '/maps/dev', '/maps/dev/', '/maps/dev/map.json/', '/maps/dev/a/map.json', '/maps//map.json', '/maps/../maps/dev/map.json']) {
      expect([path, (await get(h, path)).status]).toStrictEqual([path, 404]);
    }
    // The unknown map is answered before the file name is looked at only when the name is one of the three.
    expect(kindOf(await get(h, '/maps/other/other.txt'))).toBe('unknown-path');
  });

  it('FR-281 (HTTP) raw traversal targets are never joined to a folder: dot segments and encoded separators stay unknown', async () => {
    const h = await startReads();
    for (const target of ['/maps/dev/../../package.json', '/maps/dev/%2e%2e/%2e%2e/package.json', '/maps/..%5Cdev/map.json']) {
      const reply = await raw(h.port, [head('GET', target, { connection: 'close' })]);
      expect([target, reply.status]).toStrictEqual([target, 404]);
      expect(reply.body).not.toContain('"name"');
    }
  });

  it('FR-281 (HTTP) a query on a map file is invalid-request, HEAD and POST are method-not-allowed', async () => {
    const h = await startReads();
    expect((await get(h, '/maps/dev/map.json?v=1')).json()).toStrictEqual({ kind: 'invalid-request', items: ['v'] });
    const headReply = await raw(h.port, [head('HEAD', '/maps/dev/map.json', { connection: 'close' })]);
    expect([headReply.status, headReply.headers.allow]).toStrictEqual([405, 'GET, OPTIONS']);
    expect(headReply.body).toBe('');
  });

  it('FR-281 (HTTP) a listed package whose file cannot be read is 503 unavailable, never a partial body', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = writeMapPackage(dir, 'copy', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const h = await startReads({ service: { folders: { copy: folder } } });
      expect((await bytesOf(h, '/maps/copy/map.json')).status).toBe(200);
      rmSync(join(folder, 'map.json'));
      const gone = await get(h, '/maps/copy/map.json');
      expect([gone.status, gone.text]).toStrictEqual([503, errorBody('unavailable')]);
      expect((await bytesOf(h, '/maps/copy/ids.png')).status).toBe(200);
    });
  });

  it('FR-281 (HTTP) a file replaced after its size was read is served with the length of the bytes read, never a mismatch', async () => {
    const stale = Buffer.from('short');
    const replaced = Buffer.from('this replacement file is a lot longer than the size that was read first');
    const h = await startReads({
      stub: {
        mapFile: (_mapId, name) => ({
          ok: true,
          reply: { name: name as MapFileName, size: stale.length, open: () => Readable.from([replaced.subarray(0, 20), replaced.subarray(20)]) },
        }),
      },
    });
    const reply = await bytesOf(h, '/maps/dev/map.json');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-length']).toBe(String(replaced.length));
    expect(reply.body.equals(replaced)).toBe(true);
  });

  it('FR-281 (HTTP) a file that fails while it is read is 503 with nothing of it sent', async () => {
    const h = await startReads({
      stub: {
        mapFile: (_mapId, name) => ({
          ok: true,
          reply: {
            name: name as MapFileName,
            size: 100,
            open: () =>
              new Readable({
                read() {
                  this.push(Buffer.from('partial bytes'));
                  this.destroy(new Error('read failed /private/path'));
                },
              }),
          },
        }),
      },
    });
    const reply = await bytesOf(h, '/maps/dev/ids.png');
    expect([reply.status, reply.body.toString('utf8')]).toStrictEqual([503, errorBody('unavailable')]);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(h.logs).toStrictEqual([]);
  });

  it('FR-281 (HTTP) a file that changes on disk between two requests is served as it is each time', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = writeMapPackage(dir, 'copy', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const h = await startReads({ service: { folders: { copy: folder } } });
      const first = await bytesOf(h, '/maps/copy/presentation.json');
      writeFileSync(join(folder, 'presentation.json'), '{"changed":true}');
      const second = await bytesOf(h, '/maps/copy/presentation.json');
      expect([first.status, second.status, second.body.toString('utf8'), second.headers['content-length']]).toStrictEqual([200, 200, '{"changed":true}', '16']);
    });
  });
});
