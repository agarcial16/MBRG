import type { ValidationError } from './errors';
import { isValidId } from './ids';
import type { FactionId, MapData, TerritoryId } from './types';

/**
 * FR-21..FR-27, FR-69. Precondition: the structural phase found no blocking error, so every entry
 * is an object with a unique valid id and a list of valid neighbor ids. Owners may still be missing or
 * invalid. Only reads the input.
 *
 * Errors are emitted in map order (territory order, then neighbor-list order);
 * validateMap's stable sort by kind (FR-11) keeps that order inside a kind.
 */
export function validateRelational(map: MapData): ValidationError[] {
  const errors: ValidationError[] = [];
  const { territories } = map;

  const byId = new Map<TerritoryId, number>();
  territories.forEach((t, position) => byId.set(t.id, position));

  for (const a of territories) {
    const seen = new Set<TerritoryId>();
    const repeated = new Set<TerritoryId>();
    for (const n of a.neighbors) {
      if (seen.has(n)) {
        // FR-23: one error per repeated id; later occurrences are not checked again.
        if (!repeated.has(n)) {
          repeated.add(n);
          errors.push({ kind: 'duplicate-neighbor', territory: a.id, neighbor: n });
        }
        continue;
      }
      seen.add(n);

      const position = byId.get(n);
      if (position === undefined) {
        errors.push({ kind: 'unknown-neighbor', territory: a.id, neighbor: n }); // FR-21
      } else if (n === a.id) {
        errors.push({ kind: 'self-neighbor', territory: a.id }); // FR-22
      } else if (!territories[position]?.neighbors.includes(a.id)) {
        errors.push({ kind: 'asymmetric-adjacency', from: a.id, to: n }); // FR-24
      }
    }
  }

  // FR-26, FR-69: factions are the distinct valid owners; several territories per faction are fine.
  const factions = new Set<FactionId>();
  for (const t of territories) {
    const owner: unknown = (t as { owner?: unknown }).owner;
    if (isValidId(owner)) factions.add(owner);
  }
  if (factions.size < 2) errors.push({ kind: 'too-few-factions', count: factions.size });

  // FR-27: connected groups over mutual links only.
  if (territories.length >= 2) {
    const mutual = (i: number, j: number): boolean => {
      const a = territories[i];
      const b = territories[j];
      return !!a && !!b && a.id !== b.id && a.neighbors.includes(b.id) && b.neighbors.includes(a.id);
    };
    const adjacent: number[][] = territories.map(() => []);
    territories.forEach((a, i) => {
      for (const n of a.neighbors) {
        const j = byId.get(n);
        if (j !== undefined && j !== i && mutual(i, j)) adjacent[i]?.push(j);
      }
    });

    const visited = new Array<boolean>(territories.length).fill(false);
    const groups: TerritoryId[][] = [];
    for (let start = 0; start < territories.length; start++) {
      if (visited[start]) continue;
      visited[start] = true;
      const members: number[] = [];
      const queue = [start];
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head] as number;
        members.push(i);
        for (const j of adjacent[i] ?? []) {
          if (!visited[j]) {
            visited[j] = true;
            queue.push(j);
          }
        }
      }
      members.sort((x, y) => x - y);
      groups.push(members.map((i) => (territories[i] as { id: TerritoryId }).id));
    }
    if (groups.length > 1) errors.push({ kind: 'disconnected-map', groups });
  }

  return errors;
}
