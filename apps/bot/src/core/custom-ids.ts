// The ids written on buttons, menus and windows, and their reading (spec 012 FR-454). They hold a kind and a round, never a user id
// or a token (NFR-89). Pure.
import type { PhaseKind } from './model';

export const START_ID = 'mbrg:start';
export const PREDICT_ID = 'mbrg:predict';
export const pickId = (kind: PhaseKind, round: number): string => `mbrg:pick:${kind}:${round}`;
export const findId = (kind: PhaseKind, round: number): string => `mbrg:find:${kind}:${round}`;

export type ParsedId =
  | { readonly type: 'start' }
  | { readonly type: 'predict' }
  | { readonly type: 'pick'; readonly kind: PhaseKind; readonly round: number }
  | { readonly type: 'find'; readonly kind: PhaseKind; readonly round: number };

const PHASED = /^mbrg:(pick|find):(victim|absorber):([1-9][0-9]{0,15})$/;

export function parseCustomId(id: string): ParsedId | undefined {
  if (id === START_ID) return { type: 'start' };
  if (id === PREDICT_ID) return { type: 'predict' };
  const found = PHASED.exec(id);
  if (found === null) return undefined;
  const round = Number(found[3]);
  if (!Number.isSafeInteger(round)) return undefined;
  return { type: found[1] as 'pick' | 'find', kind: found[2] as PhaseKind, round };
}
