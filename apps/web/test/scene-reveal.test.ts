// The inputs of the debug `reveal` tours (spec 009 FR-351): what the sim is asked and what the tours get.
import { describe, expect, it } from 'vitest';
import { absorptionCandidatesOf, getRounds, getState, livingFactions, ownerOf, totalRounds } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { revealInputs } from '../src/core/scene';
import type { RevealSimPort, SimPort } from '../src/core/scene';
import { DEV_MAP } from './helpers/dev-map';

const REAL: RevealSimPort = { getState, getRounds, livingFactions, absorptionCandidatesOf };
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T => {
  if (!r.ok) throw new Error('sim failed');
  return r.value;
};

/** The real sim wrapped so every request is recorded, in order. */
function recording(): { sim: RevealSimPort; calls: string[] } {
  const calls: string[] = [];
  const sim: RevealSimPort = {
    getState: (map, seed, round) => {
      calls.push(`state:${String(round)}`);
      return getState(map, seed, round);
    },
    getRounds: (map, seed, round) => {
      calls.push(`rounds:${String(round)}`);
      return getRounds(map, seed, round);
    },
    livingFactions: (map, state) => {
      calls.push(`living:${String((state as MatchState).round)}`);
      return livingFactions(map, state);
    },
    absorptionCandidatesOf: (map, state, faction) => {
      calls.push(`candidates:${String((state as MatchState).round)}:${String(faction)}`);
      return absorptionCandidatesOf(map, state, faction);
    },
  };
  return { sim, calls };
}

describe('FR-351 the inputs of the reveal tours of round n', () => {
  it('FR-351 the participants live at n - 1, the victim and the absorber come from the record of n, the candidates from the state n - 1', () => {
    for (const seed of [1, 7]) {
      for (let n = 1; n <= 4; n++) {
        const before = unwrap(getState(DEV_MAP, seed, n - 1));
        const record = unwrap(getRounds(DEV_MAP, seed, n)).at(-1)!;
        const r = unwrap(revealInputs(DEV_MAP, seed, n, REAL));
        expect(r.round, `${String(seed)}/${String(n)}`).toBe(n);
        expect(r.living, `${String(seed)}/${String(n)}`).toStrictEqual(unwrap(livingFactions(DEV_MAP, before)));
        expect(r.victim).toBe(record.eliminated);
        expect(r.absorber).toBe(record.absorber);
        // The candidates of the state BEFORE the round, which is where the victim still owns its land.
        expect(r.candidates).toStrictEqual(unwrap(absorptionCandidatesOf(DEV_MAP, before, record.eliminated)));
        expect(r.candidates).toContain(record.absorber);
        expect(r.living).toContain(record.eliminated);
      }
    }
  });

  it('FR-351 the candidates are those of n - 1 and not of n: the dev map round 3 of seed 1 differs between the two states', () => {
    const state2 = unwrap(getState(DEV_MAP, 1, 2));
    const state3 = unwrap(getState(DEV_MAP, 1, 3));
    const victim = unwrap(getRounds(DEV_MAP, 1, 3)).at(-1)!.eliminated;
    const r = unwrap(revealInputs(DEV_MAP, 1, 3, REAL));
    expect(r.candidates).toStrictEqual(unwrap(absorptionCandidatesOf(DEV_MAP, state2, victim)));
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    // Against the state after the round the victim owns nothing: the list would be empty.
    expect(unwrap(absorptionCandidatesOf(DEV_MAP, state3, victim))).toStrictEqual([]);
  });

  it('FR-351 the sim is asked only for the states n - 1 (and what is computed from it) and the records up to n, never for a later round (FR-160)', () => {
    for (let n = 1; n <= 4; n++) {
      const { sim, calls } = recording();
      const r = unwrap(revealInputs(DEV_MAP, 1, n, sim));
      expect(calls).toStrictEqual([`state:${String(n - 1)}`, `rounds:${String(n)}`, `living:${String(n - 1)}`, `candidates:${String(n - 1)}:${String(r.victim)}`]);
    }
  });

  it('FR-351 round 0 has no step to reveal: the sim error is returned, nothing is invented', () => {
    const { sim, calls } = recording();
    const r = revealInputs(DEV_MAP, 1, 0, sim);
    expect(r.ok).toBe(false);
    expect(calls).toStrictEqual(['state:-1']);
  });

  it('FR-351 a sim error on the record is returned as it is', () => {
    const failing: RevealSimPort = { ...REAL, getRounds: () => ({ ok: false, errors: [{ kind: 'invalid-seed' }] }) };
    expect(revealInputs(DEV_MAP, 1, 2, failing)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-seed' }] });
  });

  it('FR-351 the earlier SimPort literal still compiles and is a separate type from the reveal port', () => {
    const port: SimPort = { totalRounds, getState, getRounds, ownerOf };
    expect(Object.keys(port).sort()).toStrictEqual(['getRounds', 'getState', 'ownerOf', 'totalRounds']);
    expect(Object.keys(REAL).sort()).toStrictEqual(['absorptionCandidatesOf', 'getRounds', 'getState', 'livingFactions']);
  });

  it('FR-351 only core/scene.ts names the sim package among the core modules', () => {
    const sources = import.meta.glob('../src/core/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const naming = Object.entries(sources)
      .filter(([, src]) => /@mbrg\/sim/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(([path]) => path.replace('../src/core/', ''));
    expect(naming).toStrictEqual(['scene.ts']);
  });
});
