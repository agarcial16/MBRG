// Loads the committed dev map package from the viewer's own origin (FR-132). The only network code.
// The three files are Vite asset URLs of `maps/dev`: served from the repository in development and
// copied byte-identical into the build. No other address appears in the viewer sources.
import type { Result } from '@mbrg/shared';
import { parsePackage } from '../core/package';
import type { Artifact, PackageData, ReadError } from '../core/package';
import mapUrl from '../../../../maps/dev/map.json?url';
import presentationUrl from '../../../../maps/dev/presentation.json?url';
import imageUrl from '../../../../maps/dev/ids.png?url';

/** The part of `fetch` the loader uses. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Inflates a zlib stream with the platform decompressor (browsers and Node 24 have it). */
export async function inflateStream(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readText(fetchImpl: FetchLike, url: string, artifact: Artifact): Promise<Result<string, ReadError>> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return { ok: false, errors: [{ kind: 'read-failed', artifact }] };
    return { ok: true, value: await response.text() };
  } catch {
    return { ok: false, errors: [{ kind: 'read-failed', artifact }] };
  }
}

async function readBytes(fetchImpl: FetchLike, url: string, artifact: Artifact): Promise<Result<Uint8Array, ReadError>> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return { ok: false, errors: [{ kind: 'read-failed', artifact }] };
    return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { ok: false, errors: [{ kind: 'read-failed', artifact }] };
  }
}

/** Fetches the three files (same origin) and decodes them. The package checks of FR-133 come next. */
export async function loadPackage(fetchImpl: FetchLike = (url) => fetch(url)): Promise<Result<PackageData, ReadError>> {
  const [map, presentation, image] = await Promise.all([
    readText(fetchImpl, mapUrl, 'map'),
    readText(fetchImpl, presentationUrl, 'presentation'),
    readBytes(fetchImpl, imageUrl, 'image'),
  ]);
  if (!map.ok) return map;
  if (!presentation.ok) return presentation;
  if (!image.ok) return image;
  return parsePackage({ map: map.value, presentation: presentation.value, image: image.value }, inflateStream);
}
