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
  /**
   * Findings, structured rather than pre-formatted. The import screen speaks
   * two languages and these strings are its most-read text, so the code and its
   * parameters travel instead of a sentence written in one of them.
   */
  issues: ImportIssue[];
  /** Issues that block playing the map. */
  errors: ImportIssue[];
  /** Issues worth telling the user about, but playable anyway. */
  warnings: ImportIssue[];
}

export type ImportIssueCode =
  | 'regionWithoutOutline'
  | 'regionSplit'
  | 'island'
  | 'diagonalCrossings'
  | 'skippedPixels'
  | 'invalid';

export interface ImportIssue {
  code: ImportIssueCode;
  /** About the specific region, for the codes that name one. */
  params: { id: string; color: string; pieces?: number };
  /** Totals, for the codes that are not about one region. */
  numbers?: { count: number; total: number };
  /** The original message, for logs and as a fallback. */
  detail: string;
}

/** English rendering, for logs and for a future CLI. */
export function formatIssue(issue: ImportIssue): string {
  const { id, color, pieces } = issue.params;
  const count = issue.numbers?.count ?? 0;
  const total = issue.numbers?.total ?? 0;
  switch (issue.code) {
    case 'regionWithoutOutline':
      return `region ${id} (${color}) has no outline and was skipped`;
    case 'regionSplit':
      return `region ${id} (${color}) is split into ${pieces} pieces; only the largest outline is kept — merge it with a neighbour or redraw the map`;
    case 'island':
      return `region ${id} (${color}) is an island: it borders no other region, so it needs a sea link to be reachable`;
    case 'diagonalCrossings':
      return `${count} outline(s) cross diagonally where four regions meet; their shape is approximate — nudge the borders so they do not touch at a point`;
    case 'skippedPixels':
      return `${count} px were skipped as sea, borders or speckle out of ${total}`;
    case 'invalid':
      return issue.detail;
  }
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
  const warnings: ImportIssue[] = [];

  const territories: Territory[] = [];
  const summaries: TerritorySummary[] = [];

  for (const region of flat.regions) {
    const id = territoryId(region.index, prefix);
    const rings = contours.ringsByRegion.get(region.index) ?? [];
    if (rings.length === 0) {
      warnings.push(issue('regionWithoutOutline', { id, color: describeColor(region) }));
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
        issue('regionSplit', { id, color: describeColor(region), pieces: rings.length }),
      );
    }
    if (island) {
      warnings.push(issue('island', { id, color: describeColor(region) }));
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
    warnings.push(issue('diagonalCrossings', { count: ambiguous.length }));
  }
  if (flat.ignoredPixels > 0) {
    warnings.push(
      issue('skippedPixels', { count: flat.ignoredPixels, total: flat.width * flat.height }),
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
  // Islands are already reported above, with the colour and the reason spelled
  // out; `validateMap`'s own island warning would only repeat them.
  for (const message of validation.warnings) {
    if (message.includes('no connections')) continue;
    warnings.push(issue('invalid', { detail: message }));
  }
  const errors = validation.errors.map((message) => issue('invalid', { detail: message }));

  return { map, territories: summaries, issues: [...errors, ...warnings], errors, warnings };
}

function issue(code: ImportIssueCode, args: { id?: string; color?: string; pieces?: number; count?: number; total?: number; detail?: string }): ImportIssue {
  const built: ImportIssue = {
    code,
    params: { id: args.id ?? '', color: args.color ?? '', ...(args.pieces !== undefined ? { pieces: args.pieces } : {}) },
    ...(args.count !== undefined || args.total !== undefined
      ? { numbers: { count: args.count ?? 0, total: args.total ?? 0 } }
      : {}),
    detail: args.detail ?? '',
  };
  built.detail = args.detail ?? formatIssue(built);
  return built;
}

function describeColor(region: ColorRegion): string {
  return `#${region.color.toString(16).padStart(6, '0')}`;
}
