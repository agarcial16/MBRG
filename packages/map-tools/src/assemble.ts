import { validateMap, type MapFormatV1, type Territory } from '@mbrg/shared';

import type { AdjacencyResult } from './adjacency.js';
import type { ContourResult } from './contours.js';
import type { ColorRegion, FlatColorResult } from './flatColors.js';
import type { RGB } from './raster.js';

/**
 * Assemble detected regions into a `MapFormatV1` map.
 *
 * The pieces are already computed: labels gave the regions, adjacency gave the
 * borders and contours gave the outlines. This step only turns them into
 * territories and runs the map through `validateMap` — the same validation the
 * rest of the project uses, so an imported map is held to exactly the same
 * standard as a hand-made one.
 *
 * Ring orientation is left as traced. Nothing downstream depends on it: canvas
 * fills the zones with the even-odd rule, and point-in-polygon and the signed
 * area are orientation-independent.
 */

export interface AssemblyOptions {
  /** Map name. */
  name: string;
  /** Territory ids are `${idPrefix}${index}`. */
  idPrefix?: string;
}

export interface TerritorySummary {
  id: string;
  /** Region index in the detection result. */
  index: number;
  /** Representative colour, kept for the UI overlay only. Never in the map. */
  color: RGB;
  /** Area in pixels². */
  area: number;
  neighbors: string[];
  /** No land neighbour: needs a maritime link or it is unreachable. */
  island: boolean;
  /** Land falls in several disconnected pieces, which one polygon cannot hold. */
  split: boolean;
  /** Only borders another region at a corner. */
  cornerOnly: boolean;
}

export interface AssemblyResult {
  map: MapFormatV1;
  territories: TerritorySummary[];
  errors: string[];
  warnings: string[];
}

/** Territory id for a region index. */
export function territoryId(index: number, prefix = 'p'): string {
  return `${prefix}${index}`;
}

export function assembleMap(
  flat: FlatColorResult,
  adjacency: AdjacencyResult,
  contours: ContourResult,
  options: AssemblyOptions,
): AssemblyResult {
  const prefix = options.idPrefix ?? 'p';
  // A region that touches others only at corners has no land border at all.
  const cornerTouching = new Set(adjacency.cornerTouches.flat());
  const warnings: string[] = [];

  const territories: Territory[] = [];
  const summaries: TerritorySummary[] = [];

  for (const region of flat.regions) {
    const id = territoryId(region.index, prefix);
    const rings = contours.ringsByRegion.get(region.index) ?? [];
    if (rings.length === 0) {
      warnings.push(`region ${id} (${describeColor(region)}) has no outline and was skipped`);
      continue;
    }

    const neighbors = (adjacency.neighbors.get(region.index) ?? []).map((n) => territoryId(n, prefix));
    const holes = (contours.holesByRegion.get(region.index) ?? []).map((loop) => loop.points);
    const island = adjacency.islands.includes(region.index);
    const territory: Territory = {
      id,
      name: id,
      neighbors,
      polygon: rings[0].points,
      ...(holes.length > 0 ? { holes } : {}),
    };
    territories.push(territory);

    const split = rings.length > 1;
    if (split) {
      warnings.push(
        `region ${id} (${describeColor(region)}) is split into ${rings.length} pieces; ` +
          'only the largest outline is kept — merge it with a neighbour or redraw the map',
      );
    }
    if (island) {
      warnings.push(
        `region ${id} (${describeColor(region)}) is an island: it borders no other region, ` +
          'so it needs a sea link to be reachable',
      );
    }
    summaries.push({
      id,
      index: region.index,
      color: region.color,
      area: region.area,
      neighbors,
      island,
      split,
      cornerOnly: island && cornerTouching.has(region.index),
    });
  }

  const ambiguous = contours.loops.filter((l) => l.ambiguous);
  if (ambiguous.length > 0) {
    warnings.push(
      `${ambiguous.length} outline(s) cross diagonally where four regions meet; ` +
        'their shape is approximate — nudge the borders so they do not touch at a point',
    );
  }
  if (flat.ignoredPixels > 0) {
    warnings.push(
      `${flat.ignoredPixels} px were skipped as sea, borders or speckle out of ${flat.width * flat.height}`,
    );
  }

  const map: MapFormatV1 = {
    version: 1,
    name: options.name,
    width: flat.width,
    height: flat.height,
    territories,
  };

  // Same validation as any other map: an imported map earns no exemption.
  const validation = validateMap(map);
  for (const warning of validation.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  return { map, territories: summaries, errors: validation.errors, warnings };
}

function describeColor(region: ColorRegion): string {
  return `#${region.color.toString(16).padStart(6, '0')}`;
}
