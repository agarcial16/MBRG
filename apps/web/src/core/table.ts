// The dark table (spec 015 FR-422, FR-423, FR-425, FR-431): the ground the map lies on. Pure parameters and geometry: the colours of the
// wood, the soft fade of the map image edge into it, the translucent HUD panels. The shell (`ui/live-terra.ts`) draws; the stylesheet
// reads the colours from here. The fade is static work: its rectangle changes only when the camera does.
import { mapToScreen } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import type { ScreenRect } from './terra';

export const TABLE = {
  /** The flat wood tone of the bands outside the map; the fade ends exactly on it, so the join cannot show. */
  ground: '#15100c',
  /** The page behind the start, create, join and lobby screens: a lit centre and dark edges. */
  centre: '#1f1812',
  edge: '#0c0906',
  /** Strength of the light vignette over the whole screen (0 to 1, black). */
  vignette: 0.42,
  /** The fade of the image edge: full ground at the edge, nothing `depth` screen pixels inside, eased (smoothstep) so no step shows. */
  fade: { depth: 110, stops: 10 },
  /** A fade never eats more than this share of the shorter side of the visible image, so a tiny map keeps a centre. */
  fadeShare: 0.22,
  /** The desk panels: the wood tone at this opacity over the map, with a blur of the map behind. */
  panel: { rgb: '18,14,10', alpha: 0.86, blur: 6 },
} as const;

/** The fade depth for an image whose shorter visible side is `side` screen pixels. */
export function fadeDepth(side: number): number {
  const k = Math.max(0, Math.min(1, (side * TABLE.fadeShare) / TABLE.fade.depth));
  return Math.round(TABLE.fade.depth * k * 100) / 100;
}

/** The opacity of the fade at `t` (0 at the image edge, 1 at the full depth): 1 at the edge, 0 inside, eased between. */
export function fadeAlpha(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - c * c * (3 - 2 * c);
}

/** The colour stops of one strip, from the edge inwards: the ground tone at `fadeAlpha`, ending on transparent. */
function strip(direction: string, depth: number): string {
  const [r, g, b] = [parseInt(TABLE.ground.slice(1, 3), 16), parseInt(TABLE.ground.slice(3, 5), 16), parseInt(TABLE.ground.slice(5, 7), 16)];
  const stops: string[] = [];
  for (let i = 0; i <= TABLE.fade.stops; i++) {
    const t = i / TABLE.fade.stops;
    stops.push(`rgba(${r},${g},${b},${Math.round(fadeAlpha(t) * 1000) / 1000}) ${Math.round(t * depth * 100) / 100}px`);
  }
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

export interface TableFade {
  /** The screen rectangle of the fade element: the image on screen, kept within the viewport plus a margin that hides the cut edges. */
  readonly rect: ScreenRect;
  /** The `background` that draws the fade: four eased strips along the four edges of the rectangle. */
  readonly background: string;
}

/**
 * The fade of the map edge for this view, or undefined when the image is not on screen. The rectangle is the image's own screen
 * rectangle cut at the viewport grown by the fade's reach: a cut edge is off screen, so only the real edges of the image fade, at any
 * zoom, and the element never gets the size of a zoomed-in map.
 */
export function tableFade(camera: Camera, viewport: Viewport, image: ImageSize): TableFade | undefined {
  const a = mapToScreen(camera, { x: 0, y: 0 }, viewport);
  const b = mapToScreen(camera, { x: image.w, y: image.h }, viewport);
  const x0 = a.sx;
  const y0 = a.sy;
  const x1 = b.sx;
  const y1 = b.sy;
  if (x1 <= 0 || y1 <= 0 || x0 >= viewport.width || y0 >= viewport.height) return undefined;
  const depth = fadeDepth(Math.min(x1 - x0, y1 - y0));
  const reach = depth;
  const left = Math.max(x0, -reach);
  const top = Math.max(y0, -reach);
  const right = Math.min(x1, viewport.width + reach);
  const bottom = Math.min(y1, viewport.height + reach);
  return { rect: { x: left, y: top, w: right - left, h: bottom - top }, background: [strip('to bottom', depth) + ' 0 0 / 100% ' + depth + 'px no-repeat', strip('to top', depth) + ' 0 100% / 100% ' + depth + 'px no-repeat', strip('to right', depth) + ' 0 0 / ' + depth + 'px 100% no-repeat', strip('to left', depth) + ' 100% 0 / ' + depth + 'px 100% no-repeat'].join(', ') };
}

/** The wood of the page (start, create, join and lobby screens, FR-431) and its vignette, as stylesheet text. */
export function pageCss(): string {
  return [
    `:root { --hud-panel: ${panelColour()}; }`,
    `html { background: ${TABLE.edge}; }`,
    `body { background: radial-gradient(ellipse at 50% 38%, ${TABLE.centre} 0%, ${TABLE.edge} 78%) fixed; }`,
    `body::before { content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none; box-shadow: inset 0 0 180px rgba(0, 0, 0, ${TABLE.vignette}); }`,
  ].join('\n');
}

/** The vignette drawn over the match map, as an `inset` shadow. */
export const vignetteShadow = (): string => `inset 0 0 180px rgba(0, 0, 0, ${TABLE.vignette})`;

/** The translucent desk panel as a CSS colour. */
export const panelColour = (): string => `rgba(${TABLE.panel.rgb}, ${TABLE.panel.alpha})`;

/** The colour a translucent panel has over a backdrop, as #rrggbb (for the contrast check of NFR-84). */
export function overBackdrop(backdrop: string): string {
  const [r, g, b] = TABLE.panel.rgb.split(',').map(Number) as [number, number, number];
  const mix = (own: number, at: number): string => Math.round(own * TABLE.panel.alpha + parseInt(backdrop.slice(at, at + 2), 16) * (1 - TABLE.panel.alpha)).toString(16).padStart(2, '0');
  return `#${mix(r, 1)}${mix(g, 3)}${mix(b, 5)}`;
}
