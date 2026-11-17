import { afterEach, describe, expect, it } from 'vitest';
import { closeAllServers } from './helpers/server-harness';
import { OTHER_CREDENTIAL, begin, finish, leaderboard, post, predict, recordWrites } from './helpers/client-names';
import { creationBody } from './helpers/service-harness';

// Spec 022: a client credential submits with an optional display name; the name is stored with the accepted prediction in the same
// transaction, replaced by the latest one, never required to be unique, and shown by the reads only once the player is scored.

afterEach(closeAllServers);

describe('FR-530 FR-531 FR-532 submitting a display name', () => {
  it('the reply of a submission with a name is the reply without it, and the name shows on the leaderboard once scored', async () => {
    const withName = await begin(true);
    const plain = await begin(true);
    const a = await predict(withName, 'p1', { name: 'Ana Lopez' });
    const b = await predict(plain, 'p1');
    expect([a.status, a.text]).toStrictEqual([200, b.text]);
    finish(withName);
    finish(plain);
    expect((await leaderboard(withName)).map((r) => [r.playerId, r.name])).toStrictEqual([['web:p1', 'Ana Lopez']]);
    expect((await leaderboard(plain))[0]).not.toHaveProperty('name');
  });

  it('a bad name is invalid-request naming name and nothing is written', async () => {
    const rig = await begin(true);
    const log = recordWrites(rig);
    for (const bad of ['', 5, 'x'.repeat(25), 'a  b', 'ana!', null]) {
      const out = await predict(rig, 'p1', { name: bad });
      expect(out.status, JSON.stringify(bad)).toBe(400);
      expect(JSON.stringify(out.json())).toContain('"name"');
    }
    expect(log).toStrictEqual([]);
  });

  it('a player token with a name is invalid-request naming name; nothing is stored or memoised, so the same request id works without it', async () => {
    const rig = await begin(false);
    const joined = await post(rig.h, `/matches/${rig.matchId}/players`, { name: 'Pat', requestId: 'j-1' });
    const { playerToken, playerId } = joined.json() as { playerToken: string; playerId: string };
    const local = playerId.slice(playerId.indexOf(':') + 1);
    const log = recordWrites(rig);
    const refused = await predict(rig, local, { name: 'Other', requestId: 'r-1' }, playerToken);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json())).toContain('"name"');
    expect(log).toStrictEqual([]);
    const accepted = await predict(rig, local, { requestId: 'r-1' }, playerToken);
    expect(accepted.status).toBe(200);
  });

  it('writes the prediction first and the name second, for the submitting player only', async () => {
    const rig = await begin(true);
    const log = recordWrites(rig);
    expect((await predict(rig, 'p1', { name: 'Ana' })).status).toBe(200);
    expect(log).toStrictEqual(['putPrediction:web:p1', 'putClientName:web:p1']);
    log.length = 0;
    expect((await predict(rig, 'p2')).status).toBe(200);
    expect(log).toStrictEqual(['putPrediction:web:p2']);
  });

  it('two members with the same name both succeed and are told apart by rank', async () => {
    const rig = await begin(true);
    expect((await predict(rig, 'p1', { name: 'Sam' })).status).toBe(200);
    expect((await predict(rig, 'p2', { name: 'Sam' })).status).toBe(200);
    finish(rig);
    const rows = await leaderboard(rig);
    expect(rows.map((r) => [r.playerId, r.name])).toStrictEqual([['web:p1', 'Sam'], ['web:p2', 'Sam']]);
    expect(rows[0]!.rank).toBe(1);
  });

  it('a refused submission and a memo replay write no name', async () => {
    const rig = await begin(true);
    const log = recordWrites(rig);
    // another client on a client-only match: forbidden before anything
    expect((await predict(rig, 'p9', { name: 'Eve' }, OTHER_CREDENTIAL)).status).toBe(403);
    // an unknown match
    expect((await post(rig.h, '/matches/ZZZZZZZZZZZZZZZZ/predictions', { kind: 'winner', faction: 1, playerId: 'p1', name: 'Eve' }, 'client-credential-web-0123456789ab')).status).toBeGreaterThanOrEqual(400);
    expect(log).toStrictEqual([]);
    expect((await predict(rig, 'p1', { name: 'Ana', requestId: 's-1' })).status).toBe(200);
    expect(log).toStrictEqual(['putPrediction:web:p1', 'putClientName:web:p1']);
    log.length = 0;
    expect((await predict(rig, 'p1', { name: 'Ana', requestId: 's-1' })).status).toBe(200);
    expect(log).toStrictEqual([]);
  });

  it('a name on an open match is stored the same way for a client credential', async () => {
    const rig = await begin(false);
    expect((await predict(rig, 'p1', { name: 'Ana Open' })).status).toBe(200);
    finish(rig);
    expect((await leaderboard(rig))[0]!.name).toBe('Ana Open');
  });

  it('the submit route still reads the body through the one protocol reader', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../src/http/server.ts', import.meta.url), 'utf8');
    expect(text.match(/readSubmission\(/g)).toHaveLength(3);
    expect(text).not.toMatch(/putClientName|clientNames|client_names/);
    void creationBody;
  });
});

describe('FR-539 NFR-115 replacing the name and the limits', () => {
  it('a later accepted prediction with another name replaces it, even when the prediction itself is unchanged', async () => {
    const rig = await begin(true);
    expect((await predict(rig, 'p1', { name: 'Old Name' })).status).toBe(200);
    expect((await predict(rig, 'p1', { name: 'New Name' })).status).toBe(200);
    finish(rig);
    expect((await leaderboard(rig))[0]!.name).toBe('New Name');
  });

  it('a prediction without a name keeps the stored one', async () => {
    const rig = await begin(true);
    expect((await predict(rig, 'p1', { name: 'Kept Name' })).status).toBe(200);
    expect((await predict(rig, 'p1', { faction: rig.faction })).status).toBe(200);
    finish(rig);
    expect((await leaderboard(rig))[0]!.name).toBe('Kept Name');
  });

  it('the same request id with another name is request-id-reused; with the same name it replays', async () => {
    const rig = await begin(true);
    expect((await predict(rig, 'p1', { name: 'First', requestId: 's-1' })).status).toBe(200);
    const reused = await predict(rig, 'p1', { name: 'Second', requestId: 's-1' });
    expect(reused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(reused.json())).toContain('request-id-reused');
    finish(rig);
    expect((await leaderboard(rig))[0]!.name).toBe('First');
  });

  it('a request adds one name write at most, and the body-size limit still applies', async () => {
    const rig = await begin(true);
    const log = recordWrites(rig);
    expect((await predict(rig, 'p1', { name: 'Ana' })).status).toBe(200);
    expect(log.filter((l) => l.startsWith('putClientName'))).toHaveLength(1);
    const big = await predict(rig, 'p1', { name: 'x'.repeat(5000) });
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(log.filter((l) => l.startsWith('putClientName'))).toHaveLength(1);
  });
});
