import type { Result } from '@mbrg/shared';

/** FR-105: a PNG file that fails the id image file rules. Carries no data. */
export type PngError = { kind: 'invalid-png' };

/** The PNG seam of the builder: bytes <-> raw RGB, never anything else. */
export interface PngCodec {
  encode(width: number, height: number, rgb: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): Result<{ width: number; height: number; rgb: Uint8Array }, PngError>;
}
