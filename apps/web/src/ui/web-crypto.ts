// The platform digest function of the live viewer (D30): the ONLY module that names the platform `crypto`. It hashes the bytes of
// the map files and the text of a state (FR-308, FR-303). It fails closed: with no digest function (an insecure origin has no
// `crypto.subtle`) nothing is hashed and the caller shows `insecure-origin` before any request.

/** The part of the platform object this module uses; a test passes its own. */
export interface DigestPlatform {
  readonly subtle?: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
}

/** True when the platform can hash. */
export function digestAvailable(platform: DigestPlatform | undefined = globalThis.crypto): boolean {
  return typeof platform?.subtle?.digest === 'function';
}

/** The SHA-256 of exactly the bytes of `bytes`, as lower case hex. Rejects when there is no digest function. */
export async function sha256Hex(bytes: Uint8Array, platform: DigestPlatform | undefined = globalThis.crypto): Promise<string> {
  if (!digestAvailable(platform)) throw new Error('no digest function');
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const hash = new Uint8Array(await (platform as Required<DigestPlatform>).subtle.digest('SHA-256', view));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}
