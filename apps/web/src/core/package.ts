// Map package reading and checks (FR-132, FR-133). Pure: texts and bytes come in, the inflate step is injected.
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import type { IdImageError, PresentationError, Result, ValidationError } from '@mbrg/shared';
import { decodeIdPng } from './png';
import type { Inflate, InvalidPng } from './png';
import { fillTemplate, STRINGS } from './strings';

/** The three artifacts of a package. */
export type Artifact = 'map' | 'presentation' | 'image';

/** Viewer-internal read errors (English identifiers, listed in the language test). */
export type ReadError =
  | InvalidPng
  | { kind: 'invalid-json'; artifact: 'map' | 'presentation' }
  | { kind: 'read-failed'; artifact: Artifact };

/** Any error that stops the viewer before drawing (FR-133). */
export type PackageError = ValidationError | PresentationError | IdImageError;

export interface PackageData {
  /** Parsed JSON, still unchecked: `checkPackage` must pass before it is used. */
  map: unknown;
  presentation: unknown;
  width: number;
  height: number;
  values: Uint32Array;
}

export interface PackageFiles {
  map: string;
  presentation: string;
  image: Uint8Array;
}

function parseJson(text: string, artifact: 'map' | 'presentation'): Result<unknown, ReadError> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, errors: [{ kind: 'invalid-json', artifact }] };
  }
}

/** Decodes the three artifacts. The first one that cannot be read or decoded is the only error. */
export async function parsePackage(files: PackageFiles, inflate: Inflate): Promise<Result<PackageData, ReadError>> {
  const map = parseJson(files.map, 'map');
  if (!map.ok) return map;
  const presentation = parseJson(files.presentation, 'presentation');
  if (!presentation.ok) return presentation;
  const image = await decodeIdPng(files.image, inflate);
  if (!image.ok) return image;
  return {
    ok: true,
    value: { map: map.value, presentation: presentation.value, ...image.value },
  };
}

/**
 * Map validation, then the presentation check, then the id image check (FR-133).
 * An invalid map is reported alone (the other two checks start from a valid map);
 * otherwise the presentation errors come first and the image errors after them.
 */
export function checkPackage(
  map: unknown,
  presentation: unknown,
  width: number,
  height: number,
  values: ArrayLike<number>,
): PackageError[] {
  const m = validateMap(map);
  if (!m.ok) return m.errors;
  const errors: PackageError[] = [];
  const p = checkPresentation(map, presentation);
  if (!p.ok) errors.push(...p.errors);
  const i = checkIdImage(map, width, height, values);
  if (!i.ok) errors.push(...i.errors);
  return errors;
}

/** The Spanish message of FR-133: how many errors and the kind of the first one. */
export function packageErrorMessage(errors: readonly { kind: string }[]): string {
  return fillTemplate(STRINGS.packageErrors, { count: errors.length, kind: errors[0]?.kind ?? '' });
}
