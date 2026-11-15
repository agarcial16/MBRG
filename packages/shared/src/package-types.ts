import type { FactionId, TerritoryId } from './types';

/** FR-92: the two lists of the presentation data. */
export type PresentationList = 'factions' | 'territories';

/** FR-85 */
export interface FactionPresentation {
  id: FactionId;
  name: string;
  color?: string;
}

/** FR-86 */
export interface TerritoryPresentation {
  id: TerritoryId;
  name: string;
}

/** FR-84 */
export interface PresentationData {
  factions: FactionPresentation[];
  territories: TerritoryPresentation[];
}

/** FR-106: the three 8-bit channels of a pixel value. */
export type Rgb = [r: number, g: number, b: number];

/** FR-108: unordered pair of distinct non-zero values, stored with a < b. */
export type ContactPair = [a: number, b: number];

/** FR-109: decoded id image (Definitions: pixel values in row-major order). */
export interface IdImage {
  width: number;
  height: number;
  pixels: ArrayLike<number>;
}
