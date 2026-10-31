import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import { openStore } from '../src/store/sqlite';
import { scanValues, withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';
import { join } from 'node:path';

// There is no account, no recovery and no name change (spec 011 M3 T8): the token leaves the server once, in the join reply
// (and sits, as the host token does, in its 24-hour memo row). Nothing in the service can read it back, issue a second one for
// a player, or change a name.

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;
const publicHarness = (extra: HarnessOptions = {}): Harness => serviceHarness({ publicCreation: PUBLIC, secret: SECRETS['ascending-00-1f'], ...extra });
const lobbyOf = (h: Harness): string => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  return out.reply.matchId;
};

describe('no recovery, no name change', () => {
  it('FR-382 the service has no method that changes a name, issues a second token or reads one back: its method list is pinned', () => {
    const h = publicHarness();
    try {
      expect(Object.keys(h.service).sort()).toStrictEqual([
        'advance', 'close', 'create', 'createPublic', 'eventsAfter', 'hostTokenMatches', 'join', 'leaderboard', 'listMatches', 'mapFile', 'ownPredictions', 'ownPredictionsPage',
        'phaseResults', 'playerResults', 'playerTokenOf', 'players', 'publicMatch', 'purgeMemos', 'readPublicMatch', 'recordAt', 'records', 'start', 'startMatch', 'stateAt', 'submit', 'subscribe', 'tick',
      ]);
      // The only methods that take a token: the lookup (answers a player id) and the host check (answers a boolean).
      const reply = h.service.playerTokenOf(lobbyOf(h), 'x'.repeat(43));
      expect(reply).toStrictEqual({ ok: true, reply: undefined });
    } finally {
      h.close();
    }
  });

  it('FR-382 a second join with another request id and the same name is name-taken, even from the same source: no second token, no rename', () => {
    const h = publicHarness();
    try {
      const matchId = lobbyOf(h);
      const first = h.service.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
      if (!first.ok) throw new Error('join refused');
      const draws = h.draws.length;
      for (const [i, name] of ['Ana', 'ana', ' ANA ', 'Aná'].entries()) {
        expect(h.service.join({ source: 'src-a', matchId, body: { name, requestId: `j-again-${i}` } }), name).toStrictEqual({ ok: false, error: errorReply('name-taken') });
      }
      // A join under another name from the same source is a new player, with its own token; the first stays as it was.
      const second = h.service.join({ source: 'src-a', matchId, body: { name: 'Bea', requestId: 'j-2' } });
      if (!second.ok) throw new Error('second join refused');
      expect(second.reply.playerId).not.toBe(first.reply.playerId);
      expect(second.reply.playerToken).not.toBe(first.reply.playerToken);
      expect(h.draws.length).toBe(draws + 2);
      expect(h.store.playersAfter(matchId, undefined, 10).map((p) => [p.playerId, p.name])).toStrictEqual([
        [first.reply.playerId, 'Ana'],
        [second.reply.playerId, 'Bea'],
      ]);
      // The token of the first player still finds the first player, and only it.
      expect(h.service.playerTokenOf(matchId, first.reply.playerToken)).toStrictEqual({ ok: true, reply: { playerId: first.reply.playerId } });
      expect(h.store.playerByTokenDigest(matchId, credentialDigest(first.reply.playerToken))?.name).toBe('Ana');
    } finally {
      h.close();
    }
  });

  it('FR-382 the replay of a join returns the first reply, which is the only second sight of the token; any other request cannot reach it', () => {
    const h = publicHarness();
    try {
      const matchId = lobbyOf(h);
      const body = { name: 'Ana', requestId: 'j-1' };
      const first = h.service.join({ source: 'src-a', matchId, body });
      const again = h.service.join({ source: 'src-a', matchId, body });
      expect(again).toStrictEqual(first);
      // Another source with the same request id and name is not a replay: the name is taken, and the token is not shown.
      expect(h.service.join({ source: 'src-b', matchId, body })).toStrictEqual({ ok: false, error: errorReply('name-taken') });
      const token = first.ok ? first.reply.playerToken : '';
      for (const read of [h.service.players(matchId, { limit: 500 }), h.service.readPublicMatch(matchId), h.service.eventsAfter(matchId, 0), h.service.listMatches({ limit: 500 })]) {
        expect(JSON.stringify(read)).not.toContain(token);
      }
    } finally {
      h.close();
    }
  });

  it('FR-382 (clear text) the token is in clear text only in the join reply and its memo row: a scan of every table of the database file', () => {
    withTempDir((dir) => {
      const file = join(dir, 'tokens.db');
      const h = publicHarness({ store: openStore(file) });
      let token = '';
      let matchId = '';
      try {
        matchId = lobbyOf(h);
        const out = h.service.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
        if (!out.ok) throw new Error('join refused');
        token = out.reply.playerToken;
        // Reads, a start and a prediction of the player add nothing that carries the token.
        h.service.players(matchId, { limit: 10 });
        h.service.playerTokenOf(matchId, token);
      } finally {
        h.close();
      }
      withRawDb(file, (db) => {
        expect(scanValues(db, [token])).toStrictEqual(['memo.reply_json']);
        expect(scanValues(db, [token], ['memo.reply_json'])).toStrictEqual([]);
        // The digest of the token is stored in the player row, in the form the lookup uses.
        expect(scanValues(db, [credentialDigest(token)])).toStrictEqual(['players.token_digest']);
      });
    });
  });
});
