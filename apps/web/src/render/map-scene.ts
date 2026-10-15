// The Three.js scene of the map (FR-134, FR-136 to FR-140, NFR-24): one full-screen quad drawn by one
// fragment shader. It knows the package views, the owner table and the camera, and nothing else
// (FR-159). Textures are uploaded once; a round change replaces only the owner table.
import {
  ColorManagement,
  DataTexture,
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
} from 'three';
import type { Rgb } from '@mbrg/shared';
import { BORDER_PRIORITY } from '../core/borders';
import type { Camera, Viewport } from '../core/camera';
import type { EntryIndex } from '../core/entries';
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
}

export interface MapScene {
  scene: Scene;
  camera: OrthographicCamera;
  material: RawShaderMaterial;
  textures: MapTextures;
  /** Replaces the owner table (one byte per entry, entries + 1 bytes). */
  setOwners(table: Uint8Array): void;
  setView(view: MapView): void;
}

/** Size of the drawing surface in device pixels: round(width x dpr) by round(height x dpr). */
export function deviceSize(vp: Viewport, dpr: number): { width: number; height: number } {
  return { width: Math.round(vp.width * dpr), height: Math.round(vp.height * dpr) };
}

/** A texture whose bytes reach the shader exactly as stored (FR-134). */
function exactTexture(data: Uint8Array, width: number, height: number, format: typeof RGFormat | typeof RedFormat | typeof RGBAFormat): DataTexture {
  const texture = new DataTexture(data, width, height, format, UnsignedByteType);
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
  };
}
