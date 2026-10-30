import { join } from 'node:path';
import { errorReply, roundNotApplied } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { getState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import type { CreateOutcome } from '../src/service/matches';
import { secretHex } from '../src/secret';
import { credentialDigest } from '../src/service/ids';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { DEV_DIR, devMap, mapDigest, stateDigest } from './helpers/digests';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Public creation and the lobby at service level (spec 011 M2 T6): a caller with no operator credential creates a match in
// stage `lobby` through `createPublic`; the bounds, the map list and the caps are refused with nothing stored or drawn. The
// ids of the public creation limits are traced after the HTTP milestone, so these titles describe the parts in words.

const HOUR_MS = 3_600_000;
const PUBLIC = { maps: ['dev'], maxOpenLobbies: 2 } as const;
const publicHarness = (extra: Parameters<typeof serviceHarness>[0] = {}): Harness => serviceHarness({ publicCreation: PUBLIC, ...extra });

const sourceScope = (source: string): { credentialDigest: string; match: null } => ({ credentialDigest: credentialDigest(`public:${source}`), match: null });

const created = (h: Harness, source: string, requestId: string, extra: Record<string, unknown> = {}): Extract<CreateOutcome, { ok: true }> => {
  const out = h.service.createPublic({ source, body: creationBody(requestId, extra) });
  if (!out.ok) throw new Error(`public creation failed: ${JSON.stringify(out.error)}`);
  return out;
};

const refusal = (h: Harness, body: unknown, source = 'src-a'): { kind: string; items?: readonly string[] } => {
  const out = h.service.createPublic({ source, body });
  if (out.ok) throw new Error('public creation unexpectedly succeeded');
  return out.error;
};

/** Nothing was created, stored, memoised or drawn. */
const untouched = (h: Harness): void => {
  expect(h.draws).toHaveLength(0);
  expect(h.store.openLobbyCount()).toBe(0);
  expect(h.store.listMatches(undefined, 10)).toHaveLength(0);
  expect(h.store.memoOldest()).toBeUndefined();
};

describe('public creation', () => {
  it('FR-371 a public creation with a listed map, a timing in the bounds and a request id stores a match in stage lobby and replies with the host token once', () => {
    const h = publicHarness();
    try {
      const out = created(h, 'src-a', 'req-1');
      const { matchId, match, hostToken } = out.reply;
      const stored = h.store.getMatch(matchId)!;
      expect(stored.match.stage).toBe('lobby');
      expect(stored.match.appliedRounds).toBe(0);
      expect(stored.match.anchors).toBeNull();
      expect(stored.match.createdAt).toBe(START_MS);
      expect(stored.match.lastStepMs).toBe(START_MS);
      expect(stored.match.lastSeq).toBe(1);
      // The secret is the first draw, then the match id, then the host token; the token is stored as a digest.
      expect(Array.from(stored.secret)).toStrictEqual(Array.from(h.draws[0]!.bytes));
      expect(h.draws.map((d) => d.length)).toStrictEqual([32, 12, 32]);
      expect(stored.hostTokenDigest).toBe(credentialDigest(hostToken));
      // The lobby row: public, expiring after the setting (24 h by default).
      expect(h.store.getLobby(matchId)).toStrictEqual({ matchId, public: true, expiresMs: START_MS + 24 * HOUR_MS, startedMs: null, expiredMs: null });
      expect(h.store.openLobbyCount()).toBe(1);
      expect(h.store.runningCount()).toBe(0);
      // The first event is a schedule event of the lobby, without anchors.
      expect(h.store.eventsAfter(matchId, 0)).toStrictEqual([{ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: START_MS }]);
      const start = getState(devMap(), 0, 0);
      if (!start.ok) throw new Error('the dev map has a round-0 state');
      expect(match).toStrictEqual({
        matchId,
        mapId: 'dev',
        mapDigest: mapDigest(),
        totalRounds: 4,
        timing: CLOCK_TIMING,
        commitment: stored.match.commitment,
        stage: 'lobby',
        appliedRounds: 0,
        state: { mode: 'classic', round: 0, owners: start.value.owners },
        stateDigest: stateDigest(start.value),
        lastSeq: 1,
        reportedTime: START_MS,
        playerCount: 0,
      });
      expect(Object.keys(out.reply)).toStrictEqual(['matchId', 'match', 'hostToken']);
      expect(h.service.publicMatch(matchId)).toStrictEqual(match);
    } finally {
      h.close();
    }
  });

  it('FR-371 the memo row of a public creation is keyed by the digest of its source, not by the operator credential', () => {
    const h = publicHarness();
    try {
      created(h, 'src-a', 'req-1');
      expect(h.store.memoGet(sourceScope('src-a'), 'req-1')).toBeDefined();
      expect(h.store.memoGet(sourceScope('src-b'), 'req-1')).toBeUndefined();
      expect(h.store.memoGet({ credentialDigest: credentialDigest(OPERATOR), match: null }, 'req-1')).toBeUndefined();
    } finally {
      h.close();
    }
  });

  it('FR-371 the same request id and content from the same source replays the first reply with its token and creates nothing', () => {
    const h = publicHarness();
    try {
      const first = created(h, 'src-a', 'req-1');
      h.clock.advance(5_000);
      const drawn = h.draws.length;
      const again = h.service.createPublic({ source: 'src-a', body: creationBody('req-1') });
      expect(again).toStrictEqual(first);
      expect(h.draws).toHaveLength(drawn);
      expect(h.store.openLobbyCount()).toBe(1);
      expect(h.store.listMatches(undefined, 10)).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('FR-371 the same request id from another source creates a second lobby with its own token', () => {
    const h = publicHarness();
    try {
      const a = created(h, 'src-a', 'req-1');
      const b = created(h, 'src-b', 'req-1');
      expect(b.reply.matchId).not.toBe(a.reply.matchId);
      expect(b.reply.hostToken).not.toBe(a.reply.hostToken);
      expect(h.store.openLobbyCount()).toBe(2);
    } finally {
      h.close();
    }
  });

  it('FR-371 the same request id with other content is request-id-reused and creates nothing', () => {
    const h = publicHarness();
    try {
      created(h, 'src-a', 'req-1');
      const drawn = h.draws.length;
      expect(refusal(h, { ...creationBody('req-1'), timing: { i: 121, l1: 30, l2: 10 } })).toStrictEqual(errorReply('request-id-reused'));
      expect(h.draws).toHaveLength(drawn);
      expect(h.store.openLobbyCount()).toBe(1);
    } finally {
      h.close();
    }
  });

  it('the operator path still creates a match in phase-1 with no lobby row while public creation is on', () => {
    const h = publicHarness();
    try {
      const out = h.service.create({ credential: OPERATOR, body: creationBody('op-1') });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.reply.match.stage).toBe('phase-1');
      expect('playerCount' in out.reply.match).toBe(false);
      expect(h.store.getLobby(out.reply.matchId)).toBeUndefined();
      expect(h.store.openLobbyCount()).toBe(0);
      expect(h.store.runningCount()).toBe(1);
    } finally {
      h.close();
    }
  });

  it('a public creation notifies the subscribers once, after the commit, with the lobby schedule event', () => {
    const h = publicHarness();
    try {
      const seen: { matchId: string; events: readonly MatchEvent[]; stored: number }[] = [];
      h.service.subscribe((matchId, events) => seen.push({ matchId, events, stored: h.store.eventsAfter(matchId, 0).length }));
      const out = created(h, 'src-a', 'req-1');
      expect(seen).toStrictEqual([{ matchId: out.reply.matchId, events: [{ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: START_MS }], stored: 1 }]);
      // A replay publishes nothing.
      h.service.createPublic({ source: 'src-a', body: creationBody('req-1') });
      expect(seen).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('the public data and the events of a lobby hold nothing of a round, the secret or the token', () => {
    const h = publicHarness();
    try {
      const out = created(h, 'src-a', 'req-1');
      const { matchId, hostToken } = out.reply;
      const secret = secretHex(h.store.getMatch(matchId)!.secret);
      const everything = JSON.stringify([h.service.publicMatch(matchId), h.service.eventsAfter(matchId, 0), h.service.listMatches({ limit: 10 })]);
      expect(everything).not.toContain(secret);
      expect(everything).not.toContain(hostToken);
      expect(h.store.eventsAfter(matchId, 0).map((e) => e.type)).toStrictEqual(['schedule']);
      expect(h.service.stateAt(matchId, 1)).toStrictEqual({ ok: false, error: roundNotApplied(0) });
      const page = h.service.listMatches({ limit: 10 });
      expect(page.ok && page.reply.items.map((i) => i.stage)).toStrictEqual(['lobby']);
    } finally {
      h.close();
    }
  });
});

describe('public creation refusals', () => {
  it('a map outside the public list answers exactly as a map that does not exist, and stores and draws nothing', () => {
    // `other` is a real package of the catalog, but not in the public list.
    const dir = DEV_DIR.replace(/[\\/]$/, '');
    const h = publicHarness({ folders: { dev: dir, other: dir } });
    try {
      expect(h.service.create({ credential: OPERATOR, body: creationBody('op', { mapId: 'other' }) }).ok).toBe(true);
      const unlisted = refusal(h, creationBody('r1', { mapId: 'other' }));
      const unknown = refusal(h, creationBody('r2', { mapId: 'no-such-map' }));
      expect(unlisted).toStrictEqual(errorReply('unknown-map'));
      expect(unknown).toStrictEqual(unlisted);
      // Only the operator creation above exists: no lobby, and no random byte was drawn by the refusals.
      expect(h.store.openLobbyCount()).toBe(0);
      expect(h.draws).toHaveLength(3);
      expect(h.store.listMatches(undefined, 10)).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('public creation is off while the public map list is empty', () => {
    const h = serviceHarness();
    try {
      expect(refusal(h, creationBody('r1'))).toStrictEqual(errorReply('unknown-map'));
      untouched(h);
    } finally {
      h.close();
    }
  });

  it('the timings outside the public bounds are invalid-timing, each rule listed by letter after the 008 rules, and nothing is stored or drawn', () => {
    const h = publicHarness();
    try {
      const timing = (i: number, l1: number, l2: number): Record<string, unknown> => creationBody('r1', { timing: { i, l1, l2 } });
      expect(refusal(h, timing(29, 10, 5))).toStrictEqual(errorReply('invalid-timing', ['e']));
      expect(refusal(h, timing(100, 9, 5))).toStrictEqual(errorReply('invalid-timing', ['f']));
      expect(refusal(h, timing(100, 10, 4))).toStrictEqual(errorReply('invalid-timing', ['g']));
      expect(refusal(h, timing(3601, 10, 5))).toStrictEqual(errorReply('invalid-timing', ['h']));
      expect(refusal(h, timing(20, 30, 0))).toStrictEqual(errorReply('invalid-timing', ['c', 'e', 'g']));
      expect(refusal(h, creationBody('r1', { timing: 'manual' }))).toStrictEqual(errorReply('invalid-timing', ['manual']));
      // The edges are inside the bounds.
      expect(h.service.createPublic({ source: 'src-a', body: timing(30, 10, 5) }).ok).toBe(true);
      expect(h.service.createPublic({ source: 'src-b', body: timing(3600, 10, 5) }).ok).toBe(true);
    } finally {
      h.close();
    }
  });

  it('a malformed public body is invalid-request naming the first bad field, with nothing stored or drawn', () => {
    const h = publicHarness();
    try {
      expect(refusal(h, 'text')).toStrictEqual(errorReply('invalid-request', ['body']));
      expect(refusal(h, { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 } })).toStrictEqual(errorReply('invalid-request', ['requestId']));
      expect(refusal(h, creationBody('r1', { extra: 1 }))).toStrictEqual(errorReply('invalid-request', ['extra']));
      untouched(h);
    } finally {
      h.close();
    }
  });

  it('the open-lobby cap refuses with too-many-matches at the cap and allows one below it, and a refusal stores and draws nothing', () => {
    const h = publicHarness();
    try {
      created(h, 'src-a', 'r1');
      created(h, 'src-b', 'r2');
      const drawn = h.draws.length;
      const memos = h.store.memoOldest();
      expect(refusal(h, creationBody('r3'), 'src-c')).toStrictEqual(errorReply('too-many-matches'));
      expect(h.draws).toHaveLength(drawn);
      expect(h.store.openLobbyCount()).toBe(2);
      expect(h.store.memoGet(sourceScope('src-c'), 'r3')).toBeUndefined();
      expect(h.store.memoOldest()).toBe(memos);
    } finally {
      h.close();
    }
  });

  it('the open-lobby cap does not count operator matches, and the cap-refused request id is free to retry', () => {
    const h = publicHarness({ publicCreation: { ...PUBLIC, maxOpenLobbies: 1 } });
    try {
      expect(h.service.create({ credential: OPERATOR, body: creationBody('op') }).ok).toBe(true);
      const first = created(h, 'src-a', 'r1');
      expect(refusal(h, creationBody('r2'), 'src-b')).toStrictEqual(errorReply('too-many-matches'));
      // A started lobby frees its slot; the same request id then creates a lobby (the refusal was not memoised).
      const host = first.reply.hostToken;
      expect(h.service.startMatch({ credential: host, matchId: first.reply.matchId, body: {} }).ok).toBe(true);
      expect(h.service.createPublic({ source: 'src-b', body: creationBody('r2') }).ok).toBe(true);
    } finally {
      h.close();
    }
  });

  it('a storage failure of a public creation replies unavailable, leaves no lobby and frees the request id', () => {
    const real = openStore(':memory:');
    const h = publicHarness({ store: withFaults(real, { failWrite: { transaction: 1, afterWrites: 2 } }) });
    try {
      expect(h.service.createPublic({ source: 'src-a', body: creationBody('r1') })).toStrictEqual({ ok: false, error: errorReply('unavailable') });
      expect(real.openLobbyCount()).toBe(0);
      expect(real.listMatches(undefined, 10)).toHaveLength(0);
      expect(real.memoOldest()).toBeUndefined();
      expect(h.service.createPublic({ source: 'src-a', body: creationBody('r1') }).ok).toBe(true);
      expect(real.openLobbyCount()).toBe(1);
    } finally {
      h.close();
    }
  });
});

describe('public creation on a database file', () => {
  it('a lobby survives closing and reopening the file: stage, lobby row and first event', () => {
    withTempDir((dir) => {
      const path = join(dir, 'lobby.sqlite');
      const first = publicHarness({ store: openStore(path) });
      const { matchId } = created(first, 'src-a', 'r1').reply;
      first.close();
      const second = publicHarness({ store: openStore(path) });
      try {
        expect(second.store.getMatch(matchId)!.match.stage).toBe('lobby');
        expect(second.store.getLobby(matchId)).toMatchObject({ public: true, startedMs: null, expiredMs: null });
        expect(second.service.eventsAfter(matchId, 0)).toStrictEqual({ ok: true, reply: { lastSeq: 1, events: [{ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: START_MS }] } });
        const read = second.service.readPublicMatch(matchId);
        expect(read.ok && read.reply.stage).toBe('lobby');
        expect(read.ok && read.reply.playerCount).toBe(0);
      } finally {
        second.close();
      }
    });
  });
});
