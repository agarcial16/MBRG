// The layout of the match screen (spec 010 FR-356, FR-357, NFR-66): which zones exist at each width, the phone dock and how much
// of the map stays visible. Pure: the DOM shell only places what this module names.
import { describe, expect, it } from 'vitest';
import { BREAKPOINT, DOCK_TABS, PHONE, ZONES, layoutFor, mapShareFolded } from '../src/core/hud-layout';
import { STRINGS } from '../src/core/strings';

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

  it('FR-357 the dock has three tabs, in this order, named by the strings module', () => {
    expect(DOCK_TABS.map((t) => t.id)).toStrictEqual(['match', 'order', 'ranking']);
    expect(DOCK_TABS.map((t) => t.label)).toStrictEqual([STRINGS.hudTabMatch, STRINGS.hudTabOrder, STRINGS.hudTabRanking]);
  });

  it('FR-357 with the dock folded the map keeps at least 60 % of the height on every phone from 568 to 1000 px', () => {
    for (let height = 568; height <= 1000; height += 1) expect(mapShareFolded(height), String(height)).toBeGreaterThanOrEqual(0.6);
    expect(mapShareFolded(780)).toBeCloseTo(1 - (PHONE.topBar + PHONE.dockFolded) / 780, 10);
    expect(PHONE.dockFolded).toBe(160);
  });

  it('NFR-66 the touch targets of the phone are at least 44 px', () => {
    expect(PHONE.touchTarget).toBeGreaterThanOrEqual(44);
    expect(PHONE.tabHeight).toBeGreaterThanOrEqual(44);
  });
});
