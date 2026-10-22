import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MapData } from '@mbrg/shared';
import type { MatchState } from '@mbrg/sim';

// Digest definitions of spec 008 (Definitions, P32), built here for tests only (platform crypto).

export const DEV_DIR = fileURLToPath(new URL('../../../../maps/dev/', import.meta.url));
const FILES = ['map.json', 'ids.png', 'presentation.json'] as const;

/** Map digest: SHA-256 hex of, for each file in order: UTF-8 name, a zero byte, the length as 8-byte big-endian, the bytes as stored. */
export function mapDigest(dir: string = DEV_DIR): string {
  const hash = createHash('sha256');
  for (const name of FILES) {
    const bytes = readFileSync(dir + name);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(Buffer.from(name, 'utf8')).update(Buffer.from([0])).update(length).update(bytes);
  }
  return hash.digest('hex');
}

/** State text: `classic;<round>;<t1>:<f1>,<t2>:<f2>,...` (owners in map order, no spaces). */
export function stateText(state: MatchState): string {
  return `classic;${state.round};${state.owners.map(([t, f]) => `${t}:${f}`).join(',')}`;
}

/** State digest: SHA-256 hex of the ASCII state text. */
export function stateDigest(state: MatchState): string {
  return createHash('sha256').update(stateText(state), 'ascii').digest('hex');
}

export function devMap(): MapData {
  return JSON.parse(readFileSync(DEV_DIR + 'map.json', 'utf8')) as MapData;
}
