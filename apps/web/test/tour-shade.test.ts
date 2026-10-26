import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { Rgb } from '@mbrg/shared';
import { cellAt, renderReference, shade } from '../src/core/borders';
import { initialCamera } from '../src/core/camera';
import type { Camera, Viewport } from '../src/core/camera';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { assignFactionColors } from '../src/core/colors';
import { decodeIdPng } from '../src/core/png';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { THEME, toMapTheme } from '../src/core/theme';
import { dimByte, renderTourReference, shadeTour, unitLit } from '../src/core/tour-shade';
import { createMapScene } from '../src/render/map-scene';
import type { MapScene } from '../src/render/map-scene';
import { FRAGMENT_SHADER } from '../src/render/shader';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

// FR-326 (the dim of everything outside the tour's factions) and FR-355 (no tour: the old drawing, bit for bit).
// The reference is `shadeTour` over `shade`; the shader statement is checked as text and evaluated as JavaScript
// (the statement works on one channel, so it is valid in both languages).

const AREA: Viewport = { width: 1920, height: 1080 };

describe('FR-326 dimByte: every channel c becomes floor(c (1 - d) + 0.5)', () => {
  it('FR-326 delta 0 keeps all 256 values', () => {
    for (let c = 0; c < 256; c++) expect(dimByte(c, 0)).toBe(c);
  });

  it('FR-326 delta 0.65 and a non-round 0.37 follow the integer form floor((c x (100 - p) + 50) / 100); an exact .5 tie may fall either way', () => {
    let ties = 0;
    for (const [dim, p] of [
      [0.65, 65],
      [0.37, 37],
    ] as const) {
      for (let c = 0; c < 256; c++) {
        const exact = Math.floor((c * (100 - p) + 50) / 100);
        if ((c * (100 - p) + 50) % 100 === 0) {
          // The product lands on a half: the double 1 - dim decides, and the shader's float32 may decide otherwise.
          expect([exact, exact - 1], `${dim} ${c}`).toContain(dimByte(c, dim));
          ties++;
        } else {
          expect(dimByte(c, dim), `${dim} ${c}`).toBe(exact);
        }
      }
    }
    expect(ties).toBeGreaterThan(0);
  });

  it('FR-326 black stays black, white goes to the dimmed level, and the result is monotone and within 0..255', () => {
    expect(dimByte(0, 0.65)).toBe(0);
    expect(dimByte(255, 0.65)).toBe(89);
    expect(dimByte(255, 0.37)).toBe(161);
    let last = -1;
    for (let c = 0; c < 256; c++) {
      const d = dimByte(c, 0.37);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeLessThanOrEqual(c);
      last = d;
    }
  });
});

describe('FR-326 unitLit: a unit is lit when it is land owned by a lit faction', () => {
  it('FR-326 land of a lit faction only; sea, outside, unowned land and other factions are not lit', () => {
    expect(unitLit('land', 3, [3])).toBe(true);
    expect(unitLit('land', 3, [2, 3])).toBe(true);
    expect(unitLit('land', 2, [3])).toBe(false);
    expect(unitLit('land', 3, [])).toBe(false);
    expect(unitLit('sea', 3, [3])).toBe(false);
    expect(unitLit('outside', 3, [3])).toBe(false);
    expect(unitLit('land', 0, [0])).toBe(false);
    expect(unitLit('sea', 0, [0])).toBe(false);
  });
});

describe('FR-326 FR-355 shadeTour over the dev map at 1920 x 1080', () => {
  let index: EntryIndex;
  let owners: Uint8Array;
  let colors: Rgb[];
  let cam: Camera;
  let plain: Uint8Array;
  const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    const s = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 0, REAL);
    if (!s.ok) throw new Error('scene');
    const factionIndex = factionIndexOf(DEV_MAP);
    owners = ownerTable(index, s.value.owners, factionIndex);
    const assigned = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
    if (!assigned.ok) throw new Error('colours');
    colors = factionColorList(DEV_MAP, assigned.value);
    cam = initialCamera({ w: index.width, h: index.height }, AREA);
    plain = renderReference(index, owners, colors, THEME, cam, AREA, 1);
  }, 60_000);

  it('FR-355 no lit set and delta 0 is renderReference pixel for pixel; so is any lit set at delta 0', () => {
    expect(Array.from(renderTourReference(index, owners, colors, THEME, [], 0, cam, AREA, 1))).toStrictEqual(Array.from(plain));
    expect(Array.from(renderTourReference(index, owners, colors, THEME, [2, 3], 0, cam, AREA, 1))).toStrictEqual(Array.from(plain));
  }, 60_000);

  it('FR-326 lit land unchanged; other land, sea, outside and the border pixels of unlit units dimmed; border pixels of lit units unchanged', () => {
    const lit = [2, 3];
    const dim = 0.37;
    const out = renderTourReference(index, owners, colors, THEME, lit, dim, cam, AREA, 1);
    const seen = { litLand: 0, otherLand: 0, sea: 0, outside: 0, litBorder: 0, unlitBorder: 0, borderNextToLit: 0 };
    for (let y = 0; y < AREA.height; y++) {
      for (let x = 0; x < AREA.width; x++) {
        const fx = x + 0.5;
        const fy = y + 0.5;
        const px = cam.x + (fx - AREA.width / 2) / cam.scale;
        const py = cam.y + (fy - AREA.height / 2) / cam.scale;
        const a = cellAt(index, Math.floor(px), Math.floor(py));
        const kind = index.fills[a]!;
        const isLit = kind === 'land' && lit.includes(owners[a]!);
        const i = (y * AREA.width + x) * 4;
        const base = [plain[i]!, plain[i + 1]!, plain[i + 2]!];
        const want = isLit ? base : base.map((c) => Math.floor(c * (1 - dim) + 0.5));
        if (out[i] !== want[0] || out[i + 1] !== want[1] || out[i + 2] !== want[2] || out[i + 3] !== 255) {
          throw new Error(`pixel ${x},${y}: got ${out[i]},${out[i + 1]},${out[i + 2]} want ${want.join(',')}`);
        }
        const { border } = shade(index, owners, colors, THEME, cam, AREA, fx, fy);
        if (kind === 'land') seen[isLit ? 'litLand' : 'otherLand']++;
        else seen[kind === 'sea' ? 'sea' : 'outside']++;
        if (border !== null) {
          seen[isLit ? 'litBorder' : 'unlitBorder']++;
          // A border pixel of a lit unit that touches an unlit unit, and the reverse, are the cases that tell the pixel's own unit apart.
          const bx = cellAt(index, Math.floor(px + 1), Math.floor(py));
          const by = cellAt(index, Math.floor(px), Math.floor(py + 1));
          const litAt = (e: number): boolean => index.fills[e] === 'land' && lit.includes(owners[e]!);
          if (litAt(bx) !== isLit || litAt(by) !== isLit) seen.borderNextToLit++;
        }
      }
    }
    for (const [name, n] of Object.entries(seen)) expect(n, name).toBeGreaterThan(0);
  }, 120_000);

  it('FR-326 an empty lit set at a positive dim dims everything (a smaller area, device pixel ratio 1.25)', () => {
    const small: Viewport = { width: 480, height: 270 };
    const smallCam = initialCamera({ w: index.width, h: index.height }, small);
    const base = renderReference(index, owners, colors, THEME, smallCam, small, 1.25);
    const dimmed = renderTourReference(index, owners, colors, THEME, [], 0.65, smallCam, small, 1.25);
    expect(dimmed.length).toBe(base.length);
    for (let i = 0; i < dimmed.length; i += 4) {
      if (dimmed[i] !== dimByte(base[i]!, 0.65) || dimmed[i + 1] !== dimByte(base[i + 1]!, 0.65) || dimmed[i + 2] !== dimByte(base[i + 2]!, 0.65)) {
        throw new Error(`pixel ${i / 4}`);
      }
    }
    // shadeTour of one pixel agrees with the renderer.
    const one = shadeTour(index, owners, colors, THEME, [], 0.65, smallCam, small, 10.5 / 1.25, 10.5 / 1.25);
    const at = (10 * Math.round(small.width * 1.25) + 10) * 4;
    expect(one.color).toStrictEqual([dimmed[at]!, dimmed[at + 1]!, dimmed[at + 2]!]);
  }, 120_000);

  it('FR-326 the dim must be inside 0..1 and a negative or NaN dim is refused', () => {
    for (const dim of [-0.1, 1.5, Number.NaN]) {
      expect(() => shadeTour(index, owners, colors, THEME, [], dim, cam, AREA, 1, 1), String(dim)).toThrow(RangeError);
    }
  });
});

describe('FR-326 FR-355 the shader is a port of shadeTour', () => {
  /** The dim statement of the shader: from the gate to its semicolon. */
  const statement = (): string => {
    const m = /if \(uDim > 0\.0 && [^;]*;/.exec(FRAGMENT_SHADER);
    if (m === null) throw new Error('no dim statement');
    return m[0];
  };

  it('FR-326 the uniforms are exactly uDim (float) and uLit (ivec2), each declared once', () => {
    expect(FRAGMENT_SHADER.match(/\buniform\s+float\s+uDim\s*;/g)).toHaveLength(1);
    expect(FRAGMENT_SHADER.match(/\buniform\s+ivec2\s+uLit\s*;/g)).toHaveLength(1);
    const names = [...FRAGMENT_SHADER.matchAll(/\buniform\s+(?:\w+\s+)+?(u(?:Dim|Lit))\b/g)].map((m) => m[1]);
    expect(names).toStrictEqual(['uDim', 'uLit']);
  });

  it('FR-355 the dim step is gated by uDim > 0.0, comes after the colour is final and before the output', () => {
    expect(statement().startsWith('if (uDim > 0.0 && ')).toBe(true);
    const at = FRAGMENT_SHADER.indexOf(statement());
    const lastColor = FRAGMENT_SHADER.lastIndexOf('color = uBorderColors[border];');
    const out = FRAGMENT_SHADER.indexOf('outColor = vec4(color, 1.0);');
    expect(lastColor).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(lastColor);
    expect(out).toBeGreaterThan(at);
    // The gate is the only place the dim enters.
    expect(FRAGMENT_SHADER.match(/\buDim\b/g)).toHaveLength(3);
  });

  it('FR-326 the shader statement, evaluated per channel, equals dimByte and unitLit for every byte, dim, kind and owner', () => {
    const run = new Function('uDim', 'uLit', 'fillKind', 'unitOwner', 'color', 'floor', `${statement()}\nreturn color;`) as (
      dim: number,
      lit: { x: number; y: number },
      kind: number,
      owner: number,
      color: number,
      floor: (v: number) => number,
    ) => number;
    const kinds = ['outside', 'land', 'sea'] as const;
    for (const dim of [0, 0.37, 0.65, 0.5]) {
      for (const lit of [[], [3], [2, 3]] as const) {
        const uLit = { x: lit[0] ?? 0, y: lit[1] ?? lit[0] ?? 0 };
        for (let kind = 0; kind < 3; kind++) {
          for (const owner of [0, 1, 2, 3]) {
            const want = (c: number): number => (dim > 0 && !unitLit(kinds[kind]!, owner, lit) ? dimByte(c, dim) : c);
            for (let c = 0; c < 256; c += 5) {
              const got = Math.round(run(dim, uLit, kind, owner, c / 255, Math.floor) * 255);
              expect(got, `dim ${dim} lit ${lit.join()} kind ${kind} owner ${owner} c ${c}`).toBe(want(c));
            }
          }
        }
      }
    }
  });

  it('FR-326 the unit owner the shader tests is the entry owner of the pixel unit, read from the drawn table', () => {
    expect(FRAGMENT_SHADER).toContain('int unitOwner = byteAt(uOwners, a);');
  });
});

describe('FR-326 FR-355 setTour sets uniforms only', () => {
  const colors = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
  if (!colors.ok) throw new Error('colours');
  const list = factionColorList(DEV_MAP, colors.value);
  const make = (): MapScene => {
    const ids = DEV_MAP.territories.slice(0, 3).map((e) => e.id);
    return createMapScene(buildEntryIndex(DEV_MAP, 3, 2, [0, ids[0]!, ids[1]!, ids[2]!, ids[0]!, 0]), list, toMapTheme(THEME));
  };
  const versions = (s: MapScene): number[] => [s.textures.index, s.textures.kinds, s.textures.owners, s.textures.colors, s.textures.before, s.textures.front].map((t) => t.version);

  it('FR-355 the defaults draw no tour: uDim is 0 and uLit holds no faction', () => {
    const u = make().material.uniforms;
    expect(u.uDim!.value).toBe(0);
    const lit = u.uLit!.value as { x: number; y: number };
    expect([lit.x, lit.y]).toStrictEqual([0, 0]);
  });

  it('FR-326 setTour carries the dim and up to two lit factions; one faction fills both slots; undefined clears', () => {
    const scene = make();
    const u = scene.material.uniforms;
    const lit = (): number[] => [(u.uLit!.value as { x: number }).x, (u.uLit!.value as { y: number }).y];
    scene.setTour({ lit: [3, 2], dim: 0.37 });
    expect(u.uDim!.value).toBe(0.37);
    expect(lit()).toStrictEqual([3, 2]);
    scene.setTour({ lit: [4], dim: 0.5 });
    expect(u.uDim!.value).toBe(0.5);
    expect(lit()).toStrictEqual([4, 4]);
    scene.setTour({ lit: [], dim: 0.25 });
    expect(lit()).toStrictEqual([0, 0]);
    scene.setTour({ lit: [3, 2], dim: 0.37 });
    scene.setTour(undefined);
    expect(u.uDim!.value).toBe(0);
    expect(lit()).toStrictEqual([0, 0]);
  });

  it('FR-326 a dim outside 0..1 or NaN, more than two lit factions and a bad faction index are refused', () => {
    const scene = make();
    for (const dim of [-0.01, 1.01, Number.NaN]) expect(() => scene.setTour({ lit: [1], dim })).toThrow(RangeError);
    expect(() => scene.setTour({ lit: [1, 2, 3], dim: 0.5 })).toThrow(RangeError);
    for (const bad of [-1, 1.5, 256, Number.NaN]) expect(() => scene.setTour({ lit: [bad], dim: 0.5 }), String(bad)).toThrow(RangeError);
  });

  it('FR-353 FR-355 setTour uploads nothing: every texture version stays the same', () => {
    const scene = make();
    const base = versions(scene);
    scene.setTour({ lit: [3, 2], dim: 0.4 });
    scene.setTour({ lit: [1], dim: 0.2 });
    scene.setTour(undefined);
    expect(versions(scene)).toStrictEqual(base);
  });

  it('FR-353 type-level: setTour takes lit factions and a dim only, or undefined', () => {
    expectTypeOf<MapScene['setTour']>().parameters.toEqualTypeOf<[{ lit: readonly number[]; dim: number } | undefined]>();
    expect(true).toBe(true);
  });
});
