// The layout of the match screen (spec 010 FR-356, FR-357, NFR-66): which zones exist at each width, the phone dock and how much
// of the map stays visible. Pure: the DOM shell only places what this module names.
import { describe, expect, it } from 'vitest';
import { BREAKPOINT, DOCK_TABS, PHONE, ZONES, dockHeight, dockPaneHeight, layoutFor, mapShareFolded } from '../src/core/hud-layout';

describe('FR-356 the desktop layout', () => {
  it('FR-356 the layout is desktop from 1024 px and phone below it', () => {
    expect(BREAKPOINT).toBe(1024);
    expect(layoutFor(1024)).toBe('desk');
    expect(layoutFor(1023)).toBe('phone');
    expect(layoutFor(1920)).toBe('desk');
    expect(layoutFor(320)).toBe('phone');
  });

  it('FR-356 the desktop HUD has the five zones, in this order, and the map zone is the whole viewport', () => {
    expect(ZONES.desk).toStrictEqual(['top-bar', 'left-column', 'right-column', 'minimap', 'command-panel']);
  });
});

describe('FR-357 the phone layout', () => {
  it('FR-357 the phone HUD has a top bar, a minimap corner card and a dock', () => {
    expect(ZONES.phone).toStrictEqual(['top-bar', 'minimap', 'dock']);
  });

  it('FR-440 the dock has four tabs, in this order (the labels are pinned in dock.test)', () => {
    expect(DOCK_TABS.map((t) => t.id)).toStrictEqual(['order', 'chronicle', 'factions', 'ranking']);
  });

  it('FR-357 with the dock folded the map keeps at least 60 % of the height on every phone from 568 to 1000 px', () => {
    for (let height = 568; height <= 1000; height += 1) expect(mapShareFolded(height), String(height)).toBeGreaterThanOrEqual(0.6);
    expect(mapShareFolded(780)).toBeCloseTo(1 - (PHONE.topBar + PHONE.dockFolded) / 780, 10);
    expect(PHONE.dockFolded).toBe(72);
  });

  it('NFR-66 the touch targets of the phone are at least 44 px', () => {
    expect(PHONE.touchTarget).toBeGreaterThanOrEqual(44);
    expect(PHONE.tabHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('FR-445 the height of the phone dock', () => {
  it('FR-445 open, it takes at most 40 % of a tall screen and 45 % of a short one', () => {
    expect(dockHeight(844, false)).toBeLessThanOrEqual(340);
    expect(dockHeight(844, false)).toBeLessThanOrEqual(844 * 0.4);
    expect(dockHeight(640, false)).toBeLessThanOrEqual(640 * 0.45);
    expect(dockHeight(932, false)).toBeLessThanOrEqual(932 * 0.4);
    expect(dockHeight(740, false)).toBeLessThanOrEqual(740 * 0.4);
  });

  it('FR-445 folded, it is the slim bar whatever the screen', () => {
    for (const h of [568, 640, 844, 1000]) expect(dockHeight(h, true)).toBe(PHONE.dockFolded);
  });

  it('FR-445 the open dock is the folded bar, the pane and the strip, and the pane keeps room for a prediction', () => {
    for (const h of [568, 640, 700, 844, 1000]) {
      expect(dockHeight(h, false)).toBe(PHONE.dockFolded + dockPaneHeight(h) + PHONE.strip);
      expect(dockPaneHeight(h)).toBeGreaterThanOrEqual(PHONE.paneMin);
    }
    expect(dockPaneHeight(844)).toBe(173);
    expect(dockPaneHeight(640)).toBe(124);
  });

  it('FR-445 the strip holds a selector row (chips of 36 px) and a control row of 44 px targets', () => {
    expect(PHONE.chip).toBeGreaterThanOrEqual(36);
    expect(PHONE.strip).toBeGreaterThanOrEqual(PHONE.chip + PHONE.touchTarget);
  });
});
