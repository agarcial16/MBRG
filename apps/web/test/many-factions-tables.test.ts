// Tests for Spec 033 Chunk 1: 16-bit owner table, 65,535 faction ceiling, per-entry RG8 textures,
// pick/tour indices up to 65,535, and capability/refusal checks (FR-640, FR-644, FR-645).
import { NearestFilter, NoColorSpace, RGFormat, UnsignedByteType } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapData, Rgb } from '@mbrg/shared';
import { borderClass, shade } from '../src/core/borders';
import { checkCapabilities, checkCounts } from '../src/core/capabilities';
import { buildEntryIndex, factionIndexOf, MAX_ENTRIES, MAX_FACTIONS, ownerTable } from '../src/core/entries';
import { pickedColor, PICK_WHITE } from '../src/core/pick-outline';
import { THEME, toMapTheme } from '../src/core/theme';
import { shadeTour } from '../src/core/tour-shade';
import { shadeTransition } from '../src/core/transition-shade';
import { createMapScene } from '../src/render/map-scene';
import { FRAGMENT_SHADER } from '../src/render/shader';

function chainEntries(count: number, factions: number): MapData {
  return {
    territories: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      owner: (i % factions) + 1,
      neighbors: [i, i + 2].filter((id) => id >= 1 && id <= count),
    })),
  };
}

describe('FR-640 65,535 faction ceiling and 16-bit owner table', () => {
  it('FR-640 MAX_FACTIONS matches MAX_ENTRIES (65,535)', () => {
    expect(MAX_FACTIONS).toBe(65535);
    expect(MAX_FACTIONS).toBe(MAX_ENTRIES);
  });

  it('FR-640 ownerTable returns Uint16Array encoding indices across the 8-bit/16-bit boundary (255, 256, 302, 65535)', () => {
    const map = chainEntries(6, 6);
    const index = buildEntryIndex(map, 6, 1, Uint32Array.from([1, 2, 3, 4, 5, 6]));
    const factionIndex = new Map<number, number>([
      [1, 1],
      [2, 255],
      [3, 256],
      [4, 257],
      [5, 302],
      [6, 65535],
    ]);
    const owners = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
    const table = ownerTable(index, owners, factionIndex);
    expect(table).toBeInstanceOf(Uint16Array);
    expect(Array.from(table)).toStrictEqual([0, 1, 255, 256, 257, 302, 65535]);
  });

  it('FR-640 ownerTable accepts a 302-faction map without throwing', () => {
    const map = chainEntries(410, 302);
    const index = buildEntryIndex(map, 1, 1, Uint32Array.from([1]));
    const factions = factionIndexOf(map);
    const owners = new Map(map.territories.map((t) => [t.id, (t as { owner: number }).owner]));
    const table = ownerTable(index, owners, factions);
    expect(table).toBeInstanceOf(Uint16Array);
    expect(table.length).toBe(411);
    expect(table[256]).toBe(256);
    expect(table[302]).toBe(302);
  });

  it('FR-640 ownerTable refuses more than 65,535 factions', () => {
    const map = chainEntries(2, 2);
    const index = buildEntryIndex(map, 2, 1, Uint32Array.from([1, 2]));
    const tooMany = new Map<number, number>();
    for (let i = 1; i <= 65536; i++) tooMany.set(i, i);
    expect(() => ownerTable(index, new Map(), tooMany)).toThrow(RangeError);
  });
});

describe('FR-645 RG8 owner textures, shader decoding, pick/tour and CPU references for indices >= 256', () => {
  const map = chainEntries(4, 4);
  const index = buildEntryIndex(map, 4, 1, Uint32Array.from([1, 2, 3, 4]));
  const colorList: Rgb[] = Array.from({ length: 303 }, (_, i) => [(i * 37) & 255, (i * 73) & 255, (i * 109) & 255]);

  it('FR-645 owners and before textures are RG8 (2 bytes per entry, low byte in R, high byte in G)', () => {
    const scene = createMapScene(index, colorList, toMapTheme(THEME));
    for (const tex of [scene.textures.owners, scene.textures.before]) {
      expect(tex.format).toBe(RGFormat);
      expect(tex.type).toBe(UnsignedByteType);
      expect(tex.minFilter).toBe(NearestFilter);
      expect(tex.magFilter).toBe(NearestFilter);
      expect(tex.colorSpace).toBe(NoColorSpace);
      expect(tex.image.width).toBe(index.ids.length);
      expect(tex.image.height).toBe(1);
      expect((tex.image.data as Uint8Array).length).toBe(index.ids.length * 2);
    }

    const v0 = [scene.textures.index.version, scene.textures.kinds.version, scene.textures.owners.version, scene.textures.colors.version];
    const table = Uint16Array.from([0, 255, 256, 302, 65535]);
    scene.setOwners(table);
    const v1 = [scene.textures.index.version, scene.textures.kinds.version, scene.textures.owners.version, scene.textures.colors.version];
    expect(v1).toStrictEqual([v0[0], v0[1], v0[2]! + 1, v0[3]]);
    expect(Array.from(scene.textures.owners.image.data as Uint8Array)).toStrictEqual([
      0, 0,
      255, 0,
      0, 1,
      46, 1,
      255, 255,
    ]);
  });

  it('FR-645 setFront uploads RG8 earlier owners and detects high-byte-only changes (256 -> 512)', () => {
    const scene = createMapScene(index, colorList, toMapTheme(THEME));
    const field = { x0: 0, y0: 0, width: 2, height: 1, values: new Float32Array([0, 0.5]) };
    const t1 = Uint16Array.from([0, 256, 256, 302, 302]);
    scene.setFront({ before: t1, field, forward: 0.25 });
    const v1 = scene.textures.before.version;
    expect(Array.from(scene.textures.before.image.data as Uint8Array)).toStrictEqual([
      0, 0,
      0, 1,
      0, 1,
      46, 1,
      46, 1,
    ]);
    // Same values -> no re-upload
    scene.setFront({ before: Uint16Array.from([0, 256, 256, 302, 302]), field, forward: 0.5 });
    expect(scene.textures.before.version).toBe(v1);
    // High-byte-only change (256 -> 512, both low byte 0) -> must re-upload!
    scene.setFront({ before: Uint16Array.from([0, 512, 256, 302, 302]), field, forward: 0.5 });
    expect(scene.textures.before.version).toBe(v1 + 1);
    expect(Array.from(scene.textures.before.image.data as Uint8Array).slice(2, 4)).toStrictEqual([0, 2]);
  });

  it('FR-645 setPick and setTour accept faction indices up to 65,535 and refuse 65,536', () => {
    const scene = createMapScene(index, colorList, toMapTheme(THEME));
    scene.setPick(256);
    expect(scene.material.uniforms.uPick!.value).toBe(256);
    scene.setPick(65535);
    expect(scene.material.uniforms.uPick!.value).toBe(65535);
    expect(() => scene.setPick(65536)).toThrow(RangeError);
    expect(() => scene.setPick(-1)).toThrow(RangeError);

    scene.setTour({ lit: [256, 65535], dim: 0.5 });
    const lit = scene.material.uniforms.uLit!.value as { x: number; y: number };
    expect([lit.x, lit.y]).toStrictEqual([256, 65535]);
    expect(() => scene.setTour({ lit: [65536], dim: 0.5 })).toThrow(RangeError);
  });

  it('FR-645 fragment shader decodes uOwners and uOwnersBefore as 16-bit RG8 values, never 8-bit byteAt', () => {
    expect(FRAGMENT_SHADER).not.toMatch(/byteAt\s*\(\s*uOwners\b/);
    expect(FRAGMENT_SHADER).not.toMatch(/byteAt\s*\(\s*uOwnersBefore\b/);
    expect(FRAGMENT_SHADER).toMatch(/u16At\s*\(\s*uOwners\s*,/);
    expect(FRAGMENT_SHADER).toMatch(/u16At\s*\(\s*uOwnersBefore\s*,/);
  });

  it('FR-645 CPU reference shading, fronts, tours and pick outline distinguish faction indices 255, 256 and 302', () => {
    const table = Uint16Array.from([0, 255, 256, 256, 302]);
    expect(borderClass(1, 2, index.fills, table)).toBe('faction');
    expect(borderClass(2, 3, index.fills, table)).toBe('territory');
    const shaded = shade(index, table, colorList, THEME, { x: 3.5, y: 0.5, scale: 8 }, { width: 8, height: 8 }, 4, 4);
    expect(shaded.color).toStrictEqual(colorList[302]);

    const before = Uint16Array.from([0, 255, 256, 256, 256]);
    const front = { x0: 3, y0: 0, width: 1, height: 1, values: new Float32Array([0.2]) };
    const step = shadeTransition(index, before, table, colorList, THEME, front, 0.5, { x: 3.5, y: 0.5, scale: 8 }, { width: 8, height: 8 }, 4, 4);
    expect(step.color).toStrictEqual(colorList[302]);

    const tour = shadeTour(index, table, colorList, THEME, [302], 0.5, { x: 3.5, y: 0.5, scale: 8 }, { width: 8, height: 8 }, 4, 4);
    expect(tour.color).toStrictEqual(colorList[302]);

    expect(pickedColor([10, 20, 30], 'faction', 302, 302)).toStrictEqual([...PICK_WHITE]);
    expect(pickedColor([10, 20, 30], 'faction', 256, 302)).toStrictEqual([10, 20, 30]);
  });
});

describe('FR-644 refusal screen and capability checks with 65,535 faction ceiling', () => {
  it('FR-644 checkCounts accepts 302 factions (world-1815 scale) and 65,535 factions', () => {
    expect(checkCounts(chainEntries(424, 302))).toStrictEqual([]);
    expect(checkCounts(chainEntries(65535, 65535))).toStrictEqual([]);
  }, 20_000);

  it('FR-644 checkCounts refuses > 65,535 entries and factions with territories named first', () => {
    const refusals = checkCounts(chainEntries(65536, 65536));
    expect(refusals).toStrictEqual([
      { kind: 'too-many-territories', count: 65536, limit: 65535 },
      { kind: 'too-many-factions', count: 65536, limit: 65535 },
    ]);
  }, 20_000);

  it('FR-644 checkCapabilities guards factionTableSize against maxTextureSize', () => {
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 512 }, 256, 256, 256, 512)).toStrictEqual([]);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 512 }, 256, 256, 256, 513)).toStrictEqual([
      { kind: 'texture-too-small', maxTextureSize: 512, required: 513 },
    ]);
  });
});
