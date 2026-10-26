// The bounded request body reader (spec 008 FR-298, FR-296 transport; plan 18.2 stage 3).
// - A body is at most 4,096 bytes. A declared `Content-Length` above it is answered `too-large` BEFORE any body byte is read;
//   a body without a length (chunked) is counted while it arrives and answered as soon as it passes 4,096 (exactly 4,096 is
//   read). Reading stops there: the rest is never buffered.
// - The bytes must be valid UTF-8 (a byte order mark is not skipped, so JSON rejects it), valid JSON, and the value must be
//   an object (not an array, `null`, a number, a text): anything else is `invalid-request` naming the field `body`.
//   The own-property rule and the unknown/missing field rules belong to the protocol readers (stage 4).
// - There is no extra "ASCII only" rule at this stage: every field that reaches the memo digest is checked by the protocol
//   readers (ids, kinds, numbers), which only accept ASCII, before the canonical content is hashed (plan 11, frozen format).

import type { IncomingMessage } from 'node:http';
import { errorReply } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';

export const MAX_BODY_BYTES = 4096;

export type BodyParse = { readonly kind: 'body'; readonly value: Record<string, unknown> } | { readonly kind: 'error'; readonly error: ErrorReply };
/** The result of reading a request body; `aborted` means the client went away (nothing can be answered). */
export type BodyRead = BodyParse | { readonly kind: 'aborted' };

const invalidBody = (): BodyParse => ({ kind: 'error', error: errorReply('invalid-request', ['body']) });

/** UTF-8 decoding that throws on a malformed sequence and keeps a leading byte order mark (JSON then refuses it). */
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The bytes of a body (at most 4,096) as a JSON object, or `invalid-request ['body']`. */
export function parseBodyBytes(bytes: Uint8Array): BodyParse {
  if (bytes.length > MAX_BODY_BYTES) return { kind: 'error', error: errorReply('too-large') };
  if (bytes.length === 0) return invalidBody();
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return invalidBody();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidBody();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidBody();
  return { kind: 'body', value: value as Record<string, unknown> };
}

/** The declared `Content-Length`, or undefined when there is none (the parser of Node refuses a malformed one). */
export function declaredLength(req: IncomingMessage): number | undefined {
  const text = req.headers['content-length'];
  if (typeof text !== 'string' || !/^[0-9]+$/.test(text)) return undefined;
  return Number(text);
}

/** `too-large` when the declared length passes the limit, decided without reading anything; otherwise undefined. */
export function tooLargeByLength(req: IncomingMessage): ErrorReply | undefined {
  const declared = declaredLength(req);
  return declared !== undefined && declared > MAX_BODY_BYTES ? errorReply('too-large') : undefined;
}

/** Whether the request carries a body: a declared length above 0, or a `Transfer-Encoding` (chunked). */
export function carriesBody(req: IncomingMessage): boolean {
  const declared = declaredLength(req);
  return declared === undefined ? req.headers['transfer-encoding'] !== undefined : declared > 0;
}

/**
 * Whether a body over the limit may still be unread: the length declared above 4,096, or a chunked body (its size is unknown)
 * that has not been read to its end. A reply sent in that state must close the connection, so the platform never drains it.
 */
export function unreadLargeBody(req: IncomingMessage): boolean {
  if (req.readableEnded) return false;
  const declared = declaredLength(req);
  return declared === undefined ? req.headers['transfer-encoding'] !== undefined : declared > MAX_BODY_BYTES;
}

type BytesRead = { readonly kind: 'bytes'; readonly bytes: Buffer } | { readonly kind: 'too-large' } | { readonly kind: 'aborted' };

/** Counts the bytes as they arrive; resolves once, at the end, at the limit (the rest is not buffered), or when the client leaves. */
function readBytes(req: IncomingMessage): Promise<BytesRead> {
  return new Promise<BytesRead>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (result: BytesRead): void => {
      if (done) return;
      done = true;
      chunks.length = 0;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (done) return; // keep draining: the reply is on its way and the connection closes after it
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        finish({ kind: 'too-large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ kind: 'bytes', bytes: Buffer.concat(chunks) }));
    req.on('error', () => finish({ kind: 'aborted' }));
    req.on('close', () => finish({ kind: 'aborted' }));
  });
}

/** Reads the body of a route that takes one: at most 4,096 bytes, then UTF-8, JSON, an object. */
export async function readBody(req: IncomingMessage): Promise<BodyRead> {
  const read = await readBytes(req);
  if (read.kind === 'bytes') return parseBodyBytes(read.bytes);
  return read.kind === 'too-large' ? { kind: 'error', error: errorReply('too-large') } : read;
}

/**
 * A route that takes no body: a body over 4,096 bytes is `too-large` all the same (counted, never kept); a small one is read and
 * ignored (the request is answered as if it had none). Only the client leaving is `aborted`.
 */
export async function discardBody(req: IncomingMessage): Promise<{ readonly kind: 'ignored' } | { readonly kind: 'error'; readonly error: ErrorReply } | { readonly kind: 'aborted' }> {
  if (!carriesBody(req)) return { kind: 'ignored' };
  const read = await readBytes(req);
  if (read.kind === 'bytes') return { kind: 'ignored' };
  return read.kind === 'too-large' ? { kind: 'error', error: errorReply('too-large') } : read;
}
