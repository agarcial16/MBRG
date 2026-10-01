import type {
  Coord,
  Faction,
  FactionId,
  MapFormatV1,
  MatchState,
  Ownership,
  RoundEvent,
  SimOptions,
} from '@mbrg/shared';
import { buildAdjacency, mainRing, validateMap } from '@mbrg/shared';

import { Rng } from './rng.js';

interface MapGraph {
  /** Sorted land ∪ sea neighbors per territory (see buildAdjacency). */
  adjacency: Map<string, string[]>;
  /** Vertex-average centroid per territory (used only by the maritime fallback). */
  centroids: Map<string, Coord>;
}

/**
 * Cached per map object. Maps are treated as IMMUTABLE during a match —
 * mutating a map after the first `step()` would leave the cache stale.
 */
const graphCache = new WeakMap<MapFormatV1, MapGraph>();

function getGraph(map: MapFormatV1): MapGraph {
  const cached = graphCache.get(map);
  if (cached) return cached;
  const adjacency = buildAdjacency(map);
  const centroids = new Map<string, Coord>();
  for (const t of map.territories) {
    // The biggest ring, not an average over all of them: a province with an
    // island next to it would otherwise get a centroid out in the water, and the
    // maritime fallback would send the annexation to the wrong side.
    centroids.set(t.id, polygonCentroid(mainRing(t)));
  }
  const graph: MapGraph = { adjacency, centroids };
  graphCache.set(map, graph);
  return graph;
}

function polygonCentroid(polygon: Coord[]): Coord {
  let x = 0;
  let y = 0;
  for (const [px, py] of polygon) {
    x += px;
    y += py;
  }
  const n = polygon.length > 0 ? polygon.length : 1;
  return [x / n, y / n];
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed)) {
    throw new Error(`Seed must be an integer, got ${String(seed)}`);
  }
}

/**
 * Initial state: every territory becomes its own faction (faction id = territory id).
 * Throws if the map fails validation or options are invalid.
 */
export function createInitialMatch(map: MapFormatV1, options: SimOptions): MatchState {
  const { errors } = validateMap(map);
  if (errors.length > 0) {
    throw new Error(`Invalid map: ${errors.join('; ')}`);
  }
  assertSeed(options.seed);
  const weighting = options.weighting ?? 'uniform';
  if (weighting !== 'uniform' && weighting !== 'provinces') {
    throw new Error(`Unknown weighting: ${String(weighting)}`);
  }

  const owners: Ownership = {};
  const factions: Faction[] = [];
  for (const t of map.territories) {
    owners[t.id] = t.id;
    factions.push({ id: t.id, provinces: [t.id] });
  }

  const done = factions.length <= 1;
  return {
    seed: options.seed,
    weighting,
    rngState: options.seed >>> 0,
    owners,
    factions,
    round: 0,
    log: [],
    done,
    winner: done ? (factions[0]?.id ?? null) : null,
  };
}

/** Living factions bordering `faction` (land or sea), sorted — determinism aid. */
function neighborFactions(
  state: MatchState,
  graph: MapGraph,
  faction: Faction,
): FactionId[] {
  const found = new Set<FactionId>();
  for (const province of faction.provinces) {
    for (const territoryId of graph.adjacency.get(province) ?? []) {
      const owner = state.owners[territoryId];
      if (owner !== undefined && owner !== faction.id) {
        found.add(owner);
      }
    }
  }
  return [...found].sort();
}

function factionCentroid(faction: Faction, graph: MapGraph): Coord {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const province of faction.provinces) {
    const c = graph.centroids.get(province);
    if (!c) continue;
    x += c[0];
    y += c[1];
    n++;
  }
  const div = n > 0 ? n : 1;
  return [x / div, y / div];
}

function squaredDistance(a: Coord, b: Coord): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * One round of the "Clásico" mode:
 * 1. A living faction is picked to die (uniform, or weighted by provinces).
 *    Only factions bordering another living faction are eligible (islands are immune
 *    while isolated).
 * 2. If NO faction borders another (lone island vs. mainland winner), the maritime
 *    fallback kicks in: a faction is still picked at random, but annexes across the
 *    sea from the nearest faction by centroid distance.
 * 3. A random bordering faction receives ALL provinces of the dead faction.
 *
 * Pure: never mutates `state` or `map`; returns a brand-new state.
 */
export function step(map: MapFormatV1, state: MatchState): MatchState {
  if (state.done) {
    throw new Error('Match is already finished');
  }
  const graph = getGraph(map);
  const rng = new Rng(state.rngState);

  const eligible: Faction[] = [];
  for (const faction of state.factions) {
    if (neighborFactions(state, graph, faction).length > 0) {
      eligible.push(faction);
    }
  }

  let doomed: Faction;
  let annexerCandidates: FactionId[];
  if (eligible.length > 0) {
    doomed =
      state.weighting === 'provinces'
        ? eligible[rng.weightedIndex(eligible.map((f) => f.provinces.length))]
        : rng.pick(eligible);
    annexerCandidates = neighborFactions(state, graph, doomed);
  } else {
    // Maritime fallback: no land/sea contacts left. Random death, nearest neighbor annexes.
    doomed =
      state.weighting === 'provinces'
        ? state.factions[rng.weightedIndex(state.factions.map((f) => f.provinces.length))]
        : rng.pick(state.factions);
    annexerCandidates = nearestFaction(state, graph, doomed);
  }
  if (annexerCandidates.length === 0) {
    throw new Error('No annexer candidates (invariant violated: fewer than 2 factions?)');
  }

  const annexerId = rng.pick(annexerCandidates);
  const annexer = state.factions.find((f) => f.id === annexerId);
  if (!annexer) {
    throw new Error(`Annexer "${annexerId}" is not an alive faction (invariant violated)`);
  }

  // Build the next state — copies only, input state stays untouched.
  const owners: Ownership = { ...state.owners };
  for (const province of doomed.provinces) {
    owners[province] = annexer.id;
  }
  const factions = state.factions
    .filter((f) => f.id !== doomed.id)
    .map((f) =>
      f.id === annexer.id
        ? { id: f.id, provinces: [...f.provinces, ...doomed.provinces] }
        : f,
    );

  const event: RoundEvent = {
    round: state.round + 1,
    eliminated: doomed.id,
    annexer: annexer.id,
    gained: [...doomed.provinces],
    remaining: factions.length,
    owners: { ...owners },
  };

  return {
    ...state,
    rngState: rng.snapshot(),
    owners,
    factions,
    round: event.round,
    log: [...state.log, event],
    done: factions.length <= 1,
    winner: factions.length === 1 ? factions[0].id : null,
  };
}

/** All other living factions, sorted by distance to `from` (nearest first, ties by order). */
function nearestFaction(state: MatchState, graph: MapGraph, from: Faction): FactionId[] {
  const fromCentroid = factionCentroid(from, graph);
  const others = state.factions
    .filter((f) => f.id !== from.id)
    .map((f) => ({ id: f.id, dist: squaredDistance(fromCentroid, factionCentroid(f, graph)) }));
  others.sort((a, b) => a.dist - b.dist);
  return others.map((o) => o.id);
}

/** Convenience: run a match from creation to completion (deterministic for a given seed). */
export function simulate(map: MapFormatV1, options: SimOptions): MatchState {
  let state = createInitialMatch(map, options);
  const maxRounds = map.territories.length; // expected: territories - 1
  let guard = 0;
  while (!state.done) {
    state = step(map, state);
    if (++guard > maxRounds) {
      throw new Error('Simulation exceeded the expected number of rounds');
    }
  }
  return state;
}

/**
 * Influence fork (Phase 4 "influence" abilities): keep everything that already
 * happened, re-roll the future with a new seed.
 */
export function forkMatch(state: MatchState, newSeed: number): MatchState {
  if (state.done) {
    throw new Error('Cannot fork a finished match');
  }
  assertSeed(newSeed);
  return { ...state, seed: newSeed, rngState: newSeed >>> 0 };
}
