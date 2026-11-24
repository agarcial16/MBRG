import { describe, expect, it } from 'vitest';
import { checkIdImage } from '@mbrg/shared';
import { buildInMemory } from '../src/core/build';
import { robinson } from '../src/core/robinson';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { pngCodec } from '../src/io/png-codec';
import type { BuildInputs, BuildOutcome } from '../src/core/types';
import { baseInputs, feature, inputTexts, miniInputs } from './helpers/fixtures';

/** A 20 x 20 degree province with its south-west corner at (x, y). */
const province = (code: string, country: string, extra: Record<string, unknown>, x: number, y: number) => feature({ adm1_code: code, adm0_a3: country, ...extra }, x, y, 20);

/** A small whole-planet layout: three countries on three continents, sea seeds in between, Robinson world. */
function worldInputs(projection?: 'laea' | 'robinson'): BuildInputs {
  return {
    provinces: [
      province('AA', 'AAA', { name: 'Westland', name_es: 'Oeste' }, -150, 30),
      province('BB', 'BBB', { name: 'Midland', name_es: 'Medio' }, 10, -20),
      province('CC', 'CCC', { name: 'Eastland', name_es: 'Este' }, 120, 40),
    ],
    countries: [
      { adm0_a3: 'AAA', name: 'Westland', name_es: 'Oeste' },
      { adm0_a3: 'BBB', name: 'Midland', name_es: 'Medio' },
      { adm0_a3: 'CCC', name: 'Eastland', name_es: 'Este' },
    ],
    otherLand: [feature({ adm0_a3: 'ANT' }, -90, -80, 40)],
    grouping: {
      countries: [{ country: 'AAA' }, { country: 'BBB' }, { country: 'CCC' }],
      territories: [
        { key: 'aa', country: 'AAA', provinces: ['AA'] },
        { key: 'bb', country: 'BBB', provinces: ['BB'] },
        { key: 'cc', country: 'CCC', provinces: ['CC'] },
      ],
      excluded: [],
    },
    seeds: [
      { name: 'Oeste', lon: -80, lat: 0 },
      { name: 'Este', lon: 80, lat: 30 },
    ],
    meta: { version: '5.1.2' },
    params: projection === undefined ? { width: 128, margin: 0.02, minPieceSize: 1 } : { width: 128, margin: 0.02, minPieceSize: 1, projection },
  };
}

function built(inputs: BuildInputs): Extract<BuildOutcome, { ok: true }> {
  const outcome = buildInMemory(inputs, pngCodec);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome;
}

const RAD = Math.PI / 180;

describe('FR-699 the builder projection parameter', () => {
  it('FR-699 reads an optional projection of laea or robinson and keeps it in the parsed params', () => {
    for (const projection of ['laea', 'robinson'] as const) {
      const inputs = baseInputs();
      inputs.params = { ...inputs.params, projection };
      const parsed = parseBuildInputs(inputTexts(inputs));
      expect(parsed).toStrictEqual({ ok: true, value: inputs });
    }
  });

  it('FR-700 without the member the parsed params are exactly as before', () => {
    const parsed = parseBuildInputs(inputTexts(baseInputs()));
    expect(parsed.ok && Object.keys(parsed.value.params)).toStrictEqual(['width', 'margin', 'minPieceSize']);
  });

  it('FR-699 refuses any other projection with one invalid-input on params', () => {
    for (const bad of ['equal-earth', 'Robinson', '', 3, null, true]) {
      const texts = inputTexts(baseInputs());
      texts.params = JSON.stringify({ width: 64, margin: 0.02, minPieceSize: 4, projection: bad });
      const result = parseBuildInputs(texts);
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => [e.kind, e.reason]), String(bad)).toStrictEqual([['invalid-input', 'params: projection must be laea or robinson']]);
      }
    }
  });
});

describe('FR-699 / FR-700 building with Robinson', () => {
  it('FR-700 an explicit laea builds exactly the bytes of the same inputs without the member', () => {
    const plain = built(miniInputs());
    const withMember = miniInputs();
    withMember.params = { ...withMember.params, projection: 'laea' };
    const explicit = built(withMember);
    expect(Buffer.from(explicit.files.image).equals(Buffer.from(plain.files.image))).toBe(true);
    expect(explicit.files.map).toStrictEqual(plain.files.map);
    expect(explicit.report).toBe(plain.report);
  });

  it('FR-699 robinson draws a wide world: the land lies in a band of rows around the middle and the corners are sea', () => {
    const outcome = built(worldInputs('robinson'));
    const w = outcome.width;
    const px = outcome.pixels;
    const landRows = new Set<number>();
    const landCols = new Set<number>();
    for (let i = 0; i < px.length; i++) {
      const v = px[i]!;
      if (v >= 1 && v <= 3) {
        landRows.add(Math.floor(i / w));
        landCols.add(i % w);
      }
    }
    // the three countries span 30 + 20 = -20..-0 and 30..60 degrees of latitude: far less than the full height
    expect(Math.max(...landRows) - Math.min(...landRows)).toBeLessThan(outcome.height * 0.75);
    // and almost the whole width: -150 .. 140 degrees of longitude
    expect(Math.max(...landCols) - Math.min(...landCols)).toBeGreaterThan(w * 0.9);
    const h = outcome.height;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) expect(px[y * w + x]! > 3).toBe(true);
  });

  it('FR-699 projects the sea seeds the same way: each seed is one sea zone and lands on a water pixel of the Robinson raster', () => {
    const outcome = built(worldInputs('robinson'));
    expect(outcome.map.territories.filter((t) => 'kind' in t && t.kind === 'sea').length).toBe(2);
    // both zones exist on the final image (each seed claimed its pixels)
    const ids = new Set<number>(outcome.pixels);
    for (const t of outcome.map.territories) expect(ids.has(t.id), String(t.id)).toBe(true);
  });

  it('FR-699 the Robinson build differs from the Lambert one, is deterministic, and its report names the projection', () => {
    const a = built(worldInputs('robinson'));
    const b = built(worldInputs('robinson'));
    const asRobinson = miniInputs();
    asRobinson.params = { ...asRobinson.params, projection: 'robinson' };
    const lambert = built(miniInputs());
    const small = built(asRobinson);
    expect(Buffer.from(a.files.image).equals(Buffer.from(b.files.image))).toBe(true);
    expect(a.report).toBe(b.report);
    expect(Buffer.from(small.files.image).equals(Buffer.from(lambert.files.image))).toBe(false);
    expect(a.report).toContain('projection: robinson');
    expect(small.report).toContain('projectionCenter: lon=0 lat=0');
    expect(lambert.report).not.toContain('projection:');
  });

  it('FR-699 the central meridian is 0: a country straddling it is centred on the middle column', () => {
    const inputs = worldInputs('robinson');
    inputs.provinces[1] = province('BB', 'BBB', { name: 'Midland', name_es: 'Medio' }, -10, -20);
    // the frame is symmetric in longitude when the extreme countries mirror each other
    inputs.provinces[0] = province('AA', 'AAA', { name: 'Westland', name_es: 'Oeste' }, -160, 30);
    inputs.provinces[2] = province('CC', 'CCC', { name: 'Eastland', name_es: 'Este' }, 140, 30);
    const outcome = built(inputs);
    const w = outcome.width;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < outcome.pixels.length; i++) {
      if (outcome.pixels[i] === 2) {
        sum += i % w;
        n++;
      }
    }
    // the country BB spans lon -10..10: its pixel centre column is the middle of the image
    expect(sum / n + 0.5).toBeCloseTo(w / 2, 0);
  });
});

describe('FR-706 the Robinson image is as tall as the world: a rectangle, not a square', () => {
  it('FR-706 is W wide and H = ceil of the globe height plus the margin, in pixels of the same size as the width gives', () => {
    const inputs = worldInputs('robinson');
    const outcome = built(inputs);
    const xs: number[] = [];
    for (const f of inputs.provinces) for (const p of f.polygons) for (const [lon, lat] of p.outer.coords) xs.push(robinson(lon * RAD, lat * RAD)[0]);
    const boxWidth = Math.max(...xs) - Math.min(...xs);
    const margin = inputs.params.margin;
    const pixel = (boxWidth * (1 + 2 * margin)) / inputs.params.width;
    const pole = robinson(0, Math.PI / 2)[1];
    expect(outcome.width).toBe(128);
    expect(outcome.height).toBe(Math.ceil((2 * pole + 2 * margin * boxWidth) / pixel - 1e-9));
    expect(outcome.height).toBeLessThan(outcome.width * 0.75);
    expect(outcome.pixels.length).toBe(outcome.width * outcome.height);
  });

  it('FR-706 writes a PNG of that size, passes the id image check with W and H, and the report states the height', () => {
    const outcome = built(worldInputs('robinson'));
    const decoded = pngCodec.decode(outcome.files.image);
    if (!decoded.ok) throw new Error('png');
    expect([decoded.value.width, decoded.value.height]).toStrictEqual([outcome.width, outcome.height]);
    expect(checkIdImage(outcome.map, outcome.width, outcome.height, outcome.pixels)).toMatchObject({ ok: true });
    expect(outcome.report).toContain(`height: ${outcome.height}`);
    expect(outcome.preview.pixels.length).toBe(outcome.width * outcome.height);
  });

  it('FR-706 puts the poles on the first and last rows (land there would sit on them): the top and bottom rows are sea but for the margin', () => {
    const inputs = worldInputs('robinson');
    inputs.otherLand = [feature({ adm0_a3: 'ANT' }, -180, -90, 90)];
    const outcome = built(inputs);
    const w = outcome.width;
    // Antarctica reaches the pole line: the bottom margin (2% of the box width) holds only sea, the rows above it hold land
    const lastRow = Array.from(outcome.pixels.slice((outcome.height - 1) * w));
    expect(lastRow.every((v) => v > 3)).toBe(true);
    expect(outcome.pixels.slice(0, w).every((v) => v > 3)).toBe(true);
    expect(outcome.pixels.some((v) => v === 0)).toBe(true);
  });

  it('FR-706 leaves the Lambert build square', () => {
    const outcome = built(miniInputs());
    expect(outcome.height).toBe(outcome.width);
  });
});

/** The world fixture with a fourth country, a tenth of a degree wide: under one pixel at width 128. */
function withTinyIsland(minFootprint?: number): BuildInputs {
  const inputs = worldInputs('robinson');
  inputs.provinces.push(feature({ adm1_code: 'DD', adm0_a3: 'DDD', name: 'Tinyland', name_es: 'Chiquito' }, 30.3, 10.3, 0.1));
  inputs.countries.push({ adm0_a3: 'DDD', name: 'Tinyland', name_es: 'Chiquito' });
  inputs.grouping.countries.push({ country: 'DDD' });
  inputs.grouping.territories.push({ key: 'dd', country: 'DDD', provinces: ['DD'] });
  if (minFootprint !== undefined) inputs.params = { ...inputs.params, minFootprint };
  return inputs;
}

describe('FR-705 the minimum footprint parameter', () => {
  it('FR-705 reads an optional minFootprint, an integer from 1 to 1,000, and keeps it in the parsed params', () => {
    for (const n of [1, 9, 1000]) {
      const inputs = baseInputs();
      inputs.params = { ...inputs.params, minFootprint: n };
      expect(parseBuildInputs(inputTexts(inputs))).toStrictEqual({ ok: true, value: inputs });
    }
  });

  it('FR-705 refuses 0, a fraction, 1,001, text and null with one invalid-input on params', () => {
    for (const bad of [0, 2.5, 1001, '9', null, -1]) {
      const texts = inputTexts(baseInputs());
      texts.params = JSON.stringify({ width: 64, margin: 0.02, minPieceSize: 4, minFootprint: bad });
      const result = parseBuildInputs(texts);
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.errors.map((e) => [e.kind, e.reason]), String(bad)).toStrictEqual([['invalid-input', 'params: minFootprint must be an integer from 1 to 1000']]);
    }
  });

  it('FR-705 without the rule a country under one pixel vanishes and the build fails; with it the country keeps the minimum', () => {
    const without = buildInMemory(withTinyIsland(), pngCodec);
    expect(without.ok).toBe(false);
    const outcome = built(withTinyIsland(9));
    const id = 4;
    expect(outcome.pixels.filter((v) => v === id).length).toBe(9);
    expect(checkIdImage(outcome.map, outcome.width, outcome.height, outcome.pixels)).toMatchObject({ ok: true });
    // its links come from pixel contact: the island touches a sea zone and nothing else
    const entry = outcome.map.territories.find((t) => t.id === id)!;
    expect(entry.neighbors.length).toBeGreaterThan(0);
  });

  it('FR-705 never makes a unit smaller or touches the others: units that reach the minimum keep every pixel', () => {
    const plain = built(worldInputs('robinson'));
    const withRule = worldInputs('robinson');
    withRule.params = { ...withRule.params, minFootprint: 4 };
    const ruled = built(withRule);
    expect(Buffer.from(ruled.files.image).equals(Buffer.from(plain.files.image))).toBe(true);
    expect(ruled.report).toBe(plain.report);
  });

  it('FR-705 is deterministic, and the report lists the grown units', () => {
    const a = built(withTinyIsland(9));
    const b = built(withTinyIsland(9));
    expect(Buffer.from(a.files.image).equals(Buffer.from(b.files.image))).toBe(true);
    expect(a.report).toContain('grownUnits: 1');
    expect(a.report).toContain('  - entry=4 from=0 to=9');
  });
});
