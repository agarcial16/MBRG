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

/** Reads the body, counting bytes as they arrive; resolves once, at the end, at the limit, or when the client leaves. */
export function readBody(req: IncomingMessage): Promise<BodyRead> {
  return new Promise<BodyRead>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (result: BodyRead): void => {
      if (done) return;
      done = true;
      chunks.length = 0;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (done) return; // keep draining: the reply is on its way and the connection closes after it
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        finish({ kind: 'error', error: errorReply('too-large') });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(parseBodyBytes(Buffer.concat(chunks))));
    req.on('error', () => finish({ kind: 'aborted' }));
    req.on('close', () => finish({ kind: 'aborted' }));
  });
}
