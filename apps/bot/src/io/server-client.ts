// The bot's client of the MBRG server (spec 012). Public reads carry no credential; the `discord` client credential goes only in
// the Authorization header of a prediction, and a host token only in that of a start (NFR-89). Every reply is read by the
// protocol's strict readers; anything unreadable is "the server is down" (no value is ever echoed into a message or a log).
import { readErrorReply, readLeaderboardPage, readPredictionReply, readPublicConfig, readPublicMatch, readStateReply } from '@mbrg/protocol';
import type { CreationBody, ErrorReply, LeaderboardRow, PredictionKind, PredictionReply, PublicConfig, PublicMatch } from '@mbrg/protocol';
import { livingCount, readCorrectPage, readCreated } from '../core/decode-results';
import type { Created } from '../core/decode-results';
import { readFactionNames } from '../core/names';
import type { Named } from '../core/text';

export type Failure = { readonly type: 'refused'; readonly error: ErrorReply } | { readonly type: 'down' };
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

export interface ClientOptions {
  readonly baseUrl: string;
  readonly credential: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface Submission {
  readonly kind: PredictionKind;
  readonly round: number;
  readonly faction: number;
  /** The local player id: the member's Discord user id (the server builds `discord:<id>`). */
  readonly playerId: string;
}

export interface ServerClient {
  config(): Promise<Result<PublicConfig>>;
  create(body: CreationBody): Promise<Result<Created>>;
  start(matchId: string, hostToken: string): Promise<Result<PublicMatch>>;
  match(matchId: string): Promise<Result<PublicMatch>>;
  /** The number of factions alive in the state at an applied round. */
  livingAt(matchId: string, round: number): Promise<Result<number>>;
  factions(mapId: string): Promise<Result<Named[]>>;
  submit(matchId: string, submission: Submission): Promise<Result<PredictionReply>>;
  /** The ids of every player who guessed a scored phase right (all pages). */
  correctPlayers(matchId: string, round: number, phase: 1 | 2): Promise<Result<string[]>>;
  leaderboard(matchId: string, limit: number): Promise<Result<LeaderboardRow[]>>;
}

const DOWN: Failure = { type: 'down' };
const down = <T>(): Result<T> => ({ ok: false, failure: DOWN });
const PAGE = 500;
const MAX_PAGES = 40;

export function createServerClient(options: ClientOptions): ServerClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2500;

  async function call<T>(method: 'GET' | 'POST', path: string, read: (json: unknown) => T | undefined, bearer?: string, body?: unknown): Promise<Result<T>> {
    let response: Response;
    let json: unknown;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers: { ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      json = await response.json();
    } catch {
      return down();
    }
    if (response.status >= 200 && response.status < 300) {
      const value = read(json);
      return value === undefined ? down() : { ok: true, value };
    }
    const error = readErrorReply(json);
    return error.ok ? { ok: false, failure: { type: 'refused', error: error.value } } : down();
  }

  const decoded =
    <T>(reader: (input: unknown) => { ok: true; value: T } | { ok: false }) =>
    (json: unknown): T | undefined => {
      const r = reader(json);
      return r.ok ? r.value : undefined;
    };
  const enc = encodeURIComponent;

  return {
    config: () => call('GET', '/config', decoded(readPublicConfig)),
    create: (body) => call('POST', '/matches', readCreated, undefined, body),
    start: (matchId, hostToken) => call('POST', `/matches/${enc(matchId)}/start`, decoded(readPublicMatch), hostToken, {}),
    match: (matchId) => call('GET', `/matches/${enc(matchId)}`, decoded(readPublicMatch)),
    async livingAt(matchId, round) {
      const state = await call('GET', `/matches/${enc(matchId)}/states/${round}`, decoded(readStateReply));
      return state.ok ? { ok: true, value: livingCount(state.value.owners) } : state;
    },
    factions: (mapId) => call('GET', `/maps/${enc(mapId)}/presentation.json`, (json) => readFactionNames(json)),
    submit: (matchId, s) =>
      call('POST', `/matches/${enc(matchId)}/predictions`, decoded(readPredictionReply), options.credential, { kind: s.kind, round: s.round, faction: s.faction, playerId: s.playerId }),
    async correctPlayers(matchId, round, phase) {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = `?limit=${PAGE}${cursor === undefined ? '' : `&cursor=${enc(cursor)}`}`;
        const got = await call('GET', `/matches/${enc(matchId)}/results/${round}/${phase}${query}`, readCorrectPage);
        if (!got.ok) return got;
        ids.push(...got.value.correct);
        cursor = got.value.next;
        if (cursor === undefined) return { ok: true, value: ids };
      }
      return { ok: true, value: ids };
    },
    async leaderboard(matchId, limit) {
      const page = await call('GET', `/matches/${enc(matchId)}/leaderboard?limit=${limit}`, decoded(readLeaderboardPage));
      return page.ok ? { ok: true, value: [...page.value.items] } : page;
    },
  };
}
