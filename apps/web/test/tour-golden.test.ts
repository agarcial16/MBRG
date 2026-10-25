import { describe, expect, it } from 'vitest';
import { absorptionCandidatesOf, getRounds, getState, livingFactions, totalRounds } from '@mbrg/sim';
import { decodeIdPng } from '../src/core/png';
import { buildTour } from '../src/core/tour';
import { frameDigest, frameText } from '../src/core/tour-digest';
import type { TourFrame } from '../src/core/tour-frame';
import { tourFrame } from '../src/core/tour-frame';
import { fnv1a32, keyText } from '../src/core/tour-key';
import { inflateStream } from '../src/ui/load';
import pinsText from './golden/tour-frame-pins.json?raw';
import toursText from './golden/tours.json?raw';
import { GOLDEN_MATCH_ID, sigmaOf, toursGoldenText } from './golden/tours-model';
import type { GoldenRound, GoldenTour } from './golden/tours-model';
import { DEV_MAP, devPngBytes } from './helpers/dev-map';
import { PIN_AREA, framePinsText, pinInstants, toursOfRound } from './helpers/tour-pins';
import type { PinnedRound } from './helpers/tour-pins';

// The golden of the tours (NFR-59). tours.json holds INDEPENDENT values (tours-model.ts: BigInt hash and stream, no
// code of apps/web/src). tour-frame-pins.json holds REGRESSION PINS: frame digests written by the code under test.
interface ToursFile {
  seed: number;
  matchId: string;
  rounds: GoldenRound[];
}
interface PinsFile {
  rounds: PinnedRound[];
}
const golden = JSON.parse(toursText) as ToursFile;
const pins = JSON.parse(pinsText) as PinsFile;

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown }): T => {
  if (!r.ok) throw new Error('sim error');
  return r.value;
};

const toursOf = (r: GoldenRound): Array<{ scope: string; kind: 'victim' | 'absorber'; tour: GoldenTour; result: number; set: number[] }> =>
  (['debug', 'live'] as const).flatMap((scope) => {
    const t = r[scope];
    return [
      { scope, kind: 'victim' as const, tour: t.victim, result: r.victim, set: r.participants },
      ...(t.absorber === null ? [] : [{ scope, kind: 'absorber' as const, tour: t.absorber, result: r.absorber, set: r.candidates }]),
    ];
  });

describe('tour goldens (independent values)', () => {
  it('NFR-59 the golden covers every round of the dev map with debug seed 1 and the fixed match id', () => {
    expect(golden.seed).toBe(1);
    expect(golden.matchId).toBe('Ab3dE5fG7hI9jK1m');
    expect(GOLDEN_MATCH_ID).toBe('Ab3dE5fG7hI9jK1m');
    const total = unwrap(totalRounds(DEV_MAP));
    expect(golden.rounds.map((r) => r.round)).toStrictEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it('NFR-59 the participants, victims, absorbers and candidates of the golden are the ones of the sim', () => {
    for (const r of golden.rounds) {
      const before = unwrap(getState(DEV_MAP, 1, r.round - 1));
      const record = unwrap(getRounds(DEV_MAP, 1, r.round)).at(-1)!;
      expect(r.participants, `round ${r.round}`).toStrictEqual(unwrap(livingFactions(DEV_MAP, before)));
      expect(r.victim).toBe(record.eliminated);
      expect(r.absorber).toBe(record.absorber);
      expect(r.candidates).toStrictEqual(unwrap(absorptionCandidatesOf(DEV_MAP, before, record.eliminated)));
      expect(r.candidates).toContain(r.absorber);
      expect(r.participants).toContain(r.victim);
      expect(r.debug.absorber === null).toBe(r.candidates.length < 2);
    }
  });

  it('NFR-59 the keys, sigma, stops, instants and D of every tour equal the golden', () => {
    for (const r of golden.rounds) {
      for (const { scope, kind, tour, result, set } of toursOf(r)) {
        const label = `round ${r.round} ${scope} ${kind}`;
        const key = keyText(scope === 'debug' ? 'debug' : golden.matchId, r.round, kind);
        expect(key, label).toBe(tour.key);
        expect(fnv1a32(key), label).toBe(tour.sigma);
        const built = buildTour({ kind, result, set, sigma: fnv1a32(key), ...(kind === 'absorber' ? { victim: r.victim } : {}) });
        expect(built.stops, label).toStrictEqual(tour.stops);
        expect(built.at, label).toStrictEqual(tour.at);
        expect(built.end, label).toBe(tour.end);
      }
    }
  });

  it('NFR-59 hand-checked anchors: D is 5,349 with three or more participants, 3,487 with two, 2,411 for an absorber tour', () => {
    expect(golden.rounds[0]!.debug.victim.key).toBe('debug:1');
    expect(golden.rounds[0]!.live.victim.key).toBe('Ab3dE5fG7hI9jK1m:1');
    for (const r of golden.rounds) {
      for (const { tour, kind, set } of toursOf(r)) {
        if (kind === 'absorber') {
          expect(tour.end).toBe(2411);
          expect(tour.at[5]).toBe(1311);
          expect(tour.at).toHaveLength(6);
        } else if (set.length >= 3) {
          expect(tour.end).toBe(5349);
          expect(tour.at[11]).toBe(3549);
          expect(tour.at).toHaveLength(12);
        } else {
          expect(tour.end).toBe(3487);
          expect(tour.at[5]).toBe(1687);
          expect(tour.at).toHaveLength(6);
        }
      }
    }
    // The last round has two participants: a victim tour of 6 stops and no absorber tour.
    const last = golden.rounds.at(-1)!;
    expect(last.participants).toHaveLength(2);
    expect(last.debug.absorber).toBeNull();
    expect(last.live.absorber).toBeNull();
  });

  it('NFR-59 every golden tour ends on its result, repeats no faction twice in a row and shows everyone before repeating', () => {
    for (const r of golden.rounds) {
      for (const { tour, result, set, scope, kind } of toursOf(r)) {
        const label = `round ${r.round} ${scope} ${kind}`;
        expect(tour.stops.at(-1), label).toBe(result);
        for (let i = 1; i < tour.stops.length; i++) expect(tour.stops[i], label).not.toBe(tour.stops[i - 1]);
        for (const s of tour.stops) expect(set, label).toContain(s);
        // Read backwards, the first min(|set|, H) stops are distinct.
        const back = [...tour.stops].reverse();
        const first = back.slice(0, Math.min(set.length, back.length));
        expect(new Set(first).size, label).toBe(first.length);
        if (set.length >= 3) expect(tour.stops.slice(0, -1), label).not.toContain(result);
      }
    }
  });

  it('NFR-59 the debug and the match id keys give different tours', () => {
    const different = golden.rounds.filter((r) => r.debug.victim.sigma !== r.live.victim.sigma);
    expect(different.length).toBe(golden.rounds.length);
  });

  it('NFR-59 the generator output equals the committed golden byte for byte', () => {
    expect(toursGoldenText(DEV_MAP)).toBe(toursText);
  });

  it('NFR-59 the independent hash agrees with the hash of the code under test on non-round keys', () => {
    for (const text of ['debug:7', 'Ab3dE5fG7hI9jK1m:12:absorber', 'x', 'lit=3,5;dim=0.650000']) {
      expect(sigmaOf(text), text).toBe(fnv1a32(text));
    }
  });
});

describe('tour frame pins (regression values written by the code under test)', () => {
  it('NFR-59 the pinned instants are 0, 400, 1,000, tau_H - 1, tau_H, tau_H + 800, D - 1 and D of each golden tour', () => {
    expect(pins.rounds.map((r) => r.round)).toStrictEqual(golden.rounds.map((r) => r.round));
    for (const [i, r] of golden.rounds.entries()) {
      const pinned = pins.rounds[i]!;
      const expected = (t: GoldenTour): number[] => [0, 400, 1000, t.at.at(-1)! - 1, t.at.at(-1)!, t.at.at(-1)! + 800, t.end - 1, t.end];
      expect(pinned.victim.instants, `round ${r.round}`).toStrictEqual(expected(r.debug.victim));
      if (r.debug.absorber === null) expect(pinned.absorber).toBeNull();
      else expect(pinned.absorber!.instants, `round ${r.round}`).toStrictEqual(expected(r.debug.absorber));
      for (const d of [...pinned.victim.digests, ...(pinned.absorber?.digests ?? [])]) expect(d).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('NFR-59 the frames at the pinned instants equal the pinned digests at 1920 x 1080', async () => {
    const png = await decodeIdPng(devPngBytes(), inflateStream);
    if (!png.ok) throw new Error('png');
    const image = { w: png.value.width, h: png.value.height };
    for (const [i, r] of golden.rounds.entries()) {
      const { victim, absorber, start } = toursOfRound(DEV_MAP, png.value, r);
      const pinned = pins.rounds[i]!;
      const cases = [
        { tour: victim, pin: pinned.victim },
        ...(absorber === null ? [] : [{ tour: absorber, pin: pinned.absorber! }]),
      ];
      for (const { tour, pin } of cases) {
        expect(pinInstants(tour), `round ${r.round}`).toStrictEqual(pin.instants);
        pin.instants.forEach((t, k) => {
          const frame = tourFrame(tour, t, { area: PIN_AREA, image, start, taken: false });
          expect(frameDigest(frame), `round ${r.round} t=${t}`).toBe(pin.digests[k]);
          // The pins are not blind: what each instant shows follows the timing.
          const tauH = tour.at.at(-1)!;
          expect(frame.resultShown, `round ${r.round} t=${t}`).toBe(t >= tauH);
          expect(frame.ended, `round ${r.round} t=${t}`).toBe(t >= tour.end);
          if (t === 0 || t >= tour.end) expect(frame.dim).toBe(0);
          if (t >= 300 && t < tauH + tour.hold) expect(frame.dim).toBeCloseTo(0.65, 12);
        });
      }
    }
  });

  it('NFR-59 the pins file equals the output of the pin generator byte for byte', async () => {
    const png = await decodeIdPng(devPngBytes(), inflateStream);
    if (!png.ok) throw new Error('png');
    expect(framePinsText(DEV_MAP, png.value, golden.rounds)).toBe(pinsText);
  });

  it('NFR-59 the pins file says it holds regression values written by the code under test', () => {
    expect(pinsText).toContain('REGRESSION PINS');
    expect(pinsText).toContain('not independent');
    expect(toursText).toContain('INDEPENDENT');
  });
});

describe('tour frame text and digest', () => {
  const base: TourFrame = {
    lit: [3, 5],
    dim: 0.65,
    factors: { lit: 1, other: 0 },
    camera: { x: 12.3456, y: 7, scale: 1.5 },
    resultShown: true,
    ended: false,
  };

  it('NFR-59 the text is canonical: fixed decimals, absent parts as a dash', () => {
    expect(frameText(base)).toBe('lit=3,5;dim=0.650000;other=0.000000;camera=12.346,7.000,1.500;marker=-;indicator=-;result=1;ended=0');
    const full: TourFrame = { ...base, marker: { x: 100.0004, y: 50.5, r: 28.25 }, indicator: { x: 12, y: 91, angle: -2.9997 } };
    expect(frameText(full)).toBe(
      'lit=3,5;dim=0.650000;other=0.000000;camera=12.346,7.000,1.500;marker=100.000,50.500,28.250;indicator=12.000,91.000,-3.000;result=1;ended=0',
    );
    const done: TourFrame = { lit: [], dim: 0, factors: { lit: 1, other: 1 }, resultShown: true, ended: true };
    expect(frameText(done)).toBe('lit=-;dim=0.000000;other=1.000000;camera=-;marker=-;indicator=-;result=1;ended=1');
  });

  it('NFR-59 a negative zero, or a value that rounds to it, is written as zero', () => {
    const f: TourFrame = { ...base, camera: { x: -0.0004, y: -0, scale: 1 }, dim: -0 };
    expect(frameText(f)).toBe('lit=3,5;dim=0.000000;other=0.000000;camera=0.000,0.000,1.000;marker=-;indicator=-;result=1;ended=0');
  });

  it('NFR-59 the digest is the FNV-1a of the text in eight lowercase hexadecimal digits (independent hash)', () => {
    for (const f of [base, { lit: [], dim: 0, factors: { lit: 1 as const, other: 1 }, resultShown: true, ended: true }]) {
      const expected = sigmaOf(frameText(f)).toString(16).padStart(8, '0');
      expect(frameDigest(f)).toBe(expected);
      expect(frameDigest(f)).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(frameDigest(base)).not.toBe(frameDigest({ ...base, lit: [3, 6] }));
    expect(frameDigest(base)).not.toBe(frameDigest({ ...base, camera: { x: 12.3466, y: 7, scale: 1.5 } }));
  });
});
