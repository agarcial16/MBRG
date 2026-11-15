// Graphics capability check (FR-135). Pure: the browser facts come in as plain numbers.
import { fillTemplate, STRINGS } from './strings';

export interface Capabilities {
  webgl2: boolean;
  maxTextureSize: number;
}

/** Viewer-internal error kinds (English identifiers, listed in the language test). */
export type CapabilityError =
  | { kind: 'no-webgl2' }
  | { kind: 'texture-too-small'; maxTextureSize: number; required: number };

/**
 * No WebGL 2 context, or a maximum texture size below the id image width or height or below the
 * owner table size (entries + 1), means the map cannot be drawn.
 */
export function checkCapabilities(
  caps: Capabilities,
  width: number,
  height: number,
  tableSize: number,
): CapabilityError[] {
  if (!caps.webgl2) return [{ kind: 'no-webgl2' }];
  const required = Math.max(width, height, tableSize);
  if (caps.maxTextureSize < required) return [{ kind: 'texture-too-small', maxTextureSize: caps.maxTextureSize, required }];
  return [];
}

/** The Spanish message of FR-135, naming the missing capability. */
export function capabilityMessage(error: CapabilityError): string {
  if (error.kind === 'no-webgl2') return STRINGS.noWebgl2;
  return fillTemplate(STRINGS.textureTooSmall, { size: error.maxTextureSize, required: error.required });
}
