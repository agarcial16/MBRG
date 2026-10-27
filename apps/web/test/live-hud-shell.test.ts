// The DOM shell of the match screen HUD (spec 010): source scans of `ui/live-panel.ts` and its stylesheet. The shell is thin: the
// pure modules decide what to show (hud-layout, hud-tokens, live-hud); these checks keep the shell and the style rules honest.
import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/core/hud-layout';
import { PANEL_CSS as css } from '../src/ui/live-panel-style';
import shell from '../src/ui/live-panel.ts?raw';
import main from '../src/ui/live-main.ts?raw';
import startShell from '../src/ui/live-start.ts?raw';
import terraShell from '../src/ui/live-terra.ts?raw';
import entryShell from '../src/ui/entry.ts?raw';
import { readFileSync } from 'node:fs';
import { codeOnly, languageViolations } from './helpers/scan';
import hudTokens from '../src/core/hud-tokens.ts?raw';
import hudLayout from '../src/core/hud-layout.ts?raw';
import liveHud from '../src/core/live-hud.ts?raw';
import panelStyle from '../src/ui/live-panel-style.ts?raw';

const code = codeOnly(shell.replace(/\/\/.*$/gm, ''));
const rules = (selector: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.includes(selector)).map((m) => m[2]!);

describe('FR-356 FR-357 the shell places the zones the layout module names', () => {
  it('FR-356 every zone of both layouts is created by the shell, tagged with its name', () => {
    const wanted = new Set([...ZONES.desk, ...ZONES.phone]);
    for (const zone of wanted) expect(shell, zone).toContain(`'${zone}'`);
  });

  it('FR-357 the layout is chosen by the pure module and written on the root; the stylesheet follows it and has no width media query', () => {
    expect(code).toMatch(/layoutFor\(/);
    expect(shell).toMatch(/dataset\.layout\s*=/);
    expect(css).toContain('[data-layout="phone"]');
    expect(css).not.toMatch(/@media[^{]*(?:min|max)-width/);
  });

  it('FR-357 the dock has the three tabs of the layout module and they are real tabs (roles and selection)', () => {
    expect(shell).toMatch(/DOCK_TABS/);
    expect(shell).toMatch(/role['"]?\s*,\s*['"]tab['"]/);
    expect(shell).toMatch(/aria-selected/);
  });
});

describe('FR-357 the dock folds', () => {
  it('FR-357 the dock starts folded: a folded dock hides the legend, the title and the stage line, and keeps the victim line and the controls', () => {
    expect(shell).toMatch(/dataset\.dock\s*=\s*['"]folded['"]/);
    const folded = rules('[data-dock="folded"]').join(';');
    expect(folded).toMatch(/display:\s*none/);
    expect(css).toMatch(/\[data-dock="folded"\][^{]*\.hud-left/);
    expect(css).toMatch(/\[data-dock="folded"\][^{]*\.hud-stage/);
    expect(css).toMatch(/\[data-dock="folded"\][^{]*\.hud-track/);
    expect(css).toMatch(/\[data-dock="folded"\][^{]*\.hud-secondary/);
    expect(css).not.toMatch(/\[data-dock="folded"\][^{]*\.hud-nav/);
    expect(css).not.toMatch(/\[data-dock="folded"\][^{]*\.hud-victim/);
  });

  it('FR-357 a tab opens the dock; the selected tab folds it again (the second click)', () => {
    expect(shell).toMatch(/dataset\.dock\s*=\s*open\s*\?/);
    expect(shell).toMatch(/id\s*===\s*current\s*&&\s*open/);
  });
});

describe('FR-367 the stylesheet uses the tokens only', () => {
  it('FR-367 no colour literal in the stylesheet except black shadows: every colour is a --hud-* variable', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const m of css.matchAll(/rgba?\([^)]*\)/g)) expect(m[0], m[0]).toMatch(/^rgba\(0, 0, 0, /);
    expect(css).toMatch(/var\(--hud-wood\)/);
    expect(css).toMatch(/var\(--hud-gilt\)/);
  });

  it('FR-367 the shell writes the token variables once, from the tokens module', () => {
    expect(shell).toMatch(/cssVariables\(\)/);
  });
});

describe('NFR-66 touch, keyboard and live regions', () => {
  it('NFR-66 in the phone layout buttons and rows are at least 44 px and the tabs 50 px', () => {
    const button = rules('[data-layout="phone"] .hud-btn').join(';');
    expect(button).toMatch(/min-height:\s*44px/);
    expect(button).toMatch(/min-width:\s*44px/);
    expect(rules('[data-layout="phone"] .hud-legend li').join(';')).toMatch(/min-height:\s*44px/);
    expect(rules('.hud-tab{').join(';') + rules('.hud-tab ').join(';')).toMatch(/min-height:\s*50px/);
  });

  it('NFR-66 every control shows a visible keyboard focus', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/);
  });

  it('NFR-66 exactly one polite live region (the state card); the countdown is never announced every second', () => {
    expect(shell.match(/aria-live/g)).toHaveLength(1);
    expect(shell).toMatch(/aria-live['"]?\s*,\s*['"]polite['"]/);
    expect(shell).toMatch(/role['"]?\s*,\s*['"]status['"]/);
  });
});

describe('NFR-67 NFR-68 motion and cost', () => {
  it('NFR-67 with reduced motion the stylesheet switches every animation and transition off', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*animation:\s*none !important/);
    expect(css).toMatch(/transition:\s*none !important/);
  });

  it('NFR-68 the shell has no timer and no frame callback of its own: it draws when told (an event or the once-per-second refresh)', () => {
    for (const banned of ['requestAnimationFrame', 'setInterval', 'setTimeout', 'ResizeObserver']) expect(code, banned).not.toContain(banned);
    expect(shell).toMatch(/addEventListener\(\s*['"]resize['"]/);
  });
});

describe('NFR-70 every visible text of the HUD is in the strings module', () => {
  it('NFR-70 the HUD sources hold no Spanish text and no non-ASCII character: the scan of the language rule finds nothing in them', () => {
    const sources: Record<string, string> = { shell, hudTokens, hudLayout, liveHud, panelStyle };
    for (const [name, src] of Object.entries(sources)) expect(languageViolations(src), name).toStrictEqual([]);
  });

  it('NFR-70 the planted violations are seen: a Spanish text written to the page and a non-ASCII character', () => {
    expect(languageViolations("node.textContent = 'Hola mundo';")).not.toStrictEqual([]);
    expect(languageViolations('const x = 1; // é'.replace('\u00e9', 'é'))).not.toStrictEqual([]);
  });
});

describe('FR-367 the fonts are self-hosted and licensed', () => {
  const files = Object.keys(import.meta.glob('../public/fonts/*', { query: '?url', import: 'default', eager: true })).map((p) => p.replace('../public/fonts/', ''));
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);

  it('FR-367 the stylesheet declares the faces the type scale uses: Cormorant SC (500, 600, 700) and Spectral (400, 500, 600, 400 italic)', () => {
    const families = faces.map((f) => `${/font-family:\s*'([^']+)'/.exec(f)?.[1]} ${/font-weight:\s*(\d+)/.exec(f)?.[1]}${/font-style:\s*italic/.test(f) ? ' italic' : ''}`).sort();
    expect(families).toStrictEqual(['Cormorant SC 500', 'Cormorant SC 600', 'Cormorant SC 700', 'Spectral 400', 'Spectral 400 italic', 'Spectral 500', 'Spectral 600']);
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });

  it('FR-367 every face points to a woff2 file that is in public/fonts, and no face points anywhere else', () => {
    for (const face of faces) {
      const src = /url\('(\/fonts\/[^']+\.woff2)'\)\s*format\('woff2'\)/.exec(face)?.[1];
      expect(src, face).toBeDefined();
      expect(files, src).toContain(src!.replace('/fonts/', ''));
    }
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('FR-367 each family ships its licence text, the SIL Open Font License, next to the files', () => {
    expect(files).toContain('OFL-Cormorant.txt');
    expect(files).toContain('OFL-Spectral.txt');
  });

  it('FR-367 the page loads no font from a network host (no CDN link in the entry page or the sources)', () => {
    expect(shell).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe('FR-359 to FR-364 the shell of the left column, the band, the track and the minimap', () => {
  it('FR-360 the chronicle writes its entries from the strings templates: applied, pending and the wait text of a reveal that has not stopped', () => {
    for (const key of ['hudChronicle', 'hudChronicleApplied', 'hudChroniclePending', 'hudChronicleRevealing']) expect(shell, key).toContain(`STRINGS.${key}`);
    expect(shell).toMatch(/entry\.status\s*===\s*'pending'/);
  });

  it('FR-361 the factions list sorts, searches and caps with the pure functions, shows the three columns and the sort controls', () => {
    for (const fn of ['sortRows', 'searchRows', 'visibleRows']) expect(shell, fn).toContain(`${fn}(`);
    for (const key of ['hudColTerritories', 'hudColKills', 'hudColConquered', 'hudSortTerritories', 'hudSortKills', 'hudSortConquered', 'hudSearch', 'hudShowAll', 'hudShowLess', 'hudAliveOf']) {
      expect(shell, key).toContain(`STRINGS.${key}`);
    }
    expect(shell).toMatch(/type\s*=\s*'search'/);
    expect(shell).toMatch(/aria-pressed/);
  });

  it('FR-361 a fallen faction says when it fell, or only that it is eliminated when the record is not held', () => {
    expect(shell).toContain('STRINGS.hudFell');
    expect(shell).toContain('STRINGS.hudFellUnknown');
    expect(shell).toContain('STRINGS.hudUnknown');
  });

  it('FR-362 asking for the bajas or conquered column, or focusing the search, asks for the archive; the live scene sends it to the runner', () => {
    expect(shell).toMatch(/handlers\.onArchive\(\)/);
    expect(main).toMatch(/onArchive:\s*\(\)\s*=>\s*runner\?\.requestArchive\(\)/);
  });

  it('FR-363 the band shows the replay text and sends the way back to the runner; the live mark sits in the top bar', () => {
    expect(shell).toMatch(/hud\.band/);
    expect(shell).toMatch(/handlers\.onNavigate\(bandTarget\)/);
    expect(shell).toMatch(/bandTarget\s*=\s*band\.target/);
    expect(shell).toMatch(/hud\.live/);
  });

  it('FR-364 the track is dots that jump to their round, or a slider that does, both through the navigation of the runner', () => {
    expect(shell).toMatch(/trackTarget\(/);
    expect(shell).toContain('STRINGS.hudTrackRound');
    expect(shell).toMatch(/type\s*=\s*'range'/);
    expect(shell).toMatch(/onNavigate\(\{\s*to:/);
  });

  it('FR-359 the scene draws the minimap from the owners and moves the camera by the pure functions, and redraws it on every round change and camera change', () => {
    for (const fn of ['minimapPixels', 'cameraAtPoint', 'viewRect', 'minimapSize']) expect(main, fn).toContain(`${fn}(`);
    expect(main).toMatch(/drawMinimap\(/);
    expect(main.match(/drawMinimap\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(shell).toContain('STRINGS.hudMinimap');
    expect(shell).toContain('STRINGS.hudMinimapHint');
  });
});

describe('FR-368 terra incognita: the asset and the layer', () => {
  const file = readFileSync(new URL('../public/terra.webp', import.meta.url));

  it('FR-368 the texture is one WebP tile of at most 150 KB, in public/', () => {
    expect(file.length).toBeGreaterThan(10_000);
    expect(file.length).toBeLessThanOrEqual(150_000);
    expect(file.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(file.subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  it('FR-368 the layer is made of the bands of the pure module, above the map canvas and below the labels, and never takes the pointer', () => {
    expect(terraShell).toMatch(/terraBands\(/);
    expect(terraShell).toMatch(/terraOffset\(/);
    expect(terraShell).toMatch(/pointerEvents\s*=\s*'none'/);
    expect(terraShell).toContain('TERRA_TILE');
    expect(main).toMatch(/createTerra\(/);
    expect(main).toMatch(/terra\??\.place\(/);
    expect(main.match(/terra\??\.place\(/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('FR-368 the layer places itself again only when the camera or the viewport changed, so a frame with the same view costs nothing', () => {
    expect(terraShell).toMatch(/camera\.x\s*===\s*last\.x/);
    expect(terraShell).toMatch(/return;/);
  });
});

describe('FR-366 the single entry page', () => {
  it('FR-366 the entry gives the page a start screen action, and the start screen is built from the pure address function', () => {
    expect(entryShell).toMatch(/start:\s*/);
    expect(startShell).toMatch(/matchAddress\(/);
    expect(startShell).toMatch(/type\s*=\s*'text'/);
    expect(startShell).toMatch(/addEventListener\(\s*'submit'/);
    expect(startShell).toMatch(/form\.method\s*=\s*'get'/);
    expect(startShell).toMatch(/input\.name\s*=\s*'match'/);
    expect(startShell).toMatch(/input\.value\s*=\s*address\.id/);
    expect(startShell).toContain('STRINGS.startTitle');
    expect(startShell).toContain('STRINGS.startCode');
    expect(startShell).toContain('STRINGS.startEnter');
    expect(startShell).toContain('STRINGS.startInvalid');
  });

  it('FR-366 the debug scene and the test client are reachable from the start screen only in a development build', () => {
    expect(startShell).toMatch(/import\.meta\.env\.DEV/);
    expect(startShell).toContain('STRINGS.debugTitle');
    expect(startShell).toContain('STRINGS.clientTitle');
    const gate = startShell.indexOf('import.meta.env.DEV');
    expect(startShell.indexOf('client.html')).toBeGreaterThan(gate);
    expect(startShell.indexOf('seed=')).toBeGreaterThan(gate);
  });
});

describe('FR-356 the zones of the desk layout do not overlap', () => {
  const px = (rule: string, property: string): number => {
    const found = new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`).exec(rule);
    if (found === null) throw new Error(`${property} not found`);
    return Number(found[1]);
  };

  it('FR-356 the command panel stops before the minimap: its right margin is at least the width and margin of the minimap, with a gap', () => {
    const mini = rules('.hud-mini').find((r) => /width:\s*\d+px/.test(r) && /right:\s*\d+px/.test(r));
    const command = rules('.hud-command').find((r) => /right:\s*\d+px/.test(r));
    expect(mini).toBeDefined();
    expect(command).toBeDefined();
    // The width of the minimap includes its padding, so the sum below is what it takes on screen.
    expect(rules('.hud-mini').join(';')).toMatch(/box-sizing:\s*border-box/);
    expect(px(command!, 'right')).toBeGreaterThanOrEqual(px(mini!, 'right') + px(mini!, 'width') + 8);
  });

  it('FR-356 the top bar puts its texts on one baseline, the countdown is in the middle and the factions alive are not repeated there', () => {
    expect(rules('.hud-top').join(';')).toMatch(/align-items:\s*baseline/);
    const count = rules('.hud-top .hud-count').join(';');
    expect(count).toMatch(/position:\s*absolute/);
    expect(count).toMatch(/left:\s*50%/);
    expect(shell).not.toContain('hud-alive');
    expect(css).not.toContain('hud-alive');
  });
});

describe('FR-359 the minimap zooms the map', () => {
  it('FR-359 the wheel over the minimap asks the page for a zoom, and the page does not scroll', () => {
    expect(shell).toMatch(/miniBox\.addEventListener\(\s*'wheel'/);
    expect(shell).toMatch(/onMinimapZoom\(/);
    expect(shell).toMatch(/wheelSteps\(/);
    expect(shell).toMatch(/passive:\s*false/);
    expect(main).toMatch(/onMinimapZoom:/);
  });
});

describe('FR-359 the minimap dims only itself', () => {
  it('FR-359 the box that holds the view rectangle clips its shadow: the 999 px shadow of the rectangle must not dim the screen', () => {
    expect(css).toMatch(/\.hud-minirect\s*\{[^}]*box-shadow:\s*0 0 0 999px/);
    expect(rules('.hud-minibox').join(';')).toMatch(/overflow:\s*hidden/);
  });
});
