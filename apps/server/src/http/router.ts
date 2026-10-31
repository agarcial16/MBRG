// The route table and the path rules (spec 008 FR-280; plan 18.2 stages 2 to 7, plan 18.3). No `node:http` here: the table
// is data plus functions of the request context, and `resolve` is a function of a method and a request target.
// Path rules (no percent-decoding anywhere; a path is matched byte for byte):
// - The target must start with `/`; an empty segment (a trailing slash, `//`, `/`) or a literal that differs (`/mat%63hes`) is
//   `unknown-path`, whatever the method. A target that is not a path (`*`, an absolute URL) is `unknown-path`.
// - A known path called with a method its routes do not offer, `HEAD` included, is `method-not-allowed` with `Allow` listing
//   the methods the path offers plus `OPTIONS`, sorted. `OPTIONS` on a known path is the preflight; on an unknown one,
//   `unknown-path`.
// - A `:param` segment takes any non-empty text. The checks of the value belong to the decision: a malformed match id is
//   `unknown-match`, a malformed map id `unknown-map`. Only `:file` is checked here (one of the three map files, else
//   `unknown-path`), and `parseRoundSegment` is the one reading of a `:round` segment.
// - Round segment (decided here, stated in the PR): `0` or a decimal number without leading zero is a round; digits past the
//   safe-integer range (a value above 2^53 - 1, so 16 or more digits at most) are `beyond` (the read route answers `round-not-applied`);
//   a leading zero (`01`), a sign, a fraction, an exponent or any other text is `invalid` (`invalid-request ['round']`).

import { MAP_FILE_NAMES } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import type { Identity } from './identity';
import type { LimitKey } from './limits';

export type RouteMethod = 'GET' | 'POST';

/** What a stage of a route sees: path parameters, the raw query text, the parsed body, who asks and the instant. */
export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  /** The query text after `?` as received (empty when none); parsed by the route that has a query. */
  readonly query: string;
  /** The parsed JSON object of a route with a body; undefined for a route without one. */
  readonly body: unknown;
  /** The Bearer token read from the request, or undefined (the credential the service compares itself). */
  readonly token: string | undefined;
  /** The values of the `Last-Event-ID` header as received (several when repeated), or undefined when absent (FR-289 (d)). */
  readonly lastEventId: readonly string[] | undefined;
  readonly identity: Identity;
  readonly now: number;
}

/** What a route decides: an encoded success, or an error reply (status by `status.ts`, body by the protocol encoder). */
export type Reply =
  | { readonly kind: 'success'; readonly status: 200 | 201; readonly body: string }
  // The bytes of a map file, read once for this request: the length sent is the length of these bytes (never a size read earlier).
  | { readonly kind: 'file'; readonly contentType: string; readonly body: Uint8Array }
  // An event stream (FR-289): the pipeline opens it on the hub with the response; `after` is the last number the client has
  // (undefined: only events committed after the open). A hub refusal is an ordinary error reply, written before any stream byte.
  | { readonly kind: 'stream'; readonly matchId: string; readonly after: number | undefined }
  | { readonly kind: 'error'; readonly error: ErrorReply };

/**
 * A route. The pipeline runs the hooks in the FR-301 order, the first that answers an error wins:
 * `checkQuery` (stage 3, after the body), `shape` (4), `authorize` (5), `playerLimit` (6, cancels the ticket of stage 1 on a
 * refusal), `decide` (7).
 */
export interface Route {
  readonly method: RouteMethod;
  /** Literal segments and `:name` parameters, for example `/matches/:id/advance`. */
  readonly path: string;
  /** `object`: the body is read (at most 4,096 bytes) and must be a JSON object; `none`: it is not read. */
  readonly body: 'none' | 'object';
  /** An event-stream route: the pipeline takes an open-stream place at stage 1 and hands it to the hub (FR-299 (b)). */
  readonly stream?: true;
  /** Names the path parameter holding the match id when the token may be that match's host token (advance only, PD16). Same as `matchParam` with `holders: ['host']`. */
  readonly hostParam?: string;
  /**
   * Spec 011: names the path parameter holding the match id when an unrecognised token may be a token OF that match, and
   * `holders` says which kinds of match token the route accepts. The pipeline looks a token up (one indexed read) only for
   * a route that lists the kind, in the order host, player; the first that matches gives the role. A route without
   * `holders` asks for nothing.
   */
  readonly matchParam?: string;
  readonly holders?: readonly ('host' | 'player')[];
  checkQuery?(ctx: RouteContext): ErrorReply | undefined;
  shape?(ctx: RouteContext): ErrorReply | undefined;
  authorize?(ctx: RouteContext): ErrorReply | undefined;
  playerLimit?(ctx: RouteContext): readonly LimitKey[] | undefined;
  decide(ctx: RouteContext): Reply | Promise<Reply>;
}

/** The match parameter and the kinds of match token a route accepts (`hostParam` alone means the host token), if any. */
export function holdersOf(route: Route): { readonly param: string; readonly host: boolean; readonly player: boolean } | undefined {
  const param = route.matchParam ?? route.hostParam;
  if (param === undefined) return undefined;
  const holders = route.holders ?? (route.hostParam === undefined ? [] : ['host' as const]);
  const host = holders.includes('host');
  const player = holders.includes('player');
  return host || player ? { param, host, player } : undefined;
}

export type Resolution<R extends Route = Route> =
  | { readonly kind: 'found'; readonly route: R; readonly params: Readonly<Record<string, string>>; readonly query: string }
  | { readonly kind: 'preflight'; readonly allow: readonly string[] }
  | { readonly kind: 'method-not-allowed'; readonly allow: readonly string[] }
  | { readonly kind: 'unknown-path' };

export interface Router<R extends Route = Route> {
  /** The method as received (any text) and the request target as received. */
  resolve(method: string, target: string): Resolution<R>;
}

/** Parameter names the router itself validates. */
const FILE_PARAM = 'file';

const segmentsOf = (path: string): string[] => path.slice(1).split('/');

export function createRouter<R extends Route>(routes: readonly R[]): Router<R> {
  const compiled = routes.map((route) => {
    if (!route.path.startsWith('/')) throw new RangeError('a route path starts with /');
    return { route, segments: segmentsOf(route.path) };
  });
  const seen = new Set<string>();
  for (const { route } of compiled) {
    const id = `${route.method} ${route.path.replace(/:[A-Za-z]+/g, ':')}`;
    if (seen.has(id)) throw new RangeError('two routes have the same method and path');
    seen.add(id);
  }

  return {
    resolve(method, target) {
      const mark = target.indexOf('?');
      const path = mark < 0 ? target : target.slice(0, mark);
      const query = mark < 0 ? '' : target.slice(mark + 1);
      if (!path.startsWith('/')) return { kind: 'unknown-path' };
      const parts = segmentsOf(path);
      if (parts.some((part) => part === '')) return { kind: 'unknown-path' };

      const here: { route: R; params: Record<string, string> }[] = [];
      for (const { route, segments } of compiled) {
        if (segments.length !== parts.length) continue;
        const params: Record<string, string> = Object.create(null) as Record<string, string>;
        let same = true;
        for (let i = 0; i < segments.length && same; i += 1) {
          const want = segments[i] as string;
          const got = parts[i] as string;
          if (want.startsWith(':')) {
            const name = want.slice(1);
            if (name === FILE_PARAM && !(MAP_FILE_NAMES as readonly string[]).includes(got)) same = false;
            else params[name] = got;
          } else same = want === got;
        }
        if (same) here.push({ route, params });
      }
      if (here.length === 0) return { kind: 'unknown-path' };

      const allow = [...new Set([...here.map((h) => h.route.method as string), 'OPTIONS'])].sort();
      const hit = here.find((h) => h.route.method === method);
      if (hit !== undefined) return { kind: 'found', route: hit.route, params: hit.params, query };
      if (method === 'OPTIONS') return { kind: 'preflight', allow };
      return { kind: 'method-not-allowed', allow };
    },
  };
}

/** `0` or a decimal number without a leading zero, sign, fraction or exponent. */
const ROUND_DIGITS = /^(?:0|[1-9][0-9]*)$/;

export type RoundSegment = { readonly kind: 'round'; readonly value: number } | { readonly kind: 'beyond' } | { readonly kind: 'invalid' };

/** The one reading of a `:round` segment (see the header): a round, `beyond` the safe range, or `invalid`. */
export function parseRoundSegment(text: string): RoundSegment {
  if (!ROUND_DIGITS.test(text)) return { kind: 'invalid' };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || text.length > 16) return { kind: 'beyond' };
  return { kind: 'round', value };
}
