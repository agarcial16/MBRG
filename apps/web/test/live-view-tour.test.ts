// The live panel during the reveal tours (spec 009 FR-330, D12, D13, D19): the panel never shows the victim's name before the
// tour stops on it, and its legend keeps the old counts while the absorber tour plays.
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/core/strings';
import type { LiveModel } from '../src/core/live-model';
import { absorberRequestOf, liveTourPanel, panelTourState, panelView, tourReportOf, victimRequestOf, type LivePanelView } from '../src/core/live-view';
import { skipLabel } from '../src/core/live-text';
import { DEV_PRESENTATION } from './helpers/dev-map';
import { Driver, eventsOfRound, scripted, type Scripted } from './helpers/scripted-match';

const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));
const nameOf = (id: number): string => factions.find((f) => f.id === id)?.name ?? '';

/** A model in phase 2 of round `k` (the victim revealed, N = k - 1, displayed N). */
async function revealed(s: Scripted, k: number): Promise<LiveModel> {
  const d = new Driver(s);
  await d.load(k - 1);
  await d.events(eventsOfRound(s, k).slice(0, 3));
  return d.model;
}

/** Every field of the view except the legend, as text. */
const withoutLegend = (v: LivePanelView): string => JSON.stringify({ ...v, legend: undefined });

describe('FR-330 the panel shows "revelando…" until the tour stops on the victim', () => {
  it('FR-330 with revealing the victim line says so and no field except the legend can name a faction; the legend is unchanged', async () => {
    const s = await scripted();
    for (const k of [1, 2, 3]) {
      const model = await revealed(s, k);
      const victim = s.records[k - 1]?.eliminated as number;
      const shown = panelView(model, 20_000, factions);
      expect(shown.victim).toBe(`Víctima de la ronda: ${nameOf(victim)}.`);
      const hidden = panelView(model, 20_000, factions, { revealing: true });
      expect(hidden.victim).toBe('Víctima de la ronda: revelando…');
      expect(hidden.victim).toContain(STRINGS.liveRevealing);
      for (const f of factions) expect(withoutLegend(hidden), `${f.name} in round ${String(k)}`).not.toContain(f.name);
      // The victim line is the only thing that changes.
      expect(hidden.legend).toStrictEqual(shown.legend);
      expect({ ...hidden, victim: undefined }).toStrictEqual({ ...shown, victim: undefined });
    }
  });

  it('FR-330 without revealing the name shows at once: late join, reload, reduced motion and a halted match (D19)', async () => {
    const s = await scripted();
    const model = await revealed(s, 2);
    const victim = s.records[1]?.eliminated as number;
    for (const options of [undefined, {}, { revealing: false }, { revealing: false, absorbing: false }]) {
      expect(panelView(model, 20_000, factions, options).victim, JSON.stringify(options)).toBe(`Víctima de la ronda: ${nameOf(victim)}.`);
    }
    const halted = panelView({ ...model, stage: 'halted', haltReason: 'victim-mismatch' }, 20_000, factions);
    expect(halted.victim).toContain(nameOf(victim));
  });

  it('FR-330 revealing shows the text only where a victim line would show: never in phase 1, finished or without a victim', async () => {
    const s = await scripted();
    const model = await revealed(s, 2);
    for (const stage of ['phase-1', 'finished'] as const) {
      expect(panelView({ ...model, stage }, 20_000, factions, { revealing: true }).victim).toBeUndefined();
    }
    expect(panelView({ ...model, victim: undefined }, 20_000, factions, { revealing: true }).victim).toBeUndefined();
  });

  it('FR-330 the stage, the countdown, the round line, the controls and the notice are never changed by a tour', async () => {
    const s = await scripted();
    const model = { ...(await revealed(s, 2)), timing: { i: 120, l1: 30, l2: 10 }, schedule: { c1: 65_000, c2: 125_000, a: 305_000 } } as LiveModel;
    const base = panelView(model, 20_000, factions);
    expect(base.countdown).toBeDefined();
    for (const options of [{ revealing: true }, { absorbing: true }, { revealing: true, absorbing: true }]) {
      const view = panelView(model, 20_000, factions, options);
      expect(view.stage).toBe(base.stage);
      expect(view.countdown).toBe(base.countdown);
      expect(view.round).toBe(base.round);
      expect(view.controls).toStrictEqual(base.controls);
      expect(view.notice).toBe(base.notice);
      expect(view.winner).toBe(base.winner);
    }
  });
});

describe('FR-345 the legend follows the drawn state during the absorber tour', () => {
  it('FR-345 absorbing: the legend counts the owners of k - 1 while the round line already says k', async () => {
    const s = await scripted();
    for (const k of [1, 2, 3]) {
      const d = new Driver(s);
      await d.load(k - 1);
      await d.events(eventsOfRound(s, k));
      const model = d.model;
      expect(model.displayed).toBe(k);
      const record = s.records[k - 1] as Scripted['records'][number];
      const plain = panelView(model, 20_000, factions);
      const absorbing = panelView(model, 20_000, factions, { absorbing: true });
      expect(absorbing.round).toBe(`Ronda ${String(k)} de ${String(s.total)}`);
      // The legend of the old round: the one the model gives for the displayed round k - 1.
      expect(absorbing.legend).toStrictEqual(panelView({ ...model, displayed: k - 1 }, 20_000, factions).legend);
      expect(absorbing.legend).not.toStrictEqual(plain.legend);
      const row = (v: LivePanelView, id: number): string => v.legend.find((e) => e.faction === id)?.text ?? '';
      expect(row(absorbing, record.eliminated)).toContain(STRINGS.stateAlive);
      expect(row(plain, record.eliminated)).toContain(STRINGS.stateEliminated);
      expect(absorbing.legend.find((e) => e.faction === record.eliminated)?.alive).toBe(true);
      // The rest of the view is the plain one.
      expect({ ...absorbing, legend: [] }).toStrictEqual({ ...plain, legend: [] });
    }
  });

  it('FR-345 absorbing at round 0 or without the old state held leaves no legend rather than the new counts', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    const model = d.model;
    expect(model.held.has(1)).toBe(false);
    expect(panelView(model, 20_000, factions, { absorbing: true }).legend).toStrictEqual([]);
  });
});

describe('FR-343 (panel) the panel state of a tour', () => {
  it('FR-343 (panel) still tours never set revealing; full victim tours do until the result shows or the tour ends', () => {
    expect(panelTourState(undefined)).toStrictEqual({ revealing: false, absorbing: false });
    const full = { tour: 'victim', still: false } as const;
    expect(panelTourState({ ...full, resultShown: false, ended: false })).toStrictEqual({ revealing: true, absorbing: false });
    expect(panelTourState({ ...full, resultShown: true, ended: false })).toStrictEqual({ revealing: false, absorbing: false });
    expect(panelTourState({ ...full, resultShown: false, ended: true })).toStrictEqual({ revealing: false, absorbing: false });
    for (const [resultShown, ended] of [[false, false], [true, false], [true, true]] as const) {
      expect(panelTourState({ tour: 'victim', still: true, resultShown, ended })).toStrictEqual({ revealing: false, absorbing: false });
    }
  });

  it('FR-343 (panel) an absorber tour keeps the old legend until it ends and never sets revealing', () => {
    expect(panelTourState({ tour: 'absorber', still: false, resultShown: false, ended: false })).toStrictEqual({ revealing: false, absorbing: true });
    expect(panelTourState({ tour: 'absorber', still: false, resultShown: true, ended: false })).toStrictEqual({ revealing: false, absorbing: true });
    expect(panelTourState({ tour: 'absorber', still: false, resultShown: true, ended: true })).toStrictEqual({ revealing: false, absorbing: false });
  });
});

describe('FR-320 (panel) the live viewer reports a skipped tour in development builds only', () => {
  it('FR-320 (panel) a mismatch line appears in the message area only when asked, and it is Spanish', async () => {
    const s = await scripted();
    const model = await revealed(s, 1);
    expect(panelView(model, 20_000, factions).mismatch).toBeUndefined();
    expect(panelView(model, 20_000, factions, { mismatch: false }).mismatch).toBeUndefined();
    const line = panelView(model, 20_000, factions, { mismatch: true }).mismatch;
    expect(line).toBe(STRINGS.liveRevealMismatch);
    expect(line).toMatch(/participantes/);
    for (const f of factions) expect(line).not.toContain(f.name);
  });
});

describe('NFR-64 the skip label, and FR-330 the sources that write the panel', () => {
  it('NFR-64 the skip control has a Spanish label from the strings module', () => {
    expect(skipLabel()).toBe('Saltar');
  });

  it('FR-330 the panels write a victim or record text only from the view, and no attribute or title carries view data', () => {
    const sources = import.meta.glob('../src/ui/{live-panel,panel}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(2);
    for (const [path, src] of Object.entries(sources)) {
      const code = src.replace(/\/\/.*$/gm, '');
      // Attributes and titles take fixed labels only.
      for (const m of code.matchAll(/(?:setAttribute\([^)]*\)|\.title\s*=[^;]*|dataset[^;]*)/g)) {
        expect(m[0], `${path}: ${m[0]}`).not.toMatch(/view\b|victim|scene|record|legend/i);
      }
    }
    const live = (sources['../src/ui/live-panel.ts'] as string).replace(/\/\/.*$/gm, '');
    // The live panel writes the victim line only through the one `write(victim, view.victim)` call.
    expect(live.match(/view\.victim/g)).toHaveLength(1);
    expect(live).toMatch(/write\(victim, view\.victim\)/);
  });
});

describe('FR-330 (shell) the live tour requests and the panel state the shell builds', () => {
  const index = new Map(factions.map((f, i) => [f.id, i]));
  const idx = (id: number): number => index.get(id) as number;

  it('FR-330 (shell) the victim request maps ids to view indices and carries sigma and the budget; the last round without two candidates returns to the overview (D20)', async () => {
    const s = await scripted();
    const model = await revealed(s, s.total);
    const victim = s.records[s.total - 1]?.eliminated as number;
    const effect = { type: 'victim-tour', round: s.total, victim, living: s.living[s.total - 1] as number[], sigma: 123_456, budget: 4_321 } as const;
    expect(model.victim?.candidates).toHaveLength(1);
    expect(victimRequestOf(effect, model, index)).toStrictEqual({
      kind: 'victim',
      result: idx(victim),
      set: effect.living.map(idx),
      sigma: 123_456,
      budget: 4_321,
      overviewAfter: true,
    });
    const earlier = await revealed(s, 1);
    const first = victimRequestOf({ ...effect, round: 1, budget: undefined } as never, earlier, index);
    expect(first).toBeDefined();
    expect(first && 'overviewAfter' in first).toBe(false);
    expect(first && 'budget' in first).toBe(false);
    const two = { ...model, victim: { ...(model.victim as NonNullable<typeof model.victim>), candidates: [1, 2] } };
    expect(victimRequestOf(effect, two, index) && 'overviewAfter' in (victimRequestOf(effect, two, index) as object)).toBe(false);
  });

  it('FR-330 (shell) a faction without a view index gives no request, never a thrown error', async () => {
    const s = await scripted();
    const model = await revealed(s, 1);
    const victim = s.records[0]?.eliminated as number;
    const effect = { type: 'victim-tour', round: 1, victim, living: [...(s.living[0] as number[]), 4_000_001], sigma: 1 } as const;
    expect(victimRequestOf(effect, model, index)).toBeUndefined();
    expect(absorberRequestOf({ victim, candidates: [victim, 4_000_001], absorber: victim, sigma: 1 }, index)).toBeUndefined();
  });

  it('FR-345 (shell) the absorber request names the victim, the candidates and the absorber by view index, with sigma and the budget', async () => {
    const s = await scripted();
    const living = s.living[0] as number[];
    const [victim, absorber, other] = [living[0] as number, living[1] as number, living[2] as number];
    expect(absorberRequestOf({ victim, candidates: [absorber, other], absorber, sigma: 77, budget: 2_900 }, index)).toStrictEqual({
      kind: 'absorber',
      result: idx(absorber),
      victim: idx(victim),
      set: [idx(absorber), idx(other)],
      sigma: 77,
      budget: 2_900,
    });
    const nominal = absorberRequestOf({ victim, candidates: [absorber, other], absorber, sigma: 77 }, index);
    expect(nominal && 'budget' in nominal).toBe(false);
  });

  it('FR-330 (shell) a running tour keeps "revelando�" from its first report until its result shows; the end of the run clears the report', () => {
    const status = { index: 0, tour: 'victim', still: false, resultShown: false, ended: false, runEnded: false } as const;
    expect(panelTourState(tourReportOf(status))).toStrictEqual({ revealing: true, absorbing: false });
    expect(panelTourState(tourReportOf({ ...status, resultShown: true }))).toStrictEqual({ revealing: false, absorbing: false });
    expect(panelTourState(tourReportOf({ ...status, still: true }))).toStrictEqual({ revealing: false, absorbing: false });
    expect(panelTourState(tourReportOf({ ...status, tour: 'absorber' }))).toStrictEqual({ revealing: false, absorbing: true });
    expect(tourReportOf({ ...status, ended: true, runEnded: true })).toBeUndefined();
  });

  it('FR-320 (shell) the mismatch line shows in development builds only and only for a skipped reveal', async () => {
    const s = await scripted();
    const model = await revealed(s, 1);
    expect(liveTourPanel({ ...model, skipped: true }, undefined, true)).toStrictEqual({ revealing: false, absorbing: false, mismatch: true });
    expect(liveTourPanel({ ...model, skipped: true }, undefined, false).mismatch).toBe(false);
    expect(liveTourPanel({ ...model, skipped: false }, undefined, true).mismatch).toBe(false);
    const run = { tour: 'victim', still: false, resultShown: false, ended: false } as const;
    expect(liveTourPanel(model, run, true)).toStrictEqual({ revealing: true, absorbing: false, mismatch: false });
    const line = panelView({ ...model, skipped: true }, 10_000, factions, liveTourPanel({ ...model, skipped: true }, undefined, true)).mismatch;
    const none = panelView({ ...model, skipped: true }, 10_000, factions, liveTourPanel({ ...model, skipped: true }, undefined, false)).mismatch;
    expect(line).toBeTypeOf('string');
    expect(none).toBeUndefined();
  });
});
