// The start screen of the single entry page (spec 010 FR-366): what a typed code or a pasted link becomes. Pure; the page address
// rule is the one of the live scene (`chooseScene`), so the start screen can never build an address the page would refuse.
import { chooseScene } from './live-address';

export type MatchAddress =
  | { readonly ok: true; readonly id: string; readonly search: string; readonly spectate?: true }
  | { readonly ok: false };

const CODE = /^[A-Za-z0-9_-]{16}$/;

/**
 * The address of the match a text names: a bare match code, or a link (or a query) that holds exactly one `match` and no seed.
 * Only the match (and `spectate=1` for spectator links, spec 030 FR-612) is kept: the round and the camera of a pasted link
 * are not carried over. Anything else is refused, before any request.
 */
export function matchAddress(text: string): MatchAddress {
  const typed = text.trim();
  if (CODE.test(typed)) return { ok: true, id: typed, search: `?match=${typed}` };
  const withoutFragment = typed.split('#')[0] ?? '';
  const mark = withoutFragment.indexOf('?');
  const query = mark >= 0 ? withoutFragment.slice(mark + 1) : withoutFragment.includes('=') ? withoutFragment : '';
  if (query === '') return { ok: false };
  const chosen = chooseScene(`?${query}`, false);
  if (chosen.kind !== 'live') return { ok: false };
  return chosen.spectate === true
    ? { ok: true, id: chosen.matchId, search: `?match=${chosen.matchId}&spectate=1`, spectate: true }
    : { ok: true, id: chosen.matchId, search: `?match=${chosen.matchId}` };
}
