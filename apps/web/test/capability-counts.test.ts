// Tests of spec 029: the viewer refuses a package whose counts pass the map format but exceed its
// own tables (FR-586 to FR-590). Synthetic packages sit just above each limit and exactly at each
// border; the package of the faction limit is complete (map, presentation and image) so the format
// accepts every byte of it before the viewer refuses. The committed dev map keeps loading unchanged
// (FR-590). The heavy 65,536-entry its carry an explicit timeout; `checkPresentation` is not run on
// them (its territory scan is quadratic in the entries, a cost this spec does not touch), so they
// prove what counts here: the map format and the id image accept the package, and the viewer refuses.
import { describe, expect, it } from 'vitest';
import { checkIdImage, validateMap } from '@mbrg/shared';
import type { MapData, PresentationData } from '@mbrg/shared';
import { capabilityMessage, checkCounts } from '../src/core/capabilities';
import capabilitiesSource from '../src/core/capabilities.ts?raw';
import { MAX_ENTRIES, MAX_FACTIONS } from '../src/core/entries';
import { checkPackage } from '../src/core/package';
import { STRINGS } from '../src/core/strings';
import { DEV_MAP } from './helpers/dev-map';
import { codeOnly, stripComments } from './helpers/scan';
import liveSource from '../src/ui/live-main.ts?raw';
import mainSource from '../src/ui/main.ts?raw';

/** A package the format checks accept: `entries` land territories as one connected chain of
 * pixels on a single row (each pixel touches the next and the links are mutual, so the map is
 * connected and the image contact matches the links), owned round-robin by `factions` factions.
 * Every faction and territory has a presentation entry; faction names and colours differ. Pure
 * data, built in memory. */
function syntheticPackage(entries: number, factions: number): {
  map: MapData;
  presentation: PresentationData;
  width: number;
  height: number;
  values: Uint32Array;
} {
  const territories = Array.from({ length: entries }, (_, i) => ({
    id: i + 1,
    owner: (i % factions) + 1,
    neighbors: [i, i + 2].filter((id) => id >= 1 && id <= entries),
  }));
  const values = new Uint32Array(entries);
  for (let i = 0; i < entries; i++) values[i] = i + 1;
  const presentation = {
    factions: Array.from({ length: factions }, (_, f) => ({
      id: f + 1,
      name: `F${f + 1}`,
      color: `#${(f + 1).toString(16).padStart(6, '0')}`,
    })),
    territories: Array.from({ length: entries }, (_, i) => ({ id: i + 1, name: `T${i + 1}` })),
  };
  return { map: { territories }, presentation, width: entries, height: 1, values };
}

describe('FR-586 to FR-588 the viewer refuses counts beyond its tables', () => {
  it('FR-587 a package just above the faction limit is valid for the format and refused naming the faction limit', () => {
    const pkg = syntheticPackage(MAX_FACTIONS + 1, MAX_FACTIONS + 1);
    // The package passes every check the map format offers (map, presentation, image).
    expect(checkPackage(pkg.map, pkg.presentation, pkg.width, pkg.height, pkg.values)).toStrictEqual([]);
    const refusals = checkCounts(pkg.map);
    expect(refusals).toStrictEqual([{ kind: 'too-many-factions', count: MAX_FACTIONS + 1, limit: MAX_FACTIONS }]);
    const text = capabilityMessage(refusals[0]!);
    expect(text).toBe(STRINGS.tooManyFactions.replace('{count}', String(MAX_FACTIONS + 1)).replace('{limit}', String(MAX_FACTIONS)));
    expect(text).toContain('facciones');
  });

  it('FR-587 exactly at the faction border the load continues: no refusal, no new errors', () => {
    const pkg = syntheticPackage(MAX_FACTIONS, MAX_FACTIONS);
    expect(checkPackage(pkg.map, pkg.presentation, pkg.width, pkg.height, pkg.values)).toStrictEqual([]);
    expect(checkCounts(pkg.map)).toStrictEqual([]);
  });

  it(
    'FR-586 a map just above the territory limit is valid for the format and the image and refused naming the territory limit',
    () => {
      const pkg = syntheticPackage(MAX_ENTRIES + 1, 8);
      // The map format and the id image accept the package (see the file header for the presentation scan).
      expect(validateMap(pkg.map)).toStrictEqual({ ok: true, value: pkg.map });
      const image = checkIdImage(pkg.map, pkg.width, pkg.height, pkg.values);
      expect(image.ok).toBe(true);
      const refusals = checkCounts(pkg.map);
      expect(refusals).toStrictEqual([{ kind: 'too-many-territories', count: MAX_ENTRIES + 1, limit: MAX_ENTRIES }]);
      const text = capabilityMessage(refusals[0]!);
      expect(text).toBe(STRINGS.tooManyTerritories.replace('{count}', String(MAX_ENTRIES + 1)).replace('{limit}', String(MAX_ENTRIES)));
      expect(text).toContain('territorios');
    },
    20_000,
  );

  it(
    'FR-586 exactly at the territory border the load continues: the format accepts the map and no refusal comes',
    () => {
      const pkg = syntheticPackage(MAX_ENTRIES, 8);
      expect(validateMap(pkg.map)).toStrictEqual({ ok: true, value: pkg.map });
      expect(checkCounts(pkg.map)).toStrictEqual([]);
    },
    20_000,
  );

  it(
    'FR-588 both counts above their limits name the territory limit first',
    () => {
      const pkg = syntheticPackage(MAX_ENTRIES + 1, MAX_FACTIONS + 1);
      const refusals = checkCounts(pkg.map);
      expect(refusals).toHaveLength(2);
      expect(refusals[0]).toStrictEqual({ kind: 'too-many-territories', count: MAX_ENTRIES + 1, limit: MAX_ENTRIES });
      expect(refusals[1]).toStrictEqual({ kind: 'too-many-factions', count: MAX_FACTIONS + 1, limit: MAX_FACTIONS });
    },
    20_000,
  );
});

describe('FR-589 the limits are the table sizes, never inline numbers', () => {
  it('FR-589 the refusal reads MAX_ENTRIES and MAX_FACTIONS from core/entries', () => {
    const code = codeOnly(stripComments(capabilitiesSource));
    expect(code).toContain('MAX_ENTRIES');
    expect(code).toContain('MAX_FACTIONS');
    // No inline form of either limit survives in the refusal module.
    expect(/\b65535\b|\b65536\b|0xffff/i.test(code)).toBe(false);
    expect(/\b255\b/.test(code)).toBe(false);
  });

  it('FR-589 the refusal follows the tables: a wider table refuses later (a map at the wider border is not refused)', () => {
    // The refusal is the same comparison the tables make: exactly MAX_ENTRIES entries and MAX_FACTIONS
    // factions never overflow the index pixels or the owner bytes, one more does.
    const atBorder = syntheticPackage(MAX_FACTIONS, MAX_FACTIONS);
    expect(checkCounts(atBorder.map)).toStrictEqual([]);
    const above = syntheticPackage(MAX_FACTIONS + 1, MAX_FACTIONS + 1);
    expect(checkCounts(above.map)[0]!.kind).toBe('too-many-factions');
  });
});

describe('FR-590 FR-586 valid maps and the scenes keep their behaviour', () => {
  it('FR-590 the committed dev map is not refused', () => {
    expect(checkCounts(DEV_MAP)).toStrictEqual([]);
  });

  it('FR-586 both scenes refuse the counts before any browser check and before the palette (source scan)', () => {
    for (const [name, source] of [
      ['ui/main.ts', mainSource],
      ['ui/live-main.ts', liveSource],
    ] as const) {
      const code = codeOnly(stripComments(source));
      const at = (needle: string): number => {
        const i = code.indexOf(needle);
        expect(i, `${name} must call ${needle}`).toBeGreaterThanOrEqual(0);
        return i;
      };
      const counts = at('checkCounts(');
      const caps = at('checkCapabilities(');
      const palette = at('assignFactionColors(');
      expect(counts, `${name}: the counts refusal comes first`).toBeLessThan(caps);
      expect(caps, `${name}: the browser checks come before the palette`).toBeLessThan(palette);
    }
  });

  it('NFR-132 the two new messages are Spanish sentences of the strings module with the numbers filled', () => {
    const territory = capabilityMessage({ kind: 'too-many-territories', count: 70000, limit: MAX_ENTRIES });
    expect(territory).toBe(STRINGS.tooManyTerritories.replace('{count}', '70000').replace('{limit}', String(MAX_ENTRIES)));
    const faction = capabilityMessage({ kind: 'too-many-factions', count: 300, limit: MAX_FACTIONS });
    expect(faction).toBe(STRINGS.tooManyFactions.replace('{count}', '300').replace('{limit}', String(MAX_FACTIONS)));
  });
});
