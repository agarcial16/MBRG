import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { CREATION_PATH } from '../src/service/matches';
import type { CreateOutcome } from '../src/service/matches';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { commitment } from '../src/secret';
import { credentialDigest } from '../src/service/ids';
import { withFaults, InjectedFault } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { DEV_DIR, devMap, mapDigest, stateDigest } from './helpers/digests';
import { credentialTextColumns, listColumns, scanValues, withRawDb } from './helpers/db-scan';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The creation part of the lifecycle service (M2b T5): FR-231, FR-232, FR-235, FR-236, FR-238; the commitment part of FR-259
// (the reveal of the secret at the end of a match is the steps task); NFR-54 (store): what the database holds about credentials.

const created = (h: Harness, requestId: string, extra: Record<string, unknown> = {}): Extract<CreateOutcome, { ok: true }> => {
  const out = h.service.create({ credential: OPERATOR, body: creationBody(requestId, extra) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return out;
};

const failed = (h: Harness, credential: string | undefined, body: unknown): { kind: string; items?: readonly string[] } => {
  const out = h.service.create({ credential, body });
  if (out.ok) throw new Error('creation unexpectedly succeeded');
  return out.error;
};

// The dev map file exactly as stored: the map digest covers its bytes.
const DEV_MAP_TEXT = readFileSync(DEV_DIR + 'map.json', 'utf8');
const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

describe('creation', () => {
  it('FR-231 creation with the operator credential stores the match, the secret, the host-token digest and the creation event, and replies with the public data at round 0', () => {
    const h = serviceHarness();
    try {
      const out = created(h, 'req-1');
      const { matchId, match, hostToken } = out.reply;
      const stored = h.store.getMatch(matchId);
      expect(stored).toBeDefined();
      // The secret is the first draw of the random source, in plain form (D14); the host token is stored as a digest.
      expect(Array.from(stored!.secret)).toStrictEqual(Array.from(h.draws[0]!.bytes));
      expect(stored!.hostTokenDigest).toBe(credentialDigest(hostToken));
      expect(stored!.match.stage).toBe('phase-1');
      expect(stored!.match.appliedRounds).toBe(0);
      expect(stored!.match.createdAt).toBe(START_MS);
      expect(stored!.match.lastSeq).toBe(1);
      expect(h.store.eventsAfter(matchId, 0)).toStrictEqual([
        {
          type: 'schedule',
          seq: 1,
          stage: 'phase-1',
          schedule: { c1: START_MS + 80_000, c2: START_MS + 110_000, a: START_MS + 120_000 },
          reportedTime: START_MS,
        },
      ]);
      const start = getState(devMap(), 0, 0);
      if (!start.ok) throw new Error('the dev map has a round-0 state');
      expect(h.store.getState(matchId, 0)).toStrictEqual({ state: start.value, stateDigest: stateDigest(start.value) });
      expect(h.store.runningCount()).toBe(1);
      // The reply: the public data at round 0 with the creation event as the latest one.
      expect(match).toStrictEqual({
        matchId,
        mapId: 'dev',
        mapDigest: mapDigest(),
        totalRounds: 4,
        timing: CLOCK_TIMING,
        commitment: stored!.match.commitment,
        stage: 'phase-1',
        appliedRounds: 0,
        state: { mode: 'classic', round: 0, owners: start.value.owners },
        stateDigest: stateDigest(start.value),
        lastSeq: 1,
        reportedTime: START_MS,
        schedule: { c1: START_MS + 80_000, c2: START_MS + 110_000, a: START_MS + 120_000 },
      });
      expect(Object.keys(out.reply)).toStrictEqual(['matchId', 'match', 'hostToken']);
    } finally {
      h.close();
    }
  });

  it('FR-231 a match with timing manual has no schedule in its public data or in its creation event', () => {
    const h = serviceHarness();
    try {
      const out = h.service.create({ credential: OPERATOR, body: { mapId: 'dev', timing: 'manual', requestId: 'm-1' } });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.reply.match.timing).toBe('manual');
      expect('schedule' in out.reply.match).toBe(false);
      const [event] = h.store.eventsAfter(out.reply.matchId, 0);
      expect(event).toStrictEqual({ type: 'schedule', seq: 1, stage: 'phase-1', reportedTime: START_MS });
      expect(out.reply.match.lastSeq).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-231 the creation time is the clock reading floored to a whole millisecond and the reported time follows it', () => {
    const h = serviceHarness({ start: START_MS + 0.9 });
    try {
      const out = created(h, 'req-1');
      expect(out.reply.match.reportedTime).toBe(START_MS);
      expect(h.store.getMatch(out.reply.matchId)!.match.createdAt).toBe(START_MS);
    } finally {
      h.close();
    }
  });

  it('FR-231 everything is stored in one transaction before the reply: a failed transaction leaves no row and gives no reply', () => {
    const store = withFaults(openStore(':memory:'), { failTransaction: 1 });
    const h = serviceHarness({ store });
    try {
      expect(() => h.service.create({ credential: OPERATOR, body: creationBody('req-1') })).toThrow(InjectedFault);
      expect(h.store.runningCount()).toBe(0);
      expect(h.store.memoGet({ credentialDigest: credentialDigest(OPERATOR), match: null }, 'req-1')).toBeUndefined();
      // The next transaction works, and the first attempt left nothing behind that it would collide with.
      const out = created(h, 'req-1');
      expect(h.store.getMatch(out.reply.matchId)).toBeDefined();
      expect(h.store.runningCount()).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-231 a storage failure after the match row (the event write) rolls the whole creation back', () => {
    const real = openStore(':memory:');
    const breaking = { ...withFaults(real, {}), appendEvents: () => { throw new Error('disk full'); } };
    const h = serviceHarness({ store: breaking });
    try {
      expect(() => h.service.create({ credential: OPERATOR, body: creationBody('req-1') })).toThrow('disk full');
      expect(real.runningCount()).toBe(0);
    } finally {
      h.close();
    }
  });

  it('FR-259 (commitment) the commitment is the SHA-256 of the 32 raw secret bytes and is published in the reply, which holds no secret', () => {
    const h = serviceHarness();
    try {
      const out = created(h, 'req-1');
      const secret = h.draws[0]!.bytes;
      expect(secret).toHaveLength(32);
      const expected = createHash('sha256').update(secret).digest('hex');
      expect(out.reply.match.commitment).toBe(expected);
      expect(out.reply.match.commitment).toBe(commitment(secret));
      expect(h.store.getMatch(out.reply.matchId)!.match.commitment).toBe(expected);
      const text = JSON.stringify(out);
      expect(text).not.toContain(Buffer.from(secret).toString('hex'));
      expect(text).not.toContain(base64url(secret));
      expect('matchSecret' in out.reply.match).toBe(false);
    } finally {
      h.close();
    }
  });
});

describe('creation errors', () => {
  const nothingCreated = (h: Harness, before: number): void => {
    expect(h.store.runningCount()).toBe(0);
    expect(h.draws.length).toBe(before); // no secret, id or token is drawn for a refused creation
  };

  it('FR-232 no operator credential, or another one, is `forbidden` before the map, the timing or the limit are looked at', () => {
    const h = serviceHarness();
    try {
      const bad = { mapId: 'nowhere', timing: { i: 1, l1: 1, l2: 1 }, requestId: 'r' };
      for (const credential of [undefined, '', 'wrong', OPERATOR + 'x', OPERATOR.toUpperCase()]) {
        expect(failed(h, credential, bad), String(credential)).toStrictEqual({ kind: 'forbidden' });
      }
      nothingCreated(h, 0);
    } finally {
      h.close();
    }
  });

  it('FR-232 a malformed body is `invalid-request` before `forbidden`, naming the first failing field', () => {
    const h = serviceHarness();
    try {
      expect(failed(h, undefined, { timing: 'manual', requestId: 'r' })).toStrictEqual({ kind: 'invalid-request', items: ['mapId'] });
      expect(failed(h, 'wrong', { mapId: 'dev', timing: 'manual' })).toStrictEqual({ kind: 'invalid-request', items: ['requestId'] });
      expect(failed(h, OPERATOR, null)).toStrictEqual({ kind: 'invalid-request', items: ['body'] });
      expect(failed(h, OPERATOR, { mapId: 'dev', timing: { i: 5, l1: 1 }, requestId: 'r' })).toStrictEqual({ kind: 'invalid-request', items: ['timing.l2'] });
      nothingCreated(h, 0);
    } finally {
      h.close();
    }
  });

  it('FR-232 a map id that is not in the map list is `unknown-map`, before the timing and the limit', () => {
    const h = serviceHarness({ limit: 1 });
    try {
      created(h, 'first');
      const before = h.draws.length;
      expect(failed(h, OPERATOR, { mapId: 'nowhere', timing: { i: 1, l1: 1, l2: 1 }, requestId: 'r' })).toStrictEqual({ kind: 'unknown-map' });
      expect(h.draws.length).toBe(before);
    } finally {
      h.close();
    }
  });

  it('FR-232 a listed map that fails the 001 validation lists its errors, before too-few-factions and the timing', () =>
    withTempDir((dir) => {
      const broken = writeMapPackage(dir, 'broken', '{}');
      const asymmetric = writeMapPackage(dir, 'asym', JSON.stringify({ territories: [{ id: 1, owner: 7, neighbors: [2] }, { id: 2, owner: 8, neighbors: [] }] }));
      const h = serviceHarness({ folders: { broken, asym: asymmetric } });
      try {
        expect(failed(h, OPERATOR, { mapId: 'broken', timing: { i: 1, l1: 1, l2: 1 }, requestId: 'a' })).toStrictEqual({ kind: 'map-validation', items: ['invalid-territories'] });
        expect(failed(h, OPERATOR, { mapId: 'asym', timing: 'manual', requestId: 'b' })).toStrictEqual({
          kind: 'map-validation',
          items: ['asymmetric-adjacency', 'disconnected-map'],
        });
        nothingCreated(h, 0);
      } finally {
        h.close();
      }
    }));

  it('FR-232 a listed folder with no readable package is a map validation error, never a match', () =>
    withTempDir((dir) => {
      const h = serviceHarness({ folders: { gone: dir + '/missing' } });
      try {
        expect(failed(h, OPERATOR, { mapId: 'gone', timing: 'manual', requestId: 'a' }).kind).toBe('map-validation');
        nothingCreated(h, 0);
      } finally {
        h.close();
      }
    }));

  it('FR-232 a map with fewer than 2 factions is `too-few-factions`, before the timing and the limit', () =>
    withTempDir((dir) => {
      const one = writeMapPackage(dir, 'one', JSON.stringify({ territories: [{ id: 1, owner: 7, neighbors: [2] }, { id: 2, owner: 7, neighbors: [1] }] }));
      const h = serviceHarness({ folders: { one }, limit: 1 });
      try {
        expect(failed(h, OPERATOR, { mapId: 'one', timing: { i: 10, l1: 5, l2: 5 }, requestId: 'a' })).toStrictEqual({ kind: 'too-few-factions' });
        nothingCreated(h, 0);
      } finally {
        h.close();
      }
    }));

  it('FR-232 an impossible timing is `invalid-timing` listing each failed rule, before `too-many-matches`', () => {
    const h = serviceHarness({ limit: 1 });
    try {
      created(h, 'first');
      const before = h.draws.length;
      expect(failed(h, OPERATOR, { mapId: 'dev', timing: { i: 10, l1: 5, l2: 5 }, requestId: 'a' })).toStrictEqual({ kind: 'invalid-timing', items: ['c'] });
      expect(failed(h, OPERATOR, { mapId: 'dev', timing: { i: 2_592_001, l1: 0, l2: -1 }, requestId: 'b' })).toStrictEqual({
        kind: 'invalid-timing',
        items: ['a', 'b', 'd'],
      });
      expect(h.draws.length).toBe(before);
      expect(h.store.runningCount()).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-232 the 21st running match is `too-many-matches` with the default limit of 20', () => {
    const h = serviceHarness();
    try {
      for (let i = 1; i <= 20; i++) created(h, `req-${i}`);
      expect(h.store.runningCount()).toBe(20);
      const before = h.draws.length;
      expect(failed(h, OPERATOR, creationBody('req-21'))).toStrictEqual({ kind: 'too-many-matches' });
      expect(h.store.runningCount()).toBe(20);
      expect(h.draws.length).toBe(before);
    } finally {
      h.close();
    }
  });

  it('FR-232 halted and finished matches do not count toward the running-match limit', () => {
    const h = serviceHarness({ limit: 3 });
    try {
      const a = created(h, 'a').reply.matchId;
      const b = created(h, 'b').reply.matchId;
      created(h, 'c');
      expect(failed(h, OPERATOR, creationBody('d')).kind).toBe('too-many-matches');
      h.store.transaction(() => h.store.updateMatch({ ...h.store.getMatch(a)!.match, stage: 'halted', haltReason: 'map-changed', anchors: null }));
      expect(h.store.runningCount()).toBe(2);
      created(h, 'e');
      expect(failed(h, OPERATOR, creationBody('f')).kind).toBe('too-many-matches');
      h.store.transaction(() => h.store.updateMatch({ ...h.store.getMatch(b)!.match, stage: 'finished', winner: 1, anchors: null }));
      expect(h.store.runningCount()).toBe(2);
      created(h, 'g');
      expect(h.store.runningCount()).toBe(3);
    } finally {
      h.close();
    }
  });

  it('FR-232 the limit comes from the settings, not from a constant', () => {
    const h = serviceHarness({ limit: 2 });
    try {
      created(h, 'a');
      created(h, 'b');
      expect(failed(h, OPERATOR, creationBody('c')).kind).toBe('too-many-matches');
    } finally {
      h.close();
    }
  });
});

describe('what stays fixed', () => {
  it('FR-235 the stored map, map digest and timing of a match never change, whatever happens to the files or to later creations', () =>
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'live', DEV_MAP_TEXT);
      const h = serviceHarness({ folders: { live: folder } });
      try {
        const first = h.service.create({ credential: OPERATOR, body: { mapId: 'live', timing: { i: 90, l1: 20, l2: 5 }, requestId: 'a' } });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const before = h.store.getMatch(first.reply.matchId)!.match;
        expect(before.mapId).toBe('live');
        expect(before.mapDigest).toBe(mapDigest());
        expect(before.timing).toStrictEqual({ i: 90, l1: 20, l2: 5 });
        // The package changes on disk and another match is created with other settings.
        writeFileSync(join(folder, 'map.json'), DEV_MAP_TEXT + ' ');
        const second = h.service.create({ credential: OPERATOR, body: { mapId: 'live', timing: 'manual', requestId: 'b' } });
        expect(second.ok && second.reply.match.mapDigest).not.toBe(mapDigest());
        expect(h.store.getMatch(first.reply.matchId)!.match).toStrictEqual(before);
        // No operation of the service changes a stored match.
        expect(Object.keys(h.service).sort()).toStrictEqual(['create', 'purgeMemos']);
      } finally {
        h.close();
      }
    }));

  it('FR-235 the store refuses a change of the timing or the map of a stored match', () => {
    const h = serviceHarness();
    try {
      const { matchId } = created(h, 'a').reply;
      const stored = h.store.getMatch(matchId)!.match;
      for (const changed of [{ ...stored, timing: 'manual' as const }, { ...stored, mapId: 'other' }, { ...stored, mapDigest: 'f'.repeat(64) }]) {
        expect(() => h.store.transaction(() => h.store.updateMatch(changed))).toThrow();
      }
      expect(h.store.getMatch(matchId)!.match).toStrictEqual(stored);
    } finally {
      h.close();
    }
  });
});

describe('identifiers', () => {
  it('FR-236 the secret, the match id and the host token come from three separate draws of 32, 12 and 32 bytes', () => {
    const h = serviceHarness();
    try {
      const out = created(h, 'a');
      expect(h.draws.map((d) => d.length)).toStrictEqual([32, 12, 32]);
      expect(out.reply.matchId).toBe(base64url(h.draws[1]!.bytes));
      expect(out.reply.hostToken).toBe(base64url(h.draws[2]!.bytes));
      expect(out.reply.matchId).toHaveLength(16);
      expect(out.reply.hostToken).toHaveLength(43);
    } finally {
      h.close();
    }
  });

  it('FR-236 the match id and the host token are independent of the secret and of each other, in the credential character set', () => {
    const h = serviceHarness({ limit: 100 });
    try {
      const ids = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const out = created(h, `r${i}`);
        expect(out.reply.matchId).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
        expect(out.reply.hostToken).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
        const secretText = Buffer.from(h.store.getMatch(out.reply.matchId)!.secret);
        expect(out.reply.hostToken).not.toContain(base64url(secretText).slice(0, 8));
        expect(out.reply.matchId).not.toBe(out.reply.hostToken.slice(0, 16));
        ids.add(out.reply.matchId);
        ids.add(out.reply.hostToken);
      }
      expect(ids.size).toBe(60);
    } finally {
      h.close();
    }
  });
});

describe('idempotent creation', () => {
  it('FR-238 a repeated creation with the same request id and content returns the first reply, host token included, and creates nothing', () => {
    const h = serviceHarness();
    try {
      const first = created(h, 'req-1');
      h.clock.advance(5_000);
      const drawn = h.draws.length;
      const again = h.service.create({ credential: OPERATOR, body: creationBody('req-1') });
      expect(again).toStrictEqual(first);
      expect(again.ok && again.reply.hostToken).toBe(first.reply.hostToken);
      expect(again.ok && again.reply.match.reportedTime).toBe(START_MS);
      expect(h.store.runningCount()).toBe(1);
      expect(h.draws.length).toBe(drawn);
      expect(h.store.eventsAfter(first.reply.matchId, 0)).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('FR-238 the content is compared as the canonical body: key order does not matter', () => {
    const h = serviceHarness();
    try {
      const first = created(h, 'req-1');
      const reordered = { requestId: 'req-1', timing: { l2: 10, i: 120, l1: 30 }, mapId: 'dev' };
      expect(h.service.create({ credential: OPERATOR, body: reordered })).toStrictEqual(first);
      expect(h.store.runningCount()).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-238 the same request id with another content is `request-id-reused` and creates nothing', () => {
    const h = serviceHarness();
    try {
      const first = created(h, 'req-1');
      for (const body of [
        { mapId: 'dev', timing: 'manual', requestId: 'req-1' },
        { mapId: 'dev', timing: { i: 121, l1: 30, l2: 10 }, requestId: 'req-1' },
        { mapId: 'other', timing: { ...CLOCK_TIMING }, requestId: 'req-1' },
      ]) {
        expect(failed(h, OPERATOR, body), JSON.stringify(body)).toStrictEqual({ kind: 'request-id-reused' });
      }
      expect(h.store.runningCount()).toBe(1);
      expect(h.service.create({ credential: OPERATOR, body: creationBody('req-1') })).toStrictEqual(first);
    } finally {
      h.close();
    }
  });

  it('FR-238 the memo holds for 24 hours from the first use; after that the id is new and a second match is created', () => {
    const h = serviceHarness();
    try {
      const first = created(h, 'req-1');
      h.clock.set(START_MS + MEMO_RETENTION_MS);
      expect(h.service.create({ credential: OPERATOR, body: creationBody('req-1') })).toStrictEqual(first);
      h.clock.set(START_MS + MEMO_RETENTION_MS + 1);
      const later = created(h, 'req-1');
      expect(later.reply.matchId).not.toBe(first.reply.matchId);
      expect(later.reply.hostToken).not.toBe(first.reply.hostToken);
      expect(h.store.runningCount()).toBe(2);
    } finally {
      h.close();
    }
  });

  it('FR-238 an error that is memoised is replayed with the same request id, and `forbidden` is never memoised', () => {
    const h = serviceHarness();
    try {
      const body = { mapId: 'nowhere', timing: 'manual', requestId: 'req-1' };
      expect(failed(h, OPERATOR, body)).toStrictEqual({ kind: 'unknown-map' });
      expect(failed(h, OPERATOR, body)).toStrictEqual({ kind: 'unknown-map' });
      expect(failed(h, OPERATOR, { ...body, timing: { i: 5, l1: 1, l2: 1 } })).toStrictEqual({ kind: 'request-id-reused' });
      // A refused credential leaves no memo: the right credential may use the same request id.
      expect(failed(h, 'wrong', creationBody('req-2'))).toStrictEqual({ kind: 'forbidden' });
      expect(created(h, 'req-2').ok).toBe(true);
    } finally {
      h.close();
    }
  });

  it('FR-238 the memo is keyed by the creation scope: the digest of the operator credential and no match', () => {
    const h = serviceHarness();
    try {
      const first = created(h, 'req-1');
      const entry = h.store.memoGet({ credentialDigest: credentialDigest(OPERATOR), match: null }, 'req-1');
      expect(entry?.createdMs).toBe(START_MS);
      expect(entry?.reply).toStrictEqual(first);
      expect(entry?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(CREATION_PATH).toBe('/matches');
    } finally {
      h.close();
    }
  });
});

describe('credentials in the store', () => {
  it('FR-238 NFR-54 (store) the plain host token is stored only in the creation memo, and after the purge the database holds none', () =>
    withTempDir((dir) => {
      const file = dir + '/mbrg.sqlite';
      const h = serviceHarness({ store: openStore(file) });
      const first = created(h, 'req-1');
      const token = first.reply.hostToken;
      const matchId = first.reply.matchId;
      h.close();
      withRawDb(file, (db) => {
        // The memo is the only copy, in plain form; the match row holds the one-way digest.
        expect(scanValues(db, [token])).toStrictEqual(['memo.reply_json']);
        const row = db.prepare('SELECT host_token_digest FROM matches WHERE id = ?').get(matchId);
        expect(row?.host_token_digest).toBe(credentialDigest(token));
      });

      const again = serviceHarness({ store: openStore(file) });
      try {
        again.clock.set(START_MS + MEMO_RETENTION_MS); // exactly 24 h: still within the retention
        expect(again.service.purgeMemos()).toBe(0);
        again.clock.set(START_MS + MEMO_RETENTION_MS + 1);
        expect(again.service.purgeMemos()).toBe(1);
        expect(again.store.getMatch(matchId)!.hostTokenDigest).toBe(credentialDigest(token));
      } finally {
        again.close();
      }
      withRawDb(file, (db) => {
        expect(scanValues(db, [token])).toStrictEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS n FROM memo').get()?.n).toBe(0);
        expect(db.prepare('SELECT host_token_digest FROM matches WHERE id = ?').get(matchId)?.host_token_digest).toBe(credentialDigest(token));
      });
    }));

  it('NFR-54 (store) no credential text is in the database: the operator credential, the host token digest key and the memo scope are digests', () =>
    withTempDir((dir) => {
      const file = dir + '/mbrg.sqlite';
      const h = serviceHarness({ store: openStore(file) });
      const first = created(h, 'req-1');
      h.close();
      withRawDb(file, (db) => {
        expect(scanValues(db, [OPERATOR, Buffer.from(OPERATOR).toString('base64'), Buffer.from(OPERATOR).toString('hex')])).toStrictEqual([]);
        expect(credentialTextColumns(listColumns(db))).toStrictEqual([]);
        expect(db.prepare('SELECT scope, request_id FROM memo').all().map((r) => ({ scope: r.scope, request_id: r.request_id }))).toStrictEqual([{ scope: JSON.stringify([credentialDigest(OPERATOR), null]), request_id: 'req-1' }]);
        // The one plain secret column is the match secret (D14); it holds the 32 bytes drawn for it.
        const secret = db.prepare('SELECT secret FROM matches WHERE id = ?').get(first.reply.matchId)?.secret as Uint8Array;
        expect(secret).toHaveLength(32);
        expect(scanValues(db, [secret])).toStrictEqual(['matches.secret']);
      });
    }));
});
