import type { Coord, MapFormatV1, Territory } from './map.js';

export interface ValidationResult {
  errors: string[];
  /** Non-fatal findings (e.g. islands, which the sim resolves via maritime fallback). */
  warnings: string[];
}

function isFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** The old single-ring shape, as it still lives in people's saved maps. */
interface LegacyTerritory {
  polygon?: Coord[];
  polygons?: Coord[][];
}

/**
 * Accept the pre-`polygons` shape and lift it into the current one.
 *
 * A territory used to carry one ring called `polygon`; it now carries `polygons`,
 * one per connected piece. The old field is still found in maps already sitting
 * in localStorage from before the change, and silently dropping those maps would
 * mean deleting the user's imported work on the next load. The rename is pure
 * bookkeeping, so the migration is a wrap: one ring becomes a list of one.
 *
 * Returns a new object; the input is left untouched.
 */
export function normalizeMap(map: unknown): unknown {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return map;
  const candidate = map as { territories?: unknown };
  if (!Array.isArray(candidate.territories)) return map;
  return {
    ...(map as object),
    territories: candidate.territories.map((t) => {
      if (typeof t !== 'object' || t === null) return t;
      const legacy = t as LegacyTerritory;
      if (Array.isArray(legacy.polygons)) return t;
      if (!Array.isArray(legacy.polygon)) return t;
      const { polygon: _dropped, ...rest } = legacy as object & { polygon: Coord[] };
      return { ...rest, polygons: [legacy.polygon as Coord[]] };
    }),
  };
}

/**
 * Runtime validation of a `MapFormat` v1 map. Accepts `unknown` so it can be
 * used directly on untrusted JSON (file import, network payload).
 */
export function validateMap(map: unknown): ValidationResult {
  map = normalizeMap(map);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return { errors: ['map must be an object'], warnings };
  }
  const candidate = map as Partial<MapFormatV1>;

  if (candidate.version !== 1) {
    errors.push(`unsupported version: ${JSON.stringify(candidate.version)} (expected 1)`);
  }
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    errors.push('name must be a non-empty string');
  }
  if (!Array.isArray(candidate.territories) || candidate.territories.length === 0) {
    errors.push('territories must be a non-empty array');
    return { errors, warnings };
  }

  // Pass 1: shape checks + id uniqueness.
  const ids = new Set<string>();
  const list: Territory[] = [];
  for (let i = 0; i < candidate.territories.length; i++) {
    const raw = candidate.territories[i] as Partial<Territory> | undefined;
    const where = `territories[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${where} must be an object`);
      continue;
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      errors.push(`${where}.id must be a non-empty string`);
      continue;
    }
    if (ids.has(raw.id)) {
      errors.push(`duplicate territory id: "${raw.id}"`);
      continue;
    }
    ids.add(raw.id);
    list.push(raw as Territory);

    if (!Array.isArray(raw.neighbors)) {
      errors.push(`"${raw.id}".neighbors must be an array`);
    }
    if (!Array.isArray(raw.polygons) || raw.polygons.length === 0) {
      errors.push(`"${raw.id}".polygons needs at least one ring`);
    } else {
      raw.polygons.forEach((ring: unknown, i: number) => {
        if (!Array.isArray(ring) || ring.length < 3) {
          errors.push(`"${raw.id}".polygons[${i}] needs at least 3 points`);
        } else {
          for (const [j, pt] of (ring as unknown[]).entries()) {
            if (!isFinitePair(pt)) {
              errors.push(`"${raw.id}".polygons[${i}][${j}] must be [x, y] with finite numbers`);
            }
          }
        }
      });
    }
    if (raw.center !== undefined && !isFinitePair(raw.center)) {
      errors.push(`"${raw.id}".center must be [x, y] with finite numbers`);
    }
    if (
      raw.holes !== undefined &&
      (!Array.isArray(raw.holes) ||
        raw.holes.some(
          (h) => !Array.isArray(h) || h.length < 3 || h.some((pt) => !isFinitePair(pt)),
        ))
    ) {
      errors.push(`"${raw.id}".holes must be arrays of at least 3 finite points`);
    }
  }

  // Pass 2: referential integrity, symmetry, island warnings.
  const byId = new Map(list.map((t) => [t.id, t]));
  for (const t of list) {
    for (const field of ['neighbors', 'seaLinks'] as const) {
      const rawField = t[field];
      if (rawField === undefined) continue;
      if (!Array.isArray(rawField)) {
        errors.push(`"${t.id}".${field} must be an array`);
        continue;
      }
      for (const n of rawField) {
        if (typeof n !== 'string') {
          errors.push(`"${t.id}".${field} contains a non-string entry`);
          continue;
        }
        if (n === t.id) {
          errors.push(`"${t.id}".${field} contains itself`);
          continue;
        }
        const other = byId.get(n);
        if (!other) {
          errors.push(`"${t.id}".${field} references unknown territory "${n}"`);
          continue;
        }
        const otherList = other[field];
        if (!Array.isArray(otherList) || !otherList.includes(t.id)) {
          errors.push(`adjacency is not symmetric: "${t.id}" → "${n}" missing in "${n}".${field}`);
        }
      }
    }
    const land = Array.isArray(t.neighbors) ? t.neighbors.length : 0;
    const sea = Array.isArray(t.seaLinks) ? t.seaLinks.length : 0;
    if (land + sea === 0) {
      warnings.push(`territory "${t.id}" has no connections (island)`);
    }
  }

  return { errors, warnings };
}
