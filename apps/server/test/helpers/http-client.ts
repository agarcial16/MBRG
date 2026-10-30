import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';

// A real-socket client for the HTTP tests (no mocking, no `fetch`): one connection per request, so no keep-alive socket
// outlives a test. `raw` writes bytes to a plain TCP socket for the cases a client library would not send (a declared
// length with no body, a chunked body cut short, a header block over the limit).

export interface ClientReply {
  readonly status: number;
  /** Lower-case names. */
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
  /** The body parsed as JSON (throws on a body that is not JSON). */
  json(): unknown;
}

export interface ClientRequest {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | readonly string[]>>;
  /** An object is sent as JSON; a string or Buffer as is. */
  readonly body?: unknown;
}

export function request(port: number, req: ClientRequest): Promise<ClientReply> {
  const payload = req.body === undefined ? undefined : typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
  return new Promise<ClientReply>((resolve, reject) => {
    const headers: Record<string, string | readonly string[] | number> = { connection: 'close', ...(req.headers ?? {}) };
    if (payload !== undefined && headers['content-length'] === undefined) headers['content-length'] = Buffer.byteLength(payload);
    const call = httpRequest({ host: '127.0.0.1', port, method: req.method ?? 'GET', path: req.path, headers: headers as never, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) as unknown });
      });
      res.on('error', reject);
    });
    call.on('error', reject);
    call.end(payload);
  });
}

/** A JSON POST with an optional bearer token. */
export const postJson = (port: number, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

/** What a raw exchange saw: the bytes the server wrote and how the connection ended. */
export interface RawReply {
  readonly raw: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Whether the server closed the connection by itself. */
  readonly closed: boolean;
}

const parseRaw = (raw: string, closed: boolean): RawReply => {
  const split = raw.indexOf('\r\n\r\n');
  const head = split < 0 ? raw : raw.slice(0, split);
  const lines = head.split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { raw, status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? '')?.[1] ?? 0), headers, body: split < 0 ? '' : raw.slice(split + 4), closed };
};

/**
 * Writes the parts in order to a TCP socket and collects the reply until the server closes the connection (or `waitMs` has
 * passed, then the socket is destroyed). A reset after bytes were received is not an error: a server that answers 413 and
 * closes while the client still writes may reset the connection.
 */
export function raw(port: number, parts: readonly (string | Buffer)[], waitMs = 3000): Promise<RawReply> {
  return new Promise<RawReply>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    let closed = false;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(parseRaw(Buffer.concat(chunks).toString('latin1'), closed));
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('close', () => {
      closed = true;
      finish();
    });
    socket.on('error', (error) => {
      if (chunks.length > 0) finish();
      else if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.on('connect', () => {
      for (const part of parts) socket.write(part);
    });
  });
}

/** A request head: the request line, the headers and the blank line. */
export const head = (method: string, path: string, headers: Readonly<Record<string, string>> = {}): string =>
  `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('')}\r\n`;
