// Faction colour assignment (FR-141). Pure: the inputs are the map and the presentation data only,
// so the colours never depend on seed, round, time or camera.
import { entryKind, factionOrder, isValidColor } from '@mbrg/shared';
import type { FactionId, MapData, MapEntry, PresentationData, Result, Rgb } from '@mbrg/shared';
import { fillTemplate, STRINGS } from './strings';
import type { Theme } from './theme';

/** Viewer-internal error kind (English identifier, listed in the language test). */
export interface PaletteExhausted {
  kind: 'palette-exhausted';
  faction: FactionId;
}

const sameColor = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function parseColor(text: string): Rgb {
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
}

/**
 * Direct candidates of every faction at round 0 (002 FR-75, FR-76): factions owning a land neighbour
 * and factions owning land that touches a sea zone shared with it. Links count only when written on
 * both ends. A faction is never its own candidate.
 */
export function directCandidates(map: MapData): Map<FactionId, Set<FactionId>> {
  const entryById = new Map<number, MapEntry>(map.territories.map((t) => [t.id, t]));
  const isSea = (e: MapEntry): boolean => entryKind(e) === 'sea';
  const linked = (a: MapEntry, b: MapEntry): boolean =>
    a.id !== b.id && a.neighbors.includes(b.id) && b.neighbors.includes(a.id);
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
 * FR-141: one colour per faction, in faction order. A preferred colour is used as given. Otherwise
 * step (1) takes the first palette colour used by no coloured faction and equal to no preferred colour
 * of the map; step (2) the first palette colour used by none of the faction's already coloured direct
 * candidates and equal to no preferred colour of its direct candidates; else `palette-exhausted`.
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
  const candidates = directCandidates(map);
  const colors = new Map<FactionId, Rgb>();
  // Preferred colours count as coloured from the start: a faction can see them whatever the order.
  for (const f of order) {
    const own = preferred.get(f);
    if (own !== undefined) colors.set(f, own);
  }
  const preferredList = [...preferred.values()];
  const assigned: Rgb[] = [];

  for (const f of order) {
    if (preferred.has(f)) continue;
    let pick = theme.palette.find(
      (c) => !assigned.some((u) => sameColor(u, c)) && !preferredList.some((p) => sameColor(p, c)),
    );
    if (pick === undefined) {
      const near = [...(candidates.get(f) ?? [])];
      const nearColors = near.flatMap((g) => {
        const c = colors.get(g);
        return c === undefined ? [] : [c];
      });
      pick = theme.palette.find((c) => !nearColors.some((u) => sameColor(u, c)));
    }
    if (pick === undefined) return { ok: false, errors: [{ kind: 'palette-exhausted', faction: f }] };
    colors.set(f, pick);
    assigned.push(pick);
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
