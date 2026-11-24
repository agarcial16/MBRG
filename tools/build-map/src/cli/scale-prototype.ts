import { pathToFileURL } from 'node:url';
import { cleanupPieces, type PieceEntry } from '../core/pieces';
import { frameFor, pixelSide, project, projectionCenter, toPixel, type Frame } from '../core/projection';
import { rasterize, WATER, type RasterLayer } from '../core/rasterize';
import { toPixelPolygons } from '../core/rings';
import { assignSeaZonesDetailed, seedPixels } from '../core/sea';
import type { SeaSeed, SourceFeature } from '../core/types';
import { parseCuration, usedProperties } from '../importer/curation';
import { readSources } from '../importer/read-source';
import { NFR_136, generateScaleFixture, type ScaleFixture, type ScaleOptions } from '../importer/scale-fixture';
import { matchesFilter, selectUnits } from '../importer/select';
import { buildUnits, type Unit } from '../importer/units';

/**
 * NFR-136, plan section 6 (T1.10): the scale prototype. It reads the generated fixture through the importer's reader
 * and runs, on the 003b core in place, the heavy steps the importer will run: the Lambert projection, the
 * rasterization of every unit, an inset in its own raster, the seed search of the sea and the piece cleanup. It
 * measures each step. It is an adapter (it reads the clock and the process), never part of the pure core.
 */

/** A reduced fixture for a quick check of the prototype itself (never a measurement of the bound). */
export const SMALL_SCALE: ScaleOptions = {
  units: 400,
  islandUnits: 12,
  columns: 25,
  factions: 8,
  seas: 10,
  verticesPerSide: 12,
  side: 1024,
  minPieceSize: 8,
  insetAt: [10, 915],
};

export interface PrototypeResult {
  /** The measured steps, in order, each in milliseconds. */
  steps: { name: string; ms: number }[];
  /** The sum of the steps: from the source bytes read to the cleaned image (the artifacts are not written here). */
  totalMs: number;
  units: number;
  positions: number;
  landEntries: number;
  seaZones: number;
  /** `ok`, or the kind of the error that stopped the run (a seed error or `vanished-entry`). */
  outcome: string;
  /** Pieces the cleanup reassigned. */
  reassigned: number;
  pixels: number;
  /** Peak resident memory of the process, megabytes. */
  maxRssMb: number;
  /** The inset: its rectangle in pixels and the pixels of its units that reached the image. */
  inset: { width: number; height: number; unitPixels: number };
}

/**
 * The heavy path of the importer on a fixture, timed with `now()` (milliseconds). The core's own projection,
 * rasterizer, sea search and cleanup run as they are; the importer's reader, curation, units and selection feed them.
 */
export function runScalePrototype(fixture: ScaleFixture, now: () => number, rss: () => number = () => 0): PrototypeResult {
  const steps: { name: string; ms: number }[] = [];
  let mark = now();
  const done = (name: string): void => {
    const t = now();
    steps.push({ name, ms: t - mark });
    mark = t;
  };

  const curation = parseCuration(fixture.curationBytes, 'curation.json');
  if (!curation.ok) throw new Error(`the fixture curation is invalid: ${JSON.stringify(curation.errors)}`);
  const c = curation.value;
  const read = readSources(
    [
      { file: c.primary, bytes: fixture.primary },
      { file: c.context[0]!, bytes: fixture.context },
    ],
    { usedProperties: usedProperties(c) },
  );
  if (!read.ok) throw new Error(`the fixture source is invalid: ${JSON.stringify(read.errors.slice(0, 3))}`);
  const [primary, context] = read.value;
  done('read');

  const formed = buildUnits(primary!.features, c);
  if (!formed.ok) throw new Error(`the fixture units are invalid: ${JSON.stringify(formed.errors.slice(0, 3))}`);
  const selection = selectUnits(formed.value, c);
  if (!selection.ok) throw new Error(`the fixture selection is invalid: ${JSON.stringify(selection.errors)}`);
  const selected = selection.value.selected;
  const inset = c.insets[0]!;
  const insetUnits = selected.filter((u) => inset.select.every((f) => matchesFilter(u, f)));
  const insetSet = new Set(insetUnits);
  const mainUnits = selected.filter((u) => !insetSet.has(u));
  const idOf = new Map<Unit, number>(selected.map((u, i) => [u, i + 1]));
  done('units');

  const W = c.params.side;
  // The main view: centre and frame from the raw vertices of its units, as 003b does.
  const verticesOf = (units: readonly Unit[]): [number, number][] => {
    const out: [number, number][] = [];
    for (const unit of units) {
      for (const polygon of unit.polygons) {
        for (const p of polygon.outer.coords) out.push(p);
        for (const hole of polygon.holes) for (const p of hole.coords) out.push(p);
      }
    }
    return out;
  };
  const vertices = verticesOf(mainUnits);
  const center = projectionCenter(vertices);
  const frame = frameFor(
    vertices.map(([lon, lat]) => project(center, lon, lat)),
    c.params.margin,
  );
  const toUV = (lon: number, lat: number): [number, number] => {
    const [px, py] = project(center, lon, lat);
    const at = toPixel(frame, W, px, py);
    return [at.u, at.v];
  };
  const asFeature = (unit: Unit): SourceFeature => ({ props: {}, polygons: unit.polygons });
  const layers: RasterLayer[] = mainUnits.map((unit) => ({ value: idOf.get(unit)!, polygons: toPixelPolygons([asFeature(unit)], toUV) }));
  layers.push({ value: 0, polygons: toPixelPolygons(context!.features, toUV) });
  done('project');

  const pixels = rasterize(W, layers);
  done('rasterize');

  // The inset: its own centre and frame at the main scale, rasterized in its own square, then copied to its place.
  const insetVertices = verticesOf(insetUnits);
  const insetCenter = projectionCenter(insetVertices);
  const projected = insetVertices.map(([lon, lat]) => project(insetCenter, lon, lat));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of projected) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pixel = pixelSide(frame, W);
  const margin = c.params.margin * frame.side;
  const rectW = Math.ceil((maxX - minX + 2 * margin) / pixel);
  const rectH = Math.ceil((maxY - minY + 2 * margin) / pixel);
  const square = Math.max(rectW, rectH);
  const insetFrame: Frame = { west: minX - margin, north: maxY + margin, side: square * pixel };
  const toInsetUV = (lon: number, lat: number): [number, number] => {
    const [px, py] = project(insetCenter, lon, lat);
    const at = toPixel(insetFrame, square, px, py);
    return [at.u, at.v];
  };
  const insetLayers: RasterLayer[] = insetUnits.map((unit) => ({ value: idOf.get(unit)!, polygons: toPixelPolygons([asFeature(unit)], toInsetUV) }));
  const insetPixels = rasterize(square, insetLayers);
  const [atX, atY] = inset.at;
  for (let y = 0; y < rectH && atY + y < W; y++) {
    for (let x = 0; x < rectW && atX + x < W; x++) pixels[(atY + y) * W + atX + x] = insetPixels[y * square + x]!;
  }
  let insetUnitPixels = 0;
  for (let y = 0; y < rectH && atY + y < W; y++) {
    for (let x = 0; x < rectW && atX + x < W; x++) {
      const value = pixels[(atY + y) * W + atX + x]!;
      if (value > 0 && value < WATER) insetUnitPixels++;
    }
  }
  done('inset');

  const landEntries = selected.length;
  const seeds: SeaSeed[] = c.seas;
  const located = seedPixels(seeds, center, frame, W, pixels);
  const result = (outcome: string, reassigned: number): PrototypeResult => ({
    steps,
    totalMs: steps.reduce((sum, s) => sum + s.ms, 0),
    units: selected.length,
    positions: primary!.positions + context!.positions,
    landEntries,
    seaZones: seeds.length,
    outcome,
    reassigned,
    pixels: W * W,
    maxRssMb: Math.round(rss()),
    inset: { width: rectW, height: rectH, unitPixels: insetUnitPixels },
  });
  if (!located.ok) {
    done('seeds');
    return result(located.errors[0]!.kind, 0);
  }
  const seaIds = seeds.map((_, i) => landEntries + 1 + i);
  const assigned = assignSeaZonesDetailed(W, pixels, located.value, seaIds).pixels;
  done('sea');

  const owners = new Map<string, number>();
  const entries: PieceEntry[] = [
    ...selected.map((unit): PieceEntry => {
      const prov = String(unit.features[0]!.props['prov']);
      if (!owners.has(prov)) owners.set(prov, owners.size + 1);
      return { id: idOf.get(unit)!, kind: 'land', owner: owners.get(prov)! };
    }),
    ...seaIds.map((id): PieceEntry => ({ id, kind: 'sea' })),
  ];
  const cleaned = cleanupPieces(W, assigned, entries, c.params.minPieceSize);
  done('cleanup');
  return cleaned.ok ? result('ok', cleaned.value.reassigned.length) : result(cleaned.errors[0]!.kind, 0);
}

/** The text a run prints: the fixture, each step and the total, one line each. */
export function describeRun(result: PrototypeResult, generateMs: number): string {
  const lines = [
    `fixture: units=${result.units} seaZones=${result.seaZones} positions=${result.positions} pixels=${result.pixels}`,
    `generate: ${Math.round(generateMs)} ms (not part of the bound)`,
    ...result.steps.map((s) => `step ${s.name}: ${Math.round(s.ms)} ms`),
    `total: ${Math.round(result.totalMs)} ms (${(result.totalMs / 1000).toFixed(1)} s, source bytes read to cleaned image)`,
    `outcome: ${result.outcome}`,
    `reassignedPieces: ${result.reassigned}`,
    `inset: ${result.inset.width}x${result.inset.height} pixels, ${result.inset.unitPixels} of units`,
    `maxRssMb: ${result.maxRssMb}`,
  ];
  return lines.join('\n') + '\n';
}

/** The real command: `--small` runs the reduced fixture (a check of the prototype, not of the bound). */
function main(): number {
  const small = process.argv.slice(2).includes('--small');
  const unknown = process.argv.slice(2).filter((a) => a !== '--small');
  if (unknown.length > 0) {
    process.stderr.write(`unknown option: ${unknown[0]}\nusage: scale:prototype [--small]\n`);
    return 2;
  }
  const t0 = performance.now();
  const fixture = generateScaleFixture(small ? SMALL_SCALE : NFR_136);
  const generateMs = performance.now() - t0;
  const result = runScalePrototype(fixture, () => performance.now(), () => process.resourceUsage().maxRSS / 1024);
  process.stdout.write(describeRun(result, generateMs));
  return result.outcome === 'ok' ? 0 : 1;
}

// Run only as a script, never when a test imports the module.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
