// The visual review set of NFR-27: the debug scenes the user accepts by screenshot, as fixed addresses
// on the committed dev map (seed 1). Pure data: `test/review-set.test.ts` checks that every point holds
// what its label says, so a rebuilt map or a retuned theme cannot silently invalidate the set.
import { formatAddress } from './address';

export interface ReviewScene {
  /** Unique, kebab-case. */
  label: string;
  seed: number;
  round: number;
  /** Absent: the whole map at fit scale (no camera parameters in the address). */
  camera?: { x: number; y: number; zoom: number };
  /** What the reviewer looks at. */
  look: string;
}

/** Points on the dev map, in map units (the pixel at floor(x), floor(y) or the edge at that position). */
export const REVIEW_POINTS = {
  /** An edge between Espana and Francia (a `faction` border at round 0). */
  factionBorder: { x: 788, y: 1260.5 },
  /** An edge between a territory of Alemania and one of Francia: a faction border at round 0, a former one at round 1. */
  formerBorder: { x: 1241, y: 723.5 },
  /** A pixel of Islas Baleares. */
  baleares: { x: 954.5, y: 1556.5 },
  /** Midpoint of the Messina strait: a sea pixel 2 units from both Sicilia and Calabria. */
  messina: { x: 1831.5, y: 1629 },
  /** A `sea-zone` edge one unit from the coast. */
  seaZoneCoast: { x: 1153, y: 1238.5 },
  /** Water enclosed by land (the Etang de Berre), sea since spec 003c. */
  lagoon: { x: 1073.5, y: 1204.5 },
  /** A pixel of the land territory with the fewest map units (id 6, inside Alemania). */
  smallTerritory: { x: 1266.5, y: 317.5 },
} as const;

/** Scales of the territory line scenes (below, strictly between and above the fade of FR-140). */
export const TERRITORY_LINE_ZOOMS = { far: 1, mid: 1.75, near: 32 } as const;

const at = (point: { x: number; y: number }, zoom: number): { x: number; y: number; zoom: number } => ({
  x: point.x,
  y: point.y,
  zoom,
});

export const REVIEW_SET: readonly ReviewScene[] = [
  { label: 'fit-round-0', seed: 1, round: 0, look: 'whole map, five factions, sea and background colours' },
  { label: 'fit-round-1', seed: 1, round: 1, look: 'Alemania absorbed by Francia, no line between them' },
  { label: 'fit-round-2', seed: 1, round: 2, look: 'second absorption' },
  { label: 'fit-round-4', seed: 1, round: 4, look: 'one faction left, only coast and sea-zone lines' },
  { label: 'faction-border-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.factionBorder, 8), look: '4 px faction line, step shape' },
  { label: 'faction-border-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.factionBorder, 8), look: 'the same line after one absorption' },
  { label: 'former-border-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.formerBorder, 8), look: 'Alemania - Francia faction border' },
  { label: 'former-border-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.formerBorder, 8), look: 'the same edge, now a faint territory line' },
  { label: 'baleares-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.baleares, 8), look: 'island: coast line and fill' },
  { label: 'baleares-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.baleares, 8), look: 'island after one round' },
  { label: 'messina-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.messina, 12), look: 'narrow strait kept open' },
  { label: 'messina-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.messina, 12), look: 'strait after one round' },
  { label: 'sea-zone-coast-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.seaZoneCoast, 8), look: 'sea-zone line reaching the coast' },
  { label: 'sea-zone-coast-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.seaZoneCoast, 8), look: 'the same place after one round' },
  { label: 'lagoon-round-0', seed: 1, round: 0, camera: at(REVIEW_POINTS.lagoon, 14), look: 'enclosed water drawn as sea with a coast line, no grey hole' },
  { label: 'lagoon-round-1', seed: 1, round: 1, camera: at(REVIEW_POINTS.lagoon, 14), look: 'the same lagoon after one round' },
  { label: 'small-territory-fit', seed: 1, round: 0, camera: at(REVIEW_POINTS.smallTerritory, 0.527), look: 'smallest land territory at fit scale' },
  { label: 'territory-line-far', seed: 1, round: 1, camera: at(REVIEW_POINTS.formerBorder, TERRITORY_LINE_ZOOMS.far), look: 'at or below the fade start: no territory line' },
  { label: 'territory-line-mid', seed: 1, round: 1, camera: at(REVIEW_POINTS.formerBorder, TERRITORY_LINE_ZOOMS.mid), look: 'between the fade start and full: half-strength line' },
  { label: 'territory-line-near', seed: 1, round: 1, camera: at(REVIEW_POINTS.formerBorder, TERRITORY_LINE_ZOOMS.near), look: 'maximum scale: line at maximum opacity' },
];

/** The address text of a scene (the query string the page reads). */
export function reviewAddress(scene: ReviewScene): string {
  if (scene.camera === undefined) return `?seed=${scene.seed}&round=${scene.round}`;
  return formatAddress(scene.seed, scene.round, { x: scene.camera.x, y: scene.camera.y, scale: scene.camera.zoom });
}
