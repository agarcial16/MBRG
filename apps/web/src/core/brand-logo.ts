// Logo 1 vector geometry (spec 030 FR-611): a faceted map divided into muted regions topped by a golden crown.
// Pure data: the landing shell turns these polygons into a crisp inline SVG with createElementNS.

export const LOGO_VIEWBOX = '0 0 64 72';

export interface LogoRegion {
  readonly id: string;
  readonly points: string;
  readonly fill: string;
}

export interface LogoCrown {
  readonly bodyLeft: string;
  readonly bodyRight: string;
  readonly band: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx: number };
  readonly diamonds: readonly string[];
}

/** Three-peaked gilt crown with faceted shading and three diamond finials. */
export const LOGO_CROWN: LogoCrown = {
  bodyLeft: '17,27 14,13 24,20 32,9 32,27',
  bodyRight: '32,9 40,20 50,13 47,27 32,27',
  band: { x: 17, y: 28.5, width: 30, height: 3.5, rx: 1 },
  diamonds: [
    '14,7.5 16.2,9.7 14,11.9 11.8,9.7',
    '32,2.5 34.4,4.9 32,7.3 29.6,4.9',
    '50,7.5 52.2,9.7 50,11.9 47.8,9.7',
  ],
};

/** Muted dark-friendly polygonal regions separated by crisp borders, plus a small detached island. */
export const LOGO_REGIONS: readonly LogoRegion[] = [
  { id: 'nw', points: '12,37 29,34 31,44 23,49 9,46', fill: '#b84c4a' },
  { id: 'ne', points: '32,34 49,35 54,45 45,50 34,44', fill: '#d19e45' },
  { id: 'sw', points: '9,49 22,52 26,64 17,67 7,58', fill: '#8265a8' },
  { id: 'ce', points: '25,51 33,46 45,52 54,53 51,64 35,66 29,63', fill: '#5b9651' },
  { id: 'so', points: '20,68 28,65 38,67 42,71 27,71', fill: '#489389' },
  { id: 'island', points: '56,57 60,56 61,61 57,63', fill: '#c48653' },
];
