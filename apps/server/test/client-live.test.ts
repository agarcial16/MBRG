import { afterEach, describe, expect, it } from 'vitest';
import { draftFor, draftKey, factionChoices, playerResultsPath, submissionBody } from '../../web/src/core/client-form';
import { createPredictionNet } from '../../web/src/ui/live-net';
import { advanceSteps, get, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { SECRETS } from './helpers/core-timelines';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { startViewer, until } from './helpers/viewer-kit';

// FR-310 (real server), NFR-56 (web test client): the web test client's calls (imported by relative path, plan H6) against the
// real server: the three kinds submitted, a replay with the same request id, the own predictions, the player's results with the
// raw colon in the path and the leaderboard after a scored phase.

afterEach(closeAllServers);

const clientNet = (h: ServerHarness, credential: string | undefined = CLIENT_CREDENTIAL): ReturnType<typeof createPredictionNet> =>
  createPredictionNet({ base: `http://127.0.0.1:${h.port}`, fetch: (url, init) => fetch(url, init), credential });

describe('the web test client against the real server', () => {
  it('FR-310 (real server) the three kinds are accepted, a replay with the same request id gives the same reply, then the own predictions, the results and the leaderboard', async () => {
    const h = await startReads({ service: { scheduler: true, secret: SECRETS['ascending-00-1f'] } }); // round 1 has three candidates: an absorber is predictable
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const viewer = startViewer({ port: h.port, matchId: id });
    await until(() => viewer.scene.draws.length === 1, 'the first drawing');
    const net = clientNet(h);
    const model = viewer.model();
    const living = factionChoices(model, 'victim');
    expect(living.length).toBeGreaterThan(2);

    // Victim (round 1) and winner while phase 1 is open.
    const victimBody = submissionBody({ kind: 'victim', round: 1, faction: living[0] as number, playerId: 'p1', requestId: 'req-victim' });
    const sent = await net.submit(id, victimBody);
    expect(sent).toStrictEqual({ ok: true, value: { kind: 'victim', round: 1, choice: living[0], version: 1 } });
    const replay = await net.submit(id, victimBody);
    expect(replay).toStrictEqual(sent);
    const winner = await net.submit(id, submissionBody({ kind: 'winner', round: undefined, faction: living[1] as number, playerId: 'p1', requestId: 'req-winner' }));
    expect(winner.ok && winner.value.kind).toBe('winner');
    expect(winner.ok && winner.value.round).toBeUndefined();

    // The reveal: the form now offers the absorber from the victim's candidates, and the winner list drops the victim.
    advanceSteps(h, id, 1);
    await until(() => viewer.model().victim !== undefined, 'the reveal');
    const revealed = viewer.model();
    const candidates = factionChoices(revealed, 'absorber');
    expect(candidates).toStrictEqual([...(publicOf(h, id).victim?.candidates ?? [])]);
    expect(factionChoices(revealed, 'winner')).not.toContain(revealed.victim?.victim);
    const absorber = await net.submit(id, submissionBody({ kind: 'absorber', round: 1, faction: candidates[0] as number, playerId: 'p1', requestId: 'req-absorber' }));
    expect(absorber.ok && absorber.value.kind).toBe('absorber');

    const own = await net.ownPredictions(id, 'p1');
    expect(own.ok && own.value.items.map((p) => p.kind).sort()).toStrictEqual(['absorber', 'victim', 'winner']);

    // Score both phases of round 1.
    advanceSteps(h, id, 2);
    await until(() => viewer.model().applied === 1, 'round 1 applied');
    const path = playerResultsPath(id, 'p1') as string;
    expect(path).toBe(`/matches/${id}/players/web:p1/results`);
    const results = await net.playerResults(id, 'web:p1');
    expect(results.ok).toBe(true);
    expect(results.ok && results.value.playerId).toBe('web:p1');
    expect(results.ok && results.value.items.length).toBeGreaterThanOrEqual(2);
    const direct = await get(h, path);
    expect(direct.status).toBe(200);
    const board = await net.leaderboard(id);
    expect(board.ok && board.value.items.map((row) => row.playerId)).toStrictEqual(['web:p1']);
  }, 120_000);

  it('FR-310 (real server) FR-284 (client player ids) a percent-encoded colon in the path is 400 invalid-player-id; the client never sends one', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const encoded = await get(h, `/matches/${id}/players/web%3Ap1/results`);
    expect(encoded.status).toBe(400);
    expect((encoded.json() as { kind: string }).kind).toBe('invalid-player-id');
    const raw = await get(h, `/matches/${id}/players/web:p1/results`);
    expect(raw.status).toBe(200);
    // Every request of the client for this player is the raw path.
    const seen: string[] = [];
    const net = createPredictionNet({ base: `http://127.0.0.1:${h.port}`, fetch: (url, init) => (seen.push(url), fetch(url, init)), credential: CLIENT_CREDENTIAL });
    expect((await net.playerResults(id, 'web:p1')).ok).toBe(true);
    expect(await net.playerResults(id, 'web:p/1')).toStrictEqual({ ok: false, outcome: 'invalid-player-id', status: undefined });
    expect(seen).toStrictEqual([`http://127.0.0.1:${h.port}/matches/${id}/players/web:p1/results`]);
  }, 60_000);

  it('FR-310 (real server) a wrong credential and a refused submission give the server kind; a retry reuses the request id and is not stored twice', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const living = factionChoices((await (async () => {
      const v = startViewer({ port: h.port, matchId: id });
      await until(() => v.scene.draws.length === 1, 'the first drawing');
      return v.model();
    })()), 'victim');
    const body = submissionBody({ kind: 'victim', round: 1, faction: living[0] as number, playerId: 'p1', requestId: 'req-a' });
    const wrong = await clientNet(h, 'not-the-credential-0123456789abcdef').submit(id, body);
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.status).toBeGreaterThanOrEqual(400);
    const draft = draftFor(undefined, draftKey(body), () => 'req-b');
    const retried = { ...body, requestId: draft.requestId };
    const first = await clientNet(h).submit(id, retried);
    const second = await clientNet(h).submit(id, { ...retried, requestId: draftFor(draft, draftKey(body), () => 'req-c').requestId });
    expect(second).toStrictEqual(first);
    const own = await clientNet(h).ownPredictions(id, 'p1');
    expect(own.ok && own.value.items).toHaveLength(1);
    expect(own.ok && own.value.items[0]?.version).toBe(1);
  }, 60_000);
});
