import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { LOBBY_RETENTION_MS } from '../src/store/store';
import { openStore } from '../src/store/sqlite';
import { START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Restart of lobbies at service level (spec 011 M2 T7): a new store and a new service on the same file. A lobby is still a
// lobby and its expiry is armed again; one already past its expiry expires at once, late, with the effective instant.

const HOUR = 3_600_000;
const reopened = (file: string, start: number): Harness =>
  serviceHarness({ store: openStore(file), scheduler: true, start, publicCreation: { maps: ['dev'], lobbyExpiryHours: 7 } });

const createdLobby = (file: string): string => {
  const first = serviceHarness({ store: openStore(file), scheduler: true, publicCreation: { maps: ['dev'], lobbyExpiryHours: 7 } });
  try {
    const out = first.service.createPublic({ source: 'src-a', body: creationBody('c-1') });
    if (!out.ok) throw new Error('public creation failed');
    return out.reply.matchId;
  } finally {
    first.close();
  }
};

describe('restart of lobbies', () => {
  it('FR-372 NFR-76 after a restart a lobby is still a lobby with its expiry armed, and it expires at created + expiry exactly', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const matchId = createdLobby(file);
      const h = reopened(file, START_MS + 2 * HOUR);
      try {
        const report = h.service.start();
        expect(report.failed).toStrictEqual([]);
        expect(h.service.publicMatch(matchId)).toMatchObject({ stage: 'lobby', lastSeq: 1, playerCount: 0 });
        expect(h.store.getLobby(matchId)).toMatchObject({ expiredMs: null, startedMs: null, expiresMs: START_MS + 7 * HOUR });
        expect(h.scheduler!.pending()).toContain(START_MS + 7 * HOUR);
        h.scheduler!.runTo(START_MS + 7 * HOUR - 1);
        expect(h.service.publicMatch(matchId)?.stage).toBe('lobby');
        h.scheduler!.runTo(START_MS + 7 * HOUR);
        expect(h.service.publicMatch(matchId)?.stage).toBe('expired');
        expect(h.store.getLobby(matchId)?.expiredMs).toBe(START_MS + 7 * HOUR);
      } finally {
        h.close();
      }
    });
  });

  it('FR-372 a lobby already overdue at restart expires at once, late, with the effective instant, and the retention counts from that instant', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const matchId = createdLobby(file);
      const lateAt = START_MS + 7 * HOUR + 5 * HOUR + 123;
      const h = reopened(file, lateAt);
      try {
        h.service.start();
        expect(h.service.publicMatch(matchId)?.stage).toBe('expired');
        expect(h.store.getLobby(matchId)?.expiredMs).toBe(lateAt);
        expect(h.store.eventsAfter(matchId, 0)[1]).toStrictEqual({ type: 'schedule', seq: 2, stage: 'expired', reportedTime: lateAt });
        h.scheduler!.runTo(lateAt + LOBBY_RETENTION_MS);
        expect(h.service.publicMatch(matchId)?.stage).toBe('expired');
        h.scheduler!.runTo(lateAt + LOBBY_RETENTION_MS + 1);
        expect(h.service.publicMatch(matchId)).toBeUndefined();
      } finally {
        h.close();
      }
    });
  });

  it('FR-372 an expired lobby that is waiting for its removal is removed at the right instant after a restart', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const matchId = createdLobby(file);
      const expiredAt = START_MS + 7 * HOUR;
      const second = reopened(file, expiredAt);
      try {
        second.service.start();
        expect(second.service.publicMatch(matchId)?.stage).toBe('expired');
      } finally {
        second.close();
      }
      const third = reopened(file, expiredAt + 10 * HOUR);
      try {
        third.service.start();
        expect(third.service.publicMatch(matchId)?.stage).toBe('expired');
        third.scheduler!.runTo(expiredAt + LOBBY_RETENTION_MS);
        expect(third.service.publicMatch(matchId)?.stage).toBe('expired');
        third.scheduler!.runTo(expiredAt + LOBBY_RETENTION_MS + 1);
        expect(third.service.publicMatch(matchId)).toBeUndefined();
      } finally {
        third.close();
      }
    });
  });

  it('FR-372 a started match is not re-armed as a lobby at restart and never expires', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const first = serviceHarness({ store: openStore(file), scheduler: true, publicCreation: { maps: ['dev'], lobbyExpiryHours: 7 } });
      let matchId = '';
      try {
        const out = first.service.createPublic({ source: 'src-a', body: creationBody('c-1') });
        if (!out.ok) throw new Error('public creation failed');
        matchId = out.reply.matchId;
        expect(first.service.startMatch({ credential: out.reply.hostToken, matchId, body: {} }).ok).toBe(true);
      } finally {
        first.close();
      }
      const h = reopened(file, START_MS + 8 * HOUR);
      try {
        h.service.start();
        expect(h.scheduler!.pending()).not.toContain(START_MS + 7 * HOUR);
        expect(h.store.getLobby(matchId)?.expiredMs).toBeNull();
        expect(h.service.publicMatch(matchId)?.stage).not.toBe('expired');
        expect(h.service.startMatch({ credential: 'nope', matchId, body: {} })).toStrictEqual({ ok: false, error: errorReply('forbidden') });
      } finally {
        h.close();
      }
    });
  });

  it('NFR-76 a restart with a clock behind the creation does not expire the lobby early', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const matchId = createdLobby(file);
      const h = reopened(file, START_MS - 3 * HOUR);
      try {
        h.service.start();
        expect(h.service.publicMatch(matchId)?.stage).toBe('lobby');
        expect(h.scheduler!.pending()).toContain(START_MS + 7 * HOUR);
      } finally {
        h.close();
      }
    });
  });
});
