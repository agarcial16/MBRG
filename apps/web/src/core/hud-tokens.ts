// The visual tokens of the match screen (spec 010 FR-367): one table, the single source of every colour of the HUD. The
// stylesheet reads them as CSS variables (`cssVariables`); `PAIRS` lists the text and control pairs the screen really uses so a
// test can check the contrast rule (NFR-65). Faction colours are data and live elsewhere (`colors.ts`).

export const TOKENS = {
  umber: '#17110d',
  wood: '#241b14',
  wood2: '#31261b',
  gilt: '#c0994f',
  giltDim: '#8a6f3b',
  vellum: '#eadfc3',
  ink: '#2a2118',
  inkMuted: '#5f5238',
  wax: '#9a2e24',
  onWax: '#f4dcb0',
  onGilt: '#1d1508',
  verdigris: '#6aa88a',
  text: '#efe6d0',
  muted: '#a99d84',
  ember: '#f0a089',
} as const;

export type TokenName = keyof typeof TOKENS;

/** A pair of tokens that sit on each other on the screen. `large` is text of 24 px or more; `outline` is a control outline. */
export interface TokenPair {
  readonly name: string;
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly large?: true;
  readonly outline?: true;
}

export const PAIRS: readonly TokenPair[] = [
  { name: 'body text', fg: 'text', bg: 'wood' },
  { name: 'body text on a raised control', fg: 'text', bg: 'wood2' },
  { name: 'muted text', fg: 'muted', bg: 'wood' },
  { name: 'muted text on a raised control', fg: 'muted', bg: 'wood2' },
  { name: 'accent text', fg: 'gilt', bg: 'wood' },
  { name: 'live lamp', fg: 'verdigris', bg: 'wood' },
  { name: 'primary button', fg: 'onGilt', bg: 'gilt' },
  { name: 'wax seal', fg: 'onWax', bg: 'wax' },
  { name: 'vellum text', fg: 'ink', bg: 'vellum' },
  { name: 'vellum muted text', fg: 'inkMuted', bg: 'vellum' },
  { name: 'timer warning', fg: 'ember', bg: 'umber', large: true },
  { name: 'frame outline', fg: 'giltDim', bg: 'wood', outline: true },
];

const channel = (hex: string, from: number): number => {
  const v = parseInt(hex.slice(from, from + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = (hex: string): number => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

/** The WCAG contrast ratio of two #rrggbb colours (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The tokens as one `:root` rule of CSS variables, `--hud-<kebab-case name>`. */
export function cssVariables(): string {
  const lines = Object.entries(TOKENS).map(([name, value]) => `--hud-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value};`);
  return `:root{${lines.join('')}}`;
}
