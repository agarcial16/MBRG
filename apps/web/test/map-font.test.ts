import { describe, expect, it } from 'vitest';
import { LABEL_PARAMS, fontString } from '../src/core/label-params';
import { MAP_FONT_CSS, ensureMapFont, fontEpoch, type FontHost } from '../src/ui/map-font';

const host = (load: (font: string, text: string) => Promise<unknown>): { host: FontHost; styles: string[] } => {
  const styles: string[] = [];
  return { styles, host: { fonts: { load, addEventListener: () => undefined }, addStyle: (css) => styles.push(css) } };
};

describe('FR-437 the map names use the bundled Noto Sans only', () => {
  it('FR-437 the name font is Noto Sans 600 with a generic fallback and no system family', () => {
    expect(LABEL_PARAMS.font.weight).toBe(600);
    expect(LABEL_PARAMS.font.families).toStrictEqual(['"Noto Sans"', 'sans-serif']);
    expect(fontString(20)).toBe('600 20px "Noto Sans", sans-serif');
  });

  it('FR-437 the font face declares the latin and latin-ext woff2 files of weight 600', () => {
    expect(MAP_FONT_CSS).toContain("font-family: 'Noto Sans'");
    expect(MAP_FONT_CSS).toContain('/fonts/noto-sans-600-latin.woff2');
    expect(MAP_FONT_CSS).toContain('/fonts/noto-sans-600-latin-ext.woff2');
    expect(MAP_FONT_CSS.match(/@font-face/g)).toHaveLength(2);
    expect(MAP_FONT_CSS.match(/unicode-range/g)).toHaveLength(2);
  });

  it('FR-437 ensureMapFont adds the style once and resolves only after both subsets are loaded', async () => {
    const loaded: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = host(async (font, text) => {
      await gate;
      loaded.push(`${font}|${text}`);
    });
    let done = false;
    const p = ensureMapFont(h.host).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
    expect(loaded).toHaveLength(2);
    for (const l of loaded) expect(l.startsWith('600 16px "Noto Sans"|')).toBe(true);
    await ensureMapFont(h.host);
    expect(h.styles).toStrictEqual([MAP_FONT_CSS]);
  });

  it('FR-437 a font that fails to load does not block the page, and the epoch moves when it settles', async () => {
    const before = fontEpoch();
    const failing = host(() => Promise.reject(new Error('no font')));
    await expect(ensureMapFont(failing.host)).resolves.toBeUndefined();
    expect(fontEpoch()).toBeGreaterThan(before);
  });
});
