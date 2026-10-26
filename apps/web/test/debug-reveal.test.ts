import { describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { recordLine } from '../src/core/panel-text';
import { debugTourState, digestLine, drawnScene, revealRequests } from '../src/core/debug-reveal';
import { factionIndexOf } from '../src/core/entries';
import { sceneAt } from '../src/core/scene';
import type { Scene, SimPort } from '../src/core/scene';
import { frameDigest } from '../src/core/tour-digest';
import { fnv1a32 } from '../src/core/tour-key';
import { beginSession, freezeSession, paintSession, planTours } from '../src/core/tour-session';
import type { SessionView, TourSession, TourStatus } from '../src/core/tour-session';
import toursText from './golden/tours.json?raw';
import type { GoldenRound } from './golden/tours-model';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';
import { codeOnly } from './helpers/scan';

// FR-341 and the debug shell's pure side (FR-351 (frozen drawing), A2, D12): the requests of a round, what the panel hides, the legend
// guard over a whole chain, the digest of the frame drawn, and the wiring of ui/main.ts, ui/panel.ts and ui/input.ts as text.
const golden = (JSON.parse(toursText) as { rounds: GoldenRound[] }).rounds;
const factionIndex = factionIndexOf(DEV_MAP);
const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
const scene = (n: number): Scene => {
  const s = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, n, REAL);
  if (!s.ok) throw new Error('scene');
  return s.value;
};
const inputsOf = (r: GoldenRound) => ({ round: r.round, living: r.participants, victim: r.victim, absorber: r.absorber, candidates: r.candidates });
const VIEW: SessionView = { area: { width: 1920, height: 1080 }, image: { w: 2048, h: 2048 }, current: { x: 1024, y: 1024, scale: 0.5 } };
const none = () => new Map();

describe('revealRequests: the tours of a debug round over faction indices', () => {
  const r = golden.find((g) => g.candidates.length >= 2)!;
  const one = golden.find((g) => g.candidates.length < 2);

  it('FR-351 (frozen drawing) the victim request holds the participants and the victim; sigma comes from the debug keys', () => {
    const { victim } = revealRequests(inputsOf(r), factionIndex);
    expect(victim.kind).toBe('victim');
    expect(victim.result).toBe(factionIndex.get(r.victim));
    expect(victim.set).toStrictEqual(r.participants.map((f) => factionIndex.get(f)));
    expect(victim.sigma).toBe(fnv1a32(`debug:${r.round}`));
    expect(victim.victim).toBeUndefined();
  });

  it('FR-351 (frozen drawing) the absorber request holds the candidates, the victim and the absorber, with the key debug:<N>:absorber', () => {
    const { absorber } = revealRequests(inputsOf(r), factionIndex);
    expect(absorber).toMatchObject({ kind: 'absorber', result: factionIndex.get(r.absorber), victim: factionIndex.get(r.victim) });
    expect(absorber!.set).toStrictEqual(r.candidates.map((f) => factionIndex.get(f)));
    expect(absorber!.sigma).toBe(fnv1a32(`debug:${r.round}:absorber`));
  });

  it('FR-341 no absorber tour is asked for at d = 1 (the chain then skips it)', () => {
    expect(one, 'the dev map has a round with one candidate').toBeDefined();
    expect(revealRequests(inputsOf(one!), factionIndex).absorber).toBeUndefined();
  });
});

describe('debugTourState: what the panel hides', () => {
  const st = (over: Partial<TourStatus>): TourStatus => ({ index: 0, tour: 'victim', still: false, resultShown: false, ended: false, runEnded: false, ...over });
  it('FR-351 (frozen drawing) the table of the chain: revealing, then absorbing, then nothing', () => {
    expect(debugTourState(undefined)).toStrictEqual({ revealing: false, absorbing: false });
    expect(debugTourState(st({}))).toStrictEqual({ revealing: true, absorbing: false });
    expect(debugTourState(st({ resultShown: true }))).toStrictEqual({ revealing: false, absorbing: true });
    expect(debugTourState(st({ resultShown: true, ended: true }))).toStrictEqual({ revealing: false, absorbing: true });
    expect(debugTourState(st({ index: 1, tour: 'absorber' }))).toStrictEqual({ revealing: false, absorbing: true });
    expect(debugTourState(st({ index: 1, tour: 'absorber', resultShown: true, ended: true, runEnded: true }))).toStrictEqual({ revealing: false, absorbing: false });
    // A still tour (reduced motion) shows the victim at once; the absorber stays hidden until the run ends.
    expect(debugTourState(st({ still: true }))).toStrictEqual({ revealing: false, absorbing: true });
    expect(debugTourState(st({ still: true, ended: true, runEnded: true }))).toStrictEqual({ revealing: false, absorbing: false });
  });
});

describe('the debug legend follows the drawn state N - 1 until the tours stop (plan section 9)', () => {
  /** Every distinct status the map view would report over a whole run, with the scene the panel draws its legend from. */
  function legendsOver(requests: ReturnType<typeof revealRequests>, before: Scene, after: Scene): Array<{ status: TourStatus; legend: Scene['legend']; living: number }> {
    const list = requests.absorber === undefined ? [requests.victim] : [requests.victim, requests.absorber];
    let session: TourSession | undefined = beginSession(planTours(list, false, none), 1000, { overview: true }, true);
    const seen: Array<{ status: TourStatus; legend: Scene['legend']; living: number }> = [];
    let last: TourStatus | undefined;
    for (let t = 0; session !== undefined && t < 20000; t += 7) {
      const out = paintSession(session, 1000 + t, VIEW);
      session = out.session;
      const sameAsLast = last !== undefined && JSON.stringify(last) === JSON.stringify(out.status);
      if (!sameAsLast) {
        const drawn = drawnScene(after, before, debugTourState(out.status));
        seen.push({ status: out.status, legend: drawn.legend, living: drawn.living });
        last = out.status;
      }
    }
    return seen;
  }

  it('FR-351 (frozen drawing) over a whole chain (d >= 2) the legend and the living count are those of N - 1 until the run ends, then those of N', () => {
    const r = golden.find((g) => g.candidates.length >= 2)!;
    const before = scene(r.round - 1);
    const after = scene(r.round);
    expect(after.legend, 'the two rounds differ (not vacuous)').not.toStrictEqual(before.legend);
    expect(after.living).toBeLessThan(before.living);
    const seen = legendsOver(revealRequests(inputsOf(r), factionIndex), before, after);
    expect(seen.map((s) => `${s.status.tour}${s.status.resultShown ? '+' : ''}${s.status.runEnded ? '!' : ''}`)).toStrictEqual([
      'victim', 'victim+', 'absorber', 'absorber+', 'absorber+!',
    ]);
    for (const s of seen.slice(0, -1)) {
      expect(s.legend).toStrictEqual(before.legend);
      expect(s.living).toBe(before.living);
    }
    expect(seen.at(-1)!.legend).toStrictEqual(after.legend);
    expect(seen.at(-1)!.living).toBe(after.living);
  });

  it('FR-351 (frozen drawing) a chain without an absorber tour (d = 1) gives the same guard over the victim tour alone', () => {
    const r = golden.find((g) => g.candidates.length < 2)!;
    const before = scene(r.round - 1);
    const after = scene(r.round);
    const seen = legendsOver(revealRequests(inputsOf(r), factionIndex), before, after);
    expect(seen.map((s) => s.status.runEnded)).toStrictEqual([false, false, true]);
    expect(seen[0]!.legend).toStrictEqual(before.legend);
    expect(seen[1]!.legend).toStrictEqual(before.legend);
    expect(seen[2]!.legend).toStrictEqual(after.legend);
  });

  it('FR-351 (frozen drawing) a frozen value never stops: its legend stays at N - 1 for every t', () => {
    const r = golden.find((g) => g.candidates.length >= 2)!;
    const before = scene(r.round - 1);
    const after = scene(r.round);
    const req = revealRequests(inputsOf(r), factionIndex);
    for (const request of [req.victim, req.absorber!]) {
      const tour = planTours([request], false, none).tours[0]!;
      for (const t of [0, 400, tour.at.at(-1)!, tour.end - 1, tour.end]) {
        const out = paintSession(freezeSession(tour, false, t, { overview: true }, false), 0, VIEW);
        const drawn = drawnScene(after, before, debugTourState(out.status));
        expect(drawn.legend, `${request.kind} t=${t}`).toStrictEqual(before.legend);
      }
    }
  });

  it('FR-351 (frozen drawing) the record line hides the victim before its stop and the absorber until the run ends (A2)', () => {
    const r = golden.find((g) => g.candidates.length >= 2)!;
    const after = scene(r.round);
    const full = recordLine(after, DEV_PRESENTATION);
    const revealing = recordLine(after, DEV_PRESENTATION, { revealing: true });
    const absorbing = recordLine(after, DEV_PRESENTATION, { absorbing: true });
    expect(new Set([full, revealing, absorbing]).size).toBe(3);
    expect(absorbing).toContain('revelando');
    expect(revealing.match(/revelando/g)).toHaveLength(2);
    expect(full).not.toContain('revelando');
  });

  it('FR-351 (frozen drawing) drawnScene keeps the displayed scene when nothing is hidden, or when no earlier scene is held', () => {
    const a = scene(1);
    const b = scene(2);
    expect(drawnScene(b, a, { revealing: false, absorbing: false })).toBe(b);
    expect(drawnScene(b, undefined, { revealing: true, absorbing: false })).toBe(b);
    expect(drawnScene(b, a, { revealing: true, absorbing: false })).toBe(a);
    expect(drawnScene(b, a, { revealing: false, absorbing: true })).toBe(a);
  });
});

describe('the panel digest is the digest of the frame the map view drew', () => {
  it('FR-351 (frozen drawing) digestLine of a frame is its digest in the Spanish line; no frame gives no line', () => {
    const r = golden[0]!;
    const tour = planTours([revealRequests(inputsOf(r), factionIndex).victim], false, none).tours[0]!;
    const frame = paintSession(freezeSession(tour, false, 1000, { overview: true }, false), 0, VIEW).frame;
    expect(digestLine(frame)).toBe(`Huella del fotograma: ${frameDigest(frame)}`);
    expect(digestLine(undefined)).toBeUndefined();
  });

  const src = (path: string): string => codeOnly(Object.values(import.meta.glob('../src/ui/map-view.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0]! + path);

  it('FR-351 (frozen drawing) the map view keeps the frame it drew, right after drawing it, and forgets it on a plain drawing', () => {
    const code = src('');
    expect(code).toMatch(/present\(tourLabelDraws\([^;]*\);\s*lastFrame = out\.frame;/);
    expect(code).toMatch(/mapScene\.setTour\(undefined\);\s*lastFrame = undefined;/);
    expect(code).toContain('tourFrame: () => lastFrame,');
  });
});

describe('FR-341 the skip control and the shell wiring', () => {
  const read = (glob: Record<string, string>): string => codeOnly(Object.values(glob)[0]!);
  const main = read(import.meta.glob('../src/ui/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
  const panel = read(import.meta.glob('../src/ui/panel.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);

  it('FR-341 the skip button and Escape both complete the whole run through the view', () => {
    expect(main.match(/onSkip: \(\) => view\.completeTour\(now\(\)\),/g)).toHaveLength(2);
    expect(panel).toContain('button(reset, STRINGS.tourSkip, handlers.onSkip)');
    expect(panel).toContain('skip.hidden = !skippable;');
  });

  it('FR-341 a round request completes a running tour first (strict no-op without one), before anything else of the change', () => {
    const body = main.slice(main.indexOf('const showRound = (n: number): void =>'));
    expect(body.indexOf('view.completeTour(started)')).toBeGreaterThan(-1);
    expect(body.indexOf('view.completeTour(started)')).toBeLessThan(body.indexOf('view.request(n, started)'));
  });

  it('FR-351 (frozen drawing) a round change leaves a frozen tour: the value is dropped from the address and the view settles on round N', () => {
    expect(main).toMatch(/frozenRequest = undefined;\s*reveal = revealAfterRoundChange\(reveal\);/);
    expect(main).toContain('view.commit(settled, view.prepare(scene.owners, undefined, true), started);');
    expect(main).toContain('syncAddress(scene.seed, scene.round, view.camera(), frozenText, revealText(reveal))');
  });

  it('FR-351 (frozen drawing) the chain plays victim, then absorber when asked for, then the step, only for a forward one-round step', () => {
    expect(main).toMatch(/reveal\?\.mode === \S*\s*&& outcome\.change === \S*\s*&& data !== undefined && n > scene\.round/);
    expect(main).toContain('requests.absorber === undefined ? [requests.victim] : [requests.victim, requests.absorber]');
    expect(main).toContain('view.beginTour(list, started, { target: n, owners: next.owners, data })');
  });

  it('FR-351 (frozen drawing) a frozen tour draws round N - 1 with the address camera counted as taken, and the pointer follows the drawn state', () => {
    expect(main).toContain('view.freezeTour(frozenRequest, reveal.t, address.camera !== undefined);');
    expect(main).toContain('pointerInfo(index, drawnScene(scene, previousScene, tourState)');
    expect(main).toMatch(/round: previousScene === undefined \? scene\.round : previousScene\.round,/);
  });

  it('FR-341 the user camera goes through userCamera (it takes the camera from a tour)', () => {
    expect(main).toMatch(/const setCamera = \(next: Camera\): void => \{\s*view\.userCamera\(next\);/);
  });
});
