import { afterEach, describe, expect, it } from 'vitest';
import { LEADERBOARD_ROW_KEYS } from '@mbrg/protocol';
import { HAND_RUN_STEPS, leaderboardProblems, pickFactions, redact, runHandRun, tokenPrefix } from '../scripts/hand-run-playable';
import type { Call } from '../scripts/hand-run-playable';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';

// The hand-run script of spec 011 (done criterion 3): its pure parts, and one smoke run of the same flow against an in-process
// server on port 0 with the fake clock (the clock never moves: the host advances every step). The real run, with a spawned
// server process and the real clock, is made by hand and recorded in PROGRESS.md.

afterEach(closeAllServers);

describe('the hand-run script: pure parts', () => {
  it('prints a token as its first six characters and three dots, and nothing for a shorter text', () => {
    expect(tokenPrefix('abcdefghijklmnop')).toBe('abcdef...');
    expect(tokenPrefix('abc')).toBe('...');
    expect(tokenPrefix('')).toBe('...');
  });

  it('redacts every occurrence of every token, in a path or a text, and ignores empty tokens', () => {
    const a = 'AAAAAAAAAAAAAAAAAAAA';
    const b = 'BBBBBBBBBBBBBBBBBBBB';
    const text = `GET /x/${a}/y ${b} and again ${a}`;
    const shown = redact(text, [a, '', b]);
    expect(shown).toBe('GET /x/AAAAAA.../y BBBBBB... and again AAAAAA...');
    expect(shown).not.toContain(a);
    expect(redact('nothing here', [a])).toBe('nothing here');
  });

  it('lists the steps of the run in order', () => {
    expect(HAND_RUN_STEPS).toStrictEqual([
      'create a lobby without a credential',
      'two players join with a name',
      'the players list shows both names in join order',
      'only the host starts the match',
      'each player predicts the winner with its own token',
      'every round: victim predictions, three host steps, absorber predictions',
      'the match is finished and its secret is public',
      'the leaderboard shows both names',
      'who guessed right and the player results carry the names',
      'no token was printed',
    ]);
  });

  it('picks the first or the last of a list of factions', () => {
    expect(pickFactions([4, 7, 9])).toStrictEqual({ first: 4, last: 9 });
    expect(pickFactions([6])).toStrictEqual({ first: 6, last: 6 });
    expect(() => pickFactions([])).toThrow(RangeError);
  });

  it('accepts a leaderboard with both names, ranks that do not fall and the documented members, and names each problem otherwise', () => {
    const row = (rank: number, name: string | undefined, total = 3): Record<string, unknown> => ({
      rank,
      playerId: `player:${name ?? 'x'}`,
      total,
      correctVictims: 1,
      correctAbsorbers: 0,
      correctWinner: 0,
      ...(name === undefined ? {} : { name }),
    });
    expect(leaderboardProblems([row(1, 'Bea', 5), row(2, 'Ana', 3)], ['Ana', 'Bea'])).toStrictEqual([]);
    expect(leaderboardProblems([row(1, 'Ana')], ['Ana', 'Bea'])).toStrictEqual(['the leaderboard has no row named Bea']);
    expect(leaderboardProblems([row(1, 'Ana'), row(2, undefined)], ['Ana'])).toStrictEqual(['row 2 has no name']);
    expect(leaderboardProblems([row(2, 'Ana'), row(1, 'Bea')], ['Ana', 'Bea'])).toStrictEqual(['ranks fall at row 2']);
    expect(leaderboardProblems([{ ...row(1, 'Ana'), secret: 1 }], ['Ana'])).toStrictEqual(['row 1 has the members ' + [...LEADERBOARD_ROW_KEYS, 'secret'].join(',') + ', not the documented ones']);
    expect(leaderboardProblems('nope', ['Ana'])).toStrictEqual(['the leaderboard is not a list of rows']);
  });
});

describe('the hand-run script: smoke run', () => {
  it('runs the whole flow on port 0 with the fake clock: no failure, both names on the leaderboard, no token in the transcript', async () => {
    const h = await startServer({
      routes: productionRoutes,
      service: { publicCreation: { maps: ['dev'], maxOpenLobbies: 10 } },
      limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000, submissions: 100_000, advances: 100_000 },
    });
    const secrets = new Set<string>();
    const call: Call = async (method, path, token, body) => {
      const reply = await request(h.port, { method, path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
      const parsed = reply.status < 300 && reply.text.startsWith('{') ? (JSON.parse(reply.text) as Record<string, unknown>) : {};
      for (const key of ['hostToken', 'playerToken']) if (typeof parsed[key] === 'string') secrets.add(parsed[key]);
      return { status: reply.status, text: reply.text };
    };
    const printed: string[] = [];
    const report = await runHandRun(call, (line) => printed.push(line));

    expect(report.failures).toStrictEqual([]);
    expect(printed).toStrictEqual(report.lines);
    expect(secrets.size).toBe(3);
    for (const secret of secrets) expect(printed.join('\n')).not.toContain(secret);
    expect(printed.join('\n')).toContain('...');

    expect(report.figures.names).toStrictEqual(['Ana', 'Bea']);
    expect(report.figures.rounds).toBe(report.figures.totalRounds);
    expect(report.figures.totalRounds).toBeGreaterThan(0);
    expect(report.figures.hostSteps).toBe(report.figures.totalRounds * 3);
    expect(report.figures.requests).toBeGreaterThan(30);
    expect(report.figures.leaderboard.map((r) => r.name).sort()).toStrictEqual(['Ana', 'Bea']);
    // One heading per step of the run, in order.
    expect(printed.filter((line) => /^\[\d+\/10\] /.test(line)).map((line) => line.replace(/^\[\d+\/10\] /, ''))).toStrictEqual([...HAND_RUN_STEPS]);
  }, 60_000);

  it('reports a failure instead of throwing when the server refuses the first request', async () => {
    const refuse: Call = async () => ({ status: 404, text: '{"kind":"unknown-map"}' });
    const report = await runHandRun(refuse);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures[0]).toContain('POST /matches');
    expect(report.failures[0]).toContain('404');
  });
});
