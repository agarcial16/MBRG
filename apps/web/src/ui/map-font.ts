// The font of the names drawn on the map (spec 013 FR-437): Noto Sans 600, bundled in public/fonts (SIL Open Font
// License, OFL-NotoSans.txt), so a name has the same glyph shapes and advances on every device. The face is declared
// here, not in the HUD stylesheet, so the debug scene loads it too; `ensureMapFont` resolves once the file is in, and
// the page measures and draws names only after that. `fontEpoch` moves whenever the set of loaded fonts may have
// changed; the view hands it to the label layer, which then drops its cache of measured advances.

/** Latin and latin-ext subsets of Noto Sans weight 600 (Google Fonts v42 files); latin covers Spanish. */
export const MAP_FONT_CSS = `@font-face { font-family: 'Noto Sans'; font-weight: 600; font-style: normal; font-display: block; src: url('/fonts/noto-sans-600-latin-ext.woff2') format('woff2'); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: 'Noto Sans'; font-weight: 600; font-style: normal; font-display: block; src: url('/fonts/noto-sans-600-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
`;

/** A sample character of each subset: loading it fetches the file whose unicode-range covers it. */
const SAMPLES = ['Aa', '\u0100\u0141'] as const;

/** What the loader needs of the page, so tests can pass a fake. */
export interface FontHost {
  fonts: { load(font: string, text: string): Promise<unknown>; addEventListener(type: string, listener: () => void): void };
  /** Adds a stylesheet to the page. */
  addStyle(css: string): void;
}

let epoch = 0;
const styled = new WeakSet<FontHost>();

/** Increases whenever fonts finished loading: caches of measured text depend on it. */
export function fontEpoch(): number {
  return epoch;
}

/** Marks that measured text may be stale. */
export function bumpFontEpoch(): void {
  epoch++;
}

function pageHost(): FontHost {
  return {
    fonts: document.fonts,
    addStyle(css) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    },
  };
}

/**
 * Declares the font face (once per page) and resolves when both subsets are loaded or loading failed (the names
 * then use the generic fallback family; the epoch moves, also when the font arrives later). No timer: the
 * browser's own network limits end a stalled download.
 */
export function ensureMapFont(host: FontHost = pageHost()): Promise<void> {
  if (!styled.has(host)) {
    styled.add(host);
    host.addStyle(MAP_FONT_CSS);
    host.fonts.addEventListener('loadingdone', bumpFontEpoch);
  }
  const font = '600 16px "Noto Sans"';
  const loading = Promise.all(SAMPLES.map((text) => host.fonts.load(font, text))).then(
    () => undefined,
    () => undefined,
  );
  return loading.then(bumpFontEpoch);
}
