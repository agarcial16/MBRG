// Faction colour assignment (FR-141, spec 033 FR-641 to FR-644, NFR-160, NFR-161). Pure: the
// inputs are the map and the presentation data only, so the colours never depend on seed, round,
// time or camera.
import { entryKind, factionOrder, isValidColor } from '@mbrg/shared';
import type { FactionId, MapData, MapEntry, PresentationData, Result, Rgb } from '@mbrg/shared';
import { colorDistance, createProceduralPalette, MIN_LAND_SEPARATION, PRIMARY_PROCEDURAL_LIMIT, rgbKey } from './palette';
import { fillTemplate, STRINGS } from './strings';
import type { Theme } from './theme';

/** Viewer-internal error kind (English identifier, listed in the language test). */
export interface PaletteExhausted {
  kind: 'palette-exhausted';
  faction: FactionId;
}

function parseColor(text: string): Rgb {
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
}

/** Mutual-link adjacency lookup over map entries: uses Array.includes for small lists, Set for large ones. */
function buildNeighborLookup(map: MapData): {
  entryById: Map<number, MapEntry>;
  linked: (a: MapEntry, b: MapEntry) => boolean;
} {
  const entryById = new Map<number, MapEntry>();
  const largeSets = new Map<number, Set<number>>();
  for (const t of map.territories) {
    entryById.set(t.id, t);
    if (t.neighbors.length > 16) largeSets.set(t.id, new Set(t.neighbors));
  }
  const hasLink = (from: MapEntry, toId: number): boolean => {
    const s = largeSets.get(from.id);
    return s !== undefined ? s.has(toId) : from.neighbors.includes(toId);
  };
  const linked = (a: MapEntry, b: MapEntry): boolean => a.id !== b.id && hasLink(a, b.id) && hasLink(b, a.id);
  return { entryById, linked };
}

/**
 * Land neighbours of every faction at round 0: factions owning a land territory with a mutual
 * border to one of its land territories. A faction is never its own neighbour.
 */
export function landNeighbors(map: MapData): Map<FactionId, Set<FactionId>> {
  const { entryById, linked } = buildNeighborLookup(map);
  const isSea = (e: MapEntry): boolean => entryKind(e) === 'sea';
  const ownerOfEntry = (e: MapEntry): FactionId | undefined => (isSea(e) ? undefined : (e as { owner: FactionId }).owner);

  const result = new Map<FactionId, Set<FactionId>>();
  for (const f of factionOrder(map)) result.set(f, new Set());
  const link = (a: FactionId, b: FactionId): void => {
    if (a === b) return;
    result.get(a)?.add(b);
    result.get(b)?.add(a);
  };

  for (const t of map.territories) {
    const owner = ownerOfEntry(t);
    if (owner === undefined) continue;
    for (const n of t.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(t, m)) continue;
      const other = ownerOfEntry(m);
      if (other !== undefined) link(owner, other);
    }
  }
  return result;
}

/**
 * Direct candidates of every faction at round 0 (002 FR-75, FR-76): factions owning a land neighbour
 * and factions owning land that touches a sea zone shared with it. Links count only when written on
 * both ends. A faction is never its own candidate.
 */
export function directCandidates(map: MapData): Map<FactionId, Set<FactionId>> {
  const { entryById, linked } = buildNeighborLookup(map);
  const isSea = (e: MapEntry): boolean => entryKind(e) === 'sea';
  const ownerOfEntry = (e: MapEntry): FactionId | undefined => (isSea(e) ? undefined : (e as { owner: FactionId }).owner);

  const result = landNeighbors(map);
  const link = (a: FactionId, b: FactionId): void => {
    if (a === b) return;
    result.get(a)?.add(b);
    result.get(b)?.add(a);
  };

  // Land touching the same sea zone: all owners around one zone are candidates of each other.
  for (const z of map.territories) {
    if (!isSea(z)) continue;
    const around = new Set<FactionId>();
    for (const n of z.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(z, m)) continue;
      const owner = ownerOfEntry(m);
      if (owner !== undefined) around.add(owner);
    }
    for (const a of around) for (const b of around) link(a, b);
  }
  return result;
}

/**
 * FR-141 & Spec 033 (FR-641 to FR-644): one colour per faction, in faction order.
 * Preferred colours are used verbatim. Otherwise:
 * (1) first curated base colour unused by any faction and unequal to any preferred colour of the map;
 * (2) first curated base colour unused by any already-coloured or preferred direct candidate (land + sea);
 * (3) soft sea-zone fallback (building on fix/world-palette-exhausted): curated base colour unused by
 *     any land neighbour (already coloured or preferred) appearing fewest times among direct candidates
 *     (ties broken by palette order);
 * (4) procedural last resort (only when theme.procedural is true and all curated colours are blocked by
 *     land neighbours): deterministic procedural colour unused by direct candidates and separated from
 *     land neighbours, relaxing sea-only distinctness first and then separation distance if needed;
 * else `palette-exhausted` (defensive guard for custom finite palettes).
 */
export function assignFactionColors(
  map: MapData,
  presentation: PresentationData,
  theme: Theme,
): Result<Map<FactionId, Rgb>, PaletteExhausted> {
  const order = factionOrder(map);
  const preferred = new Map<FactionId, Rgb>();
  for (const f of presentation.factions) {
    if (isValidColor(f.color)) preferred.set(f.id, parseColor(f.color));
  }

  // Build land adjacency and per-sea-zone membership in one linear pass (avoids O(K^2) sea-clique blow-up).
  const { entryById, linked } = buildNeighborLookup(map);
  const isSea = (e: MapEntry): boolean => entryKind(e) === 'sea';
  const ownerOfEntry = (e: MapEntry): FactionId | undefined => (isSea(e) ? undefined : (e as { owner: FactionId }).owner);

  const land = new Map<FactionId, Set<FactionId>>();
  const factionSeaZones = new Map<FactionId, number[]>();
  for (const f of order) {
    land.set(f, new Set());
    factionSeaZones.set(f, []);
  }

  for (const t of map.territories) {
    const owner = ownerOfEntry(t);
    if (owner === undefined) continue;
    const ownLand = land.get(owner)!;
    for (const n of t.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(t, m)) continue;
      const other = ownerOfEntry(m);
      if (other !== undefined && other !== owner) {
        ownLand.add(other);
        land.get(other)!.add(owner);
      }
    }
  }

  const seaZoneFactions: Set<FactionId>[] = [];
  const seaZoneColorCounts: Map<number, number>[] = [];
  for (const z of map.territories) {
    if (!isSea(z)) continue;
    const around = new Set<FactionId>();
    for (const n of z.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(z, m)) continue;
      const owner = ownerOfEntry(m);
      if (owner !== undefined) around.add(owner);
    }
    if (around.size < 2) continue;
    const zoneIndex = seaZoneFactions.length;
    seaZoneFactions.push(around);
    seaZoneColorCounts.push(new Map());
    for (const f of around) factionSeaZones.get(f)!.push(zoneIndex);
  }

  const colors = new Map<FactionId, Rgb>();
  const colorKeys = new Map<FactionId, number>();
  const usedGlobal = new Set<number>();

  const recordSeaColor = (f: FactionId, k: number): void => {
    for (const z of factionSeaZones.get(f)!) {
      const counts = seaZoneColorCounts[z]!;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  };

  // Preferred colours count as coloured from the start: a faction can see them whatever the order.
  for (const f of order) {
    const own = preferred.get(f);
    if (own !== undefined) {
      const k = rgbKey(own);
      colors.set(f, own);
      colorKeys.set(f, k);
      usedGlobal.add(k);
      recordSeaColor(f, k);
    }
  }

  const palette = theme.palette;
  const paletteKeys = palette.map(rgbKey);
  let nextUniquePaletteIndex = 0;

  // Lazily created procedural pool (only touched if land neighbours exhaust the entire curated palette).
  let procGen: ReturnType<typeof createProceduralPalette> | undefined;
  const procPool: Rgb[] = [];
  const procPoolKeys: number[] = [];
  const ensureProcedural = (count: number): void => {
    if (procGen === undefined) {
      const excluded = new Set<number>(paletteKeys);
      excluded.add(rgbKey(theme.sea));
      excluded.add(rgbKey(theme.background));
      for (const b of Object.values(theme.border)) excluded.add(rgbKey(b));
      procGen = createProceduralPalette(excluded);
    }
    while (procPool.length < count) {
      const c = procGen.next();
      procPool.push(c);
      procPoolKeys.push(rgbKey(c));
    }
  };

  const landKeySet = new Set<number>();

  for (const f of order) {
    if (preferred.has(f)) continue;

    // Step 1: first curated colour unused by any faction and unequal to any preferred colour of the map.
    let pick: Rgb | undefined;
    let pickKey = -1;
    while (nextUniquePaletteIndex < palette.length) {
      const idx = nextUniquePaletteIndex++;
      const k = paletteKeys[idx]!;
      if (!usedGlobal.has(k)) {
        pick = palette[idx]!;
        pickKey = k;
        break;
      }
    }

    if (pick === undefined) {
      const landNbs = land.get(f)!;
      landKeySet.clear();
      for (const g of landNbs) {
        const k = colorKeys.get(g);
        if (k !== undefined) landKeySet.add(k);
      }
      const zones = factionSeaZones.get(f)!;
      const isSeaFree = (k: number): boolean => {
        for (let i = 0; i < zones.length; i++) {
          if ((seaZoneColorCounts[zones[i]!]!.get(k) ?? 0) > 0) return false;
        }
        return true;
      };

      // Step 2: first curated colour unused by any already-coloured or preferred direct candidate (land + sea).
      for (let i = 0; i < palette.length; i++) {
        const k = paletteKeys[i]!;
        if (!landKeySet.has(k) && isSeaFree(k)) {
          pick = palette[i]!;
          pickKey = k;
          break;
        }
      }

      // Step 3: soft sea-zone fallback (land neighbours strict; least-used colour among direct candidates).
      if (pick === undefined) {
        let multiSeaCounts: Map<number, number> | undefined;
        if (zones.length > 1) {
          const seenSea = new Set<FactionId>();
          multiSeaCounts = new Map();
          for (const z of zones) {
            for (const g of seaZoneFactions[z]!) {
              if (g === f || landNbs.has(g) || seenSea.has(g)) continue;
              seenSea.add(g);
              const k = colorKeys.get(g);
              if (k !== undefined) multiSeaCounts.set(k, (multiSeaCounts.get(k) ?? 0) + 1);
            }
          }
        }
        let bestCount = Infinity;
        for (let i = 0; i < palette.length; i++) {
          const k = paletteKeys[i]!;
          if (landKeySet.has(k)) continue;
          const count =
            zones.length === 0
              ? 0
              : zones.length === 1
                ? (seaZoneColorCounts[zones[0]!]!.get(k) ?? 0)
                : (multiSeaCounts!.get(k) ?? 0);
          if (count < bestCount) {
            bestCount = count;
            pick = palette[i]!;
            pickKey = k;
          }
        }
      }

      // Step 4: procedural last resort (only when enabled and all curated colours are blocked by land neighbours).
      if (pick === undefined && theme.procedural === true) {
        const landRgbs: Rgb[] = [];
        for (const g of landNbs) {
          const c = colors.get(g);
          if (c !== undefined) landRgbs.push(c);
        }
        const isSeparated = (c: Rgb): boolean => {
          for (let i = 0; i < landRgbs.length; i++) {
            if (colorDistance(c, landRgbs[i]!) < MIN_LAND_SEPARATION) return false;
          }
          return true;
        };

        // 4a: unused by direct candidates AND perceptually separated from all land neighbours.
        let bestRelaxedSeaIdx = -1;
        for (let idx = 0; idx < PRIMARY_PROCEDURAL_LIMIT; idx++) {
          ensureProcedural(idx + 1);
          const k = procPoolKeys[idx]!;
          if (landKeySet.has(k)) continue;
          const c = procPool[idx]!;
          if (!isSeparated(c)) continue;
          if (isSeaFree(k)) {
            pick = c;
            pickKey = k;
            break;
          }
          if (bestRelaxedSeaIdx === -1) bestRelaxedSeaIdx = idx;
        }
        // 4b: relax sea-only distinctness while keeping land separation.
        if (pick === undefined && bestRelaxedSeaIdx !== -1) {
          pick = procPool[bestRelaxedSeaIdx]!;
          pickKey = procPoolKeys[bestRelaxedSeaIdx]!;
        }
        // 4c: pathological land graph fallback: pick first procedural colour unused by any land neighbour.
        if (pick === undefined) {
          for (let idx = 0; ; idx++) {
            ensureProcedural(idx + 1);
            const k = procPoolKeys[idx]!;
            if (!landKeySet.has(k)) {
              pick = procPool[idx]!;
              pickKey = k;
              break;
            }
          }
        }
      }
    }

    if (pick === undefined) return { ok: false, errors: [{ kind: 'palette-exhausted', faction: f }] };
    colors.set(f, pick);
    colorKeys.set(f, pickKey);
    usedGlobal.add(pickKey);
    recordSeaColor(f, pickKey);
  }

  // Result in faction order.
  const ordered = new Map<FactionId, Rgb>();
  for (const f of order) ordered.set(f, colors.get(f)!);
  return { ok: true, value: ordered };
}

/** The Spanish message of FR-141: the faction that could not be coloured, by name, and the error kind. */
export function paletteMessage(error: PaletteExhausted, presentation: PresentationData): string {
  const name = presentation.factions.find((f) => f.id === error.faction)?.name ?? String(error.faction);
  return fillTemplate(STRINGS.paletteExhausted, { faction: name, kind: error.kind });
}
