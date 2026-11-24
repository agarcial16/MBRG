import { isValidName } from '@mbrg/shared';
import { rasterize, WATER } from '../core/rasterize';
import type { SourcePolygon } from '../core/types';
import { polygonsOf } from './pixels';
import type { ReadSource } from './types';
import { antimeridianErrors, visiblePolygons, type View, type ViewSet } from './views';

/**
 * Spec 035, FR-679 and FR-694: real names for tiles. A names file is a GeoJSON of named polygons (Natural Earth's marine
 * areas); each tile takes the name of the polygon that covers most of it, the smallest polygon winning each pixel, and a
 * tile with no covered pixel keeps its basin's name. Pure and deterministic (NFR-175).
 */

/** The longest name 003a FR-87 allows, in code points. */
export const NAME_MAX_CODE_POINTS = 80;

/** One named polygon feature of a names file, in the order that decides ties (smallest area first, then file order). */
export interface NameFeature {
  name: string;
  /** Position of the feature in the file. */
  index: number;
  /** The area in square degrees of longitude and latitude (outer rings minus holes): only an order, never a measure. */
  area: number;
  polygons: SourcePolygon[];
}

function ringArea(coords: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) sum += (coords[j]![0] + coords[i]![0]) * (coords[j]![1] - coords[i]![1]);
  return Math.abs(sum) / 2;
}

/**
 * FR-694: the features of a names file with a name, smallest area first (ties to the lower file position). A feature's
 * name is the first of `nameProperty` that is present as a valid name (003a FR-87); a feature with none is skipped,
 * never an error. Reading the property value is the own-property rule (the reader gives plain objects).
 */
export function nameFeatures(source: ReadSource, nameProperty: readonly string[]): NameFeature[] {
  const out: NameFeature[] = [];
  for (const feature of source.features) {
    let name: string | undefined;
    for (const property of nameProperty) {
      const value = Object.hasOwn(feature.props, property) ? feature.props[property] : undefined;
      if (isValidName(value)) {
        name = value;
        break;
      }
    }
    if (name === undefined) continue;
    let area = 0;
    for (const polygon of feature.polygons) area += ringArea(polygon.outer.coords) - polygon.holes.reduce((n, hole) => n + ringArea(hole.coords), 0);
    out.push({ name, index: feature.index, area, polygons: feature.polygons });
  }
  return out.sort((a, b) => a.area - b.area || a.index - b.index);
}

/** The result of rasterising the names: per pixel the 1-based rank of the covering feature (0 none), and the skipped features. */
export interface NameRaster {
  ranks: Uint32Array;
  /** FR-694: the features a view could not draw (an antimeridian edge in an `equal-earth` view), skipped with a warning. */
  skipped: number[];
}

/**
 * FR-694: the polygons are projected and rasterised like context features (the same centre-point rule and views, the
 * same ignore rule beyond 90 degrees for `laea`), smallest first, so a pixel takes the smallest polygon that covers its
 * centre; a polygon the projection cannot draw is skipped, never an error.
 */
export function rasterizeNames(views: ViewSet, features: readonly NameFeature[]): NameRaster {
  const skipped = new Set<number>();
  const layersOf = (view: View): { value: number; polygons: SourcePolygon[] }[] => {
    const drawable = new Set<number>();
    const blocked = antimeridianErrors(
      view,
      features.map((f) => ({ origin: { file: 'names', feature: f.index }, polygons: f.polygons })),
    );
    const blockedIndex = new Set(blocked.flatMap((e) => ('feature' in e ? [e.feature] : [])));
    features.forEach((f, rank) => {
      if (blockedIndex.has(f.index)) skipped.add(f.index);
      else drawable.add(rank);
    });
    return features.map((f, rank) => ({
      value: rank + 1,
      polygons: drawable.has(rank) ? polygonsOf(view, visiblePolygons(view, f.polygons)) : [],
    }));
  };
  const main = rasterize(views.main.side, layersOf(views.main));
  for (const inset of views.insets) {
    const raster = rasterize(inset.side, layersOf(inset));
    const { x, y, w, h } = inset.rect;
    for (let row = 0; row < h; row++) main.set(raster.subarray(row * inset.side, row * inset.side + w), (y + row) * views.width + x);
  }
  for (let i = 0; i < main.length; i++) if (main[i] === WATER) main[i] = 0;
  return { ranks: main, skipped: [...skipped].sort((a, b) => a - b) };
}

/**
 * FR-679: per tile, the rank of the feature that covers most of its pixels (ties to the smaller area, which is the
 * lower rank), or -1 when no pixel of the tile is covered.
 */
export function dominantFeatures(labels: Int32Array, tileCount: number, ranks: Uint32Array, featureCount: number): Int32Array {
  const counts = new Map<number, number>();
  const stride = featureCount + 1;
  let lastKey = -1;
  let run = 0;
  const flush = (): void => {
    if (lastKey >= 0) counts.set(lastKey, (counts.get(lastKey) ?? 0) + run);
  };
  for (let i = 0; i < labels.length; i++) {
    const t = labels[i]!;
    if (t < 0) continue;
    const rank = ranks[i]!;
    if (rank === 0) continue;
    const key = t * stride + rank;
    if (key === lastKey) run++;
    else {
      flush();
      lastKey = key;
      run = 1;
    }
  }
  flush();
  const best = new Int32Array(tileCount).fill(-1);
  const bestCount = new Float64Array(tileCount);
  for (const [key, count] of counts) {
    const t = Math.floor(key / stride);
    const rank = key % stride;
    if (count > bestCount[t]! || (count === bestCount[t] && rank - 1 < best[t]!)) {
      bestCount[t] = count;
      best[t] = rank - 1;
    }
  }
  return best;
}

/**
 * FR-679, FR-696: the final names. Names used by more than one tile are numbered `<name> <n>` (one space, decimal, from
 * 1, in tile order across the map); a name used once stays as it is; a generated name that collides with any other name
 * of the map skips to the next number, so every name is unique.
 */
export function numberRepeatedNames(bases: readonly string[]): string[] {
  const uses = new Map<string, number>();
  for (const name of bases) uses.set(name, (uses.get(name) ?? 0) + 1);
  const taken = new Set<string>(bases.filter((name) => uses.get(name) === 1));
  const next = new Map<string, number>();
  return bases.map((name) => {
    if (uses.get(name) === 1) return name;
    let n = next.get(name) ?? 1;
    let candidate = `${name} ${n}`;
    while (taken.has(candidate) || uses.has(candidate)) candidate = `${name} ${++n}`;
    taken.add(candidate);
    next.set(name, n + 1);
    return candidate;
  });
}
