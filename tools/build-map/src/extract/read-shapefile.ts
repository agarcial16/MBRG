/// <reference path="./shapefile.d.ts" />
import * as shapefile from 'shapefile';
import type { SourceFeature, SourcePolygon } from '../core/types';
import type { ShpGeometry } from '../importer/types';

/**
 * FR-131: the only module that imports `shapefile`. It reads a polygon shapefile and its dBASE
 * table from two ArrayBuffers and returns plain records (properties and polygons). Fixed-width
 * text fields come back without their space or NUL padding (decoding, not a trim of names). The library
 * can also open paths and URLs; only ArrayBuffers are accepted here so it never touches a file or
 * the network, and the caller (the extract command) does the file reading.
 */
export async function readShapefile(shp: ArrayBuffer, dbf: ArrayBuffer): Promise<SourceFeature[]> {
  if (!(shp instanceof ArrayBuffer) || !(dbf instanceof ArrayBuffer)) {
    throw new TypeError('readShapefile accepts ArrayBuffer arguments only');
  }
  const source = await shapefile.open(shp, dbf, { encoding: 'utf-8' });
  const features: SourceFeature[] = [];
  for (;;) {
    const result = await source.read();
    if (result.done || result.value === undefined) return features;
    features.push({ props: unpadded(result.value.properties), polygons: polygonsOf(result.value.geometry) });
  }
}

/** DBF text values lose their trailing space and NUL padding (the real files pad with NUL). */
function unpadded(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    out[key] = typeof value === 'string' ? value.replace(/[\x00 ]+$/, '') : value;
  }
  return out;
}

type Position = [number, number];

function ringOf(value: unknown): { coords: Position[] } {
  return { coords: (value as Position[]).map((p) => [p[0], p[1]] as Position) };
}

function polygonOf(rings: unknown): SourcePolygon {
  const list = rings as unknown[];
  return { outer: ringOf(list[0]), holes: list.slice(1).map(ringOf) };
}

/** The library classifies rings into outer rings and holes; a null shape has no polygon. */
function polygonsOf(geometry: { type: string; coordinates: unknown } | null): SourcePolygon[] {
  if (geometry === null) return [];
  if (geometry.type === 'Polygon') return [polygonOf(geometry.coordinates)];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as unknown[]).map(polygonOf);
  throw new Error(`unsupported shape type ${geometry.type}: polygons only`);
}

/**
 * FR-590: the geometry of every record of a polygon shapefile, in record order, and nothing else. The attribute table is
 * not read here (the importer reads it with its own code, PD4); a null shape record gives `null`. Only an ArrayBuffer is
 * accepted, as for `readShapefile`; a shapefile that holds anything but polygons throws.
 */
export async function openShpGeometry(shp: ArrayBuffer): Promise<(ShpGeometry | null)[]> {
  if (!(shp instanceof ArrayBuffer)) throw new TypeError('openShpGeometry accepts an ArrayBuffer argument only');
  const source = await shapefile.openShp(shp);
  const geometries: (ShpGeometry | null)[] = [];
  for (;;) {
    const result = await source.read();
    if (result.done) return geometries;
    const geometry = result.value;
    if (geometry === null || geometry === undefined) {
      geometries.push(null);
      continue;
    }
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      throw new Error(`unsupported shape type ${geometry.type}: polygons only`);
    }
    geometries.push(
      geometry.type === 'Polygon'
        ? { type: 'Polygon', coordinates: geometry.coordinates as [number, number][][] }
        : { type: 'MultiPolygon', coordinates: geometry.coordinates as [number, number][][][] },
    );
  }
}
