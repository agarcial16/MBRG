// Debug scene model (FR-152, FR-155 to FR-157, FR-160). Pure: seed and round are parameters and the
// sim is injected, so the calls it receives can be recorded in tests. Nothing is cached or held:
// a scene is built from the sim for exactly the requested round and holds nothing after it.
import { entryKind, factionOrder } from '@mbrg/shared';
import type { FactionId, MapData, PresentationData, Result, TerritoryId } from '@mbrg/shared';
import type { MatchError, MatchState, RoundRecord } from '@mbrg/sim';
import type { EntryIndex } from './entries';
import { fillTemplate, STRINGS } from './strings';
import type { FillClass } from './theme';

/** The error of the sim as the rest of the viewer core sees it (only this module names the sim package). */
export type SceneError = MatchError;

/** The label of the panel (FR-156, FR-161). */
export const DEBUG_TITLE: string = STRINGS.debugTitle;

/** The part of the sim the debug scene uses (plan P2). The real exports of `@mbrg/sim` fit it. */
export interface SimPort {
  totalRounds(map: unknown): Result<number, MatchError>;
  getState(map: unknown, seed: unknown, round: unknown): Result<MatchState, MatchError>;
  getRounds(map: unknown, seed: unknown, round: unknown): Result<RoundRecord[], MatchError>;
  ownerOf(state: MatchState, territory: TerritoryId): FactionId | undefined;
}

/**
 * The part of the sim the debug `reveal` tours use (FR-351). A separate type from `SimPort`, so the existing literals of
 * `SimPort` stay as they are (PD10). The real exports of `@mbrg/sim` fit it.
 */
export interface RevealSimPort {
  getState(map: unknown, seed: unknown, round: unknown): Result<MatchState, MatchError>;
  getRounds(map: unknown, seed: unknown, round: unknown): Result<RoundRecord[], MatchError>;
  livingFactions(map: unknown, state: unknown): Result<FactionId[], MatchError>;
  absorptionCandidatesOf(map: unknown, state: unknown, faction: unknown): Result<FactionId[], MatchError>;
}

/** What the tours of round `round` are built from in the debug scene (the key is `debug:<round>`, never the seed). */
export interface RevealInputs {
  readonly round: number;
  /** The factions living at round - 1 (the participants of the victim tour). */
  readonly living: readonly FactionId[];
  readonly victim: FactionId;
  readonly absorber: FactionId;
  /** The absorption candidates of the victim in the state at round - 1, computed as the sim does. */
  readonly candidates: readonly FactionId[];
}

/** One faction line of the legend. The swatch colour comes from `assignFactionColors`, by `faction`. */
export interface LegendRow {
  faction: FactionId;
  name: string;
  /** Land territories owned at the displayed round. */
  territories: number;
  alive: boolean;
}

/** Everything the panel and the drawing need for one displayed round, and nothing about any later round. */
export interface Scene {
  seed: number;
  round: number;
  total: number;
  /** Land territory -> owning faction at `round`. */
  owners: Map<TerritoryId, FactionId>;
  /** The record of round `round` (absent at round 0). */
  record?: RoundRecord;
  /** Factions in faction order. */
  legend: LegendRow[];
  /** Factions with at least one territory. */
  living: number;
}

const factionName = (presentation: PresentationData, faction: FactionId): string =>
  presentation.factions.find((f) => f.id === faction)?.name ?? String(faction);

/**
 * The scene at round `n` for a checked map and presentation. Asks the sim for T, the state at `n` and,
 * when n >= 1, the records of rounds 1..n (keeping the last). Never asks about any other round (FR-160).
 */
export function sceneAt(
  map: MapData,
  presentation: PresentationData,
  seed: number,
  n: number,
  sim: SimPort,
): Result<Scene, MatchError> {
  const total = sim.totalRounds(map);
  if (!total.ok) return total;
  const state = sim.getState(map, seed, n);
  if (!state.ok) return state;
  let record: RoundRecord | undefined;
  if (n >= 1) {
    const rounds = sim.getRounds(map, seed, n);
    if (!rounds.ok) return rounds;
    record = rounds.value[rounds.value.length - 1];
  }

  const owners = new Map<TerritoryId, FactionId>();
  for (const entry of map.territories) {
    if (entryKind(entry) === 'sea') continue;
    const owner = sim.ownerOf(state.value, entry.id);
    if (owner !== undefined) owners.set(entry.id, owner);
  }
  const counts = new Map<FactionId, number>();
  for (const owner of owners.values()) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  const legend: LegendRow[] = factionOrder(map).map((faction) => {
    const territories = counts.get(faction) ?? 0;
    return { faction, name: factionName(presentation, faction), territories, alive: territories > 0 };
  });

  const scene: Scene = {
    seed,
    round: n,
    total: total.value,
    owners,
    legend,
    living: legend.filter((row) => row.alive).length,
  };
  if (record !== undefined) scene.record = record;
  return { ok: true, value: scene };
}

/**
 * FR-351: the inputs of the reveal tours of the step n - 1 -> n. Asks the sim for the state at n - 1 and the records up to n
 * (keeping the last), then for the factions living at n - 1 and the candidates of the victim in that state; never for any
 * round above n (FR-160). Round 0 has no step: the sim's error for the round before it is returned.
 */
export function revealInputs(map: MapData, seed: number, n: number, sim: RevealSimPort): Result<RevealInputs, MatchError> {
  const before = sim.getState(map, seed, n - 1);
  if (!before.ok) return before;
  const rounds = sim.getRounds(map, seed, n);
  if (!rounds.ok) return rounds;
  const record = rounds.value[rounds.value.length - 1];
  // Cannot happen for n >= 1 (round 0 failed above); an empty error list keeps the type without inventing an error kind.
  if (record === undefined) return { ok: false, errors: [] };
  const living = sim.livingFactions(map, before.value);
  if (!living.ok) return living;
  const candidates = sim.absorptionCandidatesOf(map, before.value, record.eliminated);
  if (!candidates.ok) return candidates;
  return {
    ok: true,
    value: { round: n, living: living.value, victim: record.eliminated, absorber: record.absorber, candidates: candidates.value },
  };
}

/** The Spanish error message of FR-152, showing the kind of the first sim error. */
export function sceneErrorMessage(errors: readonly { kind: string }[]): string {
  return fillTemplate(STRINGS.simError, { kind: errors[0]?.kind ?? '' });
}

export interface RoundSummary {
  eliminated: string;
  absorber: string;
  /** Number of territories transferred. */
  transferred: number;
}

/** The round record of the panel (FR-156); absent at round 0. */
export function roundSummary(scene: Scene, presentation: PresentationData): RoundSummary | undefined {
  const record = scene.record;
  if (record === undefined) return undefined;
  return {
    eliminated: factionName(presentation, record.eliminated),
    absorber: factionName(presentation, record.absorber),
    transferred: record.transferred.length,
  };
}

export interface PointerInfo {
  /** The map point as given (map units). */
  x: number;
  y: number;
  /** The id image value of the pixel under the point (0 outside). */
  value: number;
  fill: FillClass;
  /** Entry name (presentation data), absent outside. */
  name?: string;
  /** Owner name at the displayed round, for land only. */
  owner?: string;
  /** The Spanish "outside the map" text, for `outside` only. */
  text?: string;
}

/** What the panel shows for the map point under the pointer (FR-157). */
export function pointerInfo(
  index: EntryIndex,
  scene: Scene,
  presentation: PresentationData,
  point: { x: number; y: number },
): PointerInfo {
  const px = Math.floor(point.x);
  const py = Math.floor(point.y);
  const inside = px >= 0 && py >= 0 && px < index.width && py < index.height;
  const entry = inside ? index.cells[py * index.width + px]! : 0;
  const fill: FillClass = index.fills[entry] ?? 'outside';
  const info: PointerInfo = { x: point.x, y: point.y, value: index.ids[entry] ?? 0, fill };
  if (fill === 'outside') {
    info.text = STRINGS.outsideMap;
    return info;
  }
  const id = info.value;
  info.name = presentation.territories.find((t) => t.id === id)?.name ?? String(id);
  if (fill === 'land') {
    const owner = scene.owners.get(id);
    if (owner !== undefined) info.owner = factionName(presentation, owner);
  }
  return info;
}
