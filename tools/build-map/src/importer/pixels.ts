import type { Result } from '@mbrg/shared';
import { rasterize, type RasterLayer } from '../core/rasterize';
import { toPixelPolygons } from '../core/rings';
import type { SourcePolygon } from '../core/types';
import type { Unit } from './units';
import { insetHidesLand, visiblePolygons, type InsetError, type View, type ViewSet } from './views';

/** One value of the image and the selected units that make it up (a land territory, or the units of a sea zone). */
export interface PixelLayer {
  /** The map id of the entry (a land territory id, or the id of a sea zone). */
  value: number;
  units: readonly Unit[];
}

/** What the pixel step takes. */
export interface PixelInput {
  views: ViewSet;
  /** The land territories in map order (FR-605): a pixel in several goes to the first. */
  land: readonly PixelLayer[];
  /** The sea zones' units in the order of the zones (FR-605): they take only the water the land layers leave. */
  seas: readonly PixelLayer[];
  /** The polygons of every context feature, in list order (FR-589): other land, never units. */
  context: readonly (readonly SourcePolygon[])[];
  /** The excluded units and every unselected primary unit, in unit order: other land, never water. */
  other: readonly Unit[];
}

/** The raster layers of one view: land in map order, then ONE value-0 layer of other land, then the sea units. */
function layersOf(view: View, members: ReadonlySet<Unit>, input: PixelInput): RasterLayer[] {
  const polygonsOf = (polygons: readonly SourcePolygon[]): SourcePolygon[] => toPixelPolygons([{ props: {}, polygons: [...polygons] }], view.toUV);
  const layer = (entry: PixelLayer): RasterLayer => ({
    value: entry.value,
    polygons: entry.units.filter((unit) => members.has(unit)).flatMap((unit) => polygonsOf(unit.polygons)),
  });
  const layers = input.land.map(layer);
  // other land: context features in list order, then the excluded and unselected units; a Lambert view ignores a
  // polygon with a vertex beyond 90 degrees of arc from its centre (003b is silent: the dev data is far smaller)
  const otherPolygons: SourcePolygon[] = [];
  const add = (polygons: readonly SourcePolygon[]): void => {
    for (const polygon of polygonsOf(visiblePolygons(view, polygons))) otherPolygons.push(polygon);
  };
  for (const polygons of input.context) add(polygons);
  for (const unit of input.other) add(unit.polygons);
  layers.push({ value: 0, polygons: otherPolygons });
  for (const entry of input.seas) layers.push(layer(entry));
  return layers;
}

/**
 * FR-589, FR-602: assigns every pixel of the composed image by its centre (003b FR-115, `rasterize` unchanged), never
 * blending or inventing a value: the land territories in map order win, then other land (value 0: context features, the
 * excluded and the unselected primary units, never water), then the sea units, else water (`WATER`). Each view is
 * rasterized at its own side: the main view W x W, each inset its own square of side max(w, h), whose rectangle is
 * blitted to its place; no second W x W buffer exists. The pixels inside an inset rectangle come only from that inset's
 * projection. `inset-hides-land` fails when the main projection gives a pixel of a rectangle to a land territory.
 */
export function composePixels(input: PixelInput): Result<Uint32Array, InsetError> {
  const { views } = input;
  const main = rasterize(views.main.side, layersOf(views.main, new Set(views.mainUnits), input));
  const landValues = new Set(input.land.map((entry) => entry.value));
  const hidden = insetHidesLand(views, main, (value) => landValues.has(value));
  if (hidden.length > 0) return { ok: false, errors: hidden };
  for (const inset of views.insets) {
    const raster = rasterize(inset.side, layersOf(inset, new Set(inset.units), input));
    const { x, y, w, h } = inset.rect;
    for (let row = 0; row < h; row++) main.set(raster.subarray(row * inset.side, row * inset.side + w), (y + row) * views.width + x);
  }
  return { ok: true, value: main };
}
