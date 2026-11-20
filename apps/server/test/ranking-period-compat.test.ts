import { createHash } from 'node:crypto';
import { decodeCursor, encodeCursor } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCORD, KEY_A, populateRanking, postRanking, startHistory, walkRanking } from './helpers/ranking-kit';
import { closeAllServers } from './helpers/server-harness';

// Spec 027 NFR-129 (compatibility): a request that names no period, or names all time, gets the reply spec 025 gave, byte for
// byte, cursor included. The SHA-256 of every reply of a full all-time walk over a real server (the fixed fake clock, the fixed
// population of the ranking kit, every order, with and without a player named, pages of 7) was recorded with the 025 service
// BEFORE spec 027 touched it (task T2.1) and is pinned below; the walks of the finished code must give the same digests.
// A digest is of a reply text, so a changed byte, member order, cursor or `asker` shows. Planted literals only.

vi.setConfig({ testTimeout: 60_000 });
afterEach(closeAllServers);

const ORDERS = ['points', 'correct', 'wins', 'accuracy'] as const;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The digests of every page reply of the walks of one request shape, keyed `<order>/<shape>/<page>`. */
async function digestsOf(extra: Record<string, unknown>, shape: string, nameAsker: boolean): Promise<Record<string, string>> {
  const h = await startHistory();
  await populateRanking(h);
  const out: Record<string, string> = {};
  for (const order of ORDERS) {
    const walked = await walkRanking(h, DISCORD, { community: KEY_A, order, ...extra, ...(nameAsker ? { playerId: 'u2' } : {}) } as never, 7);
    walked.texts.forEach((text, i) => {
      out[`${order}/${shape}/${i}`] = sha(text);
    });
  }
  await h.close();
  return out;
}

/** The recorded digests of the 025 service (task T2.1, taken before the service changed). */
export const PINNED_ALL_TIME: Readonly<Record<string, string>> = {
  'points/plain/0': '61895871e43b2ff72b8c83917013c5453920c0a8ad7c9b4b0b37250b53031637',
  'points/plain/1': 'e7ac214611c78374f36aef514614cb108efea362f65c785ae5591866897490d2',
  'points/plain/2': '7e10f7cbaaaacf053c61ab91321715aebf3c42dad1e564d9dd8ee44d6ac4101b',
  'correct/plain/0': '559de774f54daac11fb1362f051146139d16ec4403150b4c46e2fde31e9edbc4',
  'correct/plain/1': '2e575805a5e828e5c0c80fa290f9429cd2e9804902a777431da3e5865e7b11c7',
  'correct/plain/2': '6b3bde079216a91c424186331e04636daca967e1d4630eb6d74113ffda86d651',
  'wins/plain/0': '4ab843a29af85486fa11883e8e589b2239a1e952b7f002a1347a881393fa6d91',
  'wins/plain/1': '607eef7924328bbd2bf970801baabca1f57fb052c27b00b963b6c8ad247c9a22',
  'wins/plain/2': 'd30c17444ec51942bc6b74031b058e7c05ee48dab03755627cafcd6f6e0a8cf6',
  'accuracy/plain/0': '1c2795723eb4e9c9d5597b1bb51e7f10d6ed3036ca234aebd411715506a1cc6e',
  'accuracy/plain/1': 'cf5ec37739066dbf316c63d5629ec4259ad66b1cd059da713cfe08d74231a00f',
  'accuracy/plain/2': '356d342b7b4972f15d8c71764d97ff0a62a759e1db63c7c229d2fbff634fabdf',
  'points/asker/0': '1bff0d4707f3ec6c6960c3912ad60922fb6324cb58ef1fd5af701a6e5d674905',
  'points/asker/1': '6ff3f46bd4682db3a95036b9c203b52ef27ec2cd596a433e9799e16497ad0c46',
  'points/asker/2': '54aba3307f5c8028a929f48f50b245c4124399c07bd0848fd2db097f088cb9ba',
  'correct/asker/0': '113dc2d72a5b66a299a9b93e7f8557d6b537c72388d1d84275b5e17635c83cf2',
  'correct/asker/1': 'ca827267cad7112ea60232445024c6c1180a31622646adb1db9e51383b599072',
  'correct/asker/2': '62b7874dabab0d2656712bc376049dae3d5244869ef07a969381af7984e245ed',
  'wins/asker/0': 'a5e37ba41494f5fc5bffb9c51bcef51a0dd181a8797bceafeb71f82d183e8ed0',
  'wins/asker/1': '2c8101a2516829c14c45894f7cda289dc7e48928ff1054cb2da1907dcaf4b4b1',
  'wins/asker/2': '197a2edbbcbb29265841af57a75519303f6629d01ffb8d19428e7b9df2544d2a',
  'accuracy/asker/0': '97d425a0db55aa07ed7a1fc38127146f62442c822884ee385e11a7296a483fbc',
  'accuracy/asker/1': '4f77992e6312e47a746be41c8d60a5df9cc6cee4e19752e5a59886b1cbab8b8b',
  'accuracy/asker/2': '565377bab8c1a63dba16d91c6fcc6e1d6257f9ced74ea9f9bc468db5de3b140e',
};

describe('NFR-129 (compat, service part) the all-time reply is byte-identical to the 025 reply', () => {
  it('NFR-129 (compat, service part) every page of a full all-time walk, in every order, with and without a player named, hashes to the digest the 025 service gave', async () => {
    const got = { ...(await digestsOf({}, 'plain', false)), ...(await digestsOf({}, 'asker', true)) };
    expect(got).toStrictEqual(PINNED_ALL_TIME);
  });
});

describe('NFR-129 a request that names no period, or all time, gets the 025 reply byte for byte', () => {
  it('NFR-129 `period: "all"` and no period give the digests the 025 service gave, over the full walk in every order, `next` included', async () => {
    const named = { ...(await digestsOf({ period: 'all' }, 'plain', false)), ...(await digestsOf({ period: 'all' }, 'asker', true)) };
    expect(named).toStrictEqual(PINNED_ALL_TIME);
    const bare = { ...(await digestsOf({}, 'plain', false)), ...(await digestsOf({}, 'asker', true)) };
    expect(bare).toStrictEqual(PINNED_ALL_TIME);
  });

  it('NFR-129 a cursor of the 025 form (four parts) continues an all-time walk, with no period and with `all`, and the page is the pinned one', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const firstPage = await postRanking(h, DISCORD.credential, { community: KEY_A, order: 'points', limit: 7 });
    expect(sha(firstPage.text)).toBe(PINNED_ALL_TIME['points/plain/0']);
    const cursor = (firstPage.json() as { next: string }).next;
    // The cursor decodes to the 025 key, four parts, and encoding those parts again gives the same text.
    const decoded = decodeCursor('ranking', cursor);
    expect(decoded.ok && (decoded.value as readonly unknown[]).length).toBe(4);
    expect(encodeCursor('ranking', decoded.ok ? decoded.value! : [0, 0, '', ''])).toBe(cursor);
    for (const extra of [{}, { period: 'all' }]) {
      const second = await postRanking(h, DISCORD.credential, { community: KEY_A, order: 'points', limit: 7, cursor, ...extra });
      expect(sha(second.text), JSON.stringify(extra)).toBe(PINNED_ALL_TIME['points/plain/1']);
    }
    await h.close();
  });
});
