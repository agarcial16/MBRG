import { readEvent, type PredictionKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_NAMESPACE,
  draftFor,
  draftKey,
  factionChoices,
  leaderboardLine,
  livingAt,
  ownLine,
  ownPredictionsPath,
  playerResultsPath,
  readFailedLine,
  refusedLine,
  resultLine,
  roundOf,
  submissionBody,
  submittedLine,
  totalLine,
} from '../src/core/client-form';
import type { LiveModel } from '../src/core/live-model';
import { createLiveNet, createPredictionNet } from '../src/ui/live-net';
import { startRunner } from '../src/ui/live-runner';
import { requestId } from '../src/ui/web-crypto';
import { createFakeServer, frameText } from './helpers/fake-server';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const BASE = 'http://server.test';
const SECRET = 'dev-credential-0123456789abcdef';
const json = (value: unknown, status = 200): { status: number; body: string; headers: Record<string, string> } => ({ status, body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });
const names = (faction: number): string => `F${faction}`;

/** A model at N = 1 with the first round revealed or not. */
async function modelAt(revealed: boolean): Promise<LiveModel> {
  const s = await scripted();
  const d = new Driver(s);
  await d.load(1);
  if (revealed) await d.events(eventsOfRound(s, 2).slice(0, 2));
  return d.model;
}

describe('FR-310 (client form) what the form submits and offers', () => {
  it('FR-310 (client form) the body of each kind holds a round exactly for victim and absorber, in the documented field order', () => {
    const common = { faction: 3, playerId: 'p1', requestId: 'r1' };
    const victim = submissionBody({ kind: 'victim', round: 2, ...common });
    const absorber = submissionBody({ kind: 'absorber', round: 2, ...common });
    const winner = submissionBody({ kind: 'winner', round: 2, ...common });
    expect(Object.keys(victim)).toStrictEqual(['kind', 'round', 'faction', 'playerId', 'requestId']);
    expect(Object.keys(absorber)).toStrictEqual(['kind', 'round', 'faction', 'playerId', 'requestId']);
    expect(Object.keys(winner)).toStrictEqual(['kind', 'faction', 'playerId', 'requestId']);
    expect(victim.round).toBe(2);
    expect('round' in winner).toBe(false);
    expect('round' in submissionBody({ kind: 'victim', round: undefined, ...common })).toBe(false);
    expect(roundOf({ applied: 4 }, 'victim')).toBe(5);
    expect(roundOf({ applied: 4 }, 'absorber')).toBe(5);
    expect(roundOf({ applied: 4 }, 'winner')).toBeUndefined();
  });

  it('FR-310 (client form) the choices: living at N for the victim, the candidates for the absorber, the living without the revealed victim for the winner', async () => {
    const s = await scripted();
    const before = await modelAt(false);
    const living = s.living[1] as number[];
    expect(livingAt(before)).toStrictEqual(living);
    expect(factionChoices(before, 'victim')).toStrictEqual(living);
    expect(factionChoices(before, 'absorber')).toStrictEqual([]);
    expect(factionChoices(before, 'winner')).toStrictEqual(living);

    const after = await modelAt(true);
    const victim = after.victim;
    expect(victim).toBeDefined();
    expect(factionChoices(after, 'absorber')).toStrictEqual([...(victim?.candidates ?? [])]);
    expect(factionChoices(after, 'winner')).not.toContain(victim?.victim);
    expect(factionChoices(after, 'winner')).toStrictEqual(living.filter((f) => f !== victim?.victim));
    expect(factionChoices(after, 'victim')).toStrictEqual(living);
    // Nothing about a round above N: the choices come from the owners at N only.
    expect(after.held.has(after.applied + 1)).toBe(false);
  });

  it('FR-282 (client request ids) a retried submission reuses its request id and a different submission draws a new one', () => {
    let calls = 0;
    const make = (): string => `id${++calls}`;
    const key = draftKey({ kind: 'victim', round: 2, faction: 3, playerId: 'p1' });
    const first = draftFor(undefined, key, make);
    expect(draftFor(first, key, make)).toBe(first);
    expect(calls).toBe(1);
    const other = draftFor(first, draftKey({ kind: 'victim', round: 2, faction: 4, playerId: 'p1' }), make);
    expect(other.requestId).toBe('id2');
    expect(draftKey({ kind: 'winner', round: undefined, faction: 1, playerId: 'p1' })).not.toBe(draftKey({ kind: 'victim', round: undefined, faction: 1, playerId: 'p1' }));
  });

  it('FR-284 (client player ids) the player-results path keeps the colon as written and a local id outside FR-297 gives no path', () => {
    expect(CLIENT_NAMESPACE).toBe('web');
    expect(playerResultsPath(MATCH_ID, 'p1')).toBe(`/matches/${MATCH_ID}/players/web:p1/results`);
    expect(playerResultsPath(MATCH_ID, 'a.b-c_9')).toBe(`/matches/${MATCH_ID}/players/web:a.b-c_9/results`);
    expect(ownPredictionsPath(MATCH_ID, 'p1')).toBe(`/matches/${MATCH_ID}/predictions?playerId=p1`);
    for (const bad of ['', 'a/b', 'a:b', '%3A', 'a b', 'x'.repeat(65), 'ñ', 'a?b']) {
      expect(playerResultsPath(MATCH_ID, bad), bad).toBeUndefined();
      expect(ownPredictionsPath(MATCH_ID, bad), bad).toBeUndefined();
    }
  });

  it('FR-310 (client form) the reply lines are Spanish templates around English kinds', () => {
    expect(submittedLine({ kind: 'victim', round: 2, choice: 3, version: 1 }, names)).toBe('Predicción guardada: victim, ronda 2, facción F3, versión 1.');
    expect(submittedLine({ kind: 'winner', choice: 3, version: 2 }, names)).toBe('Predicción guardada: winner, facción F3, versión 2.');
    expect(refusedLine('round-not-open')).toBe('No se ha podido enviar la predicción: round-not-open.');
    expect(readFailedLine('network')).toBe('No se ha podido leer del servidor: network.');
    expect(ownLine({ playerId: 'p1', kind: 'absorber', round: 1, choice: 2, version: 1 }, names)).toBe('absorber, ronda 1: facción F2 (versión 1)');
    expect(resultLine({ kind: 'victim', round: 1, choice: 2, correct: true, points: 5 }, names)).toBe('victim, ronda 1: facción F2, acierto, 5 puntos');
    expect(resultLine({ kind: 'winner', choice: 2, correct: false, points: 0 }, names)).toBe('winner: facción F2, fallo, 0 puntos');
    expect(totalLine(7)).toBe('Total: 7 puntos');
    expect(leaderboardLine({ rank: 1, playerId: 'web:p1', total: 7, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0 })).toBe('1. web:p1: 7 puntos');
  });

  it('FR-282 (client request ids) requestId gives 32 hex digits that are a valid local id and differ between calls', () => {
    const a = requestId();
    const b = requestId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(requestId({ getRandomValues: (array: Uint8Array<ArrayBuffer>) => array.fill(255) })).toBe('ff'.repeat(16));
    expect(() => requestId({} as never)).toThrow('no random source');
  });
});

describe('FR-310 (web test client) the calls to the server', () => {
  async function harness(credential: string | undefined): Promise<{ server: Awaited<ReturnType<typeof createFakeServer>>; net: ReturnType<typeof createPredictionNet> }> {
    const server = await createFakeServer(await scripted(), 1);
    return { server, net: createPredictionNet({ base: BASE, fetch: server.fetch, credential }) };
  }

  it('FR-310 (web test client) a submission sends the bearer credential and the JSON type, and a retry sends the same request id', async () => {
    const { server, net } = await harness(SECRET);
    const reply = { kind: 'victim', round: 2, choice: 3, version: 1 };
    server.forced.push(json(reply, 201), json(reply, 201));
    const draft = draftFor(undefined, 'k', () => 'req-1');
    const body = submissionBody({ kind: 'victim', round: 2, faction: 3, playerId: 'p1', requestId: draft.requestId });
    const first = await net.submit(MATCH_ID, body);
    const retry = await net.submit(MATCH_ID, body);
    expect(first).toStrictEqual({ ok: true, value: reply });
    expect(retry.ok).toBe(true);
    const sent = server.requests.filter((r) => r.method === 'POST');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.path).toBe(`/matches/${MATCH_ID}/predictions`);
    expect(sent[0]?.headers['authorization']).toBe(`Bearer ${SECRET}`);
    expect(sent[0]?.headers['content-type']).toBe('application/json');
    expect(sent[0]?.credentials).toBe('omit');
    expect(JSON.parse(sent[0]?.body ?? '')).toStrictEqual({ kind: 'victim', round: 2, faction: 3, playerId: 'p1', requestId: 'req-1' });
    expect(sent[1]?.body).toBe(sent[0]?.body);
  });

  it('FR-310 (web test client) the own-predictions read is credentialed and the results and leaderboard reads are not', async () => {
    const { server, net } = await harness(SECRET);
    server.forced.push(
      json({ items: [{ playerId: 'p1', kind: 'victim', round: 2, choice: 3, version: 1 }] }),
      json({ playerId: 'web:p1', total: 5, items: [{ kind: 'victim', round: 1, choice: 3, correct: true, points: 5 }] }),
      json({ items: [{ rank: 1, playerId: 'web:p1', total: 5, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0 }] }),
    );
    const own = await net.ownPredictions(MATCH_ID, 'p1');
    const results = await net.playerResults(MATCH_ID, 'web:p1');
    const board = await net.leaderboard(MATCH_ID);
    expect(own.ok && own.value.items).toHaveLength(1);
    expect(results.ok && results.value.total).toBe(5);
    expect(board.ok && board.value.items[0]?.rank).toBe(1);
    const [a, b, c] = server.requests;
    expect(a?.path).toBe(`/matches/${MATCH_ID}/predictions`);
    expect(a?.query).toBe('?playerId=p1');
    expect(a?.headers['authorization']).toBe(`Bearer ${SECRET}`);
    expect(a?.headers['content-type']).toBe('application/json');
    // The path keeps the colon unescaped, and the credential-free reads carry neither header.
    expect(b?.path).toBe(`/matches/${MATCH_ID}/players/web:p1/results`);
    expect(b?.url).not.toContain('%3A');
    expect(c?.path).toBe(`/matches/${MATCH_ID}/leaderboard`);
    for (const r of [b, c]) {
      expect(r?.headers['authorization']).toBeUndefined();
      expect(r?.headers['content-type']).toBeUndefined();
      expect(r?.credentials).toBe('omit');
    }
  });

  it('FR-284 (client player ids) a player id outside the rules sends nothing and a missing credential sends nothing credentialed', async () => {
    const { server, net } = await harness(SECRET);
    for (const bad of ['web:a/b', 'web:%3Ap1', 'p1', 'web:', ':p1', 'web:a:b']) {
      expect(await net.playerResults(MATCH_ID, bad), bad).toStrictEqual({ ok: false, outcome: 'invalid-player-id', status: undefined });
    }
    expect(await net.ownPredictions(MATCH_ID, 'a:b')).toStrictEqual({ ok: false, outcome: 'invalid-player-id', status: undefined });
    expect(server.requests).toStrictEqual([]);
    const without = await harness(undefined);
    const body = submissionBody({ kind: 'winner', round: undefined, faction: 1, playerId: 'p1', requestId: 'r' });
    expect(await without.net.submit(MATCH_ID, body)).toStrictEqual({ ok: false, outcome: 'missing-credential', status: undefined });
    expect(await without.net.ownPredictions(MATCH_ID, 'p1')).toStrictEqual({ ok: false, outcome: 'missing-credential', status: undefined });
    expect(without.server.requests).toStrictEqual([]);
  });

  it('FR-310 (web test client) a refused reply gives its kind and a broken one gives unreadable or network', async () => {
    const { server, net } = await harness(SECRET);
    server.forced.push(json({ kind: 'unknown-match' }, 404), json({ nonsense: true }), 'network');
    const body = submissionBody({ kind: 'winner', round: undefined, faction: 1, playerId: 'p1', requestId: 'r' });
    expect(await net.submit(MATCH_ID, body)).toStrictEqual({ ok: false, outcome: 'unknown-match', status: 404 });
    expect(await net.leaderboard(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'unreadable', status: 200 });
    expect(await net.leaderboard(MATCH_ID)).toStrictEqual({ ok: false, outcome: 'network', status: undefined });
  });

  it('FR-310 (web test client) the onFrame hook of the runner hands each stream frame to the page, a results event once per round', async () => {
    const s = await scripted();
    const server = await createFakeServer(s, 0);
    const seen: unknown[] = [];
    startRunner({
      matchId: MATCH_ID,
      net: createLiveNet({ base: BASE, fetch: server.fetch }),
      port: { open: async (m) => ({ ok: true, round: m.appliedRounds }), draw: () => undefined, playStep: () => undefined, startVictimTour: () => undefined, completeTour: () => undefined, show: () => undefined, fail: () => undefined },
      now: () => 1,
      after: () => () => undefined,
      onFrame: (data) => seen.push(data),
    });
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    server.n = 1;
    for (const event of eventsOfRound(s, 1)) server.push(frameText(event));
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    const types = seen.map((d) => {
      const read = readEvent(d);
      return read.status === 'known' ? read.event.type : read.status;
    });
    expect(types.filter((t) => t === 'results')).toHaveLength(1);
    expect(types).toHaveLength(8);
    const kinds: PredictionKind[] = ['victim', 'absorber', 'winner'];
    expect(kinds).toHaveLength(3);
  });
});
