import { readFileSync } from 'node:fs';
import { encodeJoinReply, errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { credentialDigest } from '../src/service/ids';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { SECRETS } from './helpers/core-timelines';
import { OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// Joining a match at service level (spec 011 M3 T6): a name and a request id from a source, no credential. The reply carries
// the player id and the token once; the player is stored as a digest, with its `player-joined` event, in one transaction.

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;
const publicHarness = (extra: HarnessOptions = {}): Harness => serviceHarness({ publicCreation: PUBLIC, ...extra });

const lobbyOf = (h: Harness): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error(`public creation failed: ${JSON.stringify(out.error)}`);
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};

type JoinOut = ReturnType<Harness['service']['join']>;
const join = (h: Harness, matchId: string, name: unknown, requestId = 'j-1', source = 'src-a'): JoinOut => h.service.join({ source, matchId, body: { name, requestId } });
const joined = (out: JoinOut) => {
  if (!out.ok) throw new Error(`join refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const errorOf = (out: JoinOut): { kind: string; items?: readonly string[] } => {
  if (out.ok) throw new Error('join unexpectedly succeeded');
  return out.error;
};
const scopeOf = (source: string, matchId: string) => ({ credentialDigest: credentialDigest(`join:${source}`), match: matchId });

describe('a join in a lobby', () => {
  it('FR-377 returns the player id, the name, the token and the public data with one player; the id and the token are fresh draws of 9 and 32 bytes', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const before = h.draws.length;
      const reply = joined(join(h, matchId, 'Ana'));
      expect(Object.keys(reply)).toStrictEqual(['playerId', 'name', 'playerToken', 'match']);
      expect(reply.playerId).toMatch(/^player:[A-Za-z0-9_-]{12}$/);
      expect(reply.name).toBe('Ana');
      expect(reply.playerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(reply.match).toMatchObject({ matchId, stage: 'lobby', lastSeq: 2, playerCount: 1 });
      expect(() => encodeJoinReply(reply)).not.toThrow();
      const draws = h.draws.slice(before);
      expect(draws.map((d) => d.length)).toStrictEqual([9, 32]);
      expect(h.service.publicMatch(matchId)).toStrictEqual(reply.match);
      expect(h.store.playerCount(matchId)).toBe(1);
      expect(h.store.playersAfter(matchId, undefined, 10)).toStrictEqual([{ playerId: reply.playerId, name: 'Ana', joinedSeq: 2, joinedMs: START_MS }]);
      expect(h.store.playerByTokenDigest(matchId, credentialDigest(reply.playerToken))?.playerId).toBe(reply.playerId);
    } finally {
      h.close();
    }
  });

  it('FR-377 stores the trimmed NFC text as given, keeps its case for display, and keys the name without case, accents or edge spaces', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      expect(joined(join(h, matchId, '  José  ', 'j-1')).name).toBe('José');
      expect(joined(join(h, matchId, 'MARIA', 'j-2')).name).toBe('MARIA');
      expect(h.store.playersAfter(matchId, undefined, 10).map((p) => p.name)).toStrictEqual(['José', 'MARIA']);
      for (const [i, clash] of ['JOSE', 'jose', ' José ', 'José', 'JosÉ', 'maria', 'María'].entries()) {
        expect(errorOf(join(h, matchId, clash, `k-${i}`)), clash).toStrictEqual(errorReply('name-taken'));
      }
      expect(h.store.playerCount(matchId)).toBe(2);
    } finally {
      h.close();
    }
  });

  it('FR-377 a name that clashes is name-taken and stores, draws, emits and memoises nothing; its request id stays free', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      const seen: MatchEvent[] = [];
      h.service.subscribe((_id, events) => seen.push(...events));
      const draws = h.draws.length;
      const events = h.store.eventsAfter(matchId, 0).length;
      expect(errorOf(join(h, matchId, 'ana', 'j-2'))).toStrictEqual(errorReply('name-taken'));
      expect(h.draws.length).toBe(draws);
      expect(seen).toStrictEqual([]);
      expect(h.store.eventsAfter(matchId, 0)).toHaveLength(events);
      expect(h.store.playerCount(matchId)).toBe(1);
      expect(h.store.getMatch(matchId)!.match.lastSeq).toBe(2);
      expect(h.store.memoGet(scopeOf('src-a', matchId), 'j-2')).toBeUndefined();
      // The same request id with a free name is a new join, not a replay of the refusal.
      expect(joined(join(h, matchId, 'Bea', 'j-2')).name).toBe('Bea');
    } finally {
      h.close();
    }
  });

  it('FR-377 the shape check comes first (invalid-request on the name, then the request id, then an extra member), before name-taken, a full match or a finished one', () => {
    const h = publicHarness({ maxPlayers: 1 });
    try {
      const { matchId } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      const draws = h.draws.length;
      expect(errorOf(join(h, matchId, 'ana', ''))).toStrictEqual(errorReply('invalid-request', ['requestId']));
      expect(errorOf(join(h, matchId, 'a  b'))).toStrictEqual(errorReply('invalid-request', ['name']));
      expect(errorOf(join(h, matchId, ''))).toStrictEqual(errorReply('invalid-request', ['name']));
      expect(errorOf(join(h, matchId, 'x'.repeat(25)))).toStrictEqual(errorReply('invalid-request', ['name']));
      expect(errorOf(h.service.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-3', extra: 1 } }))).toStrictEqual(errorReply('invalid-request', ['extra']));
      expect(errorOf(h.service.join({ source: 'src-a', matchId, body: 'Ana' }))).toStrictEqual(errorReply('invalid-request', ['body']));
      expect(h.draws.length).toBe(draws);
    } finally {
      h.close();
    }
  });

  it('FR-377 FR-380 the stage and cap checks come before name-taken: a full match with a taken name is match-full', () => {
    const h = publicHarness({ maxPlayers: 1 });
    try {
      const { matchId } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      expect(errorOf(join(h, matchId, 'ana', 'j-2'))).toStrictEqual(errorReply('match-full'));
    } finally {
      h.close();
    }
  });

  it('FR-377 an unknown match is unknown-match, nothing is stored or memoised, and a match id that is not a text is the same', () => {
    const h = publicHarness();
    try {
      expect(errorOf(join(h, 'no-such-match-id', 'Ana'))).toStrictEqual(errorReply('unknown-match'));
      expect(errorOf(h.service.join({ source: 'src-a', matchId: 7 as unknown as string, body: { name: 'Ana', requestId: 'j-1' } }))).toStrictEqual(errorReply('unknown-match'));
      expect(h.store.memoGet(scopeOf('src-a', 'no-such-match-id'), 'j-1')).toBeUndefined();
      expect(h.draws).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  it('a source that is not a text is a programming error', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      expect(() => h.service.join({ source: '', matchId, body: { name: 'Ana', requestId: 'j-1' } })).toThrow(TypeError);
    } finally {
      h.close();
    }
  });
});

describe('the join event', () => {
  it('FR-376 player-joined carries the id and the name only, with the next sequence number, and a late subscriber replays every join in order', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const a = joined(join(h, matchId, 'Ana', 'j-1'));
      const b = joined(join(h, matchId, 'Bea', 'j-2', 'src-b'));
      const read = h.service.eventsAfter(matchId, 0);
      if (!read.ok) throw new Error('read failed');
      expect(read.reply.events.slice(1)).toStrictEqual([
        { type: 'player-joined', seq: 2, playerId: a.playerId, name: 'Ana' },
        { type: 'player-joined', seq: 3, playerId: b.playerId, name: 'Bea' },
      ]);
      expect(read.reply.lastSeq).toBe(3);
      expect(Object.keys(read.reply.events[1]!)).toStrictEqual(['type', 'seq', 'playerId', 'name']);
      expect(JSON.stringify(read.reply.events)).not.toContain(a.playerToken);
      expect(h.service.eventsAfter(matchId, 2)).toMatchObject({ ok: true, reply: { events: [{ seq: 3 }] } });
    } finally {
      h.close();
    }
  });

  it('FR-376 is published after the commit, once per join, in join order, with the player and the new last number already stored', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const seen: { events: readonly MatchEvent[]; players: number; lastSeq: number }[] = [];
      h.service.subscribe((id, events) => seen.push({ events, players: h.store.playerCount(id), lastSeq: h.store.getMatch(id)!.match.lastSeq }));
      const a = joined(join(h, matchId, 'Ana', 'j-1'));
      const b = joined(join(h, matchId, 'Bea', 'j-2'));
      expect(seen).toStrictEqual([
        { events: [{ type: 'player-joined', seq: 2, playerId: a.playerId, name: 'Ana' }], players: 1, lastSeq: 2 },
        { events: [{ type: 'player-joined', seq: 3, playerId: b.playerId, name: 'Bea' }], players: 2, lastSeq: 3 },
      ]);
    } finally {
      h.close();
    }
  });

  it('FR-376 the player row, the event, the last number and the memo are one transaction: a storage failure at any write leaves nothing, and the retry works', () => {
    for (let afterWrites = 0; afterWrites <= 3; afterWrites++) {
      const real = openStore(':memory:');
      const h = publicHarness({ store: withFaults(real, { failWrite: { transaction: 2, afterWrites } }) });
      try {
        const { matchId } = lobbyOf(h);
        const seen: MatchEvent[] = [];
        h.service.subscribe((_id, events) => seen.push(...events));
        expect(join(h, matchId, 'Ana'), `after ${afterWrites} writes`).toStrictEqual({ ok: false, error: errorReply('unavailable') });
        expect(real.playerCount(matchId)).toBe(0);
        expect(real.eventsAfter(matchId, 0)).toHaveLength(1);
        expect(real.getMatch(matchId)!.match.lastSeq).toBe(1);
        expect(real.memoGet(scopeOf('src-a', matchId), 'j-1')).toBeUndefined();
        expect(seen).toStrictEqual([]);
        expect(join(h, matchId, 'Ana').ok).toBe(true);
        expect(real.eventsAfter(matchId, 0)).toHaveLength(2);
      } finally {
        h.close();
      }
    }
  });
});

describe('a repeated join', () => {
  it('FR-377 with the same source, request id and content returns the first reply, token included, and joins nobody twice', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const first = join(h, matchId, 'Ana', 'j-1');
      const seen: MatchEvent[] = [];
      h.service.subscribe((_id, events) => seen.push(...events));
      const draws = h.draws.length;
      h.clock.advance(5_000);
      expect(join(h, matchId, 'Ana', 'j-1')).toStrictEqual(first);
      expect(h.draws.length).toBe(draws);
      expect(seen).toStrictEqual([]);
      expect(h.store.playerCount(matchId)).toBe(1);
      expect(h.store.eventsAfter(matchId, 0)).toHaveLength(2);
    } finally {
      h.close();
    }
  });

  it('FR-377 FR-380 replays even when the match has filled up since (the memo comes before the cap)', () => {
    const h = publicHarness({ maxPlayers: 2 });
    try {
      const { matchId } = lobbyOf(h);
      const first = join(h, matchId, 'Ana', 'j-1');
      joined(join(h, matchId, 'Bea', 'j-2', 'src-b'));
      expect(errorOf(join(h, matchId, 'Cy', 'j-3', 'src-c'))).toStrictEqual(errorReply('match-full'));
      expect(join(h, matchId, 'Ana', 'j-1')).toStrictEqual(first);
    } finally {
      h.close();
    }
  });

  it('FR-377 with the same request id and other content is request-id-reused, and stores nothing', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      expect(errorOf(join(h, matchId, 'Bea', 'j-1'))).toStrictEqual(errorReply('request-id-reused'));
      expect(h.store.playerCount(matchId)).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-377 from another source, or for another match, is another join: the same request id and name is name-taken, not a replay', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const other = h.service.createPublic({ source: 'src-host', body: creationBody('c-2') });
      if (!other.ok) throw new Error('second lobby failed');
      const first = joined(join(h, matchId, 'Ana', 'j-1'));
      expect(errorOf(join(h, matchId, 'Ana', 'j-1', 'src-b'))).toStrictEqual(errorReply('name-taken'));
      const elsewhere = joined(join(h, other.reply.matchId, 'Ana', 'j-1'));
      expect(elsewhere.playerId).not.toBe(first.playerId);
      expect(elsewhere.playerToken).not.toBe(first.playerToken);
    } finally {
      h.close();
    }
  });

  it('FR-377 a second join with another request id and the same name is name-taken even for the same source', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      expect(errorOf(join(h, matchId, 'Ana', 'j-2'))).toStrictEqual(errorReply('name-taken'));
    } finally {
      h.close();
    }
  });
});

describe('the memo row of a join', () => {
  it('FR-377 holds the token for 24 h, the purge deletes it at 24 h + 1 ms, and the player and its digest stay', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const reply = joined(join(h, matchId, 'Ana', 'j-1'));
      const memo = h.store.memoGet(scopeOf('src-a', matchId), 'j-1');
      expect(JSON.stringify(memo?.reply)).toContain(reply.playerToken);
      h.clock.set(START_MS + MEMO_RETENTION_MS);
      expect(h.service.purgeMemos()).toBe(0);
      expect(h.store.memoGet(scopeOf('src-a', matchId), 'j-1')).toBeDefined();
      h.clock.set(START_MS + MEMO_RETENTION_MS + 1);
      // The memo of the public creation (same instant) goes with it: two rows, the creation and the join.
      expect(h.service.purgeMemos()).toBe(2);
      expect(h.store.memoGet(scopeOf('src-a', matchId), 'j-1')).toBeUndefined();
      expect(h.store.playerByTokenDigest(matchId, credentialDigest(reply.playerToken))?.playerId).toBe(reply.playerId);
    } finally {
      h.close();
    }
  });

  it('FR-377 the token is in no other table: the player row has the digest only, and an event or a read never carries it', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const reply = joined(join(h, matchId, 'Ana', 'j-1'));
      expect(JSON.stringify(h.store.playersAfter(matchId, undefined, 10))).not.toContain(reply.playerToken);
      expect(JSON.stringify(h.store.eventsAfter(matchId, 0))).not.toContain(reply.playerToken);
      expect(JSON.stringify(h.service.publicMatch(matchId))).not.toContain(reply.playerToken);
    } finally {
      h.close();
    }
  });
});

describe('the cap and the stages', () => {
  it('FR-380 with a cap of 3 the fourth join is match-full and stores, draws and memoises nothing; the third was accepted', () => {
    const h = publicHarness({ maxPlayers: 3 });
    try {
      const { matchId } = lobbyOf(h);
      for (const [i, n] of ['Ana', 'Bea', 'Cy'].entries()) joined(join(h, matchId, n, `j-${i}`, `src-${i}`));
      const draws = h.draws.length;
      expect(errorOf(join(h, matchId, 'Dan', 'j-9', 'src-9'))).toStrictEqual(errorReply('match-full'));
      expect(h.draws.length).toBe(draws);
      expect(h.store.playerCount(matchId)).toBe(3);
      expect(h.store.memoGet(scopeOf('src-9', matchId), 'j-9')).toBeUndefined();
    } finally {
      h.close();
    }
  });

  it('FR-377 a lobby at or after its expiry instant is match-expired even before the wake-up ran, and a join one millisecond earlier works', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyOf(h);
      const expires = START_MS + 48 * 3_600_000;
      h.clock.set(expires - 1);
      joined(join(h, matchId, 'Ana', 'j-1'));
      h.clock.set(expires);
      expect(errorOf(join(h, matchId, 'Bea', 'j-2'))).toStrictEqual(errorReply('match-expired'));
      expect(h.store.playerCount(matchId)).toBe(1);
    } finally {
      h.close();
    }
  });

  it('FR-377 an expired lobby, a finished match and a halted match refuse with the closed codes and store nothing', () => {
    const h = publicHarness();
    try {
      const { matchId: lobby } = lobbyOf(h);
      h.clock.set(START_MS + 48 * 3_600_000 + 1);
      h.service.tick();
      expect(h.store.getMatch(lobby)!.match.stage).toBe('expired');
      expect(errorOf(join(h, lobby, 'Ana'))).toStrictEqual(errorReply('match-expired'));

      const halted = h.service.create({ credential: OPERATOR, body: creationBody('c-h', { timing: 'manual' }) });
      if (!halted.ok) throw new Error('creation failed');
      const view = h.store.getMatch(halted.reply.matchId)!.match;
      h.store.transaction(() => h.store.updateMatch({ ...view, stage: 'halted', haltReason: 'map-changed', anchors: null }));
      expect(errorOf(join(h, halted.reply.matchId, 'Ana'))).toStrictEqual(errorReply('match-halted'));

      const over = h.service.create({ credential: OPERATOR, body: creationBody('c-f', { timing: 'manual' }) });
      if (!over.ok) throw new Error('creation failed');
      for (let round = 1; h.store.getMatch(over.reply.matchId)!.match.stage !== 'finished'; round++) {
        for (const step of ['phase-1-close', 'phase-2-close', 'application'] as StepKind[]) {
          const out = h.service.advance({ credential: OPERATOR, matchId: over.reply.matchId, body: { round, step } });
          if (!out.ok) throw new Error(`advance refused ${JSON.stringify(out.error)}`);
        }
      }
      expect(errorOf(join(h, over.reply.matchId, 'Ana'))).toStrictEqual(errorReply('match-finished'));
      for (const id of [lobby, halted.reply.matchId, over.reply.matchId]) expect(h.store.playerCount(id)).toBe(0);
      expect(h.draws.filter((d) => d.length === 9)).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  it('FR-380 FR-376 a join after the start works: the start reply and the reads count the players, and the running match keeps its order of events', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      joined(join(h, matchId, 'Ana', 'j-1'));
      joined(join(h, matchId, 'Bea', 'j-2'));
      const started = h.service.startMatch({ credential: hostToken, matchId, body: {} });
      if (!started.ok) throw new Error('start failed');
      expect(started.reply.match).toMatchObject({ stage: 'phase-1', lastSeq: 4, playerCount: 2 });
      const late = joined(join(h, matchId, 'Cy', 'j-3'));
      expect(late.match).toMatchObject({ stage: 'phase-1', lastSeq: 5, playerCount: 3 });
      expect(h.store.eventsAfter(matchId, 4)).toStrictEqual([{ type: 'player-joined', seq: 5, playerId: late.playerId, name: 'Cy' }]);
      expect(h.service.publicMatch(matchId)).toMatchObject({ playerCount: 3, lastSeq: 5 });
    } finally {
      h.close();
    }
  });

  it('a running match with no player keeps the 008 public data (no count)', () => {
    const h = publicHarness();
    try {
      const { matchId, hostToken } = lobbyOf(h);
      h.service.startMatch({ credential: hostToken, matchId, body: {} });
      expect('playerCount' in h.service.publicMatch(matchId)!).toBe(false);
    } finally {
      h.close();
    }
  });
});

const GOLD = (JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: { absorber: number }[] }> }).matches['ascending-00-1f']!.rounds;
const WINNER = GOLD[3]!.absorber;

describe('joining a running match', () => {
  const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };

  it('FR-380 works in phase-1, phase-2 and locked; the late player has no row for earlier phases, and its later predictions score like any other', () => {
    const h = serviceHarness({ secret: SECRETS['ascending-00-1f'] });
    try {
      const made = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
      if (!made.ok) throw new Error('creation failed');
      const id = made.reply.matchId;
      const step = (round: number, kind: StepKind): void => {
        const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round, step: kind } });
        if (!out.ok) throw new Error(`advance refused ${JSON.stringify(out.error)}`);
      };
      const living = (): number[] => [...new Set(h.store.getMatch(id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
      expect(h.service.submit({ client: WEB, matchId: id, body: { kind: 'winner', faction: WINNER, playerId: 'early' } }).ok).toBe(true);

      // A join in each running stage of round 1.
      const stages: string[] = [];
      const players = [] as string[];
      let n = 0;
      const joinNow = (): void => {
        stages.push(h.store.getMatch(id)!.match.stage);
        players.push(joined(join(h, id, `P${n}`, `j-${n}`, `s-${n++}`)).playerId);
      };
      joinNow(); // phase-1
      step(1, 'phase-1-close');
      joinNow(); // phase-2
      step(1, 'phase-2-close');
      joinNow(); // locked
      expect(stages).toStrictEqual(['phase-1', 'phase-2', 'locked']);
      step(1, 'application');

      const late = joined(join(h, id, 'Late', 'j-late', 's-late'));
      const local = late.playerId.slice('player:'.length);
      // The token path: the match confirms the token, and the resolved pair submits.
      const found = h.service.playerTokenOf(id, late.playerToken);
      if (!found.ok || found.reply === undefined) throw new Error('the late joiner token was not found');
      expect(found.reply.playerId).toBe(late.playerId);
      const AS_PLAYER = { tokenDigest: credentialDigest(late.playerToken), playerId: found.reply.playerId };
      const pick = living()[0]!;
      expect(h.service.submit({ client: AS_PLAYER, matchId: id, body: { kind: 'victim', round: 2, faction: pick, playerId: local } }).ok).toBe(true);
      expect(h.service.submit({ client: AS_PLAYER, matchId: id, body: { kind: 'winner', faction: WINNER, playerId: local } }).ok).toBe(true);
      for (const round of [2, 3, 4]) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as StepKind[]) step(round, kind);
      expect(h.store.getMatch(id)!.match.stage).toBe('finished');

      const results = h.service.playerResults(id, late.playerId, { limit: 500 });
      if (!results.ok) throw new Error('results failed');
      expect(results.reply.items.map((i) => [i.kind, i.round ?? 0])).toStrictEqual([['winner', 0], ['victim', 2]]);
      expect(results.reply.items.find((i) => i.kind === 'winner')).toMatchObject({ correct: true });
      const board = h.service.leaderboard(id, { limit: 500 });
      if (!board.ok) throw new Error('leaderboard failed');
      const ids = board.reply.items.map((r) => r.playerId);
      expect(ids).toContain(late.playerId);
      expect(ids).toContain('web:early');
      // The players that joined earlier made no prediction: they have no rows and no points.
      for (const earlier of players) expect(ids).not.toContain(earlier);
      expect(board.reply.items.find((r) => r.playerId === late.playerId)!.total).toBe(results.reply.total);
      expect(results.reply.total).toBeGreaterThan(0);
      expect(h.service.publicMatch(id)).toMatchObject({ stage: 'finished', playerCount: 4 });
    } finally {
      h.close();
    }
  });
});
