import { afterEach, describe, expect, it } from 'vitest';
import { living } from './helpers/http-reads-kit';
import { DISCORD, KEY_A, createCommunityMatch, populateRanking, postRanking, startHistory, walkRanking } from './helpers/ranking-kit';
import type { Made, ServerHarness } from './helpers/ranking-kit';
import { closeAllServers } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Spec 025 NFR-123: the ranking counts only counted matches (finished ones of the community) and reads names only from them.
// The twin: two servers built the same way (the same fake clock, the same fake random seed) hold the same seven counted
// matches; one of them ALSO holds a RUNNING match of the same community, created and stepped BEFORE the counted ones, so its
// scored predictions and its planted 022 name (different from every counted match's name) sit BELOW the snapshot head: only
// the finished-only rule keeps them out of every reply. The plain twin consumes the running match's creation draws with a
// lobby it never starts, so the counted matches are identical on both. Every ranking reply of the server with the running
// match — the single-page read of every order with the asker named, and the full cursor walks — equals the twin's without it,
// byte for byte, before and after each of its later steps. Once the match finishes it is counted, and the replies change: the
// comparison is real.

afterEach(closeAllServers);

const ORDERS = ['points', 'correct', 'wins', 'accuracy'] as const;
const PLANTED = 'Secrecy Planted';
const STEPS = ['phase-1-close', 'phase-2-close', 'application'] as const;

/** The single-page reply of one order with the asker named: no cursor, so no match id or instant ever appears in it. */
const singlePage = async (h: ServerHarness, order: (typeof ORDERS)[number]): Promise<string> =>
  (await postRanking(h, DISCORD.credential, { community: KEY_A, order, playerId: 'u1', limit: 500 })).text;

/** The full walk of one order with the asker named, its reply texts. */
async function walkTexts(h: ServerHarness, order: (typeof ORDERS)[number]): Promise<string[]> {
  return (await walkRanking(h, DISCORD, { community: KEY_A, order, playerId: 'u1' }, 3)).texts;
}

describe('NFR-123 the ranking counts only counted matches and reads names only from them', () => {
  it('NFR-123 a running match with scored predictions and a planted name under the head changes no byte of any ranking reply, in any order, before or after any of its steps', async () => {    const plain = await startHistory();
    const withRunning = await startHistory();
    // The running match first: rounds 1 and 2 score, the planted name is stored, and its rows end up older than every counted
    // match, so the head bound alone cannot keep them out of a reply.
    const running: Made = await createCommunityMatch(withRunning, DISCORD, 'secret', KEY_A);
    const started = withRunning.service.startMatch({ credential: running.hostToken, matchId: running.id, body: {} });
    if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
    const submit = (h: ServerHarness, body: Record<string, unknown>): void => {
      const out = h.service.submit({ client: { credential: DISCORD.credential, namespace: 'discord' }, matchId: running.id, body: { playerId: 'u1', name: PLANTED, ...body } });
      if (!out.ok && out.error.kind !== 'forced-absorber') throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
    };
    for (const k of [1, 2]) {
      if (k === 1) submit(withRunning, { kind: 'winner', faction: living(withRunning, running.id)[0]! });
      submit(withRunning, { kind: 'victim', round: k, faction: living(withRunning, running.id)[0]! });
      for (const step of STEPS) {
        withRunning.clock.advance(1000);
        const out = withRunning.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: k, step } });
        if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
      }
    }
    // The plain twin consumes the running match's creation draws with a lobby it never starts, so the counted matches that
    // follow are identical on both servers (their instants differ by the running match's six steps: a reply never carries one).
    // The running match ate the harness's known secret, so both populations play arbitrary picks.
    await createCommunityMatch(plain, DISCORD, 'twin-lobby', KEY_A);
    await populateRanking(plain, { scripted: false });
    await populateRanking(withRunning, { scripted: false });
    // Both clocks move past TOLERANCE_MS so every counted match is settled on both twins before any reference reply is taken
    // (024 FR-549): the snapshot head must be the same newest counted match, not whichever is still inside the settle window.
    plain.clock.advance(2000);
    withRunning.clock.advance(2000);
    // The twin's replies are the reference; the running match's scored rows and planted name sit under the head.
    const reference = new Map<string, string>();
    for (const order of ORDERS) reference.set(order, await singlePage(plain, order));
    const expectSame = async (): Promise<void> => {
      for (const order of ORDERS) expect(await singlePage(withRunning, order), order).toStrictEqual(reference.get(order));
    };
    const walkReference = new Map<string, string[]>();
    for (const order of ORDERS) walkReference.set(order, await walkTexts(withRunning, order));
    const expectWalks = async (): Promise<void> => {
      for (const order of ORDERS) expect(await walkTexts(withRunning, order), order).toStrictEqual(walkReference.get(order));
    };
    await expectSame();
    // The remaining steps of the running match (no predictions: their cutoffs passed while the counted matches played; the
    // scored rows and the planted name of rounds 1 and 2 are the ones under the head): no reply changes, before or after any
    // of them.
    for (const k of [3, 4]) {
      for (const step of STEPS) {
        withRunning.clock.advance(1000);
        const out = withRunning.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: k, step } });
        if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
        // The last application finishes the match: the replies change legitimately from there on.
        if (k === 4 && step === 'application') break;
        await expectSame();
        await expectWalks();
      }
    }
    // The comparison detects a change: once counted, the match's scored predictions join u1's statistics and the planted
    // name (the newest counted match stored it) becomes the shown one. The player count does not change: u1 had rows.
    // The finish must be settled first (024 FR-549): the clock moves past TOLERANCE_MS after the last application.
    withRunning.clock.advance(2000);
    expect(await singlePage(withRunning, 'points')).not.toBe(reference.get('points'));
    const finished = await walkTexts(withRunning, 'points');
    expect(finished.join('\n')).toContain(PLANTED);
    expect(finished.join('\n')).not.toBe((walkReference.get('points') ?? []).join('\n'));
    const fresh = await walkRanking(withRunning, DISCORD, { community: KEY_A }, 500);
    expect(fresh.pages[0]!.total).toBe(18);
    // Hundreds of real-socket round-trips: near the default 5 s under the full suite's CPU load, so the timeout is explicit.
  }, 30_000);
});
