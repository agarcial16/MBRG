// The replies the platform would write itself (spec 008 NFR-52 network; plan 18.4b): a header block over the limit (431), a
// request that took too long (408) and any request the parser refuses (400). They carry the fixed headers of every reply
// (`Content-Type`, `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`) and `Connection: close`,
// but no CORS headers (the request was not read, so no origin is known). Their statuses are outside the C1 table, which
// maps the closed error kinds; the body is the closed kind `invalid-request` with no items and no detail of the error.

import { encodeError, errorReply } from '@mbrg/protocol';

/** What the handler needs of a socket (structural, so no `node:net` import). */
export interface ClientErrorSocket {
  readonly writable: boolean;
  readonly bytesWritten: number;
  end(text: string): unknown;
  destroy(): unknown;
}

const REASONS: Readonly<Record<number, string>> = Object.freeze({ 400: 'Bad Request', 408: 'Request Timeout', 431: 'Request Header Fields Too Large' });

/** The status of a platform error code: header overflow 431, request timeout 408, every other refusal 400. */
export function clientErrorStatus(code: unknown): 400 | 408 | 431 {
  if (code === 'HPE_HEADER_OVERFLOW') return 431;
  if (code === 'ERR_HTTP_REQUEST_TIMEOUT') return 408;
  return 400;
}

/**
 * The `clientError` handler: answers once on a socket nothing was written to; a socket already written to (or not writable)
 * is only closed, as the platform's own handler does.
 */
export function answerClientError(error: Error, socket: ClientErrorSocket): void {
  if (!socket.writable || socket.bytesWritten > 0) {
    socket.destroy();
    return;
  }
  const status = clientErrorStatus((error as { code?: unknown }).code);
  const body = encodeError(errorReply('invalid-request'));
  socket.end(
    `HTTP/1.1 ${status} ${REASONS[status]}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Cache-Control: no-store\r\n' +
      'X-Content-Type-Options: nosniff\r\n' +
      'Connection: close\r\n\r\n' +
      body,
  );
}
