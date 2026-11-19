import type { ClientReply } from './http-client';
import { request } from './http-client';
import { DISCORD, KEY_A, WEB, createCommunityMatch, playMatch, startHistory } from './history-kit';
import type { Client, Made, Player } from './history-kit';
import type { ServerHarness } from './server-harness';

// Shared setup of the ranking tests (spec 025 M2): the community matches of the history kit (created over HTTP with a client
// credential, played to the end through the service API with scripted or arbitrary predictions), a fixed population of eighteen
// players across seven counted matches — three of them play two matches, so they alone are qualified for the accuracy order —
// and the POST helper and cursor walk of the ranking read. Key values and names are planted literals.

export { DISCORD, KEY_A, KEY_B, KEY_C, WEB, createCommunityMatch, playMatch, runMatch, startHistory } from './history-kit';
export type { Client, Made, Player } from './history-kit';
export type { ServerHarness } from './server-harness';

/** One scripted player of the ranking population: the local id, the name planted for one match, the prediction pattern. */
export interface RankPlayer {
  readonly client: Client;
  readonly local: string;
  readonly name?: string;
  readonly victim: 'right' | 'wrong';
  readonly absorber: 'right' | 'wrong';
  readonly winner: 'right' | 'wrong';
}

/** The three players of the scripted first match (history-kit's answers drive `right` and `wrong`). */
export const ANA: RankPlayer = { client: DISCORD, local: 'u1', name: 'Ana Primera', victim: 'right', absorber: 'right', winner: 'right' };
export const BEA: RankPlayer = { client: DISCORD, local: 'u2', name: 'Bea', victim: 'right', absorber: 'wrong', winner: 'wrong' };
export const CAL: RankPlayer = { client: DISCORD, local: 'u3', victim: 'wrong', absorber: 'wrong', winner: 'wrong' };

/** The same three locals of a second match: a new planted name for Ana, none for the others. */
export const ANA2: RankPlayer = { client: DISCORD, local: 'u1', name: 'Ana Segunda', victim: 'wrong', absorber: 'wrong', winner: 'wrong' };
export const BEA2: RankPlayer = { client: DISCORD, local: 'u2', victim: 'right', absorber: 'wrong', winner: 'wrong' };
export const CAL2: RankPlayer = { client: DISCORD, local: 'u3', name: 'Cal', victim: 'wrong', absorber: 'wrong', winner: 'right' };

/** Three arbitrary players of one later match: no name, picks by chance. */
const trio = (n: number): RankPlayer[] => [
  { client: DISCORD, local: `u${n}1`, victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
  { client: DISCORD, local: `u${n}2`, victim: 'right', absorber: 'wrong', winner: 'wrong' },
  { client: DISCORD, local: `u${n}3`, victim: 'wrong', absorber: 'right', winner: 'right' },
];

/** The ranking population: 18 players over 7 counted matches of KEY_A; u1 to u3 play the first two. */
export const POPULATION: readonly (readonly RankPlayer[])[] = [
  [ANA, BEA, CAL],
  [ANA2, BEA2, CAL2],
  trio(4),
  trio(5),
  trio(6),
  trio(7),
  trio(8),
];

/** The locals of the population, in creation order of their first match. */
export const POPULATION_LOCALS: readonly string[] = POPULATION.flatMap((players) => players.map((p) => p.local));

export interface Ranked {
  /** The counted matches, oldest finish first (each was played to the end before the next was created). */
  readonly matches: readonly Made[];
}

/**
 * The community of the ranking tests: seven matches of KEY_A under the Discord namespace, the first with scripted predictions
 * (the known secret), the second with the same three locals under new planted names, five more with three arbitrary players
 * each. Deterministic: two harnesses built the same way produce byte-identical ranking replies.
 */
export async function populateRanking(h: ServerHarness): Promise<Ranked> {
  const matches: Made[] = [];
  for (const [i, players] of POPULATION.entries()) {
    const made = await createCommunityMatch(h, DISCORD, `a-${i}`, KEY_A);
    playMatch(h, made, players, i === 0);
    matches.push(made);
  }
  return { matches };
}

/** `POST /ranking` with an optional bearer token. */
export const postRanking = (h: ServerHarness, token: string | undefined, body: unknown, path = '/ranking'): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

export interface RankingBody {
  readonly community: string;
  readonly order?: string;
  readonly playerId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

interface Page {
  readonly items: { readonly playerId: string; readonly [k: string]: unknown }[];
  readonly total: number;
  readonly next?: string;
  readonly asker?: unknown;
  [k: string]: unknown;
}

export interface RankedWalk {
  readonly pages: Page[];
  readonly texts: string[];
}

/** Follows the cursors of a ranking walk with one page size and returns every page and its reply text. */
export async function walkRanking(h: ServerHarness, client: Client, body: RankingBody, limit: number): Promise<RankedWalk> {
  const pages: Page[] = [];
  const texts: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const reply = await postRanking(h, client.credential, { ...body, limit, ...(cursor === undefined ? {} : { cursor }) });
    if (reply.status !== 200) throw new Error(`ranking refused: ${reply.status} ${reply.text}`);
    texts.push(reply.text);
    const page = reply.json() as Page;
    pages.push(page);
    cursor = page.next;
    if (cursor === undefined) return { pages, texts };
  }
  throw new Error('the ranking walk did not end');
}
