import { describe, expect, it } from 'vitest';
import { decodeIdPng } from '../src/core/png';
import { inflateStream } from '../src/ui/load';
import pinsText from './golden/tour-frame-pins-debug.json?raw';
import oldPinsText from './golden/tour-frame-pins.json?raw';
import toursText from './golden/tours.json?raw';
import type { GoldenRound } from './golden/tours-model';
import { DEV_MAP, devPngBytes } from './helpers/dev-map';
import { debugFramePinsText, debugPinnedRound } from './helpers/tour-pins';
import type { PinnedRound } from './helpers/tour-pins';

// NFR-59 browser parity (A13, approved 2026-10-26): pins computed under the frozen debug-scene rules. They are REGRESSION values
// written by the code under test; what makes them comparable with a browser is that they do not depend on what a browser
// measures (the label aspects) and that the rules (area, start camera, boxes) are the ones of the frozen debug scene.
const golden = (JSON.parse(toursText) as { rounds: GoldenRound[] }).rounds;
const pins = JSON.parse(pinsText) as { rounds: PinnedRound[] };
const png = async () => {
  const p = await decodeIdPng(devPngBytes(), inflateStream);
  if (!p.ok) throw new Error('png');
  return p.value;
};

describe('NFR-59 pins under the frozen debug-scene rules', () => {
  it('NFR-59 the debug pins file equals the output of its generator byte for byte, and says it holds regression values', async () => {
    expect(debugFramePinsText(DEV_MAP, await png(), golden)).toBe(pinsText);
    expect(pinsText).toContain('REGRESSION PINS');
    expect(pinsText).toContain('not independent');
    expect(pinsText).toContain('exactly 1920 x 1080');
    expect(pinsText).toContain('no address camera');
  });

  it('NFR-59 every round has the eight instants and the absorber pins exactly where the victim has two or more candidates', () => {
    expect(pins.rounds.map((r) => r.round)).toStrictEqual(golden.map((r) => r.round));
    for (const [i, r] of golden.entries()) {
      const pinned = pins.rounds[i]!;
      expect(pinned.victim.digests).toHaveLength(8);
      expect(pinned.absorber === null, `round ${r.round}`).toBe(r.candidates.length < 2);
      for (const d of [...pinned.victim.digests, ...(pinned.absorber?.digests ?? [])]) expect(d).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('NFR-59 the digests are identical with non-round label aspects (2.7, 9.3) and with the placeCentredFactions boxes', async () => {
    const image = await png();
    for (const r of golden) {
      const want = pins.rounds[golden.indexOf(r)]!;
      for (const source of [{ aspect: 2.7 }, { aspect: 9.3 }, { centred: 4 }, { centred: 2.7 }] as const) {
        expect(debugPinnedRound(DEV_MAP, image, r, source), `round ${r.round} ${JSON.stringify(source)}`).toStrictEqual(want);
      }
    }
  }, 120_000);

  it('NFR-59 the debug rules are not the rules of the earlier pins: the start camera differs, so some digests differ (both sets stay)', () => {
    const old = (JSON.parse(oldPinsText) as { rounds: PinnedRound[] }).rounds;
    expect(old).toHaveLength(pins.rounds.length);
    let same = 0;
    let all = 0;
    for (const [i, r] of pins.rounds.entries()) {
      r.victim.digests.forEach((d, k) => {
        all++;
        if (d === old[i]!.victim.digests[k]) same++;
      });
    }
    expect(all).toBeGreaterThan(0);
    expect(same).toBeLessThan(all);
  });
});
