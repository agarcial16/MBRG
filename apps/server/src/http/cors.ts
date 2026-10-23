// The cross-origin policy (spec 008 FR-286, plan 18.4b), applied to every reply including errors. Pure.
// - No `Origin` header: no CORS headers (not a cross-origin browser request).
// - A credential-free read (GET without `Authorization`): `Access-Control-Allow-Origin: *` for any origin.
// - Anything else (a request carrying `Authorization`, any POST): only an origin of the allowed-origins setting, matched
//   exactly, is echoed with `Vary: Origin`; another origin gets no permission headers (the browser blocks the reply).
// - A preflight (OPTIONS) is credential-free when it asks for GET (or names no method) and does not list `authorization`;
//   then any origin is answered with `*`; otherwise only an allowed origin, with methods GET, POST and the two headers.
// `Access-Control-Allow-Credentials` is never sent: credentials travel only in the Bearer header, never in cookies.

/** Preflight answers may be cached by the browser for 600 s. */
export const PREFLIGHT_MAX_AGE = 600;

const EXPOSE = 'retry-after';

export interface CorsRequest {
  readonly method: string;
  /** The `Origin` header, exactly as received, or undefined when absent. */
  readonly origin: string | undefined;
  /** Whether the request carries an `Authorization` header (whatever its value). */
  readonly authorization: boolean;
  /** `Access-Control-Request-Method` of a preflight. */
  readonly requestMethod?: string | undefined;
  /** `Access-Control-Request-Headers` of a preflight: a comma-separated list of header names. */
  readonly requestHeaders?: string | undefined;
}

const listsAuthorization = (names: string | undefined): boolean =>
  names !== undefined && names.split(',').some((name) => name.trim().toLowerCase() === 'authorization');

/** The CORS headers of a reply (lower-case names); `allowedOrigins` are compared exactly, `*` is never one of them. */
export function corsHeaders(request: CorsRequest, allowedOrigins: readonly string[]): Readonly<Record<string, string>> {
  const { origin } = request;
  if (origin === undefined) return {};
  const allowed = origin !== '*' && allowedOrigins.includes(origin);
  if (request.method === 'OPTIONS') {
    const credentialFree = (request.requestMethod === undefined || request.requestMethod === 'GET') && !listsAuthorization(request.requestHeaders);
    if (credentialFree) return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': String(PREFLIGHT_MAX_AGE) };
    if (!allowed) return {};
    return {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': String(PREFLIGHT_MAX_AGE),
    };
  }
  if (request.method === 'GET' && !request.authorization) return { 'access-control-allow-origin': '*', 'access-control-expose-headers': EXPOSE };
  if (!allowed) return {};
  return { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': EXPOSE };
}
