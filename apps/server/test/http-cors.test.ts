import { describe, expect, it } from 'vitest';
import { PREFLIGHT_MAX_AGE, corsHeaders } from '../src/http/cors';
import type { CorsRequest } from '../src/http/cors';

// The cross-origin policy of FR-286 as the truth table of plan 18.4b (M3a T6): credential-free reads and map files for
// any origin without credentials; a request carrying `Authorization`, and its preflight, only for an allowed origin
// (exact match, empty by default); every other origin gets no cross-origin permission. `Allow-Credentials` never.

const ALLOWED = ['https://mbrg.example', 'http://localhost:5173'];
const OTHER = 'https://evil.example';

const req = (over: Partial<CorsRequest>): CorsRequest => ({ method: 'GET', origin: undefined, authorization: false, ...over });

const READ_ANY = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' };
const echo = (origin: string) => ({ 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'retry-after' });
const PREFLIGHT_READ = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '600' };
const preflightCredentialed = (origin: string) => ({
  'access-control-allow-origin': origin,
  vary: 'Origin',
  'access-control-allow-methods': 'GET, POST',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
});

describe('http cors', () => {
  it('FR-286 (policy) without an Origin header there are no CORS headers', () => {
    for (const r of [req({}), req({ authorization: true }), req({ method: 'POST', authorization: true }), req({ method: 'OPTIONS', requestMethod: 'POST' })]) {
      expect(corsHeaders(r, ALLOWED), JSON.stringify(r)).toStrictEqual({});
    }
  });

  it('FR-286 (policy) a credential-free GET is readable from any origin, without credentials', () => {
    for (const origin of [OTHER, ...ALLOWED, 'null']) expect(corsHeaders(req({ origin }), ALLOWED), origin).toStrictEqual(READ_ANY);
    expect(corsHeaders(req({ origin: OTHER }), [])).toStrictEqual(READ_ANY);
  });

  it('FR-286 (policy) a request with Authorization from an allowed origin gets that origin echoed with Vary: Origin', () => {
    for (const origin of ALLOWED) {
      expect(corsHeaders(req({ origin, authorization: true }), ALLOWED), origin).toStrictEqual(echo(origin));
      expect(corsHeaders(req({ origin, method: 'POST', authorization: true }), ALLOWED), origin).toStrictEqual(echo(origin));
    }
  });

  it('FR-286 (policy) a request with Authorization from another origin gets no permission headers, never `*`', () => {
    for (const origin of [OTHER, 'https://mbrg.example.evil', 'https://MBRG.example', 'https://mbrg.example:443', 'http://mbrg.example', 'null', '*']) {
      expect(corsHeaders(req({ origin, authorization: true }), ALLOWED), origin).toStrictEqual({});
      expect(corsHeaders(req({ origin, method: 'POST', authorization: true }), ALLOWED), origin).toStrictEqual({});
    }
    // The default setting allows no origin at all for credentialed requests.
    expect(corsHeaders(req({ origin: ALLOWED[0], authorization: true }), [])).toStrictEqual({});
  });

  it('FR-286 (policy) a POST without Authorization is not a credential-free read: only an allowed origin may read the reply', () => {
    expect(corsHeaders(req({ origin: OTHER, method: 'POST' }), ALLOWED)).toStrictEqual({});
    expect(corsHeaders(req({ origin: ALLOWED[0], method: 'POST' }), ALLOWED)).toStrictEqual(echo(ALLOWED[0] as string));
  });

  it('FR-286 (policy) the preflight of a credential-free read is answered for any origin', () => {
    expect(PREFLIGHT_MAX_AGE).toBe(600);
    for (const origin of [OTHER, ...ALLOWED]) {
      expect(corsHeaders(req({ method: 'OPTIONS', origin, requestMethod: 'GET' }), ALLOWED), origin).toStrictEqual(PREFLIGHT_READ);
      expect(corsHeaders(req({ method: 'OPTIONS', origin, requestMethod: 'GET', requestHeaders: 'last-event-id' }), ALLOWED), origin).toStrictEqual(PREFLIGHT_READ);
      expect(corsHeaders(req({ method: 'OPTIONS', origin }), ALLOWED), origin).toStrictEqual(PREFLIGHT_READ);
    }
  });

  it('FR-286 (policy) the preflight listing authorization, or of a POST, is answered only for an allowed origin', () => {
    for (const origin of ALLOWED) {
      for (const r of [
        req({ method: 'OPTIONS', origin, requestMethod: 'GET', requestHeaders: 'authorization' }),
        req({ method: 'OPTIONS', origin, requestMethod: 'GET', requestHeaders: 'Content-Type, Authorization' }),
        req({ method: 'OPTIONS', origin, requestMethod: 'GET', requestHeaders: ' content-type ,AUTHORIZATION ' }),
        req({ method: 'OPTIONS', origin, requestMethod: 'POST' }),
        req({ method: 'OPTIONS', origin, requestMethod: 'POST', requestHeaders: 'authorization,content-type' }),
      ]) {
        expect(corsHeaders(r, ALLOWED), JSON.stringify(r)).toStrictEqual(preflightCredentialed(origin));
      }
    }
    for (const r of [
      req({ method: 'OPTIONS', origin: OTHER, requestMethod: 'GET', requestHeaders: 'authorization' }),
      req({ method: 'OPTIONS', origin: OTHER, requestMethod: 'POST' }),
      req({ method: 'OPTIONS', origin: OTHER, requestMethod: 'POST', requestHeaders: 'authorization, content-type' }),
      req({ method: 'OPTIONS', origin: '*', requestMethod: 'POST' }),
      req({ method: 'OPTIONS', origin: ALLOWED[0], requestMethod: 'POST' }),
    ]) {
      expect(corsHeaders(r, r.origin === ALLOWED[0] ? [] : ALLOWED), JSON.stringify(r)).toStrictEqual({});
    }
  });

  it('FR-286 (policy) `authorization` is matched as a whole header name, not as a part of another', () => {
    const r = req({ method: 'OPTIONS', origin: OTHER, requestMethod: 'GET', requestHeaders: 'x-authorization-hint, authorizationx' });
    expect(corsHeaders(r, ALLOWED)).toStrictEqual(PREFLIGHT_READ);
  });

  it('FR-286 (policy) no reply ever carries Allow-Credentials, and `*` never comes with Authorization', () => {
    const origins = [undefined, OTHER, 'null', '*', ...ALLOWED];
    const methods = ['GET', 'POST', 'OPTIONS'] as const;
    for (const origin of origins) {
      for (const method of methods) {
        for (const authorization of [false, true]) {
          for (const requestMethod of [undefined, 'GET', 'POST']) {
            for (const requestHeaders of [undefined, 'authorization', 'content-type']) {
              const r: CorsRequest = { method, origin, authorization, requestMethod, requestHeaders };
              const headers = corsHeaders(r, ALLOWED);
              const label = JSON.stringify(r);
              expect(Object.keys(headers).map((h) => h.toLowerCase()), label).not.toContain('access-control-allow-credentials');
              const credentialed = method === 'OPTIONS' ? requestMethod === 'POST' || requestHeaders === 'authorization' : authorization || method !== 'GET';
              if (credentialed) expect(headers['access-control-allow-origin'], label).not.toBe('*');
              // Every reply that echoes an origin also says it varies by origin.
              if (headers['access-control-allow-origin'] !== undefined && headers['access-control-allow-origin'] !== '*') expect(headers.vary, label).toBe('Origin');
              // Header names are lower case (the platform writes them as given).
              for (const name of Object.keys(headers)) expect(name, label).toBe(name.toLowerCase());
            }
          }
        }
      }
    }
  });
});
