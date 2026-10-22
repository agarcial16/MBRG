import { describe, expect, it } from 'vitest';
import { errorReply } from '@mbrg/protocol';
import { readRound } from '../src/core/reads';
import { coreDriver } from './helpers/core-driver';

describe('round reads of the core', () => {
  it('FR-258 a round above N gets round-not-applied naming only N, the same reply for N + 1, N + 2 and T + 5, in every stage', () => {
    const d = coreDriver();
    const stages: string[] = [];
    const check = (): void => {
      stages.push(d.view.stage);
      const n = d.view.appliedRounds;
      const expected = { ok: false, error: errorReply('round-not-applied', [String(n)]) };
      for (const j of [n + 1, n + 2, d.view.totalRounds + 5]) {
        if (j <= n) continue;
        expect(readRound(d.view, j)).toStrictEqual(expected);
      }
      expect(JSON.stringify(expected)).toBe(JSON.stringify({ ok: false, error: { kind: 'round-not-applied', items: [String(n)] } }));
    };
    check();
    for (let r = 0; r < 4; r++) {
      for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) {
        d.run(kind);
        check();
      }
    }
    expect(new Set(stages)).toStrictEqual(new Set(['phase-1', 'phase-2', 'locked', 'finished']));
  });

  it('FR-258 the reply for the pending round reveals neither its victim nor anything else of it, before or after the phase-1 close', () => {
    const d = coreDriver();
    const before = JSON.stringify(readRound(d.view, 1));
    d.run('phase-1-close');
    const victim = d.view.victim!.victim;
    const during = JSON.stringify(readRound(d.view, 1));
    expect(during).toBe(before);
    expect(during).not.toContain('victim');
    expect(JSON.stringify(readRound(d.view, 2))).toBe(during);
    expect(victim).toBeGreaterThan(0);
    d.run('phase-2-close');
    expect(JSON.stringify(readRound(d.view, 1))).toBe(before);
  });

  it('FR-258 a round up to N is available, round 0 included; a round that is not a whole number is invalid-request', () => {
    const d = coreDriver();
    expect(readRound(d.view, 0)).toStrictEqual({ ok: true, round: 0 });
    d.run('phase-1-close');
    d.run('phase-2-close');
    d.run('application');
    expect(readRound(d.view, 1)).toStrictEqual({ ok: true, round: 1 });
    expect(readRound(d.view, 2)).toStrictEqual({ ok: false, error: errorReply('round-not-applied', ['1']) });
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '1' as unknown as number]) {
      expect(readRound(d.view, bad)).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['round']) });
    }
  });
});
