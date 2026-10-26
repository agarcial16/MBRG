import { describe, expect, it } from 'vitest';
import { estimateAt, reduce, startLive, type LiveModel } from '../src/core/live-model';
import { clockDriven, panelView } from '../src/core/live-view';
import { DEV_PRESENTATION } from './helpers/dev-map';
import { Driver, MATCH_ID, publicAt, scripted } from './helpers/scripted-match';

const CLOCK = { i: 120, l1: 30, l2: 10 } as const;
const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));

/** The model after the public data, at instant 1,000 (reported time 5,000 + 100 n, clock timing with a schedule). */
async function modelAt(n: number, extra: Parameters<typeof publicAt>[2] = {}): Promise<LiveModel> {
  const s = await scripted();
  const start = startLive(MATCH_ID).model;
  const match = publicAt(s, n, { timing: CLOCK, schedule: { c1: 65_000, c2: 125_000, a: 305_000 }, ...extra });
  return reduce(start, { type: 'public', at: 1000, match }).model;
}

describe('FR-305 (shell) the panel view', () => {
  it('FR-305 (shell) the countdown runs from the estimate: the reported time plus the time elapsed since it arrived', async () => {
    const model = await modelAt(1);
    expect(model.reported).toStrictEqual({ value: 5100, at: 1000 });
    // Phase 1 counts to C1 = 65,000: at the instant 1,000 the estimate is 5,100 -> 59,900 ms -> 1:00 (rounded up).
    expect(panelView(model, 1000, factions).countdown).toBe('Próximo paso en 1:00');
    // 30,000 ms later the estimate is 35,100 -> 29,900 ms -> 0:30; the last reported value alone would still say 1:00.
    expect(estimateAt(model, 31_000)).toBe(35_100);
    expect(panelView(model, 31_000, factions).countdown).toBe('Próximo paso en 0:30');
    expect(panelView(model, 31_000, factions).countdown).not.toBe(panelView(model, 1000, factions).countdown);
    // Past the anchor the countdown stops at 0:00, never negative.
    expect(panelView(model, 100_000, factions).countdown).toBe('Próximo paso en 0:00');
  });

  it('FR-305 (shell) the countdown follows the stage anchor and a manual match has none', async () => {
    const base = await modelAt(1);
    expect(panelView({ ...base, stage: 'phase-2' }, 1000, factions).countdown).toBe('Próximo paso en 2:00');
    expect(panelView({ ...base, stage: 'locked' }, 1000, factions).countdown).toBe('Próximo paso en 5:00');
    const s = await scripted();
    const manual = reduce(startLive(MATCH_ID).model, { type: 'public', at: 1000, match: publicAt(s, 1) }).model;
    expect(panelView(manual, 1000, factions).countdown).toBeUndefined();
  });

  it('FR-305 (shell) the round line, stage, legend and controls follow the displayed round, with no hidden data', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    const view = panelView(d.model, d.at, factions);
    expect(view.round).toBe(`Ronda 2 de ${s.total}`);
    expect(view.stage).toContain('Fase 1');
    expect(view.victim).toBeUndefined();
    expect(view.winner).toBeUndefined();
    expect(view.controls).toStrictEqual({ firstDisabled: false, previousDisabled: false, nextDisabled: true, lastDisabled: true });
    const living = s.living[2] as number[];
    expect(view.legend.filter((row) => row.alive).map((row) => row.faction)).toStrictEqual(factions.map((f) => f.id).filter((id) => living.includes(id)));
    expect(view.legend).toHaveLength(factions.length);
    const keys = Object.keys(view).sort();
    expect(keys).toStrictEqual(['controls', 'countdown', 'halt', 'legend', 'mismatch', 'notice', 'round', 'stage', 'victim', 'winner']);
  });

  it('FR-305 (shell) the victim line shows once revealed, the winner at the end and the halt reason when halted', async () => {
    const withVictim = await modelAt(1, {
      stage: 'phase-2',
      victim: { round: 2, victim: 3, candidates: [1], living: [1, 2, 3], revealedAt: 5000, c2: 125_000, a: 305_000, seq: 9 },
    });
    expect(panelView(withVictim, 1000, factions).victim).toContain(factions.find((f) => f.id === 3)?.name ?? '3');
    const s = await scripted();
    const finished = reduce(startLive(MATCH_ID).model, { type: 'public', at: 1000, match: publicAt(s, s.total) }).model;
    expect(panelView(finished, 1000, factions).winner).toContain('Ganadora');
    const halted: LiveModel = { ...(await modelAt(1)), stage: 'halted', haltReason: 'map-changed', schedule: undefined };
    expect(panelView(halted, 1000, factions).halt).toContain('mapa');
    expect(panelView(await modelAt(1), 1000, factions).halt).toBeUndefined();
  });

  it('FR-307 (shell) the connection notice appears while the next attempt waits and shows the time left', async () => {
    const base = await modelAt(1);
    const waiting: LiveModel = { ...base, wait: { attempt: 2, until: 9000 } };
    expect(panelView(base, 1000, factions).notice).toBeUndefined();
    expect(panelView(waiting, 1000, factions).notice).toBe('Sin conexión con el servidor. Se conserva el último estado. Próximo intento en 0:08.');
    expect(panelView(waiting, 8500, factions).notice).toContain('0:01');
  });

  it('FR-305 (shell) clockDriven is true only for a countdown or a waiting notice', async () => {
    const base = await modelAt(1);
    expect(clockDriven(base)).toBe(true);
    expect(clockDriven({ ...base, timing: 'manual' })).toBe(false);
    expect(clockDriven({ ...base, timing: 'manual', wait: { attempt: 1, until: 2000 } })).toBe(true);
    expect(clockDriven({ ...base, stage: 'finished' })).toBe(false);
    expect(clockDriven({ ...base, fatal: 'unknown-match' })).toBe(false);
  });
});
