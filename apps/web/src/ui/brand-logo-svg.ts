// Inline SVG builder for Logo 1 (spec 030 FR-611), shared by the start menu landing and the match screen HUD bar.
import { LOGO_CROWN, LOGO_REGIONS, LOGO_VIEWBOX } from '../core/brand-logo';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Readonly<Record<string, string>>, parent: SVGElement): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

/** Builds Logo 1 (faceted muted map regions topped by a golden crown) as an inline SVG. */
export function buildBrandLogo(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', LOGO_VIEWBOX);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const points of LOGO_CROWN.diamonds) {
    svgEl('polygon', { points, fill: 'var(--hud-gilt)' }, svg);
  }
  svgEl('polygon', { points: LOGO_CROWN.bodyLeft, fill: 'var(--hud-gilt)' }, svg);
  svgEl('polygon', { points: LOGO_CROWN.bodyRight, fill: 'var(--hud-gilt-dim)' }, svg);
  svgEl('rect', {
    x: String(LOGO_CROWN.band.x),
    y: String(LOGO_CROWN.band.y),
    width: String(LOGO_CROWN.band.width),
    height: String(LOGO_CROWN.band.height),
    rx: String(LOGO_CROWN.band.rx),
    fill: 'var(--hud-gilt)',
  }, svg);

  for (const region of LOGO_REGIONS) {
    svgEl('polygon', {
      points: region.points,
      fill: region.fill,
      stroke: 'var(--hud-umber)',
      'stroke-width': '1.4',
      'stroke-linejoin': 'round',
    }, svg);
  }
  return svg;
}
