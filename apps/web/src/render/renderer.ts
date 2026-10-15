// The WebGL renderer around a map scene (FR-135, FR-136). On-demand drawing: nothing here loops.
import { LinearSRGBColorSpace, NoToneMapping, WebGLRenderer } from 'three';
import type { Capabilities } from '../core/capabilities';
import type { Viewport } from '../core/camera';
import { deviceSize } from './map-scene';
import type { MapScene } from './map-scene';

/** Renderer settings: the theme bytes reach the screen unchanged (no colour conversion, no blending). */
export const RENDERER_SETTINGS = {
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
  outputColorSpace: LinearSRGBColorSpace,
  toneMapping: NoToneMapping,
} as const;

export interface RendererHandle {
  /** Sets the drawing surface for a drawing area in CSS pixels and a device pixel ratio. */
  resize(vp: Viewport, dpr: number): void;
  /** Draws the scene once, now. */
  draw(): void;
  maxTextureSize: number;
}

/** What a throw-away context says about the browser's graphics (FR-135), before anything is built. */
export function probeCapabilities(): Capabilities {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (gl === null) return { webgl2: false, maxTextureSize: 0 };
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { webgl2: true, maxTextureSize };
}

/** Creates the renderer on a canvas. The caller has already passed `checkCapabilities`. */
export function attachRenderer(canvas: HTMLCanvasElement, mapScene: MapScene): RendererHandle {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: RENDERER_SETTINGS.antialias,
    alpha: RENDERER_SETTINGS.alpha,
    depth: RENDERER_SETTINGS.depth,
    stencil: RENDERER_SETTINGS.stencil,
    premultipliedAlpha: RENDERER_SETTINGS.premultipliedAlpha,
    powerPreference: RENDERER_SETTINGS.powerPreference,
  });
  renderer.outputColorSpace = RENDERER_SETTINGS.outputColorSpace;
  renderer.toneMapping = RENDERER_SETTINGS.toneMapping;
  renderer.autoClear = false;
  return {
    resize(vp: Viewport, dpr: number): void {
      const size = deviceSize(vp, dpr);
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
    },
    draw(): void {
      renderer.render(mapScene.scene, mapScene.camera);
    },
    maxTextureSize: renderer.capabilities.maxTextureSize,
  };
}
