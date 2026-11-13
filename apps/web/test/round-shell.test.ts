// The shells of the round banner, the overlays, the camera return, the pinch and the outline (spec 013 part C): thin source scans.
// The decisions are in round-banner, round-overlay, camera-return, pinch, pick-outline and tour (tested in Node).
import { describe, expect, it } from 'vitest';
import { PANEL_CSS as css } from '../src/ui/live-panel-style';
import panel from '../src/ui/live-panel.ts?raw';
import liveMain from '../src/ui/live-main.ts?raw';
import mapView from '../src/ui/map-view.ts?raw';
import { languageViolations } from './helpers/scan';

const code = (src: string): string => src.replace(/\/\/.*$/gm, '');
const main = code(liveMain);
const panelCode = code(panel);

describe('FR-408 FR-409 the banner and the overlay in the panel', () => {
  it('NFR-77 the panel writes only strings of the strings module', () => {
    expect(languageViolations(panel)).toStrictEqual([]);
    expect(panelCode).toMatch(/STRINGS\.bannerClose/);
  });

  it('FR-408 the banner is one real button (tap, Enter and Space dismiss it) over a dimmed map; the fade follows the view', () => {
    expect(panelCode).toMatch(/button\(bannerBox, '', handlers\.onBannerDismiss/);
    expect(panelCode).toMatch(/bannerBox\.dataset\.fade/);
    expect(css).toMatch(/\.hud-banner \{[^}]*rgba\(0, 0, 0, 0\.45\)/);
    expect(css).toMatch(/\.hud-banner\[data-fade="on"\] \{ animation:/);
    expect(css).not.toMatch(/\.hud-banner \{[^}]*animation/);
  });

  it('FR-409 the overlay is a status line that takes no pointer events', () => {
    expect(panelCode).toMatch(/overlayBox\.setAttribute\('role', 'status'\)/);
    expect(css).toMatch(/\.hud-overlay \{[^}]*pointer-events: none/);
  });

  it('NFR-66 the banner and overlay use tokens only, and the reduced-motion rule still cancels animations', () => {
    const added = css.slice(css.indexOf('/* round banner (FR-408)'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(added.length).toBeGreaterThan(200);
    expect(added.replace(/rgba\(0, 0, 0, 0\.45\)/, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.hud \*, \.hud-error \* \{ animation: none !important/);
  });
});

describe('FR-412 the pinch on the minimap', () => {
  it('FR-412 two touches on the minimap send the ratio of their distances and do not move the camera to a point', () => {
    expect(panelCode).toMatch(/pinchDistance\(/);
    expect(panelCode).toMatch(/touches\.size !== 2/);
    expect(panelCode).toMatch(/handlers\.onMinimapPinch\(after \/ before\)/);
    expect(panelCode).toMatch(/pointercancel/);
  });
});

describe('FR-410 the live scene and the camera of the user', () => {
  it('FR-410 every camera the user asks for goes through one function that marks it moved', () => {
    const outside = main.replace(/const userMoved = [\s\S]*?\n {2}\};\n/, '');
    expect(main).toMatch(/watch = movedByUser\(watch\)/);
    // Only the reset button and the return to the default view (FR-410) touch it elsewhere.
    expect(outside.match(/\.userCamera\(/g)).toHaveLength(2);
    expect(main).toMatch(/watch = watchStart/);
    expect(main).toMatch(/setCamera: \(next\) => userMoved\(next\)/);
  });

  it('FR-410 the camera returns when the absorber tour or a step without a tour ends, never after the victim tour', () => {
    expect(main).toMatch(/status\.runEnded && status\.tour === 'absorber'\) settleCamera\(\)/);
    expect(main).toMatch(/forward && outcome\.change === 'step'\) settleCamera\(\)/);
    expect(main).toMatch(/cameraReturn\(watch,/);
  });

  it('FR-410 a camera in the address counts as the user\'s', () => {
    expect(main).toMatch(/address\.camera !== undefined\) watch = movedByUser\(watch\)/);
  });
});

describe('FR-411 NFR-79 the pace and the outline in the scene', () => {
  it('FR-411 both tour requests are bell paced only when a player is present', () => {
    expect(main.match(/pacedFor\(/g)).toHaveLength(2);
    expect(main).toMatch(/player !== undefined\)/);
  });

  it('the outline follows the sent choice and the map view hands it to the scene', () => {
    expect(main).toMatch(/pickedOf\(play\?\.predict\?\.choices\)/);
    expect(main).toMatch(/view\.setPick\(/);
    expect(code(mapView)).toMatch(/mapScene\.setPick\(faction\)/);
  });

  it('FR-409 the overlay is computed from the model and the reveal state only', () => {
    expect(main).toMatch(/overlayOf\(model, shown\.revealing\)/);
  });
});
