// The layer of terra incognita (spec 010 FR-368): the parchment texture where the map does not cover the screen. It sits between the
// map canvas and the labels, never takes the pointer, and follows the camera: the bands and the texture come from `core/terra`.
import type { Camera, ImageSize, Viewport } from '../core/camera';
import { TERRA_TILE, terraBands, terraOffset } from '../core/terra';

export interface Terra {
  /** Places the bands for this view; nothing is touched when the camera and the viewport are the ones of the last call. */
  place(camera: Camera, viewport: Viewport): void;
}

export function createTerra(after: HTMLElement, image: ImageSize): Terra {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden';
  layer.style.pointerEvents = 'none';
  after.after(layer);
  const nodes: HTMLElement[] = [];
  let last: { x: number; y: number; scale: number; w: number; h: number } | undefined;
  return {
    place(camera, viewport) {
      if (last !== undefined && camera.x === last.x && camera.y === last.y && camera.scale === last.scale && viewport.width === last.w && viewport.height === last.h) return;
      last = { x: camera.x, y: camera.y, scale: camera.scale, w: viewport.width, h: viewport.height };
      const bands = terraBands(camera, viewport, image);
      const offset = terraOffset(camera, viewport);
      while (nodes.length < bands.length) {
        const node = document.createElement('div');
        node.style.position = 'absolute';
        node.style.backgroundImage = `url(${TERRA_TILE.url})`;
        layer.append(node);
        nodes.push(node);
      }
      nodes.forEach((node, i) => {
        const band = bands[i];
        node.hidden = band === undefined;
        if (band === undefined) return;
        node.style.left = `${band.x}px`;
        node.style.top = `${band.y}px`;
        node.style.width = `${band.w}px`;
        node.style.height = `${band.h}px`;
        node.style.backgroundSize = `${offset.w}px ${offset.h}px`;
        node.style.backgroundPosition = `${offset.x - band.x}px ${offset.y - band.y}px`;
      });
    },
  };
}
