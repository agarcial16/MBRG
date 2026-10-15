/// <reference path="./shapefile.d.ts" />
import * as shapefile from 'shapefile';
import type { SourceFeature, SourcePolygon } from '../core/types';

/**
 * FR-131: the only module that imports `shapefile`. It reads a polygon shapefile and its dBASE
 * table from two ArrayBuffers and returns plain records (properties and polygons). Fixed-width
 * text fields come back without their space padding (decoding, not a trim of names). The library
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
    features.push({ props: { ...result.value.properties }, polygons: polygonsOf(result.value.geometry) });
  }
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
