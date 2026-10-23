import { createHash } from 'node:crypto';
import { getState, playRoundWithSeed, totalRounds } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { roundSeed } from '../src/secret';
import { devMap, stateDigest } from './helpers/digests';
import { encodingsOf } from './helpers/db-scan';
import { request } from './helpers/http-client';
import { CHILD_OPERATOR, baseEnv, eventsOf, withMain } from './helpers/main-child';
import { creationBody } from './helpers/service-harness';

// FR-260 (production) and NFR-47 (f): a production child process (seed-like variables set, no test seed source reachable)
// plays a whole match over HTTP; FR-259 (verification rule over HTTP): the secret appears only once the match is finished, and
// a client recomputes every round seed, record and state digest from it, and the commitment from the secret.

const ok = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T => {
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
};

const NOISY = { MBRG_TEST_SEED_SOURCE: '1', MBRG_SEED_SOURCE: 'fixed', MBRG_ROUND_SEED: '5', TEST_SEED_SOURCE: '1' };
const STEPS = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' } as const;

interface PublicShape {
  matchId: string;
  stage: keyof typeof STEPS | 'finished' | 'halted';
  appliedRounds: number;
  totalRounds: number;
  commitment: string;
  stateDigest: string;
  winner?: number;
  matchSecret?: string;
  state: { owners: [number, number][] };
}

/** Whether a reply text holds a value in any of its encodings (a text needle, or raw bytes). */
const holds = (text: string, needle: string | Uint8Array): boolean => (typeof needle === 'string' ? text.includes(needle) : Buffer.from(text, 'utf8').includes(Buffer.from(needle)));

describe('a production process plays a match', () => {
  it('FR-260 (production) FR-259 (verification rule over HTTP) the secret is revealed only at the end and recomputes the seeds, records, state digests and the commitment', async () => {
    const map = devMap();
    await withMain(baseEnv(NOISY), async (child, port) => {
      const authed = { authorization: `Bearer ${CHILD_OPERATOR}` };
      const created = await request(port, { method: 'POST', path: '/matches', headers: authed, body: creationBody('v-1', { timing: 'manual' }) });
      expect(created.status).toBe(201);
      const { matchId, match: first, hostToken } = created.json() as { matchId: string; match: PublicShape; hostToken: string };
      expect(first.commitment).toMatch(/^[0-9a-f]{64}$/);
      expect(first.matchSecret).toBeUndefined();

      // Every reply before the finish, kept to scan for the secret afterwards. The match is advanced by its host token.
      const before: string[] = [created.text];
      const read = async (path: string): Promise<{ text: string; json: unknown }> => {
        const reply = await request(port, { path });
        expect(reply.status).toBe(200);
        return { text: reply.text, json: reply.json() };
      };
      let shown = (await read(`/matches/${matchId}`)).json as PublicShape;
      let finalReply = '';
      while (shown.stage !== 'finished') {
        if (shown.stage === 'halted') throw new Error('the match halted');
        const step = STEPS[shown.stage];
        const advanced = await request(port, { method: 'POST', path: `/matches/${matchId}/advance`, headers: { authorization: `Bearer ${hostToken}` }, body: { round: shown.appliedRounds + 1, step } });
        expect(advanced.status).toBe(200);
        const after = (advanced.json() as { match: PublicShape }).match;
        if (after.stage === 'finished') {
          finalReply = advanced.text;
          break;
        }
        before.push(advanced.text);
        const current = await read(`/matches/${matchId}`);
        before.push(current.text);
        for (const path of [`/matches/${matchId}/records`, `/matches/${matchId}/states/${after.appliedRounds}`]) before.push((await read(path)).text);
        shown = current.json as PublicShape;
      }

      // The finished match shows the secret, in the advance reply that finished it and in the public data.
      const finished = (await read(`/matches/${matchId}`)).json as PublicShape;
      expect(finished.stage).toBe('finished');
      expect(finished.matchSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(finalReply).toContain(finished.matchSecret);
      const secret = new Uint8Array(Buffer.from(finished.matchSecret!, 'hex'));
      expect(secret).toHaveLength(32);

      // Nothing sent before the finish holds the secret (hex in both cases, base64, base64url, decimal, raw bytes) or a key for it.
      expect(before.length).toBeGreaterThan(20);
      for (const text of before) {
        expect(text).not.toContain('matchSecret');
        for (const needle of encodingsOf(secret)) expect(holds(text, needle), String(needle).slice(0, 12)).toBe(false);
      }

      // The commitment published at creation is the SHA-256 of the secret.
      expect(createHash('sha256').update(secret).digest('hex')).toBe(first.commitment);
      expect(finished.commitment).toBe(first.commitment);

      // Replay the match from round 0 with the seeds derived from the secret: records and state digests equal the published ones.
      let state: MatchState = ok(getState(map, 0, 0));
      const total = ok(totalRounds(map));
      expect(finished.totalRounds).toBe(total);
      const page = (await read(`/matches/${matchId}/records`)).json as { items: { round: number; eliminated: number; absorber: number; transferred: number[] }[] };
      expect(page.items).toHaveLength(total);
      for (let k = 1; k <= total; k += 1) {
        const played = ok(playRoundWithSeed(map, state, roundSeed(secret, k)));
        state = played.state;
        const record = (await read(`/matches/${matchId}/records/${k}`)).json;
        expect(record).toStrictEqual({ round: k, eliminated: played.record.eliminated, absorber: played.record.absorber, transferred: played.record.transferred });
        expect(page.items[k - 1]).toStrictEqual(record);
        const published = (await read(`/matches/${matchId}/states/${k}`)).json as { owners: [number, number][]; stateDigest: string };
        expect(published.stateDigest).toBe(stateDigest(state));
        expect(published.owners).toStrictEqual(state.owners);
      }
      expect(finished.stateDigest).toBe(stateDigest(state));
      expect(new Set(state.owners.map(([, f]) => f))).toStrictEqual(new Set([finished.winner]));
      expect(child.stderr()).toBe('');
      expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening']);
    });
  }, 120_000);
});
