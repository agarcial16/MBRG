import type { ClientReply } from './http-client';
import { request } from './http-client';
import { SECRETS } from './core-timelines';
import { GOLD, WINNER } from './results-script';
import { TOLERANCE_MS } from '../../src/core/time';
import { startReads } from './http-reads-kit';
import { CLIENT_CREDENTIAL } from './server-harness';
import type { ServerHarness, ServerHarnessOptions } from './server-harness';
import { OPERATOR, creationBody } from './service-harness';

// Shared setup of the history tests (spec 024 M2): a production-routes server with two client credentials (namespaces `web` and
// `discord`), community matches created over HTTP with a client credential, and matches played to the end through the service
// API with scripted predictions. Only the FIRST match a server creates has the known secret `ascending-00-1f` (the service
// harness substitutes the first 32-byte draw), so only it can have predictions that are right on purpose. Key values are
// planted literals no other text of the repository holds.

export const KEY_A = '1d0c5eeda11ce5a1d0c5eeda11ce5a1d0c5eeda11ce5a1d0c5eeda11ce5a1d0c';
export const KEY_B = '2e1d6ffeb22df6b2e1d6ffeb22df6b2e1d6ffeb22df6b2e1d6ffeb22df6b2e1d';
export const KEY_Z = '4a3f8bbffd44b8d4a3f8bbffd44b8d4a3f8bbffd44b8d4a3f8bbffd44b8d4a3f';
export const KEY_C = '3f2e7aaffc33a7c3f2e7aaffc33a7c3f2e7aaffc33a7c3f2e7aaffc33a7c3f2e';

export const WEB = { credential: CLIENT_CREDENTIAL, namespace: 'web' } as const;
export const DISCORD = { credential: 'client-credential-discord-0123456789', namespace: 'discord' } as const;
export type Client = typeof WEB | typeof DISCORD;

export const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 1000, maxPublicRunning: 1000 } as const;

export const startHistory = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startReads({
    clients: [
      { namespace: WEB.namespace, credential: WEB.credential },
      { namespace: DISCORD.namespace, credential: DISCORD.credential },
    ],
    ...options,
    service: { secret: SECRETS['ascending-00-1f'], publicCreation: PUBLIC, ...(options.service ?? {}) },
    limits: { createSource: 100_000, createAll: 100_000, ...(options.limits ?? {}) },
  });

export interface Made {
  readonly id: string;
  readonly hostToken: string;
}

/** A client-only creation over HTTP (with the community key when given). */
export async function createCommunityMatch(h: ServerHarness, client: Client, requestId: string, community?: string): Promise<Made> {
  const reply = await request(h.port, {
    method: 'POST',
    path: '/matches',
    body: creationBody(requestId, { joinPolicy: 'client', ...(community === undefined ? {} : { community }) }),
    headers: { authorization: `Bearer ${client.credential}` },
  });
  if (reply.status !== 201) throw new Error(`creation refused: ${reply.status} ${reply.text}`);
  const body = reply.json() as { matchId: string; hostToken: string };
  return { id: body.matchId, hostToken: body.hostToken };
}

/** One scripted player: a local id of a client and what it picks (`right` follows the golden answers of the known secret). */
export interface Player {
  readonly client: Client;
  readonly local: string;
  readonly name?: string;
  readonly victim?: 'right' | 'wrong';
  readonly absorber?: 'right' | 'wrong';
  readonly winner?: 'right' | 'wrong';
}

const STEPS = ['phase-1-close', 'phase-2-close', 'application'] as const;

function submit(h: ServerHarness, id: string, player: Player, body: Record<string, unknown>): void {
  const out = h.service.submit({ client: { credential: player.client.credential, namespace: player.client.namespace }, matchId: id, body: { playerId: player.local, ...(player.name === undefined ? {} : { name: player.name }), ...body } });
  if (!out.ok && out.error.kind !== 'forced-absorber') throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
}

const living = (h: ServerHarness, id: string): number[] => [...new Set(h.base.store.getMatch(id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);

/**
 * Starts the lobby with its host token and plays the 4 rounds (12 steps by the operator credential), the clock 1,000 ms later
 * before every step, so each step has its own instant. `known` says the match has the secret of the golden file: `right` picks
 * then follow it; any other match gets arbitrary picks (right or wrong by chance), whatever the players ask.
 */
export function playMatch(h: ServerHarness, made: Made, players: readonly Player[] = [], known = false): void {
  playUntil(h, made, players, known, 12);
  const view = h.service.readPublicMatch(made.id);
  if (!view.ok || view.reply.stage !== 'finished') throw new Error('the match did not finish');
  settle(h);
}

/** The history lists a match once it is settled (its finish instant is more than TOLERANCE_MS behind the clock): moves the clock past that. */
export const settle = (h: ServerHarness): void => h.clock.advance(TOLERANCE_MS + 1);

/** Starts the lobby and plays only the first `steps` steps (0 to 12) with the scripted predictions: a running match when under 12. */
export function playUntil(h: ServerHarness, made: Made, players: readonly Player[], known: boolean, steps: number): void {
  for (const done of playSteps(h, made, players, known)) if (done === steps) return;
}

/** The same play as a generator: yields the number of steps done after the start (0) and after each step, so a test can read in between. */
export function* playSteps(h: ServerHarness, made: Made, players: readonly Player[], known: boolean): Generator<number> {
  const started = h.service.startMatch({ credential: made.hostToken, matchId: made.id, body: {} });
  if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  let done = 0;
  yield 0;
  for (let k = 1; k <= 4; k += 1) {
    const alive = living(h, made.id);
    const gold = GOLD[k - 1]!;
    for (const player of players) {
      if (k === 1 && player.winner !== undefined) {
        const wrong = alive.find((f) => f !== WINNER)!;
        submit(h, made.id, player, { kind: 'winner', faction: known ? (player.winner === 'right' ? WINNER : wrong) : alive[0]! });
      }
      if (player.victim !== undefined) {
        const wrong = alive.find((f) => f !== gold.victim)!;
        submit(h, made.id, player, { kind: 'victim', round: k, faction: known ? (player.victim === 'right' ? gold.victim : wrong) : alive[0]! });
      }
    }
    for (const [j, step] of STEPS.entries()) {
      if (j === 1) {
        const candidates = [...h.base.store.getMatch(made.id)!.match.victim!.candidates];
        for (const player of players) {
          if (player.absorber === undefined || candidates.length < 2) continue;
          const wrong = candidates.find((c) => c !== gold.absorber)!;
          submit(h, made.id, player, { kind: 'absorber', round: k, faction: known ? (player.absorber === 'right' ? gold.absorber : wrong) : candidates[0]! });
        }
      }
      h.clock.advance(1000);
      const out = h.service.advance({ credential: OPERATOR, matchId: made.id, body: { round: k, step } });
      if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
      done += 1;
      yield done;
    }
  }
}

/** Starts the lobby and plays only `steps` steps (0 to 11): a running match. */
export function runMatch(h: ServerHarness, made: Made, steps: number): void {
  const started = h.service.startMatch({ credential: made.hostToken, matchId: made.id, body: {} });
  if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  for (let i = 0; i < steps; i += 1) {
    h.clock.advance(1000);
    const out = h.service.advance({ credential: OPERATOR, matchId: made.id, body: { round: Math.floor(i / 3) + 1, step: STEPS[i % 3]! } });
    if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
  }
}

/** `POST /history` with an optional bearer token. */
export const postHistory = (h: ServerHarness, token: string | undefined, body: unknown, path = '/history'): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

export interface HistoryBody {
  readonly community: string;
  readonly playerId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Walked {
  readonly pages: { items: { matchId: string; [k: string]: unknown }[]; total: number; next?: string }[];
  readonly texts: string[];
}

/** Follows the cursors of a walk with one page size and returns every page. */
export async function walk(h: ServerHarness, client: Client, body: HistoryBody, limit: number): Promise<Walked> {
  const pages: Walked['pages'] = [];
  const texts: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const reply = await postHistory(h, client.credential, { ...body, limit, ...(cursor === undefined ? {} : { cursor }) });
    if (reply.status !== 200) throw new Error(`history refused: ${reply.status} ${reply.text}`);
    texts.push(reply.text);
    const page = reply.json() as Walked['pages'][number];
    pages.push(page);
    cursor = page.next;
    if (cursor === undefined) return { pages, texts };
  }
  throw new Error('the walk did not end');
}
