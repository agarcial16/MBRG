/** Test-only builders of GeoJSON source bytes for the importer tests (no file access). */

export type Pos = number[];

/** A closed square ring [lon, lat] with its south-west corner at (x, y). */
export function ring(x: number, y: number, size = 1): Pos[] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
}

export function polygon(x: number, y: number, size = 1): unknown {
  return { type: 'Polygon', coordinates: [ring(x, y, size)] };
}

export function multi(...squares: [number, number, number?][]): unknown {
  return { type: 'MultiPolygon', coordinates: squares.map(([x, y, s]) => [ring(x, y, s ?? 1)]) };
}

export function feat(properties: unknown, geometry: unknown): unknown {
  return { type: 'Feature', properties, geometry };
}

export function collection(features: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { type: 'FeatureCollection', ...extra, features };
}

export const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
export const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

export function crsOf(name: string): Record<string, unknown> {
  return { crs: { type: 'name', properties: { name } } };
}
