// INDEPENDENT model of the reveal-tour goldens (spec 009 NFR-59, plan 4.1 to 4.3). It re-implements the key hash,
// the stream, the stops and the timing in BigInt and plain integers from the spec text and shares no code with
// `apps/web/src` (it imports only the sim package, for the participants, victims and candidates of each round,
// and the reference helpers of the M1 tests, which are themselves independent). The hand-run script
// `generate-tours.ts` writes `tours.json` from it; `tour-golden.test.ts` re-runs it and compares byte for byte.
import { absorptionCandidatesOf, getRounds, getState, livingFactions, totalRounds } from '@mbrg/sim';
import { referenceStops } from '../helpers/tour-reference';

export const GOLDEN_SEED = 1;
export const GOLDEN_MATCH_ID = 'Ab3dE5fG7hI9jK1m';

/** FNV-1a 32 bit over the ASCII bytes, in BigInt (offset basis 2166136261, prime 16777619). */
export function sigmaOf(text: string): number {
  let h = 2166136261n;
  for (const ch of text) {
    h = ((h ^ BigInt(ch.charCodeAt(0))) * 16777619n) & 0xffffffffn;
  }
  return Number(h);
}

interface Timing {
  readonly dwellMin: bigint;
  readonly dwellMax: bigint;
  readonly hold: number;
  readonly fade: number;
}

const VICTIM: Timing = { dwellMin: 120n, dwellMax: 700n, hold: 1500, fade: 300 };
const ABSORBER: Timing = { dwellMin: 120n, dwellMax: 500n, hold: 800, fade: 300 };

/** The instants tau_1 .. tau_H and the end D: d_i = dmin + floor((dmax - dmin) (i - 1)^2 / (H - 2)^2). */
function instantsOf(timing: Timing, stops: number): { at: number[]; end: number } {
  const at = [0];
  const h = BigInt(stops);
  for (let i = 1n; i < h; i++) {
    const dwell = timing.dwellMin + ((timing.dwellMax - timing.dwellMin) * (i - 1n) ** 2n) / (h - 2n) ** 2n;
    at.push(at[at.length - 1]! + Number(dwell));
  }
  return { at, end: at[at.length - 1]! + timing.hold + timing.fade };
}

export interface GoldenTour {
  key: string;
  sigma: number;
  stops: number[];
  at: number[];
  end: number;
}

function tourOf(kind: 'victim' | 'absorber', key: string, result: number, set: readonly number[]): GoldenTour {
  const sigma = sigmaOf(key);
  const stops = referenceStops(kind, result, set, sigma);
  const { at, end } = instantsOf(kind === 'victim' ? VICTIM : ABSORBER, stops.length);
  return { key, sigma, stops, at, end };
}

export interface GoldenRound {
  round: number;
  participants: number[];
  victim: number;
  absorber: number;
  candidates: number[];
  debug: { victim: GoldenTour; absorber: GoldenTour | null };
  live: { victim: GoldenTour; absorber: GoldenTour | null };
}

function must<T>(r: { ok: true; value: T } | { ok: false; errors: unknown }): T {
  if (!r.ok) throw new Error('sim error');
  return r.value;
}

/** The golden rounds of a map for the debug seed 1: participants at round n - 1, the record of round n. */
export function goldenRounds(map: unknown): GoldenRound[] {
  const total = must(totalRounds(map));
  const out: GoldenRound[] = [];
  for (let n = 1; n <= total; n++) {
    const before = must(getState(map, GOLDEN_SEED, n - 1));
    const record = must(getRounds(map, GOLDEN_SEED, n)).at(-1)!;
    const participants = must(livingFactions(map, before));
    const candidates = must(absorptionCandidatesOf(map, before, record.eliminated));
    const tours = (scope: string): { victim: GoldenTour; absorber: GoldenTour | null } => ({
      victim: tourOf('victim', `${scope}:${n}`, record.eliminated, participants),
      absorber: candidates.length >= 2 ? tourOf('absorber', `${scope}:${n}:absorber`, record.absorber, candidates) : null,
    });
    out.push({
      round: n,
      participants,
      victim: record.eliminated,
      absorber: record.absorber,
      candidates,
      debug: tours('debug'),
      live: tours(GOLDEN_MATCH_ID),
    });
  }
  return out;
}

/** JSON with every array of numbers (or of 8-digit hexadecimal strings) on one line. */
export function compactJson(value: unknown): string {
  const item = /(?:-?\d+|"[0-9a-f]{8}")/.source;
  const list = new RegExp('\\[\\s+(' + item + '(?:,\\s+' + item + ')*)\\s+\\]', 'g');
  return JSON.stringify(value, null, 2).replace(list, (_m, body: string) => '[' + body.replace(/\s+/g, ' ') + ']');
}

/** The text of `tours.json`. */
export function toursGoldenText(map: unknown): string {
  const doc = {
    note:
      'Tour goldens of spec 009 (NFR-59). INDEPENDENT values: sigma, stops, instants and D of both tours of every round of the dev map with debug seed 1, under the debug keys (debug:<k>, debug:<k>:absorber) and under the match id keys. Written by generate-tours.ts from tours-model.ts (BigInt hash and stream, no code of apps/web/src). absorber is null when the victim has fewer than two candidates.',
    map: 'dev',
    seed: GOLDEN_SEED,
    matchId: GOLDEN_MATCH_ID,
    rounds: goldenRounds(map),
  };
  return compactJson(doc) + '\n';
}
