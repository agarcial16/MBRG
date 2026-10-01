import { validateMap, type Coord, type MapFormatV1, type Territory } from '@mbrg/shared';

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

/**
 * How far a piece may sit from its province's main body, as a multiple of that
 * body's own size, before it is reported as a probable stray mark.
 *
 * Measured against the province and not against the image, so the rule means the
 * same thing on a 400px map and a 4000px one: "is this further from its mainland
 * than the mainland is long?". An island off the coast passes easily; a speck in
 * another continent does not.
 *
 * One is the only honest threshold. Any lower and every real archipelago in the
 * Med gets a finding, which is exactly the kind of noise that teaches people to
 * stop reading warnings.
 */
const STRAY_FACTOR = 1;

export interface TerritorySummary {
  id: string;
  /** Region index of the biggest piece, which is the one that names the id. */
  index: number;
  /** Representative colour, kept for the UI overlay only. Never in the map. */
  color: RGB;
  /** Area in pixels², summed over every piece. */
  area: number;
  neighbors: string[];
  /** No land neighbour: needs a maritime link or it is unreachable. */
  island: boolean;
  /** Land falls in several disconnected pieces. Now supported, not a defect. */
  split: boolean;
  /** How many pieces it is made of, for the "N pieces" badge. */
  pieces: number;
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
  | 'strayPiece'
  | 'island'
  | 'mostlyIslands'
  | 'diagonalCrossings'
  | 'tinyHolesDropped'
  | 'smallRegionsDropped'
  | 'skippedPixels'
  | 'invalid';

export interface ImportIssue {
  code: ImportIssueCode;
  /** About the specific region, for the codes that name one. */
  params: { id: string; color: string; pieces?: number };
  /** Totals and measurements, for the codes that are not about one region. */
  numbers?: { count: number; total: number; strayGap?: number };
  /** The original message, for logs and as a fallback. */
  detail: string;
}

/** English rendering, for logs and for a future CLI. */
export function formatIssue(issue: ImportIssue): string {
  const { id, color, pieces } = issue.params;
  const count = issue.numbers?.count ?? 0;
  const total = issue.numbers?.total ?? 0;
  const strayGap = issue.numbers?.strayGap ?? 0;
  switch (issue.code) {
    case 'regionWithoutOutline':
      return `region ${id} (${color}) has no outline and was skipped`;
    case 'regionSplit':
      return `region ${id} (${color}) is split into ${pieces} pieces; they were kept as ONE province, conquered together — if they were meant to be separate provinces, give them different colours`;
    case 'strayPiece':
      return `region ${id} (${color}) has a piece far away from its main body (${strayGap} px away); it is kept, but it is probably a stray mark rather than part of the province`;
    case 'island':
      return `region ${id} (${color}) is an island: it borders no other region, so it needs a sea link to be reachable`;
    case 'mostlyIslands':
      return `${count} of ${total} regions ended up as islands. A dark outline drawn around every province splits the map into pieces: outline pixels are not land, so they cannot bridge two regions. Use flat colours that touch, or an outline-free image`;
    case 'diagonalCrossings':
      return `${count} outline(s) cross diagonally where four regions meet; their shape is approximate — nudge the borders so they do not touch at a point`;
    case 'tinyHolesDropped':
      return `${count} small hole(s) were dropped as noise; if the image had text painted on it, the letters were read as lakes — the fill will cover them`;
    case 'smallRegionsDropped':
      return `${count} small region(s) were dropped for being tiny next to their neighbours; on most maps these are the province names painted on it — lower the minimum area if they were meant to be provinces`;
    case 'skippedPixels':
      return `${count} px of speckle were skipped out of ${total}`;
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

  // Same colour = same province. A country drawn as a mainland plus a few
  // islands, or a province whose enclave was cut off by a neighbour, arrives
  // here as several *regions* (regions are connected pieces, which is what makes
  // adjacency and contour tracing work at all) but is ONE territory. Grouping by
  // colour is what puts them back together, and it is also the only honest reading
  // of a flat-colour map: two provinces of the same colour are indistinguishable
  // to a detector, so treating them as one is a decision we can state rather than
  // an accident we have to apologize for.
  const groups = new Map<RGB, ColorRegion[]>();
  for (const region of flat.regions) {
    const bucket = groups.get(region.color);
    if (bucket) bucket.push(region);
    else groups.set(region.color, [region]);
  }
  for (const members of groups.values()) {
    // Biggest piece first; it is the one that names the province, so the id is
    // stable for a given image and the pieces keep a defined order.
    members.sort((a, b) => b.area - a.area || a.index - b.index);
  }
  const owner = new Map<number, string>();
  for (const members of groups.values()) {
    const id = territoryId(members[0].index, prefix);
    for (const region of members) owner.set(region.index, id);
  }

  for (const [color, members] of groups) {
    const main = members[0];
    const id = owner.get(main.index)!;
    const label = describeColor(main);

    const polygons: Coord[][] = [];
    const holes: Coord[][] = [];
    const neighborIds = new Set<string>();
    for (const region of members) {
      for (const ring of contours.ringsByRegion.get(region.index) ?? []) {
        polygons.push(ring.points);
      }
      for (const loop of contours.holesByRegion.get(region.index) ?? []) {
        holes.push(loop.points);
      }
      for (const n of adjacency.neighbors.get(region.index) ?? []) {
        const neighborId = owner.get(n);
        // A same-colour neighbour is this very province (see `owner`): a gap
        // closed between two of its pieces. Dropping it is not a shortcut — a
        // province that neighbours itself is rejected by `validateMap`.
        if (neighborId !== undefined && neighborId !== id) neighborIds.add(neighborId);
      }
    }
    if (polygons.length === 0) {
      // No region of this colour produced an outline, so there is nothing to draw.
      if (members.length === 1) {
        warnings.push(issue('regionWithoutOutline', { id, color: label }));
      }
      continue;
    }

    // An island is a province with no land neighbour, which is a property of the
    // whole province and not of any one piece: a mainland with an island next to
    // it is not an island, whatever the island piece says on its own.
    const neighbors = [...neighborIds].sort();
    const island = adjacency.islands.includes(main.index);
    territories.push({
      id,
      name: id,
      neighbors,
      polygons,
      ...(holes.length > 0 ? { holes } : {}),
    });

    const pieces = polygons.length;
    if (pieces > 1) {
      warnings.push(issue('regionSplit', { id, color: label, pieces }));
      const stray = farthestPieceGap(polygons);
      if (stray > STRAY_FACTOR * boxDiagonal(boundsOf(polygons[0]))) {
        warnings.push(issue('strayPiece', { id, color: label, strayGap: Math.round(stray) }));
      }
    }
    if (island) {
      warnings.push(issue('island', { id, color: label }));
    }
    summaries.push({
      id,
      index: main.index,
      color,
      area: members.reduce((sum, region) => sum + region.area, 0),
      neighbors,
      island,
      split: pieces > 1,
      pieces,
      cornerOnly: island && members.every((region) => cornerTouching.has(region.index)),
    });
  }

  if (contours.ambiguousLoops > 0) {
    warnings.push(issue('diagonalCrossings', { count: contours.ambiguousLoops }));
  }
  // One "island" warning per region is noise when *everything* is an island:
  // the cause is a single decision (a dark outline around every province splits
  // the map into pieces, since a border pixel is not land and cannot bridge two
  // regions). Say that once, or the user reads 200 identical findings.
  //
  // Counted over provinces rather than over the underlying regions: after
  // grouping by colour, one province can hold several regions, and comparing a
  // region count against a province count would trip the threshold on maps that
  // are nothing but archipelagos.
  const islandCount = summaries.filter((s) => s.island).length;
  if (territories.length > 1 && islandCount * 2 > territories.length) {
    warnings.push(issue('mostlyIslands', { count: islandCount, total: territories.length }));
  }
  if (contours.droppedHoles > 0) {
    warnings.push(issue('tinyHolesDropped', { count: contours.droppedHoles }));
  }
  // Regions dropped for being small next to their peers. Almost always the
  // province names painted on the map, and worth saying out loud: they are gone
  // from the map, so a user who *did* mean them as provinces needs to know to
  // lower the area floor.
  if (flat.droppedSmallRegions > 0) {
    warnings.push(issue('smallRegionsDropped', { count: flat.droppedSmallRegions }));
  }
  // Sea and transparency are not findings, they are the expected background, so
  // they only get reported when there is a third category hiding among them:
  // speckle, which is the part that was land and was thrown away.
  if (flat.ignored.speckle > 0) {
    warnings.push(
      issue('skippedPixels', {
        count: flat.ignored.speckle,
        total: flat.width * flat.height,
      }),
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

function issue(
  code: ImportIssueCode,
  args: {
    id?: string;
    color?: string;
    pieces?: number;
    count?: number;
    total?: number;
    strayGap?: number;
    detail?: string;
  },
): ImportIssue {
  const built: ImportIssue = {
    code,
    params: { id: args.id ?? '', color: args.color ?? '', ...(args.pieces !== undefined ? { pieces: args.pieces } : {}) },
    ...(args.count !== undefined || args.total !== undefined || args.strayGap !== undefined
      ? {
          numbers: {
            count: args.count ?? 0,
            total: args.total ?? 0,
            ...(args.strayGap !== undefined ? { strayGap: args.strayGap } : {}),
          },
        }
      : {}),
    detail: args.detail ?? '',
  };
  built.detail = args.detail ?? formatIssue(built);
  return built;
}

function describeColor(region: ColorRegion): string {
  return `#${region.color.toString(16).padStart(6, '0')}`;
}

/**
 * The widest gap between the province's main piece (`polygons[0]`) and any of
 * its others, measured between bounding boxes and so 0 when they overlap.
 *
 * A rough shape on purpose: the alternative is a full segment-to-segment distance
 * for every pair of pieces on every province of every map, to answer a question
 * whose answer only ever feeds a warning. Boxes are enough to tell an island off
 * its coast from a speck in another continent.
 */
function farthestPieceGap(polygons: Coord[][]): number {
  const main = boundsOf(polygons[0]);
  let worst = 0;
  for (let i = 1; i < polygons.length; i++) {
    worst = Math.max(worst, boxGap(main, boundsOf(polygons[i])));
  }
  return worst;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(ring: Coord[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

function boxDiagonal(box: Box): number {
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
}
