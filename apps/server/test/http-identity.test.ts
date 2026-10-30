import { describe, expect, it } from 'vitest';
import { credentialDigest, sameDigest } from '../src/service/ids';
import { DEFAULT_LIMITS } from '../src/service/settings';
import type { ServerSettings } from '../src/service/settings';
import { MAX_TOKEN_LENGTH, credentialTable, hostIdentity, identify, playerIdFor, playerIdentity, readBearer, requireClient, submitterOf } from '../src/http/identity';
import type { Identity } from '../src/http/identity';
import { OFF_PUBLIC } from './helpers/service-harness';

// Credential reading and classification for the HTTP layer (M3a T6). FR-283 (Bearer reading): only the `Authorization`
// header with the `Bearer` scheme carries a credential; FR-284: submissions and own-prediction reads need a client
// credential and the player id is `<namespace of that credential>:<local id>`; FR-300 (constant-time comparison,
// transport): the presented token is compared by digest with every configured credential, all comparisons always run.

const OPERATOR = 'operator-planted-0000000000AAAA';
const WEB = 'client-web-planted-000000000BBBB';
const BOT = 'client-bot-planted-000000000CCCC';
const HOST = 'host-token-planted-0000000000000000000DDDD';

const settings: ServerSettings = {
  operatorCredential: OPERATOR,
  maps: {},
  runningMatchLimit: 20,
  databasePath: ':memory:',
  forcedPhaseSeconds: 5,
  maxPlayers: 200,
  publicCreation: OFF_PUBLIC,
  clients: [
    { namespace: 'web', credential: WEB },
    { namespace: 'discord', credential: BOT },
  ],
  allowedOrigins: [],
  host: '127.0.0.1',
  port: 0,
  limits: DEFAULT_LIMITS,
};
const table = credentialTable(settings);

describe('http identity', () => {
  it('FR-283 (Bearer reading) exactly one `Authorization: Bearer <token>` value gives the token', () => {
    expect(readBearer([`Bearer ${WEB}`])).toBe(WEB);
    expect(readBearer(`Bearer ${WEB}`)).toBe(WEB);
    // The scheme is case-insensitive (RFC 7235 section 2.1); the token is not.
    expect(readBearer([`bearer ${WEB}`])).toBe(WEB);
    expect(readBearer([`BEARER ${WEB}`])).toBe(WEB);
  });

  it('FR-283 (Bearer reading) anything else is no credential at all', () => {
    for (const value of [
      undefined,
      [],
      [`Basic ${WEB}`],
      ['Bearer'],
      ['Bearer '],
      [`Bearer  ${WEB}`],
      [` Bearer ${WEB}`],
      [`Bearer ${WEB} `],
      [`Bearer\t${WEB}`],
      [`Bearer ${WEB}=`],
      [`Bearer ${WEB}+x`],
      [`Bearer ${WEB}/x`],
      [`Bearer ${WEB}.x`],
      [`Bearer ${WEB} extra`],
      [`Bearer ${'a'.repeat(MAX_TOKEN_LENGTH + 1)}`],
      [`Bearer ${'a'.repeat(21)}`],
      ['Bearer x'],
      [`Bearer ${WEB}`, `Bearer ${WEB}`],
      [`Bearer ${WEB}`, `Bearer ${BOT}`],
      [`Bearer ${WEB}\n`],
      [`Bearer ${WEB.slice(0, 10)}é${WEB.slice(11)}`],
    ] as const) {
      expect(readBearer(value as readonly string[] | string | undefined), JSON.stringify(value)).toBeUndefined();
    }
    expect(MAX_TOKEN_LENGTH).toBe(256);
    expect(readBearer([`Bearer ${'a'.repeat(MAX_TOKEN_LENGTH)}`])).toBe('a'.repeat(MAX_TOKEN_LENGTH));
    expect(readBearer([`Bearer ${'a'.repeat(22)}`])).toBe('a'.repeat(22));
  });

  it('FR-284 (identity) the operator, a client with the namespace of its own settings entry, a candidate and anonymous', () => {
    expect(identify(OPERATOR, table)).toStrictEqual({ role: 'operator', digest: credentialDigest(OPERATOR) });
    expect(identify(WEB, table)).toStrictEqual({ role: 'client', digest: credentialDigest(WEB), namespace: 'web' });
    expect(identify(BOT, table)).toStrictEqual({ role: 'client', digest: credentialDigest(BOT), namespace: 'discord' });
    expect(identify(HOST, table)).toStrictEqual({ role: 'candidate', digest: credentialDigest(HOST) });
    expect(identify(undefined, table)).toStrictEqual({ role: 'anonymous' });
  });

  it('FR-284 (identity) a candidate is the host only when the match says its token matches; otherwise anonymous', () => {
    const candidate = identify(HOST, table);
    expect(hostIdentity(candidate, true)).toStrictEqual({ role: 'host', digest: credentialDigest(HOST) });
    expect(hostIdentity(candidate, false)).toStrictEqual({ role: 'anonymous' });
    // Only a candidate can become the host: the operator and clients stay what they are, anonymous stays anonymous.
    expect(hostIdentity(identify(OPERATOR, table), true)).toStrictEqual(identify(OPERATOR, table));
    expect(hostIdentity(identify(WEB, table), true)).toStrictEqual(identify(WEB, table));
    expect(hostIdentity({ role: 'anonymous' }, true)).toStrictEqual({ role: 'anonymous' });
  });

  it('FR-284 (identity) the identity holds a digest and a role, never the credential text', () => {
    for (const token of [OPERATOR, WEB, BOT, HOST]) {
      const found = identify(token, table);
      const promoted = hostIdentity(found, true);
      for (const value of [found, promoted]) {
        const text = JSON.stringify(value);
        expect(text).not.toContain(token);
        expect(Object.keys(value).sort()).toStrictEqual(value.role === 'client' ? ['digest', 'namespace', 'role'] : ['digest', 'role']);
      }
    }
    const tableText = JSON.stringify(table);
    for (const token of [OPERATOR, WEB, BOT]) expect(tableText).not.toContain(token);
  });

  it('FR-300 (constant-time comparison, transport) every configured credential is compared whatever matches, through sameDigest', () => {
    const calls: [string, string][] = [];
    const counting = (a: string, b: string): boolean => {
      calls.push([a, b]);
      return sameDigest(a, b);
    };
    const total = 1 + settings.clients.length;
    for (const token of [OPERATOR, WEB, BOT, HOST]) {
      calls.length = 0;
      identify(token, table, counting);
      expect(calls, token).toHaveLength(total);
      // Each comparison takes the digest of the presented token and one configured digest, each configured digest once.
      for (const [a] of calls) expect(a).toBe(credentialDigest(token));
      expect(calls.map(([, b]) => b).sort()).toStrictEqual([table.operator, ...table.clients.map((c) => c.digest)].sort());
    }
    calls.length = 0;
    identify(undefined, table, counting);
    expect(calls).toHaveLength(0);
  });

  it('FR-300 (constant-time comparison, transport) with many clients the count does not depend on the position of the match', () => {
    const many: ServerSettings = {
      ...settings,
      clients: Array.from({ length: 9 }, (_, i) => ({ namespace: `ns${i}`, credential: `client-credential-planted-${i}-xxxxxxxx` })),
    };
    const big = credentialTable(many);
    let count = 0;
    const counting = (a: string, b: string): boolean => {
      count += 1;
      return sameDigest(a, b);
    };
    const counts = [OPERATOR, ...many.clients.map((c) => c.credential), HOST].map((token) => {
      count = 0;
      identify(token, big, counting);
      return count;
    });
    expect(new Set(counts)).toStrictEqual(new Set([10]));
    expect(identify(many.clients[8]?.credential, big)).toStrictEqual({ role: 'client', digest: credentialDigest(many.clients[8]?.credential ?? ''), namespace: 'ns8' });
  });

  it('FR-284 (player id) the player id is `<namespace>:<local id>`, the namespace from the credential only', () => {
    const web = identify(WEB, table);
    expect(playerIdFor(web, 'alice')).toStrictEqual({ ok: true, playerId: 'web:alice' });
    expect(playerIdFor(identify(BOT, table), '123456789012345678')).toStrictEqual({ ok: true, playerId: 'discord:123456789012345678' });
    // A local id that carries a namespace, or any character outside FR-297, is `invalid-player-id` (P31).
    for (const local of ['discord:123', 'web:alice', ':x', 'a b', '', 'x'.repeat(65), 'café']) {
      expect(playerIdFor(web, local), local).toStrictEqual({ ok: false, error: { kind: 'invalid-player-id' } });
    }
  });

  it('FR-284 (identity) submissions and own-prediction reads require a client credential: anything else is forbidden', () => {
    const forbidden = { ok: false, error: { kind: 'forbidden' } };
    expect(requireClient(identify(WEB, table))).toStrictEqual({ ok: true, client: { role: 'client', digest: credentialDigest(WEB), namespace: 'web' } });
    for (const who of [identify(OPERATOR, table), identify(HOST, table), hostIdentity(identify(HOST, table), true), identify(undefined, table)] as Identity[]) {
      expect(requireClient(who), who.role).toStrictEqual(forbidden);
    }
    expect(playerIdFor(identify(OPERATOR, table), 'alice')).toStrictEqual(forbidden);
    expect(playerIdFor({ role: 'anonymous' }, 'alice')).toStrictEqual(forbidden);
    // `invalid-player-id` comes before `forbidden` in the FR-301 order.
    expect(playerIdFor({ role: 'anonymous' }, 'discord:1')).toStrictEqual({ ok: false, error: { kind: 'invalid-player-id' } });
    expect(playerIdFor(identify(OPERATOR, table), 'discord:1')).toStrictEqual({ ok: false, error: { kind: 'invalid-player-id' } });
  });

  it('FR-283 (Bearer reading) the credential table holds the digests of the settings in order', () => {
    expect(table).toStrictEqual({
      operator: credentialDigest(OPERATOR),
      clients: [
        { namespace: 'web', digest: credentialDigest(WEB) },
        { namespace: 'discord', digest: credentialDigest(BOT) },
      ],
    });
  });
});

// The player role (spec 011 M3 T7): the token of a player who joined by name, confirmed by the match, is a `player` for that
// match only. The identity holds the digest, the player id and the match id, never the token text.
const PLAYER_TOKEN = 'player-token-planted-0000000000000EEEE';
const MATCH = 'match-aaaaaaaaaaaa';

describe('http identity: players', () => {
  const candidate = (): Identity => identify(PLAYER_TOKEN, table);

  it('FR-378 a candidate the match confirms is a player of that match, holding the digest and the ids and no token text', () => {
    const player = playerIdentity(candidate(), MATCH, () => ({ playerId: 'player:abcdefghijkl' }));
    expect(player).toStrictEqual({ role: 'player', digest: credentialDigest(PLAYER_TOKEN), playerId: 'player:abcdefghijkl', matchId: MATCH });
    expect(Object.keys(player).sort()).toStrictEqual(['digest', 'matchId', 'playerId', 'role']);
    expect(JSON.stringify(player)).not.toContain(PLAYER_TOKEN);
  });

  it('FR-378 a candidate no player of the match owns is anonymous', () => {
    expect(playerIdentity(candidate(), MATCH, () => undefined)).toStrictEqual({ role: 'anonymous' });
  });

  it('FR-378 the lookup runs for a candidate only: an operator, a client, a host or an anonymous caller keep their role and ask nothing', () => {
    let asked = 0;
    const lookup = () => {
      asked += 1;
      return { playerId: 'player:abcdefghijkl' };
    };
    const others: Identity[] = [identify(OPERATOR, table), identify(WEB, table), { role: 'host', digest: credentialDigest(HOST) }, { role: 'anonymous' }];
    for (const who of others) expect(playerIdentity(who, MATCH, lookup), who.role).toStrictEqual(who);
    expect(asked).toBe(0);
    playerIdentity(candidate(), MATCH, lookup);
    expect(asked).toBe(1);
  });

  it('submitterOf: a client submits as playerIdFor says, exactly', () => {
    for (const who of [identify(WEB, table), identify(BOT, table), identify(OPERATOR, table), { role: 'anonymous' } as Identity]) {
      for (const local of ['alice', 'a b', 'discord:1', '', 'x'.repeat(65)]) expect(submitterOf(who, local), `${who.role} ${local}`).toStrictEqual(playerIdFor(who, local));
    }
  });

  it('submitterOf: a player submits only under its own id: its own local id gives it, any other is forbidden, a malformed one invalid-player-id first', () => {
    const player = playerIdentity(candidate(), MATCH, () => ({ playerId: 'player:abcdefghijkl' }));
    expect(submitterOf(player, 'abcdefghijkl')).toStrictEqual({ ok: true, playerId: 'player:abcdefghijkl' });
    for (const other of ['abcdefghijkm', 'ABCDEFGHIJKL', 'abcdefghijk', 'alice']) {
      expect(submitterOf(player, other), other).toStrictEqual({ ok: false, error: { kind: 'forbidden' } });
    }
    for (const bad of ['player:abcdefghijkl', 'a b', '', 'x'.repeat(65)]) {
      expect(submitterOf(player, bad), bad).toStrictEqual({ ok: false, error: { kind: 'invalid-player-id' } });
    }
    // A host or a candidate that was not confirmed is not a player.
    expect(submitterOf(candidate(), 'abcdefghijkl')).toStrictEqual({ ok: false, error: { kind: 'forbidden' } });
    expect(submitterOf({ role: 'host', digest: credentialDigest(HOST) }, 'abcdefghijkl')).toStrictEqual({ ok: false, error: { kind: 'forbidden' } });
  });

  it('submitterOf: a client of a namespace cannot name a joined player: the id comes from its own namespace', () => {
    expect(submitterOf(identify(WEB, table), 'abcdefghijkl')).toStrictEqual({ ok: true, playerId: 'web:abcdefghijkl' });
  });
});
