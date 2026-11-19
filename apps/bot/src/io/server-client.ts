// The bot's client of the MBRG server (spec 012). Public reads carry no credential; the `discord` client credential goes only in
// the Authorization header of a prediction and of a creation (spec 018 FR-505: the match is created client-only), and a host token
// only in that of a start (NFR-89). Every reply is read by the
// protocol's strict readers; anything unreadable is "the server is down" (no value is ever echoed into a message or a log).
import { readErrorReply, readHistoryPage, readLeaderboardPage, readPredictionReply, readPublicConfig, readPublicMatch, readStateReply } from '@mbrg/protocol';
import type { CreationBody, ErrorReply, HistoryPage, LeaderboardRow, PredictionKind, PredictionReply, PublicConfig, PublicMatch } from '@mbrg/protocol';
import { HISTORY_PAGE_SIZE } from '../core/history';
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
  /** The member's display name, already cleaned to the server's name rule (spec 022 FR-537); absent when nothing valid remains. */
  readonly name?: string;
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
  /** Every row of the leaderboard (all pages), as the server ranks it; the paging of the channel is the bot's own (spec 017 FR-477). */
  leaderboard(matchId: string): Promise<Result<LeaderboardRow[]>>;
  /**
   * One page of the history of a community (spec 024 FR-573): the key, the asker's local id, the page size and the cursor go in the BODY
   * with the credential, so no path, query or access log holds them. One request: a refusal or an outage is the caller's to report, never retried.
   */
  history(request: { readonly community: string; readonly playerId: string; readonly cursor?: string }): Promise<Result<HistoryPage>>;
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
    // Spec 018 FR-505: the match is client-only (only this community's players can predict in it) and the `discord` credential says whose.
    create: (body) => call('POST', '/matches', readCreated, options.credential, { ...body, joinPolicy: 'client' }),
    start: (matchId, hostToken) => call('POST', `/matches/${enc(matchId)}/start`, decoded(readPublicMatch), hostToken, {}),
    match: (matchId) => call('GET', `/matches/${enc(matchId)}`, decoded(readPublicMatch)),
    async livingAt(matchId, round) {
      const state = await call('GET', `/matches/${enc(matchId)}/states/${round}`, decoded(readStateReply));
      return state.ok ? { ok: true, value: livingCount(state.value.owners) } : state;
    },
    factions: (mapId) => call('GET', `/maps/${enc(mapId)}/presentation.json`, (json) => readFactionNames(json)),
    submit: (matchId, s) =>
      call('POST', `/matches/${enc(matchId)}/predictions`, decoded(readPredictionReply), options.credential, { kind: s.kind, round: s.round, faction: s.faction, playerId: s.playerId, ...(s.name === undefined ? {} : { name: s.name }) }),
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
    history: (r) =>
      call('POST', '/history', decoded(readHistoryPage), options.credential, {
        community: r.community,
        playerId: r.playerId,
        limit: HISTORY_PAGE_SIZE,
        ...(r.cursor === undefined ? {} : { cursor: r.cursor }),
      }),
    async leaderboard(matchId) {
      const rows: LeaderboardRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = `?limit=${PAGE}${cursor === undefined ? '' : `&cursor=${enc(cursor)}`}`;
        const got = await call('GET', `/matches/${enc(matchId)}/leaderboard${query}`, decoded(readLeaderboardPage));
        if (!got.ok) return got;
        rows.push(...got.value.items);
        cursor = got.value.next;
        if (cursor === undefined) break;
      }
      return { ok: true, value: rows };
    },
  };
}
