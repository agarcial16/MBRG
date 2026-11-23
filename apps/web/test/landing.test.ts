// Tests for spec 030 (start menu landing): pasted match & spectator link routing, deterministic
// static atlas rotation (single-map and multi-map interleaving, storage fallback), Logo 1 SVG
// geometry, landing strings, and stylesheet/shell invariants.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS_PLATES, VISIT_STORAGE_KEY, atlasCaption, hashVisitKey, interleaveByMap, nextVisitIndex, selectAtlasPlate, type AtlasPlate } from '../src/core/landing-atlas';
import { LOGO_CROWN, LOGO_REGIONS, LOGO_VIEWBOX } from '../src/core/brand-logo';
import { matchAddress } from '../src/core/start-screen';
import { chooseScene } from '../src/core/live-address';
import { STRINGS } from '../src/core/strings';
import { LANDING_CSS } from '../src/ui/landing-style';
import landingStyleSource from '../src/ui/landing-style.ts?raw';
import brandLogoSvg from '../src/ui/brand-logo-svg.ts?raw';
import startShell from '../src/ui/live-start.ts?raw';
import { codeOnly, languageViolations } from './helpers/scan';

const ID = 'AbCdEfGh01234567';

function memoryStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => void data.set(key, value),
    removeItem: (key: string): void => void data.delete(key),
  };
}

describe('FR-612 pasted match and spectator link routing', () => {
  it('FR-612 a spectator link keeps spectate=1 and routes to the spectator viewer flow', () => {
    for (const text of [
      `https://mbrg.example/?match=${ID}&spectate=1`,
      `https://mbrg.example/viewer/?match=${ID}&round=3&x=10&y=20&zoom=1.5&spectate=1`,
      `?match=${ID}&spectate=1`,
      `  match=${ID}&spectate=1  `,
      `https://mbrg.example/?spectate=1&match=${ID}#ignored`,
    ]) {
      expect(matchAddress(text), text).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}&spectate=1`, spectate: true });
    }
  });

  it('FR-612 non-1 or repeated spectate values stay a regular match address (same rule as chooseScene)', () => {
    for (const extra of ['&spectate=0', '&spectate=', '&spectate=true', '&spectate=1&spectate=1']) {
      const parsed = matchAddress(`https://mbrg.example/?match=${ID}${extra}`);
      expect(parsed, extra).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
      if (!parsed.ok) throw new Error('expected ok');
      expect(chooseScene(parsed.search, false)).toStrictEqual({ kind: 'live', matchId: ID });
    }
  });

  it('FR-612 a routed spectator address is accepted by chooseScene as a spectator live scene in both builds', () => {
    const parsed = matchAddress(`https://mbrg.example/?match=${ID}&spectate=1`);
    if (!parsed.ok) throw new Error('expected ok');
    for (const dev of [true, false]) {
      expect(chooseScene(parsed.search, dev)).toStrictEqual({ kind: 'live', matchId: ID, spectate: true });
    }
  });
});

describe('FR-614 FR-615 deterministic static atlas catalog and per-visit rotation', () => {
  it('FR-614 the built-in catalog contains static mid-round plates for the dev map with .webp assets', () => {
    expect(ATLAS_PLATES.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(ATLAS_PLATES.map((p) => p.id));
    expect(ids.size).toBe(ATLAS_PLATES.length);
    for (const plate of ATLAS_PLATES) {
      expect(plate.mapId).toBe('dev');
      expect(plate.round).toBeGreaterThanOrEqual(1);
      expect(plate.assetUrl).toMatch(/^\/atlas\/[a-z0-9-]+\.webp$/);
      expect(plate.mapLabel).toBe(STRINGS.landingMapDev);
      expect(atlasCaption(plate)).toContain(STRINGS.landingMapDev);
      expect(atlasCaption(plate)).toContain(String(plate.round));
      const bytes = readFileSync(new URL(`../public${plate.assetUrl}`, import.meta.url));
      expect(bytes.length, plate.assetUrl).toBeGreaterThan(5_000);
      expect(bytes.length, plate.assetUrl).toBeLessThanOrEqual(200_000);
      expect(bytes.subarray(0, 4).toString('latin1'), plate.assetUrl).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1'), plate.assetUrl).toBe('WEBP');
    }
  });

  it('FR-615 selectAtlasPlate is deterministic and rotates through every plate without consecutive repeats', () => {
    const n = ATLAS_PLATES.length;
    const firstPass = Array.from({ length: n }, (_, i) => selectAtlasPlate(i).id);
    const secondPass = Array.from({ length: n }, (_, i) => selectAtlasPlate(i + n).id);
    expect(new Set(firstPass).size).toBe(n);
    expect(secondPass).toStrictEqual(firstPass);
    for (let i = 1; i < firstPass.length; i++) {
      expect(firstPass[i]).not.toBe(firstPass[i - 1]);
    }
    // Negative and non-finite inputs normalize safely and deterministically.
    expect(selectAtlasPlate(-1)).toStrictEqual(selectAtlasPlate(n - 1));
    expect(selectAtlasPlate(Number.NaN)).toStrictEqual(selectAtlasPlate(0));
  });

  it('FR-614 FR-615 multi-map catalogs interleave distinct mapIds across consecutive visits and filter by mapId when asked', () => {
    const multi: readonly AtlasPlate[] = [
      { id: 'dev-1', mapId: 'dev', mapLabel: 'Dev', round: 1, assetUrl: '/atlas/dev-1.webp' },
      { id: 'dev-2', mapId: 'dev', mapLabel: 'Dev', round: 2, assetUrl: '/atlas/dev-2.webp' },
      { id: 'spain-1', mapId: 'spain', mapLabel: 'Spain', round: 14, assetUrl: '/atlas/spain-1.webp' },
      { id: 'spain-2', mapId: 'spain', mapLabel: 'Spain', round: 28, assetUrl: '/atlas/spain-2.webp' },
      { id: 'world-1', mapId: 'world', mapLabel: 'World', round: 40, assetUrl: '/atlas/world-1.webp' },
    ];
    expect(interleaveByMap(multi).map((p) => p.id)).toStrictEqual(['dev-1', 'spain-1', 'world-1', 'dev-2', 'spain-2']);
    expect(selectAtlasPlate(0, multi).mapId).toBe('dev');
    expect(selectAtlasPlate(1, multi).mapId).toBe('spain');
    expect(selectAtlasPlate(2, multi).mapId).toBe('world');
    expect(selectAtlasPlate(0, multi, 'spain').id).toBe('spain-1');
    expect(selectAtlasPlate(1, multi, 'spain').id).toBe('spain-2');
    // Unknown mapId falls back to the full catalog instead of throwing.
    expect(selectAtlasPlate(0, multi, 'unknown').id).toBe('dev-1');
  });

  it('FR-615 nextVisitIndex advances deterministically in storage and falls back to 0 when storage is missing, corrupt or throws', () => {
    const store = memoryStorage();
    expect(nextVisitIndex(store)).toBe(0);
    expect(nextVisitIndex(store)).toBe(1);
    expect(nextVisitIndex(store)).toBe(2);
    expect(store.getItem(VISIT_STORAGE_KEY)).toBe('2');

    expect(nextVisitIndex(memoryStorage({ [VISIT_STORAGE_KEY]: 'not-a-number' }))).toBe(0);
    expect(nextVisitIndex(memoryStorage({ [VISIT_STORAGE_KEY]: '-5' }))).toBe(0);
    expect(nextVisitIndex(undefined)).toBe(0);

    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(nextVisitIndex(throwing)).toBe(0);
  });

  it('FR-615 hashVisitKey is deterministic and produces non-negative 32-bit integers', () => {
    const a = hashVisitKey('visit-alpha');
    const b = hashVisitKey('visit-beta');
    expect(a).toBe(hashVisitKey('visit-alpha'));
    expect(a).not.toBe(b);
    expect(Number.isInteger(a) && a >= 0).toBe(true);
    expect(Number.isInteger(b) && b >= 0).toBe(true);
  });
});

describe('FR-611 Logo 1 inline SVG geometry', () => {
  it('FR-611 Logo 1 defines the crown and muted polygonal regions on a clean viewBox', () => {
    expect(LOGO_VIEWBOX).toBe('0 0 64 72');
    expect(LOGO_REGIONS.length).toBeGreaterThanOrEqual(5);
    expect(LOGO_CROWN.diamonds).toHaveLength(3);
    for (const region of LOGO_REGIONS) {
      expect(region.points.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
      expect(region.fill).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('FR-611 FR-613 FR-616 NFR-140 NFR-141 landing strings, stylesheet and shell', () => {
  it('NFR-140 every spec 030 landing string is non-empty Spanish copy in STRINGS', () => {
    const keys = [
      'landingKicker',
      'landingBrand',
      'landingSubtitle',
      'landingPitch',
      'landingInputPlaceholder',
      'landingInputHint',
      'landingCreateToggle',
      'landingCreateClose',
      'landingAtlasTag',
      'landingAtlasCaption',
      'landingMapDev',
    ] as const;
    for (const key of keys) {
      expect(STRINGS[key].trim().length, key).toBeGreaterThan(0);
    }
    expect(STRINGS.landingBrand).toBe('FactionFall');
    expect(STRINGS.landingSubtitle).toBe('MAP BATTLE ROYALE');
    expect(STRINGS.landingInputPlaceholder.toLowerCase()).toContain('espectador');
  });

  it('NFR-141 FR-616 the landing stylesheet uses only --hud-* tokens, data-layout (no width media queries), 44 px phone targets and reduced motion', () => {
    expect(LANDING_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const m of LANDING_CSS.matchAll(/rgba?\([^)]*\)/g)) {
      expect(m[0], m[0]).toMatch(/^rgba\(0, 0, 0, /);
    }
    expect(LANDING_CSS).not.toMatch(/@media[^{]*(?:min|max)-width/);
    expect(LANDING_CSS).toContain('[data-layout="desk"]');
    expect(LANDING_CSS).toContain('[data-layout="phone"]');
    expect(LANDING_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(LANDING_CSS).not.toMatch(/outline:\s*(?:none|0)\b/);
    expect(languageViolations(landingStyleSource)).toStrictEqual([]);
  });

  it('FR-611 FR-612 FR-613 FR-615 the landing shell wires the inline SVG logo, spectator hidden input, deterministic atlas rotation and create drawer', () => {
    expect(brandLogoSvg).toContain('createElementNS');
    expect(startShell).toContain('buildBrandLogo(');
    expect(startShell).toContain('selectAtlasPlate(');
    expect(startShell).toContain('nextVisitIndex(');
    expect(startShell).toContain('spectate');
    expect(startShell).toContain('STRINGS.landingPitch');
    expect(startShell).toContain('STRINGS.landingInputPlaceholder');
    expect(startShell).toContain('STRINGS.landingCreateToggle');
    expect(startShell).toContain('STRINGS.landingAtlasTag');
    expect(startShell).toContain('mountCreate(');
    expect(codeOnly(startShell)).not.toMatch(/\bMath\s*\.\s*random\b/);
    expect(languageViolations(startShell)).toStrictEqual([]);
  });
});
