import { isValidId } from './ids';
import { entryKind } from './kinds';
import type { FactionId } from './types';

/**
 * FR-94, FR-101..FR-103: faction order of a map = the distinct own valid owners of land
 * entries, in first-appearance order over the entries. Walks by index; reads own properties only.
 */
export function factionOrder(map: unknown): FactionId[] {
  const order: FactionId[] = [];
  const seen = new Set<number>();
  if (typeof map !== 'object' || map === null || !Object.hasOwn(map, 'territories')) return order;
  const list: unknown = (map as { territories?: unknown }).territories;
  if (!Array.isArray(list)) return order;
  for (let i = 0; i < list.length; i++) {
    const entry: unknown = list[i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    if (entryKind(entry) !== 'land' || !Object.hasOwn(entry, 'owner')) continue;
    const owner: unknown = (entry as { owner?: unknown }).owner;
    if (isValidId(owner) && !seen.has(owner)) {
      seen.add(owner);
      order.push(owner);
    }
  }
  return order;
}
