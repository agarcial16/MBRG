// Writes the replies (spec 008 FR-301 status table, FR-286 headers, FR-299 `Retry-After`; plan 18.2 stage 7 and 8, 18.4).
// Every reply, errors included, carries `Content-Type: application/json`, `Content-Length`, `Cache-Control: no-store` and
// `X-Content-Type-Options: nosniff`, plus the CORS headers `cors.ts` decides for the request. An error reply gets its status
// from `status.ts` and its extra header (`Retry-After`, `Allow`, `Connection: close`) from `errorHeaders`. The preflight
// is the only reply without a body (204). A `HEAD` request cannot reach a route (405), and Node sends no body for it anyway.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { encodeError } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import { corsHeaders } from './cors';
import type { CorsRequest } from './cors';
import { SUCCESS_STATUS, UNEXPECTED_REPLY, UNEXPECTED_STATUS, errorHeaders, statusOf } from './status';

/** What the reply writer needs to know about the request. */
export interface ReplyTarget {
  readonly res: ServerResponse;
  readonly cors: CorsRequest;
  readonly allowedOrigins: readonly string[];
  /** True when the connection must close after this reply (a request body over the limit is still unread). */
  readonly closeAfter?: () => boolean;
}

const closeHeader = (target: ReplyTarget): Readonly<Record<string, string>> => (target.closeAfter?.() === true ? { connection: 'close' } : {});

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** The CORS view of a request: the method, the `Origin`, whether `Authorization` is present, the preflight request headers. */
export function corsRequestOf(req: IncomingMessage): CorsRequest {
  return {
    method: req.method ?? 'GET',
    origin: header(req, 'origin'),
    authorization: req.headersDistinct.authorization !== undefined,
    requestMethod: header(req, 'access-control-request-method'),
    requestHeaders: header(req, 'access-control-request-headers'),
  };
}

const BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

function write(target: ReplyTarget, status: number, body: string | undefined, extra: Readonly<Record<string, string>>): void {
  const { res } = target;
  const headers: Record<string, string | number> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (body !== undefined) {
    Object.assign(headers, BASE_HEADERS);
    headers['content-length'] = Buffer.byteLength(body, 'utf8');
  }
  Object.assign(headers, closeHeader(target), extra, corsHeaders(target.cors, target.allowedOrigins));
  res.writeHead(status, headers);
  res.end(body);
}

/** A success: 200 or 201 with the encoded body. */
export function sendSuccess(target: ReplyTarget, status: 200 | 201, body: string): void {
  write(target, status, body, {});
}

/** The 200 headers of an event stream (FR-286, plan 19.2): the stream type, no caching, no sniffing, the CORS headers of a read; no length. */
export function streamHeaders(target: ReplyTarget): Record<string, string> {
  return { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...corsHeaders(target.cors, target.allowedOrigins) };
}

/** A map file: 200 with its bytes exactly as read, `Content-Length` their count, the content type of the file (the other headers as every reply). */
export function sendFile(target: ReplyTarget, contentType: string, body: Uint8Array): void {
  const headers: Record<string, string | number> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-type': contentType,
    'content-length': body.length,
    ...closeHeader(target),
    ...corsHeaders(target.cors, target.allowedOrigins),
  };
  target.res.writeHead(200, headers);
  target.res.end(body);
}

/** An error reply: the status of its kind, its extra header, the encoded body. `allow` is the router's list for a 405. */
export function sendError(target: ReplyTarget, reply: ErrorReply, allow?: readonly string[]): void {
  write(target, statusOf(reply.kind), encodeError(reply), errorHeaders(reply, allow));
}

/** The preflight of a known path: 204, no body; the permission headers are the CORS decision. */
export function sendPreflight(target: ReplyTarget): void {
  write(target, SUCCESS_STATUS.preflight, undefined, {});
}

/**
 * An exception nobody expected: 500 with the body `{"kind":"unavailable"}` and nothing else (no message, no name). A response
 * already started cannot be replaced: it is ended, and nothing is written twice.
 */
export function sendUnexpected(target: ReplyTarget): void {
  const { res } = target;
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded) res.end();
    return;
  }
  write(target, UNEXPECTED_STATUS, encodeError(UNEXPECTED_REPLY), { connection: 'close' });
}
