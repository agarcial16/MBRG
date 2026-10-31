import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { roundSeed, secretHex } from '../src/secret';
import { credentialDigest } from '../src/service/ids';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService, PlayerCaller } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import {
  absorberColumnsOutsideRecords,
  credentialTextColumns,
  encodingsOf,
  pendingStateColumns,
  listColumns,
  playerEventViolations,
  playerTokenPlaces,
  rowsBeyondApplied,
  scanValues,
  storedFutureViolations,
  withRawDb,
} from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Players from the lobby to the finished match (spec 011 M3 T9): a public lobby, three joins by name, the start, predictions
// by token and by client credential side by side, every step to the finish, the leaderboard, and a restart after every action
// with the closed database scanned: the 008 secrecy scans with players present, and no token text anywhere but the memo row of
// its own join reply (24 h). Then the impersonation matrix.

const S = 1000;
const PLANTED = Uint8Array.from(createHash('sha256').update('mbrg/spec-011/m3-t9/planted').digest());
const NEXT = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' } as const;
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;

interface Player {
  readonly playerId: string;
  readonly local: string;
  readonly token: string;
  readonly caller: PlayerCaller;
}

const joinAs = (service: MatchService, matchId: string, name: string): Player => {
  const out = service.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
  if (!out.ok) throw new Error(`join of ${name} refused`);
  const { playerId, playerToken } = out.reply;
  return { playerId, local: playerId.slice('player:'.length), token: playerToken, caller: { tokenDigest: credentialDigest(playerToken), playerId } };
};

describe('players from the lobby to the finished match', () => {
  it('a public lobby, three joins, the start, token and client predictions, every step to the finish: both kinds reach the leaderboard and the database never holds a token outside its memo row nor the future', () => {
    withTempDir((dir) => {
      const file = join(dir, 'flow.sqlite');
      const h = serviceHarness({ store: openStore(file), publicCreation: PUBLIC, secret: PLANTED });
      const live: { store: Store; service: MatchService } = { store: h.store, service: h.service };
      const tokens: string[] = [];
      let reopened = 0;
      const checkpoint = (label: string, tokenInMemo = true): void => {
        live.service.close();
        const found = withRawDb(file, (db) => {
          const columns = listColumns(db);
          const stage = String(db.prepare('SELECT stage FROM matches').get()!.stage);
          const hex = secretHex(PLANTED);
          return {
            label,
            columns: [...absorberColumnsOutsideRecords(columns), ...pendingStateColumns(columns), ...credentialTextColumns(columns)],
            beyond: rowsBeyondApplied(db),
            future: storedFutureViolations(db),
            seeds: [1, 2, 3, 4].flatMap((k) => scanValues(db, encodingsOf(roundSeed(PLANTED, k)))),
            secret: scanValues(db, encodingsOf(PLANTED).filter((e) => e !== hex), ['matches.secret']),
            secretHex: stage === 'finished' ? [] : scanValues(db, [hex], ['matches.secret']),
            tokens: playerTokenPlaces(db, tokens, tokenInMemo),
            events: playerEventViolations(db),
          };
        });
        expect(found).toStrictEqual({ label, columns: [], beyond: [], future: [], seeds: [], secret: [], secretHex: [], tokens: [], events: [] });
        reopened += 1;
        live.store = openStore(file);
        live.service = createMatchService({ store: live.store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings });
        live.service.start();
      };

      try {
      const made = live.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
      if (!made.ok) throw new Error('creation failed');
      const { matchId, hostToken } = made.reply;
      tokens.push(hostToken);
      checkpoint('created');

      const players: Player[] = [];
      for (const [i, name] of ['Ana', 'Bea', 'Cy'].entries()) {
        h.clock.set(START_MS + (i + 1) * S);
        const p = joinAs(live.service, matchId, name);
        players.push(p);
        tokens.push(p.token);
        checkpoint(`joined ${name}`);
      }
      const [ana, bea, cy] = players as [Player, Player, Player];
      const living = (): number[] => [...new Set(live.service.publicMatch(matchId)!.state.owners.map(([, f]) => f))].sort((a, b) => a - b);

      // A lobby is closed to predictions of any kind of caller.
      expect(live.service.submit({ client: ana.caller, matchId, body: { kind: 'winner', faction: living()[0], playerId: ana.local } })).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });

      h.clock.set(START_MS + 10 * S);
      expect(live.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
      checkpoint('started');

      let predicted = 0;
      for (let n = 0; n < 60; n++) {
        const shown = live.service.publicMatch(matchId)!;
        if (shown.stage === 'finished') break;
        const stage = shown.stage as keyof typeof NEXT;
        if (shown.stage === 'phase-1') {
          const round = shown.appliedRounds + 1;
          const alive = living();
          const pick = (k: number): number => alive[(n + k) % alive.length]!;
          // Ana and Bea by token, Dan by client credential; Cy joined and never predicts.
          for (const [i, p] of [ana, bea].entries()) {
            expect(live.service.submit({ client: p.caller, matchId, body: { kind: 'victim', round, faction: pick(i), playerId: p.local, requestId: `v-${p.local}-${round}` } }).ok).toBe(true);
            expect(live.service.submit({ client: p.caller, matchId, body: { kind: 'winner', faction: pick(i + 1), playerId: p.local } }).ok).toBe(true);
          }
          expect(live.service.submit({ client: { ...WEB }, matchId, body: { kind: 'victim', round, faction: pick(2), playerId: 'dan', requestId: `v-dan-${round}` } }).ok).toBe(true);
          expect(live.service.submit({ client: { ...WEB }, matchId, body: { kind: 'winner', faction: pick(3), playerId: 'dan' } }).ok).toBe(true);
          predicted += 1;
          checkpoint(`predictions of round ${round}`);
        }
        const now = live.service.publicMatch(matchId)!;
        const schedule = now.schedule!;
        h.clock.set(stage === 'phase-1' ? schedule.c1 : stage === 'phase-2' ? schedule.c2 : schedule.a);
        live.service.tick();
        checkpoint(`after ${NEXT[stage]}`);
      }
      expect(live.service.publicMatch(matchId)!.stage).toBe('finished');
      expect(predicted).toBeGreaterThanOrEqual(3);
      expect(reopened).toBeGreaterThan(15);

      // Both kinds of caller are on the leaderboard (ids only), the player who never predicted is not.
      const board = live.service.leaderboard(matchId, { limit: 500 });
      if (!board.ok) throw new Error('leaderboard failed');
      const ids = board.reply.items.map((r) => r.playerId);
      expect(ids.sort()).toStrictEqual([ana.playerId, bea.playerId, 'web:dan'].sort());
      expect(ids).not.toContain(cy.playerId);
      const text = JSON.stringify(board);
      for (const secret of [...tokens, 'Ana', 'Bea', 'Cy']) expect(text.includes(secret)).toBe(false);
      for (const p of [ana, bea]) {
        const mine = live.service.playerResults(matchId, p.playerId, { limit: 500 });
        expect(mine.ok && mine.reply.total).toBe(board.reply.items.find((r) => r.playerId === p.playerId)!.total);
      }
      expect(live.service.publicMatch(matchId)).toMatchObject({ stage: 'finished', playerCount: 3 });
      // The finished match answers the token reads of its players and refuses new ones.
      expect(live.service.playerTokenOf(matchId, cy.token)).toStrictEqual({ ok: true, reply: { playerId: cy.playerId } });
      expect(live.service.join({ source: 'src-late', matchId, body: { name: 'Late', requestId: 'j-late' } })).toStrictEqual({ ok: false, error: errorReply('match-finished') });

      // After 24 h the next start purges the memo rows (and with them the plain tokens); the players and their tokens stay valid.
      h.clock.set(START_MS + MEMO_RETENTION_MS + 3600 * S);
      checkpoint('a day later, before the purge');
      checkpoint('after the purge', false);
      for (const p of players) expect(live.service.playerTokenOf(matchId, p.token)).toStrictEqual({ ok: true, reply: { playerId: p.playerId } });
      live.service.close();
      expect(withRawDb(file, (db) => db.prepare('SELECT COUNT(*) AS n FROM memo').get()!.n)).toBe(0);
      expect(withRawDb(file, (db) => db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n)).toBe(3);
      } finally {
        live.service.close();
      }
    });
  }, 120_000);
});

describe('impersonation: a token with ids that are not its own', () => {
  const setup = (): { h: Harness; matchId: string; ana: Player; bea: Player } => {
    const h = serviceHarness({ publicCreation: PUBLIC, secret: SECRETS['ascending-00-1f'] });
    const made = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
    if (!made.ok) throw new Error('creation failed');
    const { matchId, hostToken } = made.reply;
    const ana = joinAs(h.service, matchId, 'Ana');
    const bea = joinAs(h.service, matchId, 'Bea');
    expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
    return { h, matchId, ana, bea };
  };
  const firstLiving = (h: Harness, matchId: string): number => h.store.getMatch(matchId)!.match.state.owners[0]![1];

  it('token A writes and reads only as A: the ids of B, of a client namespace and malformed ids are refused, and nothing is stored or memoised', () => {
    const { h, matchId, ana, bea } = setup();
    try {
      const faction = firstLiving(h, matchId);
      const forbidden = { ok: false, error: errorReply('forbidden') };
      const invalid = { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
      const attempts: [string, unknown][] = [
        [bea.local, forbidden],
        [bea.local.toUpperCase() === bea.local ? bea.local.toLowerCase() : bea.local.toUpperCase(), forbidden],
        ['dan', forbidden],
        [bea.playerId, invalid],
        [`web:${ana.local}`, invalid],
        [`web:${bea.local}`, invalid],
        ['a b', invalid],
        ['', invalid],
        ['x'.repeat(200), invalid],
      ];
      for (const [i, [playerId, expected]] of attempts.entries()) {
        const body = { kind: 'victim', round: 1, faction, playerId, requestId: `imp-${i}` };
        expect(h.service.submit({ client: ana.caller, matchId, body }), `submit as ${playerId}`).toStrictEqual(expected);
        expect(h.service.ownPredictions({ player: ana.caller, playerId, matchId }), `read as ${playerId}`).toStrictEqual(expected);
        expect(h.service.ownPredictionsPage({ player: ana.caller, playerId, matchId, limit: 500 }), `page as ${playerId}`).toStrictEqual(expected);
        expect(h.store.memoGet({ credentialDigest: ana.caller.tokenDigest, match: matchId }, `imp-${i}`)).toBeUndefined();
      }
      for (const id of [ana.playerId, bea.playerId, `web:${ana.local}`, `web:${bea.local}`, 'web:dan']) expect(h.store.predictionsOf(matchId, id), id).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('a token used as a client credential, and a client naming a player local id, never write under a player id', () => {
    const { h, matchId, ana, bea } = setup();
    try {
      const faction = firstLiving(h, matchId);
      // The token text as the credential of a client: an ordinary client credential in its own namespace, never the player.
      expect(h.service.submit({ client: { credential: ana.token, namespace: 'web' }, matchId, body: { kind: 'victim', round: 1, faction, playerId: bea.local } }).ok).toBe(true);
      expect(h.store.predictionsOf(matchId, `web:${bea.local}`)).toHaveLength(1);
      for (const id of [ana.playerId, bea.playerId]) expect(h.store.predictionsOf(matchId, id)).toStrictEqual([]);
      // The player reads none of it, and the client reads none of the player's.
      expect(h.service.ownPredictions({ player: bea.caller, playerId: bea.local, matchId })).toStrictEqual({ ok: true, predictions: [] });
      expect(h.service.submit({ client: bea.caller, matchId, body: { kind: 'victim', round: 1, faction, playerId: bea.local } }).ok).toBe(true);
      expect(h.service.ownPredictions({ namespace: 'web', playerId: bea.local, matchId })).toMatchObject({ ok: true, predictions: [{ choice: faction }] });
      expect(h.store.predictionsOf(matchId, bea.playerId)).toHaveLength(1);
      expect(h.store.predictionsOf(matchId, `web:${bea.local}`)).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('a token is nobody on another match, and a lookup never answers with the player of another token', () => {
    const { h, matchId, ana, bea } = setup();
    try {
      const other = h.service.createPublic({ source: 'src-host', body: creationBody('c-2') });
      if (!other.ok) throw new Error('creation failed');
      expect(h.service.playerTokenOf(other.reply.matchId, ana.token)).toStrictEqual({ ok: true, reply: undefined });
      expect(h.service.playerTokenOf(matchId, ana.token)).toStrictEqual({ ok: true, reply: { playerId: ana.playerId } });
      expect(h.service.playerTokenOf(matchId, bea.token)).toStrictEqual({ ok: true, reply: { playerId: bea.playerId } });
      // The host token and the operator credential are not player tokens either.
      expect(h.service.playerTokenOf(matchId, other.reply.hostToken)).toStrictEqual({ ok: true, reply: undefined });
    } finally {
      h.close();
    }
  });
});
