import { describe, expect, it } from 'vitest';
import { controlsState, navigate, parseTypedRound } from '../src/core/navigation';
import type { NavAction } from '../src/core/navigation';
import { frame, motionChanged, request, startPlayback } from '../src/core/playback';
import type { PlaybackState } from '../src/core/playback';
import { forwardOf, progressAt } from '../src/core/progress';

const DT = 1500;
const T = 6;
const NOW = 10_000;

/** A request that must have been accepted by the navigation rules. */
function ask(state: PlaybackState, target: number, now = NOW, reduced = false) {
  return request(state, target, now, reduced);
}

describe('FR-176 every control that moves by one round plays a step', () => {
  const cases: [string, number, NavAction, number, 'forward' | 'backward'][] = [
    ['next', 3, 'next', 4, 'forward'],
    ['ArrowRight (next)', 0, 'next', 1, 'forward'],
    ['previous', 3, 'previous', 2, 'backward'],
    ['ArrowLeft (previous)', 6, 'previous', 5, 'backward'],
    ['first from round 1 (Home)', 1, 'first', 0, 'backward'],
    ['last from round T - 1 (End)', T - 1, 'last', T, 'forward'],
    ['typed round N + 1', 2, { to: 3 }, 3, 'forward'],
    ['typed round N - 1', 2, { to: 1 }, 1, 'backward'],
  ];
  for (const [name, from, action, target, direction] of cases) {
    it(`FR-176 ${name} from round ${from} starts a ${direction} step to round ${target}`, () => {
      expect(navigate(from, T, action)).toBe(target);
      const out = ask(startPlayback(from), target);
      expect(out.change).toBe('step');
      expect(out.state.running).toStrictEqual({
        from,
        to: target,
        earlier: Math.min(from, target),
        later: Math.max(from, target),
        direction,
        startMs: NOW,
      });
      expect(out.state.displayed).toBe(target);
    });
  }

  it('FR-176 the typed round text goes through the 004 parser and then plays when it differs by one', () => {
    const typed = parseTypedRound('4', T);
    expect(typed).toBe(4);
    expect(ask(startPlayback(3), typed as number).change).toBe('step');
  });
});

describe('FR-178 every other change is drawn at once', () => {
  it('FR-178 first and last from further away are jumps: instant', () => {
    expect(ask(startPlayback(2), 0).change).toBe('instant');
    expect(ask(startPlayback(T - 2), T).change).toBe('instant');
    expect(ask(startPlayback(3), 0).state.running).toBeUndefined();
  });

  it('FR-178 typed rounds that differ by more than one are instant, in both directions', () => {
    for (const [from, to] of [[1, 3], [5, 2], [0, 6], [6, 0], [2, 4]]) {
      const out = ask(startPlayback(from!), to!);
      expect(out.change, `${from} -> ${to}`).toBe('instant');
      expect(out.state.running).toBeUndefined();
      expect(out.state.displayed).toBe(to);
    }
  });

  it('FR-178 the first drawing after load and the error path (round 0) have no step running', () => {
    for (const n of [0, 3, T]) {
      const s = startPlayback(n);
      expect(s).toStrictEqual({ displayed: n, running: undefined, frozen: undefined });
      expect(frame(s, NOW, DT)).toStrictEqual({ state: s, drawing: { shape: 'whole' }, finished: false });
    }
  });

  it('FR-178 a request for the displayed round changes nothing and starts nothing', () => {
    const s = startPlayback(3);
    const out = ask(s, 3);
    expect(out).toStrictEqual({ state: s, change: 'none', completed: false, unfroze: false });
  });

  it('FR-178 a request for the displayed round while a step runs does nothing and the step keeps playing (U4)', () => {
    const started = ask(startPlayback(4), 5).state;
    const out = ask(started, 5, NOW + 300);
    expect(out).toStrictEqual({ state: started, change: 'none', completed: false, unfroze: false });
    const f = frame(out.state, NOW + 300, DT);
    expect(f.finished).toBe(false);
    expect(f.drawing).toMatchObject({ shape: 'step', earlier: 4, later: 5 });
  });

  it('FR-178 a request for the displayed round does not drop a frozen progress', () => {
    const s = startPlayback(3, 0.25);
    expect(ask(s, 3)).toStrictEqual({ state: s, change: 'none', completed: false, unfroze: false });
  });

  it('FR-178 a target that is not a whole number from 0 is a RangeError', () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => ask(startPlayback(3), bad), `${bad}`).toThrow(RangeError);
  });
});

describe('FR-177 reduced motion', () => {
  it('FR-177 under a reduced-motion preference every round change is instant, even by one round', () => {
    for (const [from, to] of [[3, 4], [3, 2], [1, 0], [T - 1, T], [0, 1]]) {
      const out = ask(startPlayback(from!), to!, NOW, true);
      expect(out.change, `${from} -> ${to}`).toBe('instant');
      expect(out.state).toStrictEqual({ displayed: to, running: undefined, frozen: undefined });
    }
  });

  it('FR-177 a frozen progress still applies under reduced motion until the round changes', () => {
    const s = startPlayback(3, 0.5);
    expect(frame(s, NOW, DT).drawing).toStrictEqual({ shape: 'step', earlier: 2, later: 3, forward: 0.5 });
    const out = ask(s, 4, NOW, true);
    expect(out.change).toBe('instant');
    expect(out.unfroze).toBe(true);
    expect(out.state.frozen).toBeUndefined();
  });

  it('FR-177 the preference at the request decides: the same change plays when it is off', () => {
    expect(ask(startPlayback(3), 4, NOW, false).change).toBe('step');
    expect(ask(startPlayback(3), 4, NOW, true).change).toBe('instant');
  });
});

describe('FR-182 the frames of a step', () => {
  it('FR-182 the first frame (t = 0) of a forward step is f = 0 and of a backward step is f = 1', () => {
    const up = ask(startPlayback(2), 3).state;
    expect(frame(up, NOW, DT).drawing).toStrictEqual({ shape: 'step', earlier: 2, later: 3, forward: 0 });
    const down = ask(startPlayback(3), 2).state;
    expect(frame(down, NOW, DT).drawing).toStrictEqual({ shape: 'step', earlier: 2, later: 3, forward: 1 });
  });

  it('FR-182 t is the time since the request and f follows the progress of the direction', () => {
    const up = ask(startPlayback(2), 3, 500).state;
    const down = ask(startPlayback(3), 2, 500).state;
    for (const t of [1, 250, 750, 1200, 1499]) {
      const p = progressAt(t, DT).p;
      expect(frame(up, 500 + t, DT).drawing, `forward t ${t}`).toStrictEqual({ shape: 'step', earlier: 2, later: 3, forward: forwardOf(p, 'forward') });
      expect(frame(down, 500 + t, DT).drawing, `backward t ${t}`).toStrictEqual({ shape: 'step', earlier: 2, later: 3, forward: forwardOf(p, 'backward') });
    }
  });

  it('FR-182 the first frame with t >= Dt draws the whole displayed round and ends the step', () => {
    const up = ask(startPlayback(2), 3, 500).state;
    const last = frame(up, 500 + DT - 1, DT);
    expect(last.finished).toBe(false);
    const end = frame(up, 500 + DT, DT);
    expect(end).toStrictEqual({ state: { displayed: 3, running: undefined, frozen: undefined }, drawing: { shape: 'whole' }, finished: true });
  });

  it('FR-182 the first frame after a hidden page (a huge t) ends the step at once, backward too', () => {
    for (const [from, to] of [[2, 3], [3, 2]] as const) {
      const s = ask(startPlayback(from), to, 500).state;
      const end = frame(s, 500 + 10 * DT, DT);
      expect(end.finished).toBe(true);
      expect(end.drawing).toStrictEqual({ shape: 'whole' });
      expect(end.state.displayed).toBe(to);
      expect(end.state.running).toBeUndefined();
    }
  });

  it('FR-182 after the step ended, later frames draw the whole round and are not finished again', () => {
    const s = ask(startPlayback(2), 3, 500).state;
    const end = frame(s, 500 + DT, DT);
    const again = frame(end.state, 500 + DT + 16, DT);
    expect(again).toStrictEqual({ state: end.state, drawing: { shape: 'whole' }, finished: false });
  });

  it('FR-182 a frame does not change the state while the step runs (the duration is a parameter)', () => {
    const s = ask(startPlayback(2), 3, 500).state;
    expect(frame(s, 700, DT).state).toBe(s);
    expect(frame(s, 500 + 800, 800).finished).toBe(true);
    expect(frame(s, 500 + 800, 3000).finished).toBe(false);
  });
});

describe('FR-183 a request while a step plays completes it first', () => {
  it('FR-183 previous during the forward step 4 -> 5 shows round 5 at once and then plays 5 -> 4', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    expect(controlsState(running.displayed, T).nextDisabled).toBe(false);
    const target = navigate(running.displayed, T, 'previous');
    expect(target).toBe(4);
    const out = ask(running, target as number, 1400);
    expect(out.completed).toBe(true);
    expect(out.change).toBe('step');
    expect(out.state.running).toStrictEqual({ from: 5, to: 4, earlier: 4, later: 5, direction: 'backward', startMs: 1400 });
    expect(out.state.displayed).toBe(4);
  });

  it('FR-183 a jump during a step completes it and the new round is drawn at once', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    const out = ask(running, 0, 1400);
    expect(out.completed).toBe(true);
    expect(out.change).toBe('instant');
    expect(out.state).toStrictEqual({ displayed: 0, running: undefined, frozen: undefined });
  });

  it('FR-183 next during a forward step continues from the completed round: 4 -> 5 then 5 -> 6', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    const out = ask(running, 6, 1200);
    expect(out.completed).toBe(true);
    expect(out.state.running).toMatchObject({ from: 5, to: 6, direction: 'forward', startMs: 1200 });
  });

  it('FR-183 under reduced motion a request during a step completes it and draws at once', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    const out = ask(running, 6, 1200, true);
    expect(out.completed).toBe(true);
    expect(out.change).toBe('instant');
    expect(out.state.running).toBeUndefined();
  });

  it('FR-183 with no step running nothing is completed', () => {
    expect(ask(startPlayback(4), 5).completed).toBe(false);
    expect(ask(startPlayback(4), 0).completed).toBe(false);
  });

  it('FR-183 a new step restarts the clock at the time of its own request', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    const out = ask(running, 4, 1900);
    expect(out.state.running?.startMs).toBe(1900);
    expect(frame(out.state, 1900, DT).drawing).toMatchObject({ forward: 1 });
  });
});

describe('FR-184 a reduced-motion change completes the step', () => {
  it('FR-184 the preference changing during a step completes it at once', () => {
    const running = ask(startPlayback(4), 5, 1000).state;
    const out = motionChanged(running);
    expect(out.completed).toBe(true);
    expect(out.state).toStrictEqual({ displayed: 5, running: undefined, frozen: undefined });
    expect(frame(out.state, 1100, DT).drawing).toStrictEqual({ shape: 'whole' });
  });

  it('FR-184 a backward step completes at its target round', () => {
    const out = motionChanged(ask(startPlayback(4), 3, 1000).state);
    expect(out.completed).toBe(true);
    expect(out.state.displayed).toBe(3);
  });

  it('FR-184 with no step running a preference change does nothing, and a frozen progress stays', () => {
    const idle = startPlayback(4);
    expect(motionChanged(idle)).toStrictEqual({ state: idle, completed: false });
    const frozen = startPlayback(4, 0.3);
    expect(motionChanged(frozen)).toStrictEqual({ state: frozen, completed: false });
  });
});

describe('FR-185 pan, zoom, reset and resize during a step', () => {
  it('FR-185 playback has no camera input: a step draws the same f whatever the camera does between frames', () => {
    const running = ask(startPlayback(2), 3, 0).state;
    const a = frame(running, 600, DT);
    const b = frame(running, 600, DT);
    expect(a).toStrictEqual(b);
    expect(a.state).toBe(running);
  });

  it('FR-185 the displayed round, which the pointer readout uses, is the round being entered during the step', () => {
    expect(ask(startPlayback(2), 3, 0).state.displayed).toBe(3);
    expect(ask(startPlayback(3), 2, 0).state.displayed).toBe(2);
    const running = ask(startPlayback(2), 3, 0).state;
    expect(frame(running, 700, DT).state.displayed).toBe(3);
  });
});

describe('FR-186 the displayed round is the target at once', () => {
  it('FR-186 after the request, before any frame, the displayed round is the target for every kind of change', () => {
    for (const [from, to, reduced] of [[2, 3, false], [3, 2, false], [2, 5, false], [2, 3, true], [0, 1, false]] as const) {
      expect(ask(startPlayback(from), to, NOW, reduced).state.displayed, `${from} -> ${to}`).toBe(to);
    }
  });

  it('FR-186 a step in progress holds the displayed round at the target for every frame', () => {
    const s = ask(startPlayback(2), 3, 0).state;
    for (const t of [0, 1, 700, 1499]) expect(frame(s, t, DT).state.displayed).toBe(3);
  });
});

describe('FR-191 FR-194 the frozen progress and round changes', () => {
  it('FR-191 a frozen progress draws rounds N - 1 and N at that forward progress, with no clock', () => {
    const s = startPlayback(3, 0.25);
    expect(s.frozen).toBe(0.25);
    for (const now of [0, 5000, 1e9]) {
      expect(frame(s, now, DT)).toStrictEqual({ state: s, drawing: { shape: 'step', earlier: 2, later: 3, forward: 0.25 }, finished: false });
    }
  });

  it('FR-191 the end values 0 and 1 are frozen progress too', () => {
    expect(frame(startPlayback(1, 0), 0, DT).drawing).toStrictEqual({ shape: 'step', earlier: 0, later: 1, forward: 0 });
    expect(frame(startPlayback(1, 1), 0, DT).drawing).toStrictEqual({ shape: 'step', earlier: 0, later: 1, forward: 1 });
  });

  it('FR-191 a frozen progress needs a displayed round of at least 1 and a value from 0 to 1', () => {
    expect(() => startPlayback(0, 0.5)).toThrow(RangeError);
    for (const bad of [-0.1, 1.1, Number.NaN]) expect(() => startPlayback(2, bad), `${bad}`).toThrow(RangeError);
  });

  it('FR-194 a round change leaves the frozen drawing, reports it, and starts from the full state of round N', () => {
    const out = ask(startPlayback(3, 0.5), 4, 2000);
    expect(out.unfroze).toBe(true);
    expect(out.change).toBe('step');
    expect(out.state.frozen).toBeUndefined();
    expect(out.state.running).toMatchObject({ from: 3, to: 4, direction: 'forward', startMs: 2000 });
  });

  it('FR-194 stepping back from a frozen round also animates from the full state of N', () => {
    const out = ask(startPlayback(3, 0), 2, 2000);
    expect(out.unfroze).toBe(true);
    expect(out.state.running).toMatchObject({ from: 3, to: 2, direction: 'backward' });
  });

  it('FR-194 a jump from a frozen round is instant and drops the frozen progress', () => {
    const out = ask(startPlayback(3, 0.5), 0, 2000);
    expect(out).toMatchObject({ change: 'instant', unfroze: true });
    expect(out.state).toStrictEqual({ displayed: 0, running: undefined, frozen: undefined });
  });

  it('FR-194 without a frozen progress nothing is unfrozen', () => {
    expect(ask(startPlayback(3), 4).unfroze).toBe(false);
  });

  it('FR-191 frames and a preference change keep the frozen progress (camera events never reach playback)', () => {
    const s = startPlayback(3, 0.75);
    const f = frame(s, 123, DT);
    expect(f.state).toBe(s);
    expect(motionChanged(f.state).state).toBe(s);
  });
});
