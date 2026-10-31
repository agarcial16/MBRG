import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createLimiter, SWEEP_EVERY, WINDOW_MS, createKeys, joinKeys } from '../src/http/limits';
import { DEFAULT_LIMITS } from '../src/service/settings';
import { serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';
import { creationBody } from './helpers/service-harness';

// NFR-72, service level: what an anonymous caller can make the server hold is bounded, and each bound is driven to its edge
// (one below, at, one above) on the fake clock. The HTTP side (bodies, pages, streams, floods) is in
// anonymous-bounds-wire.test.ts. Nothing here sleeps.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const publicHarness = (publicCreation: Parameters<typeof serviceHarness>[0] extends infer O ? (O extends { publicCreation?: infer P } ? P : never) : never, extra: Parameters<typeof serviceHarness>[0] = {}): Harness =>
  serviceHarness({ publicCreation: { maps: ['dev'], lobbyExpiryHours: 720, maxOpenLobbies: 1000, ...publicCreation }, ...extra });

const make = (h: Harness, n: number, source = `src-${n}`): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source, body: creationBody(`r-${n}`) });
  if (!out.ok) throw new Error(`creation ${n} failed: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const joinAs = (h: Harness, matchId: string, name: string, requestId: string, source = 'src-j'): ReturnType<Harness['service']['join']> =>
  h.service.join({ source, matchId, body: { name, requestId } });

describe('NFR-72 bounded anonymous state: players, lobbies, running matches', () => {
  it('NFR-72 players per match: maxPlayers join, the next is match-full and stores, memoises and draws nothing; another lobby is not affected', () => {
    const h = publicHarness({}, { maxPlayers: 7 });
    try {
      const a = make(h, 1);
      const b = make(h, 2);
      for (let i = 1; i <= 6; i += 1) expect(joinAs(h, a.matchId, `P${i}`, `j-${i}`).ok).toBe(true); // max - 1
      expect(h.store.playerCount(a.matchId)).toBe(6);
      expect(joinAs(h, a.matchId, 'P7', 'j-7').ok).toBe(true); // max
      expect(h.store.playerCount(a.matchId)).toBe(7);
      const events = h.store.eventsAfter(a.matchId, 0).length;
      const memoRows = h.service.purgeMemos();
      expect(memoRows).toBe(0);
      const draws = h.draws.length;
      expect(joinAs(h, a.matchId, 'P8', 'j-8')).toStrictEqual({ ok: false, error: errorReply('match-full') }); // max + 1
      expect(h.store.playerCount(a.matchId)).toBe(7);
      expect(h.store.eventsAfter(a.matchId, 0)).toHaveLength(events);
      expect(h.draws).toHaveLength(draws);
      // The refused request id is free: it was not memoised.
      expect(joinAs(h, b.matchId, 'P8', 'j-8').ok).toBe(true);
      h.clock.advance(DAY + 1);
      // 2 creations + 7 + 1 joins; the refused join left no row.
      expect(h.service.purgeMemos()).toBe(10);
    } finally {
      h.close();
    }
  });

  it('NFR-72 open lobbies: cap - 1, cap and cap + 1 creations; the refusal stores nothing and an expiry frees a place', () => {
    const CAP = 4;
    const h = publicHarness({ maxOpenLobbies: CAP, lobbyExpiryHours: 1 }, { scheduler: true });
    try {
      for (let n = 1; n <= CAP - 1; n += 1) make(h, n);
      expect(h.store.openLobbyCount()).toBe(CAP - 1);
      make(h, CAP);
      expect(h.store.openLobbyCount()).toBe(CAP);
      const draws = h.draws.length;
      const out = h.service.createPublic({ source: 'src-x', body: creationBody('r-x') });
      expect(out).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      expect(h.draws).toHaveLength(draws);
      expect(h.store.openLobbyCount()).toBe(CAP);
      h.clock.advance(HOUR);
      h.scheduler!.runTo(h.clock.now());
      expect(h.store.openLobbyCount()).toBe(0);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(true);
    } finally {
      h.close();
    }
  });

  it('NFR-72 public running matches: the cap - 1, cap and cap + 1 starts; the refused lobby stays a lobby and a finished slot is not needed to create', () => {
    const CAP = 3;
    const h = publicHarness({ maxPublicRunning: CAP });
    try {
      const lobbies = Array.from({ length: CAP + 1 }, (_, i) => make(h, i + 1));
      for (let i = 0; i < CAP; i += 1) {
        const started = h.service.startMatch({ credential: lobbies[i]!.hostToken, matchId: lobbies[i]!.matchId, body: {} });
        expect([i, started.ok]).toStrictEqual([i, true]);
        expect(h.store.publicRunningCount()).toBe(i + 1);
      }
      const last = lobbies[CAP]!;
      const refused = h.service.startMatch({ credential: last.hostToken, matchId: last.matchId, body: {} });
      expect(refused).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      expect(h.store.getMatch(last.matchId)!.match.stage).toBe('lobby');
      expect(h.store.publicRunningCount()).toBe(CAP);
      // Creation is not limited by the running cap (a lobby is not running).
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(true);
    } finally {
      h.close();
    }
  });
});

describe('NFR-72 bounded anonymous input: names and request ids', () => {
  it('NFR-72 names: 24 code points are stored, 25 are refused, and a name of a million characters is refused without being stored', () => {
    const h = publicHarness({});
    try {
      const { matchId } = make(h, 1);
      const invalid = { ok: false, error: errorReply('invalid-request', ['name']) };
      expect(joinAs(h, matchId, 'ñ'.repeat(23), 'n-1').ok).toBe(true);
      expect(joinAs(h, matchId, 'é'.repeat(24), 'n-2').ok).toBe(true);
      expect(joinAs(h, matchId, 'ñ'.repeat(25), 'n-3')).toStrictEqual(invalid);
      expect(joinAs(h, matchId, 'a'.repeat(1_000_000), 'n-4')).toStrictEqual(invalid);
      expect(joinAs(h, matchId, '', 'n-5')).toStrictEqual(invalid);
      expect(h.store.playerCount(matchId)).toBe(2);
    } finally {
      h.close();
    }
  });

  it('NFR-72 request ids: 64 characters of the set are accepted, 65, an empty one and any other character are invalid-request, for creation and for joining', () => {
    const h = publicHarness({});
    try {
      const { matchId } = make(h, 1);
      const edge = 'r'.repeat(64);
      const draws = h.draws.length;
      for (const bad of ['r'.repeat(65), '', 'with space', 'slash/id', 'ñandú', 'new\nline', 'a'.repeat(10_000)]) {
        const created = h.service.createPublic({ source: 'src-x', body: creationBody(bad) });
        expect([JSON.stringify(bad).slice(0, 20), created]).toStrictEqual([JSON.stringify(bad).slice(0, 20), { ok: false, error: errorReply('invalid-request', ['requestId']) }]);
        const joined = joinAs(h, matchId, 'Ana', bad);
        expect([JSON.stringify(bad).slice(0, 20), joined]).toStrictEqual([JSON.stringify(bad).slice(0, 20), { ok: false, error: errorReply('invalid-request', ['requestId']) }]);
      }
      expect(h.draws).toHaveLength(draws);
      expect(h.store.playerCount(matchId)).toBe(0);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody(edge) }).ok).toBe(true);
      expect(joinAs(h, matchId, 'Ana', `${'A-z_.0'.repeat(10)}1234`).ok).toBe(true);
    } finally {
      h.close();
    }
  });

  it('NFR-72 the players page: 500 items per page, a bigger match never answers more than a page; 501 is refused (the rest by cursor is in the wire file)', () => {
    const h = publicHarness({}, { maxPlayers: 520 });
    try {
      const { matchId } = make(h, 1);
      for (let i = 0; i < 520; i += 1) expect(joinAs(h, matchId, `P${i}`, `j-${i}`).ok).toBe(true);
      const first = h.service.players(matchId, { limit: 500 });
      expect(first.ok && first.reply.items).toHaveLength(500);
      expect(first.ok && first.reply.next).toBeDefined();
      expect(() => h.service.players(matchId, { limit: 501 })).toThrow(RangeError);
    } finally {
      h.close();
    }
  });
});

describe('NFR-72 bounded memory: the memo and the limiter', () => {
  it('NFR-72 the memo holds one row per admitted creation and join, a replay and a refusal add none, and a row is purged at 24 h + 1 ms, not at 24 h', () => {
    const h = publicHarness({});
    try {
      const m1 = make(h, 1);
      make(h, 2);
      make(h, 3);
      for (let i = 0; i < 5; i += 1) expect(joinAs(h, m1.matchId, `P${i}`, `j-${i}`).ok).toBe(true);
      // Replays of the same request id and content add no row; refusals (taken name, rules) add none.
      for (let i = 0; i < 5; i += 1) expect(joinAs(h, m1.matchId, `P${i}`, `j-${i}`).ok).toBe(true);
      expect(joinAs(h, m1.matchId, 'p0', 'j-taken').ok).toBe(false);
      expect(joinAs(h, m1.matchId, '', 'j-bad').ok).toBe(false);
      expect(h.service.createPublic({ source: 'src-1', body: creationBody('r-1') }).ok).toBe(true);
      h.clock.advance(DAY);
      expect(h.service.purgeMemos()).toBe(0); // exactly 24 h old: kept
      h.clock.advance(1);
      expect(h.service.purgeMemos()).toBe(8); // 3 creations + 5 joins
      expect(h.store.memoOldest()).toBeUndefined();
      expect(h.service.purgeMemos()).toBe(0);
    } finally {
      h.close();
    }
  });

  it('NFR-72 a flood from 10,000 distinct sources: the limiter holds one key per source and the overall key, every key is gone 60 s later after one sweep', () => {
    const limiter = createLimiter();
    const limits = { ...DEFAULT_LIMITS, createAll: 20_000, joinMatch: 20_000 };
    const t0 = 5_000_000;
    for (let i = 0; i < 10_000; i += 1) {
      expect(limiter.admit(createKeys(`203.0.${Math.floor(i / 250)}.${i % 250}`, limits), t0).ok).toBe(true);
    }
    expect(limiter.keyCount()).toBe(10_001); // one per source + the overall key
    expect(limiter.count('create-all', t0)).toBe(10_000);
    limiter.sweep(t0 + WINDOW_MS - 1);
    expect(limiter.keyCount()).toBe(10_001); // 59.999 s: still inside the window
    limiter.sweep(t0 + WINDOW_MS);
    expect(limiter.keyCount()).toBe(0);
  });

  it('NFR-72 a flood without a sweep call is pruned by the admissions themselves: one quiet key remains after SWEEP_EVERY more requests a minute later', () => {
    const limiter = createLimiter();
    const limits = { ...DEFAULT_LIMITS, joinSource: 1_000_000, joinMatch: 1_000_000 };
    const t0 = 7_000_000;
    for (let i = 0; i < 10_000; i += 1) limiter.admit(joinKeys(`src-${i}`, `match-${i % 10}`, limits), t0);
    expect(limiter.keyCount()).toBe(10_010);
    const later = t0 + WINDOW_MS;
    // The next sweep falls on the admission that makes the count a multiple of SWEEP_EVERY (10,000 are done).
    for (let i = 0; i < SWEEP_EVERY; i += 1) limiter.admit(joinKeys('src-late', 'match-late', limits), later);
    expect(limiter.keyCount()).toBe(2);
  });

  it('NFR-72 the keys of a flood at the limit stay bounded by the limit: refused requests record nothing under any key', () => {
    const limiter = createLimiter();
    const limits = { ...DEFAULT_LIMITS, createSource: 5, createAll: 30 };
    let admitted = 0;
    for (let i = 0; i < 10_000; i += 1) if (limiter.admit(createKeys(`src-${i}`, limits), 1_000).ok) admitted += 1;
    expect(admitted).toBe(30);
    expect(limiter.keyCount()).toBe(31);
    expect(limiter.count('create-all', 1_000)).toBe(30);
  });
});
