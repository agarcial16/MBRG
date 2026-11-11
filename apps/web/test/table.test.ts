// The dark table (spec 015): the pure parameters and geometry of the background and the edge fade, and the rules of the stylesheet that
// use them. Pixels were checked in the browser (specs/015-visual-refresh/screens); here the numbers and the rules that must not drift.
import { describe, expect, it } from 'vitest';
import { mapToScreen, type Camera, type ImageSize, type Viewport } from '../src/core/camera';
import { contrastRatio, TOKENS } from '../src/core/hud-tokens';
import { PALETTE, SEA } from '../src/core/theme';
import { TABLE, fadeAlpha, fadeDepth, overBackdrop, pageCss, panelColour, tableFade, vignetteDepth, vignetteShadow } from '../src/core/table';
import { PANEL_CSS as css } from '../src/ui/live-panel-style';
import terraShell from '../src/ui/live-terra.ts?raw';
import index from '../index.html?raw';

const image: ImageSize = { w: 2048, h: 2048 };
const rule = (selector: string): string => {
  const lines = css.split('\n').filter((l) => l.startsWith(`${selector} {`));
  expect(lines.length, selector).toBeGreaterThan(0);
  return lines.join('\n');
};
const hex = (c: readonly number[]): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

describe('FR-422 the ground is dark wood, not parchment', () => {
  it('FR-422 the wood tones are dark: the centre lighter than the edge, and the flat ground between them', () => {
    expect(contrastRatio(TABLE.centre, TABLE.edge)).toBeGreaterThan(1.05);
    for (const tone of [TABLE.ground, TABLE.centre, TABLE.edge]) expect(contrastRatio(tone, '#000000'), tone).toBeLessThan(1.5);
    expect(TABLE.vignette).toBeGreaterThan(0);
    expect(TABLE.vignette).toBeLessThanOrEqual(0.6);
  });

  it('FR-422 the layer paints the bands with the ground tone and no longer with the parchment tile', () => {
    expect(terraShell).toContain('TABLE.ground');
    expect(terraShell).not.toContain('terra.webp');
    expect(terraShell).not.toContain('backgroundImage');
  });
});

describe('FR-423 the edge of the map fades into the ground at every zoom', () => {
  const viewport: Viewport = { width: 1280, height: 720 };

  it('FR-423 the fade starts on the ground tone exactly (opaque at the edge, so no join shows) and eases to nothing', () => {
    for (let i = 1; i <= 100; i++) expect(fadeAlpha(i / 100)).toBeLessThanOrEqual(fadeAlpha((i - 1) / 100));
    expect(fadeAlpha(0)).toBe(1);
    expect(fadeAlpha(1)).toBe(0);
    expect(fadeAlpha(-3)).toBe(1);
    expect(fadeAlpha(7)).toBe(0);
    expect(fadeAlpha(0.5)).toBeCloseTo(0.5, 10);
    // the whole image inside the screen: all four edges fade
    const camera: Camera = { x: 1024, y: 1024, scale: 0.2 };
    const fade = tableFade(camera, viewport, image)!;
    const depth = fadeDepth(viewport);
    const [r, g, b] = [0x15, 0x10, 0x0c];
    expect(TABLE.ground).toBe('#15100c');
    expect(fade.background).toContain(`rgba(${r},${g},${b},1) 0px`);
    expect(fade.background).toContain(`rgba(${r},${g},${b},0) ${depth}px`);
    for (const direction of ['to bottom', 'to top', 'to right', 'to left']) expect(fade.background).toContain(`linear-gradient(${direction},`);
  });

  it('FR-423 a map that has left the screen has no fade', () => {
    expect(tableFade({ x: -5000, y: 1024, scale: 1 }, viewport, image)).toBeUndefined();
    expect(tableFade({ x: 9000, y: 1024, scale: 1 }, viewport, image)).toBeUndefined();
  });

  it('FR-423 the fade rectangle is the image on screen when it fits, so its soft edge is the image edge', () => {
    const camera: Camera = { x: 1024, y: 1024, scale: 0.2 };
    const fade = tableFade(camera, viewport, image)!;
    const a = mapToScreen(camera, { x: 0, y: 0 }, viewport);
    const b = mapToScreen(camera, { x: image.w, y: image.h }, viewport);
    expect(fade.rect.x).toBeCloseTo(a.sx, 6);
    expect(fade.rect.x + fade.rect.w).toBeCloseTo(b.sx, 6);
  });

  it('FR-423 the depth is at most 5 % of the shorter side of the viewport and 48 px (amended 2026-11-11)', () => {
    expect(TABLE.fade.depth).toBe(48);
    expect(TABLE.fadeShare).toBe(0.05);
    expect(fadeDepth({ width: 390, height: 844 })).toBeCloseTo(19.5, 6);
    expect(fadeDepth({ width: 360, height: 640 })).toBeCloseTo(18, 6);
    expect(fadeDepth({ width: 1280, height: 720 })).toBeCloseTo(36, 6);
    expect(fadeDepth({ width: 3840, height: 2160 })).toBe(48);
    expect(fadeDepth({ width: 0, height: 700 })).toBe(0);
    for (const [width, height] of [[390, 844], [360, 640], [1280, 720], [1920, 1080], [2560, 1440], [844, 390]] as const) {
      const depth = fadeDepth({ width, height });
      expect(depth, `${width}x${height}`).toBeLessThanOrEqual(Math.min(width, height) * 0.05 + 0.01);
      expect(depth, `${width}x${height}`).toBeLessThanOrEqual(48);
    }
  });

  it('FR-423 an image edge at or beyond the edge of the screen is not faded: the map the player looks at stays bright', () => {
    const phone: Viewport = { width: 390, height: 844 };
    // the image spans the whole width (scale = width / image.w) and sits lower than the top: only top and bottom edges are inside the screen
    const cam: Camera = { x: 1024, y: 1024, scale: 390 / 2048 };
    const fade = tableFade(cam, phone, image)!;
    expect(fade.edges).toStrictEqual({ left: false, right: false, top: true, bottom: true });
    expect(fade.background).toContain('linear-gradient(to bottom,');
    expect(fade.background).toContain('linear-gradient(to top,');
    expect(fade.background).not.toContain('linear-gradient(to right,');
    expect(fade.background).not.toContain('linear-gradient(to left,');
    // an edge exactly on the screen edge counts as at the edge
    expect(tableFade({ x: 1024, y: 1024, scale: 390 / 2048 }, { width: 390, height: 390 }, image)).toBeUndefined();
    // zoomed in so far that every edge is off screen there is nothing to draw at all
    expect(tableFade({ x: 1024, y: 1024, scale: 8 }, phone, image)).toBeUndefined();
    // one edge in, the others beyond
    const left = tableFade({ x: 1500, y: 1024, scale: 1 }, { width: 1280, height: 720 }, image)!;
    expect(left.edges).toStrictEqual({ left: false, right: true, top: false, bottom: false });
  });

  it('FR-423 over 200 cameras the fade covers no pixel the map does not and no edge that is not strictly inside the screen', () => {
    let s = 7;
    const next = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const vp of [viewport, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
      for (let i = 0; i < 200; i++) {
        const camera: Camera = { x: next() * 2048, y: next() * 2048, scale: 0.1 + next() * 6 };
        const fade = tableFade(camera, vp, image);
        const a = mapToScreen(camera, { x: 0, y: 0 }, vp);
        const b = mapToScreen(camera, { x: image.w, y: image.h }, vp);
        const onScreen = b.sx > 0 && b.sy > 0 && a.sx < vp.width && a.sy < vp.height;
        if (fade === undefined) {
          if (onScreen) expect(a.sx > 0 || b.sx < vp.width || a.sy > 0 || b.sy < vp.height).toBe(false);
          continue;
        }
        expect(onScreen).toBe(true);
        expect(fade.rect.x).toBeGreaterThanOrEqual(a.sx - 1e-6);
        expect(fade.rect.y).toBeGreaterThanOrEqual(a.sy - 1e-6);
        expect(fade.rect.x + fade.rect.w).toBeLessThanOrEqual(b.sx + 1e-6);
        expect(fade.rect.y + fade.rect.h).toBeLessThanOrEqual(b.sy + 1e-6);
        expect(fade.edges).toStrictEqual({ left: a.sx > 0, right: b.sx < vp.width, top: a.sy > 0, bottom: b.sy < vp.height });
      }
    }
  });

  it('FR-423 the vignette over the match shrinks with the screen, so a phone keeps its sides bright and the desk is unchanged', () => {
    expect(vignetteDepth({ width: 1280, height: 720 })).toBe(180);
    expect(vignetteDepth({ width: 3840, height: 2160 })).toBe(180);
    expect(vignetteDepth({ width: 390, height: 844 })).toBeLessThanOrEqual(55);
    expect(vignetteDepth({ width: 360, height: 640 })).toBeLessThan(vignetteDepth({ width: 390, height: 844 }) + 1);
    expect(vignetteDepth({ width: 0, height: 0 })).toBe(0);
    expect(vignetteShadow({ width: 390, height: 844 })).toBe(`inset 0 0 ${vignetteDepth({ width: 390, height: 844 })}px rgba(0, 0, 0, ${TABLE.vignette})`);
    expect(terraShell).toMatch(/vignetteShadow\(viewport\)/);
  });

  it('NFR-85 the fade is placed with the bands, behind the same unchanged-view guard, and the pointer still passes through the layer', () => {
    expect(terraShell).toMatch(/tableFade\(/);
    expect(terraShell).toMatch(/pointerEvents\s*=\s*'none'/);
    expect(terraShell).toMatch(/camera\.x\s*===\s*last\.x/);
  });
});

describe('FR-425 the desk panels are translucent wood with a blur; the phone dock is opaque and keeps its frame', () => {
  it('FR-425 desk frames use the panel colour and a backdrop blur', () => {
    const line = rule('.hud[data-layout="desk"] .hud-frame');
    expect(line).toContain('background: var(--hud-panel)');
    expect(pageCss()).toContain(`--hud-panel: ${panelColour()}`);
    expect(line).toContain(`backdrop-filter: blur(${TABLE.panel.blur}px)`);
    expect(TABLE.panel.alpha).toBeGreaterThanOrEqual(0.7);
    expect(TABLE.panel.alpha).toBeLessThan(1);
  });

  it('FR-425 the phone dock is opaque (no blur) and the frame lines (inset and outline) stay on every frame', () => {
    const dock = rule('.hud[data-layout="phone"] .hud-mini');
    // the dock, the top bar and the minimap share one rule
    expect(css).toContain('.hud[data-layout="phone"] .hud-dock,\n.hud[data-layout="phone"] .hud-top,');
    expect(dock).toContain('background: var(--hud-dock)');
    expect(dock).toContain('backdrop-filter: none');
    const frame = rule('.hud-frame');
    expect(frame).toContain('box-shadow: inset 0 0 0 1px var(--hud-gilt-dim)');
    expect(frame).toContain('outline: 1px solid var(--hud-gilt-dim)');
  });

  it('NFR-84 text, muted text and gilt text keep 4.5:1 on the translucent panel over the brightest things it can cover', () => {
    const backdrops = ['#ffffff', hex(SEA), '#bdb8aa', ...PALETTE.map(hex)];
    for (const backdrop of backdrops) {
      const ground = overBackdrop(backdrop);
      for (const fg of ['text', 'muted', 'gilt'] as const) expect(contrastRatio(TOKENS[fg], ground), `${fg} over ${backdrop}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('NFR-84 the seal text (gilt) on the opaque dock and on the page wood keeps 4.5:1', () => {
    for (const ground of [TOKENS.dock, TABLE.ground, TABLE.centre, TABLE.edge]) expect(contrastRatio(TOKENS.gilt, ground), ground).toBeGreaterThanOrEqual(4.5);
    for (const ground of [TOKENS.dock, TABLE.centre]) expect(contrastRatio(TOKENS.text, ground), ground).toBeGreaterThanOrEqual(4.5);
  });
});

describe('FR-426 the seals are a gilt outline on the wood, with no red fill', () => {
  it('FR-426 the player chip and the sent seal have no background colour, a gilt outline and gilt text', () => {
    for (const selector of ['.hud-playerchip', '.hud-seal']) {
      const line = rule(selector);
      expect(line, selector).toContain('background: none');
      expect(line, selector).toContain('color: var(--hud-gilt)');
      expect(line, selector).toContain('box-shadow: inset 0 0 0 1px var(--hud-gilt)');
      expect(line, selector).not.toContain('wax');
    }
    expect(css).not.toContain('--hud-wax');
    expect(Object.keys(TOKENS)).not.toContain('wax');
  });
});

describe('FR-428 the top bar centres its three parts and the countdown', () => {
  it('FR-428 desk: the items are centred in the bar (no baseline, no padding-top) and the countdown sits in the middle of the bar both ways', () => {
    const top = rule('.hud-top');
    expect(top).toContain('align-items: center');
    expect(top).not.toContain('baseline');
    expect(top).not.toContain('padding-top');
    const count = rule('.hud-top .hud-count');
    expect(count).toContain('left: 50%');
    expect(count).toContain('top: 50%');
    expect(count).toContain('translate(-50%, -50%)');
  });

  it('FR-428 the countdown does not take the margin of the lobby count of the same class', () => {
    expect(rule('.hud-top .hud-count')).toContain('margin: 0');
  });

  it('FR-428 phone: three columns with the countdown alone in the middle one, and the round and phase stacked in the first, centred together', () => {
    const top = rule('.hud[data-layout="phone"] .hud-top');
    expect(top).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(top).toContain('align-items: center');
    expect(rule('.hud[data-layout="phone"] .hud-top .hud-count')).toContain('justify-self: center');
  });

  it('FR-428 a long name is cut with an ellipsis before it can reach the countdown (desk: half the bar minus the countdown; phone: its own column)', () => {
    expect(rule('.hud-playerchip')).toContain('max-width: min(46vw, calc(50% - 90px))');
    expect(rule('.hud-chip-name')).toContain('text-overflow: ellipsis');
    expect(rule('.hud[data-layout="phone"] .hud-top .hud-playerchip')).toContain('max-width: 100%');
  });
});

describe('FR-429 the chip is as tall as its text and its touch area is at least 44 px on the phone', () => {
  it('FR-429 the chip has no min-height; its padding is the text plus a little; it is centred in the bar', () => {
    const chip = rule('.hud-playerchip');
    expect(chip).not.toContain('min-height');
    expect(chip).toContain('align-self: center');
    expect(chip).toMatch(/padding: 2px 12px/);
    expect(css).not.toContain('.hud-playerchip { display: inline-flex; gap: 0.35em; align-items: center; margin-left: auto; align-self: center; min-height: 32px');
  });

  it('FR-429 the touch area is an invisible margin around the box: it does not clip (no overflow on the chip) and reaches 44 px on the phone', () => {
    expect(rule('.hud-playerchip')).not.toContain('overflow');
    expect(css).toContain('.hud-playerchip::after { content: \'\'; position: absolute; left: -6px; right: -6px; top: -8px; bottom: -8px; }');
    const lineHeight = 13 * 1.25;
    const phone = css.match(/\.hud\[data-layout="phone"\] \.hud-playerchip::after \{ top: -(\d+)px; bottom: -(\d+)px; \}/);
    expect(phone).not.toBeNull();
    expect(lineHeight + 2 * 2 + Number(phone![1]) + Number(phone![2])).toBeGreaterThanOrEqual(44);
  });
});

describe('FR-431 the start, create, join and lobby screens stand on the same table', () => {
  it('FR-431 the page css puts the wood gradient on the body, the edge tone on the root, and a vignette behind the content', () => {
    const page = pageCss();
    expect(page).toContain(`html { background: ${TABLE.edge}; }`);
    expect(page).toContain(`radial-gradient(ellipse at 50% 38%, ${TABLE.centre} 0%, ${TABLE.edge} 78%)`);
    expect(page).toContain('body::before');
    expect(page).toContain('z-index: -1');
    expect(page).toContain('pointer-events: none');
    expect(css.startsWith(page)).toBe(true);
  });

  it('FR-431 the page no longer carries the flat grey inline: the body has no colour of its own and the root starts on the edge tone', () => {
    expect(index).not.toContain('#bdb8aa');
    expect(index).toContain(`<html lang="es" style="background:${TABLE.edge}">`);
  });
});

describe('FR-430 the panel shows exactly the two lines of its frame at the top', () => {
  it('FR-430 the result block has a rule above it only when a prediction block is shown above it', () => {
    expect(rule('.hud-result')).not.toContain('border');
    expect(css).toContain('.hud-predict:not([hidden]) ~ .hud-result { border-top: 1px solid var(--hud-gilt-dim); padding-top: 8px; }');
  });
});
