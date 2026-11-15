import { errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createLobby, lobbyEvents } from '../src/core/create';
import { commitment, newSecret } from '../src/secret';
import { credentialDigest, sha256Ascii } from '../src/service/ids';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { devMap, mapDigest } from './helpers/digests';
import { fakeRandom } from './helpers/fake-random';
import { OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The start of a lobby at service level (spec 011 M2 T6): the host token moves the match to phase-1 of round 1 with the
// clock anchored at the start instant (FR-374), and under manual timing the host then steps it as in 008 (FR-375).

const PUBLIC = { maps: ['dev'] } as const;
const publicHarness = (extra: Parameters<typeof serviceHarness>[0] = {}): Harness => serviceHarness({ publicCreation: PUBLIC, ...extra });

const lobbyOf = (h: Harness, source = 'src-a', requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source, body: creationBody(requestId) });
  if (!out.ok) throw new Error(`public creation failed: ${JSON.stringify(out.error)}`);
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};

/** A lobby with timing `manual`, which public creation refuses: built through the pure core and the store directly. */
const manualLobby = (h: Harness): { matchId: string; hostToken: string } => {
  const matchId = 'manual-lobby-0001';
  const hostToken = 'manual-host-token-0123456789-abcdef';
  const secret = newSecret(fakeRandom(9));
  const made = createLobby({ matchId, mapId: 'dev', mapDigest: mapDigest(), timing: 'manual', commitment: commitment(secret), now: START_MS }, { map: devMap(), sha256: sha256Ascii });
  if (!made.ok) throw new Error('the dev map makes a lobby');
  const first = lobbyEvents(made.view, START_MS);
  h.store.transaction(() => {
    h.store.insertMatch({ match: first.view, secret, hostTokenDigest: credentialDigest(hostToken) });
    h.store.insertLobby({ matchId, public: true, expiresMs: START_MS + 86_400_000 });
    h.store.appendEvents(matchId, first.events);
  });
  return { matchId, hostToken };
};

const start = (h: Harness, matchId: string, credential: string | undefined, body: unknown = {}): ReturnType<Harness['service']['startMatch']> => h.service.startMatch({ credential, matchId, body });

const errorOf = (out: ReturnType<Harness['service']['startMatch']>): { kind: string; items?: readonly string[] } => {
  if (out.ok) throw new Error('start unexpectedly succeeded');
  return out.error;
};

describe('start of a lobby', () => {
  it('FR-374 the host token moves the lobby to phase-1 of round 1 with the clock anchored at the start instant and one new schedule event', () => {
    const h = publicHarness({ scheduler: true });
    try {
      const { matchId, hostToken } = lobbyOf(h);
      h.clock.advance(7_321);
      const now = START_MS + 7_321;
      const out = start(h, matchId, hostToken);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      // C1 = start + I - L1 - L2, C2 = C1 + L1, A = start + I: counted from the start, never from the creation.
      const schedule = { c1: now + 80_000, c2: now + 110_000, a: now + 120_000 };
      expect(out.reply.match.stage).toBe('phase-1');
      expect(out.reply.match.appliedRounds).toBe(0);
      expect(out.reply.match.schedule).toStrictEqual(schedule);
      expect(out.reply.match.lastSeq).toBe(2);
      expect(out.reply.match.reportedTime).toBe(now);
      expect('playerCount' in out.reply.match).toBe(false);
      const stored = h.store.getMatch(matchId)!.match;
      expect(stored.stage).toBe('phase-1');
      expect(stored.lastStepMs).toBe(now);
      expect(stored.createdAt).toBe(START_MS);
      expect(stored.anchors).toStrictEqual({ t0: now, ...schedule });
      expect(h.store.getLobby(matchId)).toMatchObject({ startedMs: now, expiredMs: null });
      expect(h.store.openLobbyCount()).toBe(0);
      expect(h.store.publicRunningCount()).toBe(1);
      expect(h.store.eventsAfter(matchId, 0)).toStrictEqual([
        { type: 'schedule', seq: 1, stage: 'lobby', reportedTime: START_MS },
        { type: 'schedule', seq: 2, stage: 'phase-1', schedule, reportedTime: now },
      ]);
      expect(h.service.publicMatch(matchId)).toStrictEqual(out.reply.match);
      // The scheduler is armed for C1 of the started match.
      expect(h.scheduler!.pending()).toContain(schedule.c1);
    } finally {
      h.close();
    }
  });

  it('FR-374 the start event is published after the commit, once, and the stage change is already stored when the subscriber runs', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      const seen: { events: readonly MatchEvent[]; stage: string | undefined; lobbyStarted: boolean }[] = [];
      h.service.subscribe((id, events) => seen.push({ events, stage: h.store.getMatch(id)?.match.stage, lobbyStarted: h.store.getLobby(id)?.startedMs !== null }));
      h.clock.advance(1_000);
      start(h, matchId, hostToken);
      expect(seen).toStrictEqual([
        {
          events: [{ type: 'schedule', seq: 2, stage: 'phase-1', schedule: { c1: START_MS + 81_000, c2: START_MS + 111_000, a: START_MS + 121_000 }, reportedTime: START_MS + 1_000 }],
          stage: 'phase-1',
          lobbyStarted: true,
        },
      ]);
    } finally {
      h.close();
    }
  });

  it('FR-374 the stage change, the lobby mark, the schedule event and the memo are one transaction: a storage failure at any write leaves the lobby intact', () => {
    for (let afterWrites = 0; afterWrites <= 3; afterWrites++) {
      const real = openStore(':memory:');
      const h = publicHarness({ store: withFaults(real, { failWrite: { transaction: 2, afterWrites } }) });
      try {
        const { matchId, hostToken } = lobbyOf(h);
        h.clock.advance(1_000);
        expect(start(h, matchId, hostToken, { requestId: 'go-1' }), `after ${afterWrites} writes`).toStrictEqual({ ok: false, error: errorReply('unavailable') });
        const stored = real.getMatch(matchId)!.match;
        expect(stored.stage).toBe('lobby');
        expect(stored.anchors).toBeNull();
        expect(stored.lastSeq).toBe(1);
        expect(real.getLobby(matchId)).toMatchObject({ startedMs: null });
        expect(real.eventsAfter(matchId, 0)).toHaveLength(1);
        expect(real.memoGet({ credentialDigest: credentialDigest(hostToken), match: matchId }, 'go-1')).toBeUndefined();
        // The failed start left nothing in the way: the same request succeeds now.
        expect(start(h, matchId, hostToken, { requestId: 'go-1' }).ok).toBe(true);
        expect(real.eventsAfter(matchId, 0)).toHaveLength(2);
      } finally {
        h.close();
      }
    }
  });

  it('FR-374 a second start with the same request id and content returns the first reply and writes nothing', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      h.clock.advance(2_000);
      const first = start(h, matchId, hostToken, { requestId: 'go-1' });
      expect(first.ok).toBe(true);
      expect(h.store.memoGet({ credentialDigest: credentialDigest(hostToken), match: matchId }, 'go-1')).toBeDefined();
      h.clock.advance(9_000);
      const seen: MatchEvent[] = [];
      h.service.subscribe((_id, events) => seen.push(...events));
      expect(start(h, matchId, hostToken, { requestId: 'go-1' })).toStrictEqual(first);
      expect(seen).toHaveLength(0);
      expect(h.store.eventsAfter(matchId, 0)).toHaveLength(2);
      expect(h.store.getMatch(matchId)!.match.lastStepMs).toBe(START_MS + 2_000);
    } finally {
      h.close();
    }
  });

  it('FR-374 a start without a request id, or with another one, on a started match is match-started and stores nothing', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      expect(start(h, matchId, hostToken, { requestId: 'go-1' }).ok).toBe(true);
      expect(errorOf(start(h, matchId, hostToken))).toStrictEqual(errorReply('match-started'));
      expect(errorOf(start(h, matchId, hostToken, { requestId: 'go-2' }))).toStrictEqual(errorReply('match-started'));
      expect(h.store.memoGet({ credentialDigest: credentialDigest(hostToken), match: matchId }, 'go-2')).toBeUndefined();
      expect(h.store.eventsAfter(matchId, 0)).toHaveLength(2);
    } finally {
      h.close();
    }
  });

  it('FR-374 a start on an expired lobby is match-expired and starts nothing', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      h.store.transaction(() => {
        h.store.markExpired(matchId, START_MS + 1);
        h.store.updateMatch({ ...h.store.getMatch(matchId)!.match, stage: 'expired' });
      });
      expect(errorOf(start(h, matchId, hostToken))).toStrictEqual(errorReply('match-expired'));
      expect(errorOf(start(h, matchId, hostToken, { requestId: 'go-1' }))).toStrictEqual(errorReply('match-expired'));
      expect(h.store.getMatch(matchId)!.match.stage).toBe('expired');
      expect(h.store.getLobby(matchId)).toMatchObject({ startedMs: null });
      expect(h.store.memoGet({ credentialDigest: credentialDigest(hostToken), match: matchId }, 'go-1')).toBeUndefined();
    } finally {
      h.close();
    }
  });

  it('FR-374 any other credential is forbidden: the operator, a wrong token, another lobby\'s token, none, and an unknown match; nothing changes', () => {
    const h = publicHarness();
    try {
      const a = lobbyOf(h, 'src-a', 'c-1');
      const b = lobbyOf(h, 'src-b', 'c-2');
      const forbidden = errorReply('forbidden');
      expect(errorOf(start(h, a.matchId, OPERATOR))).toStrictEqual(forbidden);
      expect(errorOf(start(h, a.matchId, `${a.hostToken}x`))).toStrictEqual(forbidden);
      expect(errorOf(start(h, a.matchId, b.hostToken))).toStrictEqual(forbidden);
      expect(errorOf(start(h, a.matchId, undefined))).toStrictEqual(forbidden);
      // An unknown match is told apart from nothing: no credential can be its host, so it is forbidden too.
      expect(errorOf(start(h, 'no-such-match-0001', a.hostToken))).toStrictEqual(forbidden);
      expect(errorOf(start(h, 'no-such-match-0001', OPERATOR))).toStrictEqual(forbidden);
      expect(h.store.getMatch(a.matchId)!.match.stage).toBe('lobby');
      expect(h.store.eventsAfter(a.matchId, 0)).toHaveLength(1);
      expect(h.store.openLobbyCount()).toBe(2);
    } finally {
      h.close();
    }
  });

  it('FR-374 a malformed start body is invalid-request naming the first bad field', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      expect(errorOf(start(h, matchId, hostToken, { requestId: '!' }))).toStrictEqual(errorReply('invalid-request', ['requestId']));
      expect(errorOf(start(h, matchId, hostToken, { extra: 1 }))).toStrictEqual(errorReply('invalid-request', ['extra']));
      expect(errorOf(start(h, matchId, hostToken, 'text'))).toStrictEqual(errorReply('invalid-request', ['body']));
      expect(h.store.getMatch(matchId)!.match.stage).toBe('lobby');
    } finally {
      h.close();
    }
  });

  it('a start that would pass the running-match limit of 008, or the cap of running public matches, is too-many-matches and the lobby stays', () => {
    // The 008 limit counts public matches too: one operator match fills a limit of 1.
    const limited = publicHarness({ limit: 1 });
    try {
      expect(limited.service.create({ credential: OPERATOR, body: creationBody('op') }).ok).toBe(true);
      const { matchId, hostToken } = lobbyOf(limited);
      expect(errorOf(start(limited, matchId, hostToken, { requestId: 'go-1' }))).toStrictEqual(errorReply('too-many-matches'));
      expect(limited.store.getMatch(matchId)!.match.stage).toBe('lobby');
      expect(limited.store.getLobby(matchId)).toMatchObject({ startedMs: null });
      expect(limited.store.memoGet({ credentialDigest: credentialDigest(hostToken), match: matchId }, 'go-1')).toBeUndefined();
    } finally {
      limited.close();
    }
    // The public cap counts only public matches: an operator match does not fill it, a started public one does.
    const capped = publicHarness({ publicCreation: { ...PUBLIC, maxPublicRunning: 1 } });
    try {
      expect(capped.service.create({ credential: OPERATOR, body: creationBody('op') }).ok).toBe(true);
      const a = lobbyOf(capped, 'src-a', 'c-1');
      const b = lobbyOf(capped, 'src-b', 'c-2');
      expect(start(capped, a.matchId, a.hostToken).ok).toBe(true);
      expect(errorOf(start(capped, b.matchId, b.hostToken))).toStrictEqual(errorReply('too-many-matches'));
      expect(capped.store.getMatch(b.matchId)!.match.stage).toBe('lobby');
    } finally {
      capped.close();
    }
  });

  it('no results or victim event exists before the start, and the started match steps with its clock as any other', () => {
    const h = publicHarness({ scheduler: true });
    try {
      const { matchId, hostToken } = lobbyOf(h);
      expect(h.store.eventsAfter(matchId, 0).map((e) => e.type)).toStrictEqual(['schedule']);
      start(h, matchId, hostToken);
      expect(h.store.eventsAfter(matchId, 0).map((e) => e.type)).toStrictEqual(['schedule', 'schedule']);
      h.scheduler!.runTo(START_MS + 80_000);
      expect(h.store.getMatch(matchId)!.match.stage).toBe('phase-2');
      expect(h.store.eventsAfter(matchId, 0).some((e) => e.type === 'victim-revealed')).toBe(true);
    } finally {
      h.close();
    }
  });
});

describe('manual start', () => {
  it('FR-375 a manual lobby starts with no anchors and no clock, and the host steps a full round with advance', () => {
    const h = publicHarness({ scheduler: true });
    try {
      const { matchId, hostToken } = manualLobby(h);
      h.clock.advance(3_000);
      const out = start(h, matchId, hostToken);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.reply.match.stage).toBe('phase-1');
      expect('schedule' in out.reply.match).toBe(false);
      expect(h.store.getMatch(matchId)!.match.anchors).toBeNull();
      expect(h.store.eventsAfter(matchId, 0)[1]).toStrictEqual({ type: 'schedule', seq: 2, stage: 'phase-1', reportedTime: START_MS + 3_000 });
      expect(h.scheduler!.pending()).toStrictEqual([]);
      for (const step of ['phase-1-close', 'phase-2-close', 'application'] as const satisfies readonly StepKind[]) {
        const stepped = h.service.advance({ credential: hostToken, matchId, body: { round: 1, step } });
        expect(stepped.ok, step).toBe(true);
      }
      const after = h.store.getMatch(matchId)!.match;
      expect(after.appliedRounds).toBe(1);
      expect(after.stage).toBe('phase-1');
    } finally {
      h.close();
    }
  });

  it('an advance in a lobby is step-mismatch naming the stage lobby, and a prediction is closed', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      const out = h.service.advance({ credential: hostToken, matchId, body: { round: 1, step: 'phase-1-close' } });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.kind).toBe('step-mismatch');
      expect(h.store.getMatch(matchId)!.match.stage).toBe('lobby');
      expect(h.store.steps(matchId)).toStrictEqual([]);
      const guess = h.service.submit({ client: { credential: 'client-credential-0123456789', namespace: 'web' }, matchId, body: { kind: 'winner', faction: 1, playerId: 'p1' } });
      expect(guess).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    } finally {
      h.close();
    }
  });
});
