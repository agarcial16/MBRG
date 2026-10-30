import { errorReply } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { LOBBY_RETENTION_MS } from '../src/store/store';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The expiry of a lobby that is not started in time, at service level (spec 011 M2 T7): fake clock and fake scheduler only.
// The lobby is expired at `created + the expiry setting` exactly, its record is kept for the retention and then removed, and
// a started match is never expired by this rule.

const HOUR = 3_600_000;
const publicHarness = (hours: number | undefined, extra: Parameters<typeof serviceHarness>[0] = {}): Harness =>
  serviceHarness({ publicCreation: { maps: ['dev'], ...(hours === undefined ? {} : { lobbyExpiryHours: hours }) }, ...extra });

const lobbyOf = (h: Harness, source = 'src-a', requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source, body: creationBody(requestId) });
  if (!out.ok) throw new Error(`public creation failed: ${JSON.stringify(out.error)}`);
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};

const stageOf = (h: Harness, matchId: string): string | undefined => h.service.publicMatch(matchId)?.stage;

describe('expiry of lobbies', () => {
  for (const hours of [1, 7, 24]) {
    it(`FR-372 NFR-76 a lobby not started within ${hours} h expires at created + ${hours} h exactly, not 1 ms before, and stores and publishes one schedule event of stage expired`, () => {
      const h = publicHarness(hours, { scheduler: true });
      try {
        const { matchId, hostToken } = lobbyOf(h);
        const expiresAt = START_MS + hours * HOUR;
        expect(h.scheduler!.pending()).toStrictEqual([expiresAt]);
        const seen: { id: string; events: readonly MatchEvent[]; stage: string | undefined }[] = [];
        h.service.subscribe((id, events) => seen.push({ id, events, stage: h.store.getMatch(id)?.match.stage }));
        h.scheduler!.runTo(expiresAt - 1);
        expect(stageOf(h, matchId)).toBe('lobby');
        expect(h.store.eventsAfter(matchId, 0)).toHaveLength(1);
        expect(seen).toStrictEqual([]);
        h.scheduler!.runTo(expiresAt);
        expect(stageOf(h, matchId)).toBe('expired');
        const event: MatchEvent = { type: 'schedule', seq: 2, stage: 'expired', reportedTime: expiresAt };
        expect(h.store.eventsAfter(matchId, 0)[1]).toStrictEqual(event);
        expect(h.store.eventsAfter(matchId, 0)).toHaveLength(2);
        expect(seen).toStrictEqual([{ id: matchId, events: [event], stage: 'expired' }]);
        expect(h.store.getLobby(matchId)).toMatchObject({ startedMs: null, expiredMs: expiresAt });
        const view = h.service.publicMatch(matchId)!;
        expect(view).toMatchObject({ stage: 'expired', lastSeq: 2, playerCount: 0, appliedRounds: 0 });
        expect('schedule' in view).toBe(false);
        // Expired: start is refused with the closed code, and nothing else is armed for the match.
        expect(h.service.startMatch({ credential: hostToken, matchId, body: {} })).toStrictEqual({ ok: false, error: errorReply('match-expired') });
        expect(h.scheduler!.pending()).toStrictEqual([]);
      } finally {
        h.close();
      }
    });
  }

  it('NFR-76 without a scheduler, the tick expires a lobby at created + expiry exactly and not 1 ms before', () => {
    const h = publicHarness(7);
    try {
      const { matchId } = lobbyOf(h);
      const expiresAt = START_MS + 7 * HOUR;
      h.clock.set(expiresAt - 1);
      h.service.tick();
      expect(stageOf(h, matchId)).toBe('lobby');
      h.clock.set(expiresAt);
      h.service.tick();
      expect(stageOf(h, matchId)).toBe('expired');
      expect(h.store.getLobby(matchId)?.expiredMs).toBe(expiresAt);
      // A second tick changes nothing.
      h.service.tick();
      expect(h.store.eventsAfter(matchId, 0)).toHaveLength(2);
    } finally {
      h.close();
    }
  });

  it('FR-372 the expiry setting is read from the settings: an expiry of 1 h does not wait 24 h and one of 24 h does not fire at 23 h', () => {
    const short = publicHarness(1);
    const long = publicHarness(24);
    try {
      const a = lobbyOf(short).matchId;
      const b = lobbyOf(long).matchId;
      short.clock.set(START_MS + HOUR);
      long.clock.set(START_MS + 23 * HOUR);
      short.service.tick();
      long.service.tick();
      expect(stageOf(short, a)).toBe('expired');
      expect(stageOf(long, b)).toBe('lobby');
    } finally {
      short.close();
      long.close();
    }
  });

  it('FR-372 the record of an expired lobby is kept for the retention and removed 24 h + 1 ms after the expiry (the scheduler purges it)', () => {
    const h = publicHarness(1, { scheduler: true });
    try {
      h.service.start();
      const { matchId } = lobbyOf(h);
      const expiredAt = START_MS + HOUR;
      h.scheduler!.runTo(expiredAt);
      expect(stageOf(h, matchId)).toBe('expired');
      h.scheduler!.runTo(expiredAt + LOBBY_RETENTION_MS);
      expect(stageOf(h, matchId)).toBe('expired');
      expect(h.store.getLobby(matchId)).toBeDefined();
      h.scheduler!.runTo(expiredAt + LOBBY_RETENTION_MS + 1);
      expect(h.service.publicMatch(matchId)).toBeUndefined();
      expect(h.service.readPublicMatch(matchId)).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
      expect(h.store.getLobby(matchId)).toBeUndefined();
      expect(h.store.eventsAfter(matchId, 0)).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('FR-372 the retention counts from the expiry, not from the creation, and the tick purges the record too', () => {
    const h = publicHarness(7);
    try {
      const { matchId } = lobbyOf(h);
      const expiredAt = START_MS + 7 * HOUR;
      h.clock.set(expiredAt);
      h.service.tick();
      expect(stageOf(h, matchId)).toBe('expired');
      // 24 h + 1 ms after the CREATION is long before the end of the retention of the expiry.
      h.clock.set(START_MS + LOBBY_RETENTION_MS + 1);
      h.service.tick();
      expect(stageOf(h, matchId)).toBe('expired');
      h.clock.set(expiredAt + LOBBY_RETENTION_MS);
      h.service.tick();
      expect(stageOf(h, matchId)).toBe('expired');
      h.clock.set(expiredAt + LOBBY_RETENTION_MS + 1);
      h.service.tick();
      expect(h.service.publicMatch(matchId)).toBeUndefined();
    } finally {
      h.close();
    }
  });

  it('FR-372 a started match is never expired by the rule: the wake-up is cancelled at start and a tick at +25 h leaves it running', () => {
    const h = publicHarness(24, { scheduler: true });
    try {
      const { matchId, hostToken } = lobbyOf(h);
      const expiresAt = START_MS + 24 * HOUR;
      h.clock.advance(1_000);
      expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
      // Only the step wake-up of the started match is armed: the expiry wake-up is gone.
      expect(h.scheduler!.pending()).not.toContain(expiresAt);
      expect(h.scheduler!.pending()).toStrictEqual([START_MS + 1_000 + 80_000]);
      // A timer that fires early or late finds nothing to expire.
      h.scheduler!.fireAll();
      expect(stageOf(h, matchId)).not.toBe('expired');
      expect(h.store.getLobby(matchId)).toMatchObject({ startedMs: START_MS + 1_000, expiredMs: null });
    } finally {
      h.close();
    }
    const t = publicHarness(24);
    try {
      const { matchId, hostToken } = lobbyOf(t);
      t.clock.advance(1_000);
      t.service.startMatch({ credential: hostToken, matchId, body: {} });
      t.clock.set(START_MS + 25 * HOUR);
      t.service.tick();
      expect(stageOf(t, matchId)).not.toBe('expired');
      expect(t.store.getLobby(matchId)?.expiredMs).toBeNull();
      expect(t.store.getMatch(matchId)?.match.stage).not.toBe('lobby');
    } finally {
      t.close();
    }
  });

  it('FR-372 an expiry wake-up that finds the lobby started (mark or stage) at its expiry instant expires nothing', () => {
    // Each layer of the guard alone: the lobby row marked started while the stage still reads lobby, and the stage moved to
    // phase-1 while the row is unmarked (states the service itself never stores; the wake-up must still not expire them).
    for (const layer of ['mark', 'stage'] as const) {
      const failures: unknown[] = [];
      const h = publicHarness(1, { scheduler: true, onFailure: (f) => failures.push(f) });
      try {
        const { matchId, hostToken } = lobbyOf(h);
        const expiresAt = START_MS + HOUR;
        if (layer === 'mark') {
          h.store.transaction(() => h.store.markStarted(matchId, START_MS + 1));
        } else {
          const probe = publicHarness(1);
          try {
            const other = lobbyOf(probe);
            probe.service.startMatch({ credential: other.hostToken, matchId: other.matchId, body: {} });
            const running = probe.store.getMatch(other.matchId)!.match;
            h.store.transaction(() => h.store.updateMatch({ ...running, matchId }));
          } finally {
            probe.close();
          }
        }
        expect(hostToken).toBeTruthy();
        h.clock.set(expiresAt);
        h.scheduler!.fireAll();
        // Refused by the service itself, not by a lower layer that throws (which would be a reported failure and a retry).
        expect(failures, layer).toStrictEqual([]);
        expect(h.scheduler!.pending(), layer).toStrictEqual([]);
        expect(h.store.getLobby(matchId)?.expiredMs, layer).toBeNull();
        expect(h.store.getMatch(matchId)!.match.stage, layer).not.toBe('expired');
        expect(h.store.eventsAfter(matchId, 0), layer).toHaveLength(1);
      } finally {
        h.close();
      }
    }
  });

  it('NFR-76 a clock that goes backward does not expire a lobby early', () => {
    const h = publicHarness(1, { scheduler: true });
    try {
      const { matchId } = lobbyOf(h);
      const expiresAt = START_MS + HOUR;
      h.clock.set(START_MS - 50_000);
      h.service.tick();
      expect(h.scheduler!.fireAll()).toBeGreaterThanOrEqual(1);
      expect(stageOf(h, matchId)).toBe('lobby');
      expect(h.store.getLobby(matchId)?.expiredMs).toBeNull();
      // The early wake-up armed the expiry again at the stored instant.
      expect(h.scheduler!.pending()).toStrictEqual([expiresAt]);
      h.scheduler!.runTo(expiresAt);
      expect(stageOf(h, matchId)).toBe('expired');
    } finally {
      h.close();
    }
  });

  it('FR-372 NFR-76 an expiry that fails to store leaves the lobby intact, is reported, and is retried 3 s later', () => {
    for (let afterWrites = 0; afterWrites <= 2; afterWrites++) {
      const real = openStore(':memory:');
      const failures: { matchId: string; kind: string }[] = [];
      const h = publicHarness(1, { scheduler: true, store: withFaults(real, { failWrite: { transaction: 2, afterWrites } }), onFailure: (f) => failures.push(f) });
      try {
        const { matchId } = lobbyOf(h);
        const expiresAt = START_MS + HOUR;
        const seen: unknown[] = [];
        h.service.subscribe((id, events) => seen.push([id, events]));
        h.scheduler!.runTo(expiresAt);
        expect(real.getMatch(matchId)!.match.stage, `after ${afterWrites} writes`).toBe('lobby');
        expect(real.getMatch(matchId)!.match.lastSeq).toBe(1);
        expect(real.getLobby(matchId)).toMatchObject({ startedMs: null, expiredMs: null });
        expect(real.eventsAfter(matchId, 0)).toHaveLength(1);
        expect(seen).toStrictEqual([]);
        expect(failures).toStrictEqual([{ matchId, kind: 'unavailable' }]);
        expect(h.scheduler!.pending()).toStrictEqual([expiresAt + 3_000]);
        h.scheduler!.runTo(expiresAt + 2_999);
        expect(real.getMatch(matchId)!.match.stage).toBe('lobby');
        h.scheduler!.runTo(expiresAt + 3_000);
        expect(real.getMatch(matchId)!.match.stage).toBe('expired');
        // Late: the effective instant of the retry.
        expect(real.getLobby(matchId)?.expiredMs).toBe(expiresAt + 3_000);
        expect(real.eventsAfter(matchId, 0)[1]).toStrictEqual({ type: 'schedule', seq: 2, stage: 'expired', reportedTime: expiresAt + 3_000 });
        expect(seen).toHaveLength(1);
      } finally {
        h.close();
      }
    }
  });

  it('FR-372 the open-lobby count drops at the expiry and a new public creation succeeds at the cap boundary afterwards', () => {
    const h = publicHarness(1, { scheduler: true, publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 1 } });
    try {
      const first = lobbyOf(h, 'src-a', 'c-1');
      expect(h.store.openLobbyCount()).toBe(1);
      expect(h.service.createPublic({ source: 'src-b', body: creationBody('c-2') })).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      h.scheduler!.runTo(START_MS + HOUR - 1);
      expect(h.service.createPublic({ source: 'src-b', body: creationBody('c-2') }).ok).toBe(false);
      h.scheduler!.runTo(START_MS + HOUR);
      expect(stageOf(h, first.matchId)).toBe('expired');
      expect(h.store.openLobbyCount()).toBe(0);
      const next = h.service.createPublic({ source: 'src-b', body: creationBody('c-2') });
      expect(next.ok).toBe(true);
      if (next.ok) expect(h.scheduler!.pending()).toContain(START_MS + 2 * HOUR);
    } finally {
      h.close();
    }
  });
});
