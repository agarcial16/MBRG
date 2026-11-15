import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// FR-372: a start whose effective instant is at or after the lobby expiry instant is refused with `match-expired`, even when
// the expiry wake-up has not run yet. The refusal stores nothing; the expiry itself stays with the wake-up.

const HOUR = 3_600_000;
const EXPIRES = START_MS + 24 * HOUR;

const lobbyOf = (h: Harness): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-a', body: creationBody('c-1') });
  if (!out.ok) throw new Error(`public creation failed: ${JSON.stringify(out.error)}`);
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const harness = (): Harness => serviceHarness({ publicCreation: { maps: ['dev'] } });

describe('a start against the lobby expiry instant', () => {
  it('FR-372 one tick before the expiry instant the start succeeds', () => {
    const h = harness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      h.clock.set(EXPIRES - 1);
      const out = h.service.startMatch({ credential: hostToken, matchId, body: {} });
      expect(out.ok).toBe(true);
      expect(h.service.publicMatch(matchId)?.stage).toBe('phase-1');
    } finally {
      h.close();
    }
  });

  for (const offset of [0, 1, HOUR]) {
    it(`FR-372 ${offset} ms after the expiry instant, before the wake-up ran, the start gives match-expired and stores nothing`, () => {
      const h = harness();
      try {
        const { matchId, hostToken } = lobbyOf(h);
        const before = h.store.eventsAfter(matchId, 0).length;
        h.clock.set(EXPIRES + offset);
        const body = { requestId: 'r-1' };
        expect(h.service.startMatch({ credential: hostToken, matchId, body })).toStrictEqual({ ok: false, error: errorReply('match-expired') });
        expect(h.service.publicMatch(matchId)?.stage).toBe('lobby');
        expect(h.store.eventsAfter(matchId, 0)).toHaveLength(before);
        expect(h.store.getLobby(matchId)).toMatchObject({ startedMs: null, expiredMs: null });
        // The refusal was not memoised, and the wake-up still performs the expiry.
        h.service.tick();
        expect(h.service.publicMatch(matchId)?.stage).toBe('expired');
        expect(h.service.startMatch({ credential: hostToken, matchId, body })).toStrictEqual({ ok: false, error: errorReply('match-expired') });
      } finally {
        h.close();
      }
    });
  }

  it('FR-372 a match started before the expiry instant is unaffected by the instant passing', () => {
    const h = harness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
      h.clock.set(EXPIRES + HOUR);
      h.service.tick();
      expect(h.service.publicMatch(matchId)?.stage).not.toBe('expired');
      expect(h.service.startMatch({ credential: hostToken, matchId, body: {} })).toStrictEqual({ ok: false, error: errorReply('match-started') });
    } finally {
      h.close();
    }
  });
});
