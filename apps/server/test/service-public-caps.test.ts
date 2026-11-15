import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { START_MS, OPERATOR, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The caps of public creation at service level (spec 011 M2 T9): the open-lobby cap is checked at creation, a slot frees when
// a lobby starts or expires, the cap of running public matches is not a creation rule, and the 008 running limit of the
// operator still applies. Whether a start is refused by the running cap is a separate question (not tested here).

const HOUR = 3_600_000;
const CAP = 5;
const publicHarness = (extra: Parameters<typeof serviceHarness>[0] = {}): Harness =>
  serviceHarness({ publicCreation: { maps: ['dev'], maxOpenLobbies: CAP, lobbyExpiryHours: 1 }, ...extra });

const make = (h: Harness, n: number): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: `src-${n}`, body: creationBody(`r-${n}`) });
  if (!out.ok) throw new Error(`creation ${n} failed: ${JSON.stringify(out.error)}`);
  return out.reply;
};

describe('open-lobby cap', () => {
  it('creation at cap - 1 open lobbies succeeds, at the cap is too-many-matches, and the refusal stores, memoises and draws nothing', () => {
    const h = publicHarness();
    try {
      for (let n = 1; n < CAP; n++) make(h, n);
      expect(h.store.openLobbyCount()).toBe(CAP - 1);
      // At cap - 1 the next creation succeeds (the guard is "at the cap", not "above it").
      make(h, CAP);
      expect(h.store.openLobbyCount()).toBe(CAP);
      const drawn = h.draws.length;
      const memoOldest = h.store.memoOldest();
      const matches = h.store.listMatches(undefined, 100).length;
      const out = h.service.createPublic({ source: 'src-x', body: creationBody('r-x') });
      expect(out).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      expect(h.draws).toHaveLength(drawn);
      expect(h.store.openLobbyCount()).toBe(CAP);
      expect(h.store.listMatches(undefined, 100)).toHaveLength(matches);
      expect(h.store.memoOldest()).toBe(memoOldest);
    } finally {
      h.close();
    }
  });

  it('a start frees a slot of the open-lobby cap', () => {
    const h = publicHarness();
    try {
      const lobbies = Array.from({ length: CAP }, (_, i) => make(h, i + 1));
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(false);
      expect(h.service.startMatch({ credential: lobbies[2]!.hostToken, matchId: lobbies[2]!.matchId, body: {} }).ok).toBe(true);
      expect(h.store.openLobbyCount()).toBe(CAP - 1);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(true);
      expect(h.service.createPublic({ source: 'src-y', body: creationBody('r-y') })).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
    } finally {
      h.close();
    }
  });

  it('an expiry frees a slot of the open-lobby cap', () => {
    const h = publicHarness({ scheduler: true });
    try {
      for (let n = 1; n <= CAP; n++) make(h, n);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(false);
      h.scheduler!.runTo(START_MS + HOUR - 1);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(false);
      h.scheduler!.runTo(START_MS + HOUR);
      expect(h.store.openLobbyCount()).toBe(0);
      expect(h.service.createPublic({ source: 'src-x', body: creationBody('r-x') }).ok).toBe(true);
    } finally {
      h.close();
    }
  });
});

describe('running public matches and the operator limit', () => {
  it('a creation is not refused because public matches are running: the running cap is not a creation rule', () => {
    const h = publicHarness({ publicCreation: { maps: ['dev'], maxOpenLobbies: CAP, maxPublicRunning: 1 } });
    try {
      const first = make(h, 1);
      expect(h.service.startMatch({ credential: first.hostToken, matchId: first.matchId, body: {} }).ok).toBe(true);
      expect(h.store.publicRunningCount()).toBe(1);
      make(h, 2);
      make(h, 3);
      expect(h.store.openLobbyCount()).toBe(2);
    } finally {
      h.close();
    }
  });

  it('the 008 running limit still refuses an operator creation when running matches reach it, and open lobbies do not count', () => {
    const h = publicHarness({ limit: 2 });
    try {
      make(h, 1);
      make(h, 2);
      make(h, 3);
      expect(h.service.create({ credential: OPERATOR, body: creationBody('op-1') }).ok).toBe(true);
      expect(h.service.create({ credential: OPERATOR, body: creationBody('op-2') }).ok).toBe(true);
      const drawn = h.draws.length;
      expect(h.service.create({ credential: OPERATOR, body: creationBody('op-3') })).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      expect(h.draws).toHaveLength(drawn);
      expect(h.store.runningCount()).toBe(2);
      // The public creation is a different rule: it is not limited by the operator's running matches.
      expect(h.store.openLobbyCount()).toBe(3);
    } finally {
      h.close();
    }
  });
});
