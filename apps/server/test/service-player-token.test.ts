import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import type { PlayerCaller } from '../src/service/matches';
import { InjectedFault } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { SECRETS } from './helpers/core-timelines';
import { creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// A player's match token at service level (spec 011 M3 T7): the token is looked up by its digest within the match, and a
// resolved player submits and reads only under its own id. The client-credential path of 008 is not touched here.

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;
const publicHarness = (extra: HarnessOptions = {}): Harness => serviceHarness({ publicCreation: PUBLIC, secret: SECRETS['ascending-00-1f'], ...extra });

interface Player {
  readonly playerId: string;
  readonly local: string;
  readonly token: string;
  readonly caller: PlayerCaller;
}

const newLobby = (h: Harness, requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};

const joinAs = (h: Harness, matchId: string, name: string): Player => {
  const out = h.service.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
  if (!out.ok) throw new Error('join refused');
  const { playerId, playerToken } = out.reply;
  return { playerId, local: playerId.slice('player:'.length), token: playerToken, caller: { tokenDigest: credentialDigest(playerToken), playerId } };
};

/** A started match (phase 1 of round 1) with two players. */
const running = (h: Harness): { matchId: string; ana: Player; bea: Player; hostToken: string } => {
  const { matchId, hostToken } = newLobby(h);
  const ana = joinAs(h, matchId, 'Ana');
  const bea = joinAs(h, matchId, 'Bea');
  const started = h.service.startMatch({ credential: hostToken, matchId, body: {} });
  if (!started.ok) throw new Error('start refused');
  return { matchId, ana, bea, hostToken };
};

const livingOf = (h: Harness, matchId: string): number[] => [...new Set(h.store.getMatch(matchId)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const swapCase = (text: string): string => [...text].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');

describe('the lookup of a player token', () => {
  it('FR-378 a token of a player of the match gives its player id', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea } = running(h);
      expect(h.service.playerTokenOf(matchId, ana.token)).toStrictEqual({ ok: true, reply: { playerId: ana.playerId } });
      expect(h.service.playerTokenOf(matchId, bea.token)).toStrictEqual({ ok: true, reply: { playerId: bea.playerId } });
    } finally {
      h.close();
    }
  });

  it('FR-378 a token is a player of its own match only: on another match, on an unknown match or with a bad match text it is nobody', () => {
    const h = publicHarness();
    try {
      const first = running(h);
      const second = newLobby(h, 'c-2');
      const other = joinAs(h, second.matchId, 'Cy');
      expect(h.service.playerTokenOf(second.matchId, first.ana.token)).toStrictEqual({ ok: true, reply: undefined });
      expect(h.service.playerTokenOf(first.matchId, other.token)).toStrictEqual({ ok: true, reply: undefined });
      expect(h.service.playerTokenOf('no-such-match', first.ana.token)).toStrictEqual({ ok: true, reply: undefined });
      expect(h.service.playerTokenOf(undefined as unknown as string, first.ana.token)).toStrictEqual({ ok: true, reply: undefined });
      expect(h.service.playerTokenOf(second.matchId, other.token)).toStrictEqual({ ok: true, reply: { playerId: other.playerId } });
    } finally {
      h.close();
    }
  });

  it('FR-378 an unknown, truncated, extended, wrong-case or empty token is nobody', () => {
    const h = publicHarness();
    try {
      const { matchId, ana } = running(h);
      const wrong = [ana.token.slice(0, 42), `${ana.token}A`, swapCase(ana.token), '', ' ', ana.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'x'.repeat(43)];
      for (const token of wrong) expect(h.service.playerTokenOf(matchId, token), token).toStrictEqual({ ok: true, reply: undefined });
      // The host token and the match id are not player tokens.
      expect(h.service.playerTokenOf(matchId, matchId)).toStrictEqual({ ok: true, reply: undefined });
    } finally {
      h.close();
    }
  });

  it('FR-378 the store sees only the digest of the token', () => {
    const real = openStore(':memory:');
    const seen: unknown[][] = [];
    const spy: Store = { ...real, playerByTokenDigest: (...args: [string, string]) => (seen.push(args), real.playerByTokenDigest(...args)) };
    const h = publicHarness({ store: spy });
    try {
      const { matchId, ana } = running(h);
      h.service.playerTokenOf(matchId, ana.token);
      expect(seen).toStrictEqual([[matchId, credentialDigest(ana.token)]]);
      expect(JSON.stringify(seen)).not.toContain(ana.token);
    } finally {
      h.close();
    }
  });

  it('FR-378 a storage failure in the lookup is unavailable, not nobody', () => {
    const real = openStore(':memory:');
    const failing: Store = {
      ...real,
      playerByTokenDigest: () => {
        throw new InjectedFault('read', 1);
      },
    };
    const h = publicHarness({ store: failing });
    try {
      const { matchId, ana } = running(h);
      expect(h.service.playerTokenOf(matchId, ana.token)).toStrictEqual({ ok: false, error: errorReply('unavailable') });
    } finally {
      h.close();
    }
  });
});

describe('a resolved player submitting a prediction', () => {
  it('FR-378 stores a victim prediction under player:<local id> in an open phase', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea } = running(h);
      const pick = livingOf(h, matchId)[0]!;
      const out = h.service.submit({ client: ana.caller, matchId, body: { kind: 'victim', round: 1, faction: pick, playerId: ana.local } });
      expect(out).toMatchObject({ ok: true, reply: { kind: 'victim', round: 1, choice: pick, version: 1 } });
      expect(h.store.predictionsOf(matchId, ana.playerId).map((p) => [p.kind, p.round, p.choice])).toStrictEqual([['victim', 1, pick]]);
      expect(h.store.predictionsOf(matchId, bea.playerId)).toStrictEqual([]);
      // A second submission replaces it (version 2) under the same id.
      const other = livingOf(h, matchId)[1]!;
      expect(h.service.submit({ client: ana.caller, matchId, body: { kind: 'victim', round: 1, faction: other, playerId: ana.local } })).toMatchObject({ ok: true, reply: { version: 2 } });
    } finally {
      h.close();
    }
  });

  it('FR-378 a prediction for another player is forbidden and stores nothing, not even a memo row', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea } = running(h);
      const pick = livingOf(h, matchId)[0]!;
      const out = h.service.submit({ client: ana.caller, matchId, body: { kind: 'victim', round: 1, faction: pick, playerId: bea.local, requestId: 'r-1' } });
      expect(out).toStrictEqual({ ok: false, error: errorReply('forbidden') });
      for (const id of [ana.playerId, bea.playerId]) expect(h.store.predictionsOf(matchId, id)).toStrictEqual([]);
      expect(h.store.memoGet({ credentialDigest: ana.caller.tokenDigest, match: matchId }, 'r-1')).toBeUndefined();
      // A namespaced text or a malformed id is not a local id: invalid-player-id comes first.
      expect(h.service.submit({ client: ana.caller, matchId, body: { kind: 'victim', round: 1, faction: pick, playerId: ana.playerId } })).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
      expect(h.store.predictionsOf(matchId, ana.playerId)).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('FR-378 the memo of a player is scoped by the digest of its token: the same request id of two players does not clash, a replay returns the first reply', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea } = running(h);
      const [a, b] = livingOf(h, matchId) as [number, number];
      const body = (p: Player, faction: number) => ({ kind: 'victim', round: 1, faction, playerId: p.local, requestId: 'same-id' });
      const first = h.service.submit({ client: ana.caller, matchId, body: body(ana, a) });
      expect(first.ok).toBe(true);
      expect(h.service.submit({ client: bea.caller, matchId, body: body(bea, b) })).toMatchObject({ ok: true, reply: { choice: b } });
      expect(h.service.submit({ client: ana.caller, matchId, body: body(ana, a) })).toStrictEqual(first);
      expect(h.service.submit({ client: ana.caller, matchId, body: body(ana, b) })).toStrictEqual({ ok: false, error: errorReply('request-id-reused') });
      expect(h.store.memoGet({ credentialDigest: ana.caller.tokenDigest, match: matchId }, 'same-id')).toBeDefined();
      expect(h.store.predictionsOf(matchId, ana.playerId)[0]!.choice).toBe(a);
    } finally {
      h.close();
    }
  });

  it('FR-378 a lobby is closed to the predictions of a player, as to any caller', () => {
    const h = publicHarness();
    try {
      const { matchId } = newLobby(h);
      const ana = joinAs(h, matchId, 'Ana');
      const out = h.service.submit({ client: ana.caller, matchId, body: { kind: 'winner', faction: livingOf(h, matchId)[0], playerId: ana.local } });
      expect(out).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    } finally {
      h.close();
    }
  });

  it('FR-378 a caller that is not a resolved pair is a programming error', () => {
    const h = publicHarness();
    try {
      const { matchId, ana } = running(h);
      const body = { kind: 'winner', faction: livingOf(h, matchId)[0], playerId: ana.local };
      for (const bad of [{ tokenDigest: 'nope', playerId: ana.playerId }, { tokenDigest: ana.caller.tokenDigest, playerId: 'web:abc' }, { tokenDigest: ana.caller.tokenDigest, playerId: 'player:' }]) {
        expect(() => h.service.submit({ client: bad as PlayerCaller, matchId, body })).toThrow(TypeError);
      }
    } finally {
      h.close();
    }
  });
});

describe('a resolved player reading its predictions', () => {
  const setup = (h: Harness) => {
    const run = running(h);
    const [a, b] = livingOf(h, run.matchId) as [number, number];
    const put = (p: Player, faction: number) => h.service.submit({ client: p.caller, matchId: run.matchId, body: { kind: 'victim', round: 1, faction, playerId: p.local } });
    expect(put(run.ana, a).ok).toBe(true);
    expect(put(run.bea, b).ok).toBe(true);
    return { ...run, a, b };
  };

  it('FR-378 ownPredictions returns only the predictions of the player; another player id is forbidden', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea, a, b } = setup(h);
      expect(h.service.ownPredictions({ player: ana.caller, playerId: ana.local, matchId })).toStrictEqual({ ok: true, predictions: [{ kind: 'victim', round: 1, choice: a, version: 1 }] });
      expect(h.service.ownPredictions({ player: bea.caller, playerId: bea.local, matchId })).toStrictEqual({ ok: true, predictions: [{ kind: 'victim', round: 1, choice: b, version: 1 }] });
      expect(h.service.ownPredictions({ player: ana.caller, playerId: bea.local, matchId })).toStrictEqual({ ok: false, error: errorReply('forbidden') });
      expect(h.service.ownPredictions({ player: ana.caller, playerId: 'a b', matchId })).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
      expect(h.service.ownPredictions({ player: ana.caller, playerId: ana.local, matchId: 'no-such-match' })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    } finally {
      h.close();
    }
  });

  it('FR-378 the page read of a player lists its own predictions with no playerId asked, and refuses another one', () => {
    const h = publicHarness();
    try {
      const { matchId, ana, bea, a } = setup(h);
      const own = h.service.ownPredictionsPage({ player: ana.caller, matchId, limit: 500 });
      expect(own).toStrictEqual({ ok: true, reply: { items: [{ playerId: ana.local, kind: 'victim', round: 1, choice: a, version: 1 }] } });
      expect(h.service.ownPredictionsPage({ player: ana.caller, playerId: ana.local, matchId, limit: 500 })).toStrictEqual(own);
      expect(h.service.ownPredictionsPage({ player: ana.caller, playerId: bea.local, matchId, limit: 500 })).toStrictEqual({ ok: false, error: errorReply('forbidden') });
      expect(h.service.ownPredictionsPage({ player: ana.caller, playerId: 'a b', matchId, limit: 500 })).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
    } finally {
      h.close();
    }
  });

  it('FR-378 a token of a finished match can still read its own predictions (reads only)', () => {
    const h = publicHarness({ scheduler: false });
    try {
      const { matchId, ana, a } = setup(h);
      for (let i = 0; i < 400 && h.store.getMatch(matchId)!.match.stage !== 'finished'; i += 1) {
        h.clock.advance(60_000);
        h.service.tick();
      }
      expect(h.store.getMatch(matchId)!.match.stage).toBe('finished');
      expect(h.service.playerTokenOf(matchId, ana.token)).toStrictEqual({ ok: true, reply: { playerId: ana.playerId } });
      const read = h.service.ownPredictions({ player: ana.caller, playerId: ana.local, matchId });
      expect(read).toStrictEqual({ ok: true, predictions: [{ kind: 'victim', round: 1, choice: a, version: 1 }] });
      expect(h.service.submit({ client: ana.caller, matchId, body: { kind: 'winner', faction: a, playerId: ana.local } })).toStrictEqual({ ok: false, error: errorReply('match-finished') });
    } finally {
      h.close();
    }
  });

  it('FR-378 a token of an expired lobby can still read (an empty list)', () => {
    const h = publicHarness();
    try {
      const { matchId } = newLobby(h);
      const ana = joinAs(h, matchId, 'Ana');
      h.clock.advance(49 * 3_600_000);
      h.service.tick();
      expect(h.store.getMatch(matchId)!.match.stage).toBe('expired');
      expect(h.service.playerTokenOf(matchId, ana.token)).toStrictEqual({ ok: true, reply: { playerId: ana.playerId } });
      expect(h.service.ownPredictions({ player: ana.caller, playerId: ana.local, matchId })).toStrictEqual({ ok: true, predictions: [] });
    } finally {
      h.close();
    }
  });
});

describe('the client-credential path beside the token path', () => {
  it('FR-378 a client keeps its namespace ids and cannot read or write a joined player', () => {
    const h = publicHarness();
    try {
      const { matchId, ana } = running(h);
      const pick = livingOf(h, matchId)[0]!;
      const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
      expect(h.service.submit({ client: WEB, matchId, body: { kind: 'victim', round: 1, faction: pick, playerId: ana.local } }).ok).toBe(true);
      expect(h.store.predictionsOf(matchId, `web:${ana.local}`)).toHaveLength(1);
      expect(h.store.predictionsOf(matchId, ana.playerId)).toStrictEqual([]);
      expect(h.service.ownPredictions({ namespace: 'web', playerId: ana.local, matchId })).toMatchObject({ ok: true, predictions: [{ choice: pick }] });
      expect(h.service.ownPredictions({ player: ana.caller, playerId: ana.local, matchId })).toStrictEqual({ ok: true, predictions: [] });
    } finally {
      h.close();
    }
  });
});
