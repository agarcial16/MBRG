import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { withFaults, type FaultPlan } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { scanValues, withRawDb } from './helpers/db-scan';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// Spec 024 creation over a real listener: a client credential with the client-only policy sends the community key of its
// Discord server, and the match and its key are stored in one transaction (FR-545). Key values are planted literals.

const KEY_A = '5ec12e7a0b9d4c3f'.repeat(4);
const KEY_B = '9b8a7c6d5e4f3021'.repeat(4);
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } as const;

const dirs: string[] = [];
afterEach(async () => {
  // The servers close first: an open store holds its file, and Windows refuses to remove it.
  await closeAllServers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const newFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-community-'));
  dirs.push(dir);
  return join(dir, 'm.sqlite');
};

/** A real server over a database FILE (so a closed-file read can see the rows); `faults` wrap the store as in the 018 tests. */
const start = (file: string, options: ServerHarnessOptions & { faults?: FaultPlan } = {}): Promise<ServerHarness> => {
  const { faults, ...rest } = options;
  return startServer({
    routes: productionRoutes,
    ...rest,
    wrapStore: () => (faults === undefined ? openStore(file) : withFaults(openStore(file), faults)),
    service: { publicCreation: PUBLIC, ...(rest.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, ...(rest.limits ?? {}) },
  });
};
const post = (h: ServerHarness, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: '/matches', body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const created = (reply: ClientReply): { matchId: string } => reply.json() as never;
const withKey = (requestId: string, community: unknown = KEY_A, extra: Record<string, unknown> = {}): Record<string, unknown> => creationBody(requestId, { joinPolicy: 'client', community, ...extra });

/** The rows of `communities` and the number of matches in a closed file. */
const rowsOf = (file: string): { rows: [string, string][]; matches: number } =>
  withRawDb(file, (db) => ({
    rows: db.prepare('SELECT match_id, community FROM communities ORDER BY match_id').all().map((r) => [String(r.match_id), String(r.community)] as [string, string]),
    matches: Number(db.prepare('SELECT COUNT(*) AS n FROM matches').get()?.n),
  }));

describe('the community key at creation over HTTP', () => {
  it('FR-545 a client creation with joinPolicy client and a key stores one row with the match, and replies as a creation without the key', async () => {
    const file = newFile();
    const h = await start(file);
    const reply = await post(h, withKey('c-1'), CLIENT_CREDENTIAL);
    expect(reply.status).toBe(201);
    const plain = await start(newFile());
    const reference = await post(plain, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect([reply.status, reply.text]).toStrictEqual([reference.status, reference.text]);
    const { matchId } = created(reply);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [[matchId, KEY_A]], matches: 1 });
  });

  it('FR-545 two creations of two communities, and a client creation without a key, store one row each or none', async () => {
    const file = newFile();
    const h = await start(file);
    const a = created(await post(h, withKey('c-1', KEY_A), CLIENT_CREDENTIAL));
    const b = created(await post(h, withKey('c-2', KEY_B), CLIENT_CREDENTIAL));
    const c = created(await post(h, creationBody('c-3', { joinPolicy: 'client' }), CLIENT_CREDENTIAL));
    const d = created(await post(h, creationBody('c-4'), CLIENT_CREDENTIAL));
    expect(new Set([a.matchId, b.matchId, c.matchId, d.matchId]).size).toBe(4);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [[a.matchId, KEY_A], [b.matchId, KEY_B]].sort(([x], [y]) => String(x).localeCompare(String(y))) as [string, string][], matches: 4 });
  });

  it('FR-545 a failure of the key write, or of any later write, leaves no match, no row and no memo', async () => {
    // Writes of one creation: the match (1), the lobby (2), the client row (3), the community row (4), the events (5).
    for (const afterWrites of [3, 4]) {
      const file = newFile();
      const h = await start(file, { faults: { failWrite: { transaction: 1, afterWrites } } });
      const reply = await post(h, withKey('c-1'), CLIENT_CREDENTIAL);
      expect([reply.status, reply.text], `after ${afterWrites} writes`).toStrictEqual([503, errorBody('unavailable')]);
      expect(h.base.store.listMatches(undefined, 10), `after ${afterWrites} writes`).toStrictEqual([]);
      expect(h.base.store.memoOldest(), `after ${afterWrites} writes`).toBeUndefined();
      await h.close();
      expect(rowsOf(file), `after ${afterWrites} writes`).toStrictEqual({ rows: [], matches: 0 });
    }
  });

  it('FR-545 the key is written right after the client row: the fourth write of the creation is the community row', async () => {
    const file = newFile();
    const h = await start(file, { faults: { failWrite: { transaction: 1, afterWrites: 3 } } });
    expect((await post(h, withKey('c-1'), CLIENT_CREDENTIAL)).status).toBe(503);
    // The same plan without a key reaches the fourth write (the events) and succeeds up to it: only the key adds a write.
    const plain = await start(newFile(), { faults: { failWrite: { transaction: 1, afterWrites: 3 } } });
    expect((await post(plain, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(503);
    const free = await start(newFile(), { faults: { failWrite: { transaction: 1, afterWrites: 9 } } });
    expect((await post(free, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(201);
    const keyed = await start(newFile(), { faults: { failWrite: { transaction: 1, afterWrites: 5 } } });
    expect((await post(keyed, withKey('c-1'), CLIENT_CREDENTIAL)).status).toBe(503);
    const unkeyed = await start(newFile(), { faults: { failWrite: { transaction: 1, afterWrites: 5 } } });
    expect((await post(unkeyed, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(201);
  });

  it('FR-545 a refused creation stores nothing: a key from an anonymous caller, without joinPolicy client, malformed, or on the operator path', async () => {
    const file = newFile();
    const h = await start(file);
    const before = h.base.draws.length;
    const cases: [string, ClientReply][] = [
      ['anonymous with client and a key', await post(h, withKey('r-1'))],
      ['a client credential without joinPolicy', await post(h, creationBody('r-2', { community: KEY_A }), CLIENT_CREDENTIAL)],
      ['a client credential with open', await post(h, creationBody('r-3', { joinPolicy: 'open', community: KEY_A }), CLIENT_CREDENTIAL)],
      ['the operator', await post(h, creationBody('r-4', { community: KEY_A }), OPERATOR)],
      ['the operator with client', await post(h, withKey('r-5'), OPERATOR)],
    ];
    for (const [name, reply] of cases) {
      expect(reply.status, name).toBe(400);
      expect((reply.json() as { kind: string }).kind, name).toBe('invalid-request');
    }
    expect((cases[0]![1].json() as { items: string[] }).items).toStrictEqual(['community']);
    expect((cases[1]![1].json() as { items: string[] }).items).toStrictEqual(['community']);
    expect((cases[2]![1].json() as { items: string[] }).items).toStrictEqual(['community']);
    expect((cases[3]![1].json() as { items: string[] }).items).toStrictEqual(['community']);
    expect((cases[4]![1].json() as { items: string[] }).items).toStrictEqual(['joinPolicy']);
    for (const bad of [KEY_A.toUpperCase(), KEY_A.slice(0, 63), `${KEY_A}0`, 7, null, ['x']]) {
      const reply = await post(h, withKey('r-6', bad), CLIENT_CREDENTIAL);
      expect([reply.status, (reply.json() as { items: string[] }).items], JSON.stringify(bad)).toStrictEqual([400, ['community']]);
    }
    const repeated = `{"mapId":"dev","timing":{"i":120,"l1":30,"l2":10},"requestId":"r-7","joinPolicy":"client","community":"${KEY_A}","community":"${KEY_B}"}`;
    const reply = await request(h.port, { method: 'POST', path: '/matches', body: repeated, headers: { authorization: `Bearer ${CLIENT_CREDENTIAL}` } });
    expect([reply.status, (reply.json() as { items: string[] }).items]).toStrictEqual([400, ['community']]);
    // A refusal draws nothing and stores nothing; the replies never echo the key.
    expect(h.base.draws.length).toBe(before);
    for (const [, r] of cases) expect(r.text).not.toContain(KEY_A);
    expect(reply.text).not.toContain(KEY_A);
    expect(reply.text).not.toContain(KEY_B);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [], matches: 0 });
  });

  it('FR-545 a creation refused by a public rule (the open-lobby cap) stores no row', async () => {
    const file = newFile();
    const h = await start(file, { service: { publicCreation: { ...PUBLIC, maxOpenLobbies: 1 } } });
    const first = created(await post(h, withKey('c-1'), CLIENT_CREDENTIAL));
    const full = await post(h, withKey('c-2', KEY_B), CLIENT_CREDENTIAL);
    expect([full.status, full.text]).toStrictEqual([409, errorBody('too-many-matches')]);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [[first.matchId, KEY_A]], matches: 1 });
  });

  it('FR-545 a memo replay of the same body returns the same reply and writes nothing', async () => {
    const file = newFile();
    // The second transaction (the replay) may not write: its first write would fail with an injected fault.
    const h = await start(file, { faults: { failWrite: { transaction: 2, afterWrites: 0 } } });
    const first = await post(h, withKey('c-1'), CLIENT_CREDENTIAL);
    const again = await post(h, withKey('c-1'), CLIENT_CREDENTIAL);
    expect(first.status).toBe(201);
    expect([again.status, again.text]).toStrictEqual([first.status, first.text]);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [[created(first).matchId, KEY_A]], matches: 1 });
  });

  it('FR-545 the same request id with another key, with the key removed or added, is request-id-reused and stores nothing more', async () => {
    const file = newFile();
    const h = await start(file);
    const first = await post(h, withKey('c-1', KEY_A), CLIENT_CREDENTIAL);
    expect(first.status).toBe(201);
    for (const [name, body] of [
      ['another key', withKey('c-1', KEY_B)],
      ['the key removed', creationBody('c-1', { joinPolicy: 'client' })],
    ] as const) {
      const reply = await post(h, body, CLIENT_CREDENTIAL);
      expect([reply.status, reply.text], name).toStrictEqual([409, errorBody('request-id-reused')]);
    }
    const plain = await post(h, creationBody('c-2', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect(plain.status).toBe(201);
    const added = await post(h, withKey('c-2', KEY_A), CLIENT_CREDENTIAL);
    expect([added.status, added.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    await h.close();
    expect(rowsOf(file)).toStrictEqual({ rows: [[created(first).matchId, KEY_A]], matches: 2 });
  });

  it('FR-547 (restart) the row is unchanged after a restart of the server on the same file, and a creation after it adds its own', async () => {
    const file = newFile();
    const h = await start(file);
    const first = created(await post(h, withKey('c-1'), CLIENT_CREDENTIAL));
    await h.close();
    const before = rowsOf(file);
    expect(before.rows).toStrictEqual([[first.matchId, KEY_A]]);
    // A restarted server has a fresh fake random source: another seed, so its ids differ from those of the first run.
    const h2 = await start(file, { service: { seed: 2 } });
    expect(h2.base.store.getMatch(first.matchId)).toBeDefined();
    const second = created(await post(h2, withKey('c-9', KEY_B), CLIENT_CREDENTIAL));
    await h2.close();
    const after = rowsOf(file);
    expect(after.rows.find(([id]) => id === first.matchId)).toStrictEqual([first.matchId, KEY_A]);
    expect(after.rows.find(([id]) => id === second.matchId)).toStrictEqual([second.matchId, KEY_B]);
    expect(after.rows).toHaveLength(2);
  });

  it('FR-547 (restart) a started lobby, its steps and a restart keep the row; no HTTP route changes or removes it', async () => {
    const file = newFile();
    const h = await start(file);
    const first = created(await post(h, withKey('c-1'), CLIENT_CREDENTIAL));
    const hostToken = (await post(h, withKey('c-2', KEY_B), CLIENT_CREDENTIAL)).json() as { matchId: string; hostToken: string };
    expect(h.service.startMatch({ credential: hostToken.hostToken, matchId: hostToken.matchId, body: {} }).ok).toBe(true);
    h.clock.advance(7_200_000); // past the lobby expiry of the other lobby (1 hour)
    await h.close();
    const rows = rowsOf(file).rows;
    expect(rows.find(([id]) => id === first.matchId)).toStrictEqual([first.matchId, KEY_A]);
    expect(rows.find(([id]) => id === hostToken.matchId)).toStrictEqual([hostToken.matchId, KEY_B]);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const h2 = await start(file);
      const reply = await request(h2.port, { method, path: `/matches/${first.matchId}`, body: { community: KEY_B }, headers: { authorization: `Bearer ${CLIENT_CREDENTIAL}` } });
      expect(reply.status, method).toBeGreaterThanOrEqual(400);
      await h2.close();
    }
    expect(rowsOf(file).rows).toStrictEqual(rows);
  });

  it('FR-545 (no key in a reply) the creation reply, the events, the public reads, the logs and every other column hold no key', async () => {
    const file = newFile();
    const h = await start(file);
    const reply = await post(h, withKey('c-1'), CLIENT_CREDENTIAL);
    const { matchId } = created(reply);
    const read = await request(h.port, { method: 'GET', path: `/matches/${matchId}` });
    const list = await request(h.port, { method: 'GET', path: '/matches' });
    const events = JSON.stringify(h.base.store.eventsAfter(matchId, 0));
    const memo = JSON.stringify(h.base.store.getMatch(matchId));
    const logs = JSON.stringify(h.logs);
    for (const [name, text] of [['reply', reply.text], ['read', read.text], ['list', list.text], ['events', events], ['match', memo], ['logs', logs]] as const) {
      expect(text, name).not.toContain(KEY_A);
    }
    await h.close();
    // The key is stored in the one column made for it and nowhere else: not in the memo reply, the events or any other table.
    expect(withRawDb(file, (db) => scanValues(db, [KEY_A]))).toStrictEqual(['communities.community']);
    expect(withRawDb(file, (db) => scanValues(db, [KEY_A], ['communities.community']))).toStrictEqual([]);
  });
});
