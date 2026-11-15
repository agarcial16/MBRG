/**
 * The committed dev map package for tests. Viewer tests have no Node types (plan section 0), so the
 * files arrive through Vite imports: JSON as raw text, the PNG as an inlined base64 data URL.
 */
import type { MapData, PresentationData } from '@mbrg/shared';
import devMapText from '../../../../maps/dev/map.json?raw';
import devPresentationText from '../../../../maps/dev/presentation.json?raw';
import devPngDataUrl from '../../../../maps/dev/ids.png?inline';

export const DEV_MAP_TEXT: string = devMapText;
export const DEV_PRESENTATION_TEXT: string = devPresentationText;
export const DEV_MAP = JSON.parse(devMapText) as MapData;
export const DEV_PRESENTATION = JSON.parse(devPresentationText) as PresentationData;

/** Bytes of the committed `maps/dev/ids.png`. */
export function devPngBytes(): Uint8Array {
  const base64 = devPngDataUrl.slice(devPngDataUrl.indexOf(',') + 1);
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
