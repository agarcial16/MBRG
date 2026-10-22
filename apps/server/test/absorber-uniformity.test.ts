import { describe, expect, it } from 'vitest';
import { absorptionCandidatesOf, getState, livingFactions, playRoundWithSeed } from '@mbrg/sim';
import { pickIndex, roundRng } from '../../../packages/sim/src/rng';
import { devMap } from './helpers/digests';

// NFR-47(e): over the round seeds 0..2^20 - 1 on the dev map round-1 state, for each victim the absorber
// share of every candidate is within +-2 percentage points of uniform. This proves the marginal uniformity of
// the absorber given the victim, nothing more. Seeds are enumerated, not random (deterministic).
// The bulk loop uses the engine's own draw functions (roundRng, pickIndex: the victim index, then the
// absorber index from the same stream, as playRound does) and is proven equal to playRoundWithSeed on the
// first 10,000 seeds, so it cannot drift from the real step.

const SEEDS = 2 ** 20;
const TOLERANCE_PP = 2;
const PREFIX = 10_000;

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
}

const map = devMap();
const state = ok(getState(map, 0, 0));
const living = ok(livingFactions(map, state));
const candidates = new Map<number, number[]>(living.map((f) => [f, ok(absorptionCandidatesOf(map, state, f))]));

/** Victim and absorber of round 1 for one seed, from the engine's draw functions. */
function draw(seed: number): [number, number] {
  const rng = roundRng(seed, 1);
  const victim = living[pickIndex(rng, living.length)]!;
  const list = candidates.get(victim)!;
  return [victim, list[pickIndex(rng, list.length)]!];
}

describe('NFR-47 absorber uniformity on the dev map', () => {
  it('NFR-47 the bulk draw equals playRoundWithSeed on seeds 0..9999', () => {
    for (let seed = 0; seed < PREFIX; seed++) {
      const record = ok(playRoundWithSeed(map, state, seed)).record;
      expect(draw(seed), `seed ${seed}`).toStrictEqual([record.eliminated, record.absorber]);
    }
  });

  it('NFR-47 some victim has at least two candidates, so uniformity is not trivial', () => {
    for (const f of living) expect(candidates.get(f)!.length, `faction ${f}`).toBeGreaterThanOrEqual(1);
    expect(Math.max(...[...candidates.values()].map((c) => c.length))).toBeGreaterThanOrEqual(2);
  });

  it('NFR-47 over seeds 0..2^20-1 the absorber share of each candidate is within 2 pp of uniform, per victim', { timeout: 120_000 }, () => {
    const counts = new Map<number, Map<number, number>>(living.map((f) => [f, new Map(candidates.get(f)!.map((c) => [c, 0]))]));
    const victims = new Map<number, number>(living.map((f) => [f, 0]));
    const started = performance.now();
    for (let seed = 0; seed < SEEDS; seed++) {
      const [victim, absorber] = draw(seed);
      victims.set(victim, victims.get(victim)! + 1);
      const per = counts.get(victim)!;
      per.set(absorber, per.get(absorber)! + 1);
    }
    let worst = 0;
    for (const f of living) {
      const total = victims.get(f)!;
      expect(total, `victim ${f} occurs`).toBeGreaterThan(0);
      const list = candidates.get(f)!;
      for (const c of list) {
        const deviation = Math.abs((100 * counts.get(f)!.get(c)!) / total - 100 / list.length);
        worst = Math.max(worst, deviation);
        expect(deviation, `victim ${f} absorber ${c}`).toBeLessThanOrEqual(TOLERANCE_PP);
      }
    }
    console.log(`NFR-47(e): worst deviation ${worst.toFixed(4)} pp over ${SEEDS} seeds in ${Math.round(performance.now() - started)} ms`);
  });
});
