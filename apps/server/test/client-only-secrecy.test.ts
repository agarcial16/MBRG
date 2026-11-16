import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { encodingsOf } from './helpers/db-scan';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// Spec 018 NFR-100: the policy is a creation input, not derived from the match secret, and adds nothing about any round. A full
// run of a client-only match (a creation, a refused join, a refused submission, the owner's submissions, the finish) is scanned
// in every reply, event and log line: no credential, no host token (outside the creation reply), no secret or seed before the
// finish; the owning namespace is never named. The run is also compared with its open twin: the bytes are the same except the flag.

afterEach(closeAllServers);

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const seedSource = (): ((k: number) => number) => (k) => 3_000_000_000 + 7919 * k;
// A namespace no other text of the run contains, so any appearance of it is the policy leaking.
const NAMESPACE = 'zetanine';
const OWNER = 'client-credential-zeta-0123456789ab';
const OTHER = 'client-credential-other-0123456789a';
const OPERATOR_REFUSAL = '{"kind":"invalid-request","items":["joinPolicy"]}';
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 20 } as const;

const start = (): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    clients: [{ namespace: NAMESPACE, credential: OWNER }, { namespace: 'other', credential: OTHER }],
    service: { publicCreation: PUBLIC, secret: SECRET, seed: 5, testSeedSource: seedSource },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 },
  });

/** Every reply text of the run, in order, with the log events. */
const script = async (clientOnly: boolean, submits: boolean): Promise<{ texts: string[]; logs: string; hostToken: string; matchId: string; h: ServerHarness }> => {
  const h = await start();
  const texts: string[] = [];
  const call = async (method: string, path: string, body?: unknown, token?: string): Promise<ClientReply> => {
    const reply = await request(h.port, { method, path, ...(body === undefined ? {} : { body }), headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
    texts.push(reply.text);
    return reply;
  };
  const made = await call('POST', '/matches', creationBody('c-1', clientOnly ? { joinPolicy: 'client' } : {}), OWNER);
  const { matchId, hostToken } = made.json() as { matchId: string; hostToken: string };
  texts.shift(); // the creation reply is the one place that holds the host token
  await call('POST', `/matches/${matchId}/players`, { name: 'Late', requestId: 'j-1' });
  await call('POST', `/matches/${matchId}/start`, {}, hostToken);
  const faction = h.service.publicMatch(matchId)!.state.owners[0]![1];
  await call('POST', `/matches/${matchId}/predictions`, { kind: 'winner', faction, playerId: 'p1' }, OTHER);
  await call('POST', `/matches/${matchId}/predictions`, { kind: 'winner', faction, playerId: 'p1' });
  if (submits) {
    await call('POST', `/matches/${matchId}/predictions`, { kind: 'winner', faction, playerId: 'p1' }, OWNER);
    await call('POST', '/matches', creationBody('c-2', { joinPolicy: 'client' }), OPERATOR);
  }
  const reads = ['', '/states/0', '/records', '/players', '/leaderboard'].map((p) => `/matches/${matchId}${p}`);
  for (const path of ['/matches', '/config', ...reads]) await call('GET', path);
  // Before the finish: nothing of the secret or of a round seed in any text so far.
  for (const encoding of encodingsOf(SECRET)) for (const text of texts) if (typeof encoding === 'string') expect(text).not.toContain(encoding);
  for (let i = 0; i < 300; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished') break;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  for (const path of ['', '/records', '/results/1/1', '/leaderboard']) await call('GET', `/matches/${matchId}${path}`);
  texts.push(JSON.stringify(h.service.eventsAfter(matchId, 0)));
  return { texts, logs: JSON.stringify(h.logs), hostToken, matchId, h };
};

describe('a client-only run holds nothing it should not', () => {
  it('NFR-100 no reply, event or log line names the owning namespace, a credential or the host token (a run with no submission of the owner)', async () => {
    const run = await script(true, false);
    const everything = `${run.texts.join('\n')}\n${run.logs}`;
    for (const needle of [NAMESPACE, OWNER, OTHER, OPERATOR, run.hostToken]) expect(everything, needle).not.toContain(needle);
    // The refusals are the closed replies, with no member that could carry a detail.
    expect(run.texts[0]).toBe('{"kind":"joins-closed"}');
    expect(run.texts).toContain('{"kind":"forbidden"}');
  });

  it('NFR-100 the same holds when the owner submits: its player ids are public as in 008, the credential and the host token still are not', async () => {
    const run = await script(true, true);
    const everything = `${run.texts.join('\n')}\n${run.logs}`;
    for (const needle of [OWNER, OTHER, OPERATOR, run.hostToken]) expect(everything, needle).not.toContain(needle);
    expect(run.texts).toContain('{"kind":"invalid-request","items":["joinPolicy"]}');
  });

  it('NFR-100 the log lines of the run equal those of its open twin: the policy adds no line and no member', async () => {
    const only = await script(true, true);
    const open = await script(false, true);
    expect(only.matchId).toBe(open.matchId);
    expect(only.logs).toBe(open.logs);
    // Every reply of the client-only run that is not a refusal carries the flag only as `clientOnly: true`, never as another word.
    for (const text of only.texts.filter((t) => t !== OPERATOR_REFUSAL)) expect(text.replace(/"clientOnly":true/g, '')).not.toMatch(/clientOnly|joinPolicy/i);
  });
});
