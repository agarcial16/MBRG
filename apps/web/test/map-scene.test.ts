import { ColorManagement, LinearSRGBColorSpace, NearestFilter, NoColorSpace, NoToneMapping, RGBAFormat, RGFormat, RedFormat, UnsignedByteType } from 'three';
import type { DataTexture } from 'three';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import { BORDER_PRIORITY, EDGE_BIAS, WIDTH_LEVELS } from '../src/core/borders';
import type { Camera, Viewport } from '../src/core/camera';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { territoryOpacity } from '../src/core/lines';
import { THEME, toMapTheme } from '../src/core/theme';
import type { MapTheme } from '../src/core/theme';
import { assignFactionColors } from '../src/core/colors';
import { createMapScene, deviceSize } from '../src/render/map-scene';
import type { MapScene, MapView } from '../src/render/map-scene';
import { RENDERER_SETTINGS, attachRenderer } from '../src/render/renderer';
import { FRAGMENT_SHADER, VERTEX_SHADER } from '../src/render/shader';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';

// FR-134 (texture flags), NFR-24 (a round change touches only the owner texture), FR-136 to FR-140
// (what can be checked about the drawing without a graphics context). Three.js objects work in Node;
// only the drawing itself needs WebGL, and that is reviewed with the screenshots of the task.

const colors = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
if (!colors.ok) throw new Error('dev map colours');
const colorList: Rgb[] = factionColorList(DEV_MAP, colors.value);
const factionIndex = factionIndexOf(DEV_MAP);

/** A small index image whose pixels use the first entries of the dev map. */
function smallIndex(): EntryIndex {
  const ids = DEV_MAP.territories.slice(0, 3).map((e) => e.id);
  return buildEntryIndex(DEV_MAP, 3, 2, [0, ids[0]!, ids[1]!, ids[2]!, ids[0]!, 0]);
}

function make(): { index: EntryIndex; scene: MapScene } {
  const index = smallIndex();
  return { index, scene: createMapScene(index, colorList, toMapTheme(THEME)) };
}

const allTextures = (s: MapScene): DataTexture[] => [s.textures.index, s.textures.kinds, s.textures.owners, s.textures.colors];
const versions = (s: MapScene): number[] => allTextures(s).map((t) => t.version);

describe('FR-134 texture flags: values reach the shader exactly as stored', () => {
  it('FR-134 every texture is sampled Nearest, without mipmaps, flip, premultiplication or colour space', () => {
    const { scene } = make();
    for (const t of allTextures(scene)) {
      expect(t.minFilter).toBe(NearestFilter);
      expect(t.magFilter).toBe(NearestFilter);
      expect(t.generateMipmaps).toBe(false);
      expect(t.flipY).toBe(false);
      expect(t.premultiplyAlpha).toBe(false);
      expect(t.colorSpace).toBe(NoColorSpace);
      expect(t.unpackAlignment).toBe(1);
    }
  });

  it('FR-134 the index texture is the RG8 entry-index image itself: same size, same bytes, no copy', () => {
    const { index, scene } = make();
    const t = scene.textures.index;
    expect(t.format).toBe(RGFormat);
    expect(t.type).toBe(UnsignedByteType);
    expect(t.image.width).toBe(index.width);
    expect(t.image.height).toBe(index.height);
    expect(t.image.data).toBe(index.indexPixels);
  });

  it('FR-134 the per-entry tables hold the fill class, the owner and the faction colours byte for byte', () => {
    const { index, scene } = make();
    const kinds = scene.textures.kinds;
    expect(kinds.format).toBe(RedFormat);
    expect(kinds.image.width).toBe(index.fills.length);
    expect(kinds.image.height).toBe(1);
    expect([...(kinds.image.data as Uint8Array)]).toStrictEqual(index.fills.map((f) => (f === 'outside' ? 0 : f === 'land' ? 1 : 2)));

    const owners = scene.textures.owners;
    expect(owners.format).toBe(RedFormat);
    expect(owners.image.width).toBe(index.ids.length);
    expect(owners.image.height).toBe(1);
    expect([...(owners.image.data as Uint8Array)]).toStrictEqual(new Array<number>(index.ids.length).fill(0));

    const palette = scene.textures.colors;
    expect(palette.format).toBe(RGBAFormat);
    expect(palette.image.width).toBe(colorList.length);
    expect(palette.image.height).toBe(1);
    const bytes = [...(palette.image.data as Uint8Array)];
    expect(bytes).toStrictEqual(colorList.flatMap((c) => [c[0], c[1], c[2], 255]));
  });

  it('FR-134 the shader reads the id image with texelFetch only (no filtering, no interpolation)', () => {
    expect(FRAGMENT_SHADER).toMatch(/\btexelFetch\s*\(/);
    expect(FRAGMENT_SHADER).not.toMatch(/\btexture\s*\(/);
    expect(FRAGMENT_SHADER).not.toMatch(/\btexture(2D|Lod|Grad|Offset)\s*\(/);
    expect(VERTEX_SHADER).not.toMatch(/\btexture/);
  });
});

describe('NFR-24 a round change updates only the owner texture', () => {
  it('NFR-24 setOwners uploads the owner table and leaves every other texture and the pixel data alone', () => {
    const { index, scene } = make();
    const before = versions(scene);
    const pixels = scene.textures.index.image.data;
    const table = new Uint8Array(index.ids.length);
    table[1] = 2;
    table[2] = 5;
    scene.setOwners(table);
    const after = versions(scene);
    expect(after[2]).toBe(before[2]! + 1);
    expect([after[0], after[1], after[3]]).toStrictEqual([before[0], before[1], before[3]]);
    expect([...(scene.textures.owners.image.data as Uint8Array)]).toStrictEqual([...table]);
    expect(scene.textures.index.image.data).toBe(pixels);
    expect(scene.textures.index.image.data).toBe(index.indexPixels);
  });

  it('NFR-24 each further setOwners is again one owner-texture upload and nothing else', () => {
    const { index, scene } = make();
    const t1 = new Uint8Array(index.ids.length).fill(1);
    const t2 = new Uint8Array(index.ids.length).fill(3);
    scene.setOwners(t1);
    const v1 = versions(scene);
    scene.setOwners(t2);
    const v2 = versions(scene);
    expect(v2.map((v, i) => v - v1[i]!)).toStrictEqual([0, 0, 1, 0]);
    expect([...(scene.textures.owners.image.data as Uint8Array)]).toStrictEqual([...t2]);
  });

  it('NFR-24 the owner table of a real round has exactly one byte per entry and is accepted as it is', () => {
    const { scene } = make();
    const full = createMapScene(
      buildEntryIndex(DEV_MAP, 1, 1, [DEV_MAP.territories[0]!.id]),
      colorList,
      toMapTheme(THEME),
    );
    const owners = new Map(DEV_MAP.territories.filter((e) => e.kind !== 'sea').map((e) => [e.id, e.owner!] as const));
    const index = buildEntryIndex(DEV_MAP, 1, 1, [DEV_MAP.territories[0]!.id]);
    const table = ownerTable(index, owners, factionIndex);
    expect(table.length).toBe(DEV_MAP.territories.length + 1);
    const before = versions(full);
    full.setOwners(table);
    expect(versions(full).map((v, i) => v - before[i]!)).toStrictEqual([0, 0, 1, 0]);
    expect(() => scene.setOwners(new Uint8Array(1))).toThrow(RangeError);
    expect(() => scene.setOwners(new Uint8Array(1000))).toThrow(RangeError);
  });

  it('NFR-24 setView changes uniforms only: no texture is uploaded again', () => {
    const { scene } = make();
    const before = versions(scene);
    scene.setView({ camera: { x: 1.5, y: 1, scale: 8 }, viewport: { width: 100, height: 80 }, dpr: 2 });
    scene.setView({ camera: { x: 2, y: 1, scale: 16 }, viewport: { width: 100, height: 80 }, dpr: 1 });
    expect(versions(scene)).toStrictEqual(before);
  });
});

describe('FR-136 colour management and renderer settings leave the theme bytes untouched', () => {
  it('FR-136 colour management is off once a map scene exists', () => {
    ColorManagement.enabled = true;
    make();
    expect(ColorManagement.enabled).toBe(false);
  });

  it('FR-136 the renderer writes linear output without tone mapping, antialiasing, alpha or depth', () => {
    expect(RENDERER_SETTINGS.outputColorSpace).toBe(LinearSRGBColorSpace);
    expect(RENDERER_SETTINGS.toneMapping).toBe(NoToneMapping);
    expect(RENDERER_SETTINGS.antialias).toBe(false);
    expect(RENDERER_SETTINGS.alpha).toBe(false);
    expect(RENDERER_SETTINGS.depth).toBe(false);
    expect(RENDERER_SETTINGS.premultipliedAlpha).toBe(false);
  });
});

describe('FR-138 FR-139 FR-140 theme and view reach the shader as data', () => {
  it('FR-139 the class widths, border colours, sea and outside colours are the theme values', () => {
    const { scene } = make();
    const u = scene.material.uniforms;
    const widths = BORDER_PRIORITY.map((c) => THEME.width[c]);
    expect(u.uWidths!.value).toStrictEqual(widths);
    expect(widths).toStrictEqual([4, 2, 1, 1, 1, 4]);
    for (const w of widths) expect(WIDTH_LEVELS as readonly number[]).toContain(w);
    const border = u.uBorderColors!.value as { x: number; y: number; z: number }[];
    expect(border).toHaveLength(BORDER_PRIORITY.length);
    BORDER_PRIORITY.forEach((c, i) => {
      if (c === 'territory') return;
      const expected = THEME.border[c];
      expect([border[i]!.x * 255, border[i]!.y * 255, border[i]!.z * 255].map(Math.round)).toStrictEqual(expected);
    });
    const sea = u.uSea!.value as { x: number; y: number; z: number };
    const outside = u.uOutside!.value as { x: number; y: number; z: number };
    expect([sea.x * 255, sea.y * 255, sea.z * 255].map(Math.round)).toStrictEqual(THEME.sea);
    expect([outside.x * 255, outside.y * 255, outside.z * 255].map(Math.round)).toStrictEqual(THEME.background);
    expect(u.uTerritoryDarken!.value).toBe(THEME.territoryLine.darken);
  });

  it('FR-140 the territory line opacity uniform depends on the scale only', () => {
    const { scene } = make();
    const vp: Viewport = { width: 200, height: 100 };
    for (const scale of [0.5, 4, 8, 12, 20, 32]) {
      const seen = new Set<number>();
      for (const c of [{ x: 0, y: 0 }, { x: 1.25, y: 1 }, { x: 700, y: 900 }]) {
        scene.setView({ camera: { ...c, scale }, viewport: vp, dpr: 1 });
        seen.add(scene.material.uniforms.uTerritoryOpacity!.value as number);
      }
      expect([...seen]).toStrictEqual([territoryOpacity(scale, THEME.territoryLine)]);
    }
  });

  it('FR-140 the view is sent relative to the camera: whole map cell and exact fraction, in CSS and device pixels', () => {
    const { scene } = make();
    const cam: Camera = { x: 1234.375, y: 987.0625, scale: 32 };
    scene.setView({ camera: cam, viewport: { width: 1920, height: 1080 }, dpr: 1.25 });
    const u = scene.material.uniforms;
    const cell = u.uCenterCell!.value as { x: number; y: number };
    const frac = u.uCenterFrac!.value as { x: number; y: number };
    expect([cell.x, cell.y]).toStrictEqual([1234, 987]);
    expect([frac.x, frac.y]).toStrictEqual([0.375, 0.0625]);
    expect(u.uScale!.value).toBe(32);
    expect(u.uDpr!.value).toBe(1.25);
    const vp = u.uViewport!.value as { x: number; y: number };
    expect([vp.x, vp.y]).toStrictEqual([1920, 1080]);
    const device = u.uDevice!.value as { x: number; y: number };
    expect([device.x, device.y]).toStrictEqual([2400, 1350]);
  });

  it('FR-140 the drawing surface has round(width x dpr) by round(height x dpr) device pixels', () => {
    expect(deviceSize({ width: 1920, height: 1080 }, 1)).toStrictEqual({ width: 1920, height: 1080 });
    expect(deviceSize({ width: 1920, height: 1080 }, 1.25)).toStrictEqual({ width: 2400, height: 1350 });
    expect(deviceSize({ width: 999, height: 501 }, 1.5)).toStrictEqual({ width: 1499, height: 752 });
  });

  it('FR-138 the map theme carries the background colour as the outside colour and nothing else changes', () => {
    const m = toMapTheme(THEME);
    expect(m.outside).toBe(THEME.background);
    expect(m.sea).toBe(THEME.sea);
    expect(m.border).toBe(THEME.border);
    expect(m.width).toBe(THEME.width);
    expect(m.territoryLine).toBe(THEME.territoryLine);
    expect(Object.keys(m).sort()).toStrictEqual(['border', 'outside', 'sea', 'territoryLine', 'width']);
  });
});

describe('FR-136 FR-138 FR-139 the shader is a port of the reference rule', () => {
  it('FR-139 the shader uses the reference tie-break bias, written from the same constant', () => {
    expect(FRAGMENT_SHADER).toContain(`EDGE_BIAS = ${EDGE_BIAS.toFixed(8)}`);
    expect(Number(EDGE_BIAS.toFixed(8))).toBe(EDGE_BIAS);
    // Forward lookups reach further and backward ones less, as in the reference.
    expect(FRAGMENT_SHADER).toContain("(w * 0.5 + (dir.x + dir.y) * EDGE_BIAS) / uScale");
  });

  it('FR-138 the shader numbers the border classes in the reference priority order', () => {
    const ids = BORDER_PRIORITY.map((name) => {
      const m = new RegExp(`const int C_${name.toUpperCase().replace('-', '_')} = (\\d+);`).exec(FRAGMENT_SHADER);
      return m === null ? -1 : Number(m[1]);
    });
    expect(ids).toStrictEqual(BORDER_PRIORITY.map((_, i) => i));
  });

  it('FR-139 the shader tests the widest classes first, from the shared width levels, and each class at its own width only', () => {
    expect(WIDTH_LEVELS).toStrictEqual([4, 2, 1]);
    expect(FRAGMENT_SHADER).toContain('WIDTH_LEVELS[3] = float[3](4.0, 2.0, 1.0)');
    expect(FRAGMENT_SHADER).toContain(`wi < ${WIDTH_LEVELS.length}`);
    expect(FRAGMENT_SHADER).toMatch(/float w = WIDTH_LEVELS\[wi\];/);
    expect(FRAGMENT_SHADER).toMatch(/uWidths\[c\] == w/);
  });

  it('FR-139 the shader has no hard-coded width choice and its only loop bound is the number of levels', () => {
    expect(FRAGMENT_SHADER.match(/wi\s*<\s*\d+/g)).toStrictEqual([`wi < ${WIDTH_LEVELS.length}`]);
    expect(FRAGMENT_SHADER).not.toMatch(/wi\s*==\s*\d/);
    expect(FRAGMENT_SHADER).not.toMatch(/\?\s*\d+\.\d+\s*:\s*\d+\.\d+/);
  });

  it('FR-136 the shader positions are relative to the camera, so large map coordinates keep their precision', () => {
    expect(FRAGMENT_SHADER).toContain('uCenterFrac');
    expect(FRAGMENT_SHADER).toContain('uCenterCell');
    expect(FRAGMENT_SHADER).toMatch(/gl_FragCoord/);
    expect(FRAGMENT_SHADER).toMatch(/highp float/);
  });
});

describe('FR-159 the rendering part takes only the package views, the owner table and the camera', () => {
  it('FR-159 exported signatures name no seed, round or sim type (type-level)', () => {
    expectTypeOf(createMapScene).parameters.toEqualTypeOf<[EntryIndex, readonly Rgb[], MapTheme]>();
    expectTypeOf<MapScene['setOwners']>().parameters.toEqualTypeOf<[Uint8Array]>();
    expectTypeOf<MapScene['setView']>().parameters.toEqualTypeOf<[MapView]>();
    expectTypeOf<keyof MapView>().toEqualTypeOf<'camera' | 'viewport' | 'dpr'>();
    expectTypeOf(attachRenderer).parameters.toEqualTypeOf<[HTMLCanvasElement, MapScene]>();
    expectTypeOf(deviceSize).parameters.toEqualTypeOf<[Viewport, number]>();
    expect(true).toBe(true);
  });
});
