// The layer of terra incognita (spec 010 FR-368, spec 015 FR-422/423): the dark table where the map does not cover the screen, the soft
// fade of the map edge into it, and a light vignette. It sits between the map canvas and the labels, never takes the pointer, and
// follows the camera: the bands come from `core/terra`, the colours and the fade from `core/table`.
import type { Camera, ImageSize, Viewport } from '../core/camera';
import { TABLE, tableFade, vignetteShadow } from '../core/table';
import { terraBands } from '../core/terra';

export interface Terra {
  /** Places the bands and the fade for this view; nothing is touched when the camera and the viewport are the ones of the last call. */
  place(camera: Camera, viewport: Viewport): void;
}

export function createTerra(after: HTMLElement, image: ImageSize): Terra {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden';
  layer.style.pointerEvents = 'none';
  after.after(layer);
  const nodes: HTMLElement[] = [];
  const fade = document.createElement('div');
  fade.style.position = 'absolute';
  layer.append(fade);
  const vignette = document.createElement('div');
  vignette.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;box-shadow:${vignetteShadow()}`;
  layer.append(vignette);
  let last: { x: number; y: number; scale: number; w: number; h: number } | undefined;
  return {
    place(camera, viewport) {
      if (last !== undefined && camera.x === last.x && camera.y === last.y && camera.scale === last.scale && viewport.width === last.w && viewport.height === last.h) return;
      last = { x: camera.x, y: camera.y, scale: camera.scale, w: viewport.width, h: viewport.height };
      const bands = terraBands(camera, viewport, image);
      while (nodes.length < bands.length) {
        const node = document.createElement('div');
        node.style.position = 'absolute';
        node.style.background = TABLE.ground;
        fade.before(node);
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
      });
      const soft = tableFade(camera, viewport, image);
      fade.hidden = soft === undefined;
      if (soft === undefined) return;
      fade.style.left = `${soft.rect.x}px`;
      fade.style.top = `${soft.rect.y}px`;
      fade.style.width = `${soft.rect.w}px`;
      fade.style.height = `${soft.rect.h}px`;
      fade.style.background = soft.background;
    },
  };
}
