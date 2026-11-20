import { decodeCursor } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { living } from './helpers/http-reads-kit';
import { DISCORD, KEY_A, createCommunityMatch, playMatch, populateRanking, postRanking, walkRanking } from './helpers/ranking-kit';
import type { Made, RankPlayer, ServerHarness } from './helpers/ranking-kit';
import { startHistory } from './helpers/ranking-kit';
import { closeAllServers } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Spec 027 NFR-127: the secrecy twin of 025 NFR-123, per period. The ranking of a window counts only counted matches (finished
// ones of the community) inside the window and reads names only from them. Two servers built the same way (the same fake clock,
// the same fake random seed): two OLD counted matches, a clock move of 20 days (so they sit in the month and out of the week),
// then — on one server only — a RUNNING match of the same community, created, started and stepped through rounds 1 and 2 with
// scored predictions and a planted 022 name, then the seven counted matches of the ranking population (all inside both windows).
// The running match is older than every counted match of the snapshot and inside both windows, so ONLY the finished-only rule
// keeps its scored rows and its name out of a reply (a stage mutant is armed, as in 025). The plain twin consumes the running
// match's creation draws with a lobby it never starts. Every windowed reply of the server with the running match — the single
// page of every order with the asker named, and the full cursor walks — equals the twin's without it (single pages) or its own
// before the step (walks, whose cursors carry the head instant), byte for byte, before and after each later step. Once the match
// finishes it is counted and the replies change: the comparison is real. Key values and names are planted literals.

vi.setConfig({ testTimeout: 180_000 });
afterEach(closeAllServers);

const DAY = 86_400_000;
const ORDERS = ['points', 'correct', 'wins', 'accuracy'] as const;
const PERIODS = ['last-7-days', 'last-30-days'] as const;
const PLANTED = 'Period Secrecy Planted';
const STEPS = ['phase-1-close', 'phase-2-close', 'application'] as const;

/** Two old matches: u1 again (a name only they store) and two players who play nothing else. */
const OLD_MATCHES: readonly (readonly RankPlayer[])[] = [
  [
    { client: DISCORD, local: 'u1', name: 'Ana Vieja', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
    { client: DISCORD, local: 'o1', name: 'Old One', victim: 'right', absorber: 'wrong', winner: 'wrong' },
  ],
  [{ client: DISCORD, local: 'o2', victim: 'wrong', absorber: 'wrong', winner: 'wrong' }],
];

type Period = (typeof PERIODS)[number];
type Order = (typeof ORDERS)[number];

const singlePage = async (h: ServerHarness, period: Period, order: Order): Promise<string> =>
  (await postRanking(h, DISCORD.credential, { community: KEY_A, order, period, playerId: 'u1', limit: 500 })).text;

/**
 * The reply texts of a full walk. A fresh windowed walk fixes its floor from the clock of its first page, and each step of the running
 * match moves the clock by a second, so the floor inside a cursor legitimately differs between two walks read at different steps: the
 * cursor is reduced to its head and position (order, head instant, head id, local id, period index), and every other byte is compared.
 */
async function walkTexts(h: ServerHarness, period: Period, order: Order): Promise<string[]> {
  const texts = (await walkRanking(h, DISCORD, { community: KEY_A, order, period, playerId: 'u1' }, 6)).texts;
  return texts.map((text) => {
    const page = JSON.parse(text) as { next?: string };
    if (page.next === undefined) return text;
    const key = decodeCursor('ranking', page.next);
    if (!key.ok) throw new Error('bad cursor');
    return JSON.stringify({ ...page, next: (key.value as readonly unknown[]).slice(0, 5) });
  });
}

/** The part both twins share: two old counted matches, 20 days pass. */
async function oldMatches(h: ServerHarness): Promise<void> {
  for (const [i, players] of OLD_MATCHES.entries()) playMatch(h, await createCommunityMatch(h, DISCORD, `old-${i}`, KEY_A), players, false);
  h.clock.advance(20 * DAY);
}

describe('NFR-127 the windowed ranking counts only counted matches inside the window and reads names only from them', () => {
  it('NFR-127 a running match with scored predictions and a planted name inside the window changes no byte of any windowed reply, in any period and order, before or after any of its steps', async () => {
    const plain = await startHistory();
    const withRunning = await startHistory();
    await oldMatches(plain);
    await oldMatches(withRunning);
    // The running match first (after the old ones): rounds 1 and 2 score, the planted name is stored, and its rows end up older
    // than every counted match of the snapshot yet inside both windows, so neither the head bound nor the floor keeps them out.
    const running: Made = await createCommunityMatch(withRunning, DISCORD, 'secret', KEY_A);
    const started = withRunning.service.startMatch({ credential: running.hostToken, matchId: running.id, body: {} });
    if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
    // Two players of the running match: u1 (scored predictions, no name) and u41, who has no name in any counted match, so the
    // planted name would be the shown one the moment the running match was read (the newest match that stored a name for u41).
    const submit = (body: Record<string, unknown>): void => {
      for (const [playerId, name] of [['u1', undefined], ['u41', PLANTED]] as const) {
        const out = withRunning.service.submit({ client: { credential: DISCORD.credential, namespace: 'discord' }, matchId: running.id, body: { playerId, ...(name === undefined ? {} : { name }), ...body } });
        if (!out.ok && out.error.kind !== 'forced-absorber') throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
      }
    };
    const step = (k: number, kind: (typeof STEPS)[number]): void => {
      withRunning.clock.advance(1000);
      const out = withRunning.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: k, step: kind } });
      if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
    };
    for (const k of [1, 2]) {
      if (k === 1) submit({ kind: 'winner', faction: living(withRunning, running.id)[0]! });
      submit({ kind: 'victim', round: k, faction: living(withRunning, running.id)[0]! });
      for (const kind of STEPS) step(k, kind);
    }
    // The plain twin consumes the running match's creation draws with a lobby it never starts, so the counted matches that
    // follow are identical on both servers (their instants differ by the running match's six steps: a single-page reply never
    // carries one). The running match ate no known secret (an old match did), so both populations play arbitrary picks.
    await createCommunityMatch(plain, DISCORD, 'twin-lobby', KEY_A);
    await populateRanking(plain, { scripted: false });
    await populateRanking(withRunning, { scripted: false });
    // Both clocks move past TOLERANCE_MS so every counted match is settled on both twins before a reference reply is taken.
    plain.clock.advance(2000);
    withRunning.clock.advance(2000);
    const reference = new Map<string, string>();
    for (const period of PERIODS) for (const order of ORDERS) reference.set(`${period}/${order}`, await singlePage(plain, period, order));
    // The windows are real: 18 players this week, 20 this month (the old matches add two), and the replies differ.
    const total = (text: string): number => (JSON.parse(text) as { total: number }).total;
    expect([total(reference.get('last-7-days/points')!), total(reference.get('last-30-days/points')!)]).toStrictEqual([18, 20]);
    expect(reference.get('last-7-days/points')).not.toBe(reference.get('last-30-days/points'));
    const expectSame = async (): Promise<void> => {
      for (const period of PERIODS) for (const order of ORDERS) expect(await singlePage(withRunning, period, order), `${period} ${order}`).toStrictEqual(reference.get(`${period}/${order}`));
    };
    const walkReference = new Map<string, string[]>();
    for (const period of PERIODS) for (const order of ORDERS) walkReference.set(`${period}/${order}`, await walkTexts(withRunning, period, order));
    const expectWalks = async (): Promise<void> => {
      for (const period of PERIODS) for (const order of ORDERS) expect(await walkTexts(withRunning, period, order), `${period} ${order}`).toStrictEqual(walkReference.get(`${period}/${order}`));
    };
    await expectSame();
    // The remaining steps of the running match (no predictions: their cutoffs passed while the counted matches played; the scored
    // rows and the planted name of rounds 1 and 2 are the ones under the head): no reply changes, before or after any of them.
    for (const k of [3, 4]) {
      for (const kind of STEPS) {
        step(k, kind);
        // The last application finishes the match: the replies change legitimately from there on.
        if (k === 4 && kind === 'application') break;
        await expectSame();
        await expectWalks();
      }
    }
    // The comparison detects a change: once counted, the match's scored predictions join the statistics and the planted name of
    // u41 (the newest counted match that stored one for them) becomes the shown one, in each window. The finish must be settled first.
    withRunning.clock.advance(2000);
    for (const period of PERIODS) {
      expect(await singlePage(withRunning, period, 'points'), period).not.toBe(reference.get(`${period}/points`));
      const finished = await walkTexts(withRunning, period, 'points');
      expect(finished.join('\n'), period).toContain(PLANTED);
      expect(finished.join('\n'), period).not.toBe((walkReference.get(`${period}/points`) ?? []).join('\n'));
    }
    // Hundreds of real-socket round-trips: the timeout of the file is explicit.
  });
});
