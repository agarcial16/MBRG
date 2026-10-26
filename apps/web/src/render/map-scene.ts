// The Three.js scene of the map (FR-134, FR-136 to FR-140, NFR-24): one full-screen quad drawn by one
// fragment shader. It knows the package views, the owner table and the camera, and nothing else
// (FR-159). Textures are uploaded once; a round change replaces only the owner table.
import {
  ColorManagement,
  DataTexture,
  FloatType,
  GLSL3,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RGFormat,
  RawShaderMaterial,
  RedFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Rgb } from '@mbrg/shared';
import { BORDER_PRIORITY } from '../core/borders';
import type { Camera, Viewport } from '../core/camera';
import type { EntryIndex } from '../core/entries';
import type { FrontField } from '../core/front';
import { territoryOpacity } from '../core/lines';
import type { MapTheme } from '../core/theme';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';

/** The camera and the drawing area: everything the drawing needs to know about the view. */
export interface MapView {
  camera: Camera;
  viewport: Viewport;
  dpr: number;
}

export interface MapTextures {
  /** RG8 entry index of every map unit. Uploaded once. */
  index: DataTexture;
  /** R8 fill class per entry. Uploaded once. */
  kinds: DataTexture;
  /** R8 faction index per entry: the only texture a round change touches. */
  owners: DataTexture;
  /** RGBA8 fill colour per faction index. Uploaded once. */
  colors: DataTexture;
  /** R8 faction index per entry at the earlier state of a step. Uploaded by `setFront` only. */
  before: DataTexture;
  /** R32F normalised front distance over the front box. Replaced by `setFront` when the field changes. */
  front: DataTexture;
}

/**
 * Everything the drawing needs to show a step in progress (FR-188): the owner table of the earlier state (the
 * table given to `setOwners` is the later state), the front distances of the moving pieces, and the forward
 * fraction f. A field is not changed after it is handed over.
 */
export interface MapFront {
  before: Uint8Array;
  field: FrontField;
  forward: number;
}

export interface MapScene {
  scene: Scene;
  camera: OrthographicCamera;
  material: RawShaderMaterial;
  textures: MapTextures;
  /** Replaces the owner table (one byte per entry, entries + 1 bytes). */
  setOwners(table: Uint8Array): void;
  setView(view: MapView): void;
  /**
   * Draws the colour front of a step (FR-179, FR-180), or the plain drawing again when called with undefined.
   * A forward fraction of 1 is the later state itself, so it turns the front off. The earlier table is
   * uploaded when its contents change and the field when it is a different one; a further fraction only
   * changes a uniform.
   */
  setFront(front: MapFront | undefined): void;
  /**
   * Dims every map unit that is not land of a lit faction (FR-326), or draws the plain map again when called
   * with undefined or a dim of 0 (FR-355). Lit factions are faction indices, at most two. It changes two
   * uniforms and uploads nothing; it is given lit indices and a dim, never a result (FR-353).
   */
  setTour(tour: MapTour | undefined): void;
}

/** What the drawing gets of a reveal tour frame: the lit faction indices and the dim in 0..1. */
export interface MapTour {
  lit: readonly number[];
  dim: number;
}

/** Size of the drawing surface in device pixels: round(width x dpr) by round(height x dpr). */
export function deviceSize(vp: Viewport, dpr: number): { width: number; height: number } {
  return { width: Math.round(vp.width * dpr), height: Math.round(vp.height * dpr) };
}

/** A texture whose bytes reach the shader exactly as stored (FR-134). */
function exactTexture(
  data: Uint8Array | Float32Array,
  width: number,
  height: number,
  format: typeof RGFormat | typeof RedFormat | typeof RGBAFormat,
  type: typeof UnsignedByteType | typeof FloatType = UnsignedByteType,
): DataTexture {
  const texture = new DataTexture(data, width, height, format, type);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.colorSpace = NoColorSpace;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const rgb01 = (c: Rgb): Vector3 => new Vector3(c[0] / 255, c[1] / 255, c[2] / 255);

/**
 * Builds the scene for a checked package. `factionColors` is indexed by faction index (slot 0 is a
 * placeholder). The owner table starts empty; call `setOwners` and `setView` before the first draw.
 */
export function createMapScene(index: EntryIndex, factionColors: readonly Rgb[], theme: MapTheme): MapScene {
  // The theme bytes must reach the screen unchanged: no colour conversion anywhere.
  ColorManagement.enabled = false;

  const entries = index.ids.length;
  const kindBytes = new Uint8Array(entries);
  index.fills.forEach((fill, i) => (kindBytes[i] = fill === 'outside' ? 0 : fill === 'land' ? 1 : 2));
  const colorBytes = new Uint8Array(factionColors.length * 4);
  factionColors.forEach((c, i) => colorBytes.set([c[0], c[1], c[2], 255], i * 4));

  const textures: MapTextures = {
    index: exactTexture(index.indexPixels, index.width, index.height, RGFormat),
    kinds: exactTexture(kindBytes, entries, 1, RedFormat),
    owners: exactTexture(new Uint8Array(entries), entries, 1, RedFormat),
    colors: exactTexture(colorBytes, factionColors.length, 1, RGBAFormat),
    // Placeholders until the first `setFront`: every sampler needs a texture, none is read while the front is off.
    before: exactTexture(new Uint8Array(entries), entries, 1, RedFormat),
    front: exactTexture(new Float32Array([-1]), 1, 1, RedFormat, FloatType),
  };

  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uIndex: { value: textures.index },
      uKinds: { value: textures.kinds },
      uOwners: { value: textures.owners },
      uColors: { value: textures.colors },
      uOwnersBefore: { value: textures.before },
      uFront: { value: textures.front },
      uFrontBox: { value: new Vector4() },
      uFrontOn: { value: 0 },
      uProgress: { value: 0 },
      uDim: { value: 0 },
      uLit: { value: new Vector2() },
      uImage: { value: new Vector2(index.width, index.height) },
      uCenterCell: { value: new Vector2() },
      uCenterFrac: { value: new Vector2() },
      uViewport: { value: new Vector2() },
      uDevice: { value: new Vector2() },
      uScale: { value: 1 },
      uDpr: { value: 1 },
      uSea: { value: rgb01(theme.sea) },
      uOutside: { value: rgb01(theme.outside) },
      uBorderColors: { value: BORDER_PRIORITY.map((c) => (c === 'territory' ? new Vector3() : rgb01(theme.border[c]))) },
      uWidths: { value: BORDER_PRIORITY.map((c) => theme.width[c]) },
      uTerritoryOpacity: { value: 0 },
      uTerritoryDarken: { value: theme.territoryLine.darken },
    },
  });

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const u = material.uniforms;
  // What the placeholder-or-real textures currently hold, to upload only what changed.
  let shownField: FrontField | undefined;
  return {
    scene,
    camera,
    material,
    textures,
    setOwners(table: Uint8Array): void {
      if (table.length !== entries) throw new RangeError(`owner table has ${table.length} bytes, expected ${entries}`);
      (textures.owners.image.data as Uint8Array).set(table);
      textures.owners.needsUpdate = true;
    },
    setView(view: MapView): void {
      const cam = view.camera;
      const cellX = Math.floor(cam.x);
      const cellY = Math.floor(cam.y);
      const device = deviceSize(view.viewport, view.dpr);
      (u.uCenterCell!.value as Vector2).set(cellX, cellY);
      (u.uCenterFrac!.value as Vector2).set(cam.x - cellX, cam.y - cellY);
      (u.uViewport!.value as Vector2).set(view.viewport.width, view.viewport.height);
      (u.uDevice!.value as Vector2).set(device.width, device.height);
      u.uScale!.value = cam.scale;
      u.uDpr!.value = view.dpr;
      u.uTerritoryOpacity!.value = territoryOpacity(cam.scale, theme.territoryLine);
    },
    setFront(front: MapFront | undefined): void {
      if (front === undefined) {
        u.uFrontOn!.value = 0;
        return;
      }
      const { before, field, forward } = front;
      if (!(forward >= 0 && forward <= 1)) throw new RangeError(`forward progress ${forward} is not in 0..1`);
      if (before.length !== entries) throw new RangeError(`earlier owner table has ${before.length} bytes, expected ${entries}`);
      if (field.values.length !== field.width * field.height) {
        throw new RangeError(`front field has ${field.values.length} values, expected ${field.width * field.height}`);
      }
      if (forward === 1) {
        u.uFrontOn!.value = 0;
        return;
      }

      const held = textures.before.image.data as Uint8Array;
      if (!held.every((byte, i) => byte === before[i])) {
        held.set(before);
        textures.before.needsUpdate = true;
      }
      if (field !== shownField) {
        const empty = field.width <= 0 || field.height <= 0;
        const next = empty
          ? exactTexture(new Float32Array([-1]), 1, 1, RedFormat, FloatType)
          : exactTexture(field.values, field.width, field.height, RedFormat, FloatType);
        textures.front.dispose();
        textures.front = next;
        u.uFront!.value = next;
        (u.uFrontBox!.value as Vector4).set(field.x0, field.y0, Math.max(field.width, 0), Math.max(field.height, 0));
        shownField = field;
      }
      u.uProgress!.value = forward;
      u.uFrontOn!.value = 1;
    },
    setTour(tour: MapTour | undefined): void {
      if (tour === undefined) {
        u.uDim!.value = 0;
        (u.uLit!.value as Vector2).set(0, 0);
        return;
      }
      const { lit, dim } = tour;
      if (!(dim >= 0 && dim <= 1)) throw new RangeError(`tour dim ${dim} is not in 0..1`);
      if (lit.length > 2) throw new RangeError(`a tour lights at most 2 factions, got ${lit.length}`);
      for (const f of lit) if (!Number.isInteger(f) || f < 0 || f > 255) throw new RangeError(`lit faction index ${f} is not a byte`);
      u.uDim!.value = dim;
      // One lit faction fills both slots; a missing one is 0, the index of no owner (never lit).
      (u.uLit!.value as Vector2).set(lit[0] ?? 0, lit[1] ?? lit[0] ?? 0);
    },
  };
}
