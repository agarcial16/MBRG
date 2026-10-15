/**
 * Minimal own declaration of the `shapefile` package (0.6.6 ships no types and `@types/shapefile`
 * is not approved, NFR-20). Only what `read-shapefile.ts` uses; the adapter passes ArrayBuffers only.
 */
declare module 'shapefile' {
  export interface GeoJsonFeature {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown } | null;
  }
  export interface ShapefileSource {
    read(): Promise<{ done: boolean; value: GeoJsonFeature | undefined }>;
  }
  export function open(
    shp: ArrayBuffer,
    dbf: ArrayBuffer,
    options: { encoding: string },
  ): Promise<ShapefileSource>;
}
