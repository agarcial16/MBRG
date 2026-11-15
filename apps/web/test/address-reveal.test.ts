// The `reveal` parameter of the debug scene (spec 009 FR-351, FR-352, D15): parsing, range checks, writing the address.
import { describe, expect, it } from 'vitest';
import { checkReveal, formatAddress, parseAddress, problemMessage, revealAfterRoundChange, revealText } from '../src/core/address';
import type { AddressProblem } from '../src/core/address';
import { STRINGS } from '../src/core/strings';

const IMAGE = { w: 2048, h: 2048 };
const VP = { width: 1920, height: 1080 };
const T = 4;
const parse = (search: string) => parseAddress(search, T, IMAGE, VP);
const CAMERA = { x: 100, y: 200, scale: 2 };

describe('FR-351 the reveal parameter is read', () => {
  it('FR-351 on, victim:0, victim:5349 and absorber:2411 are accepted at round 1 or later and keep their text', () => {
    expect(parse('?round=2&reveal=on').reveal).toStrictEqual({ mode: 'on', text: 'on' });
    expect(parse('?round=2&reveal=victim:0').reveal).toStrictEqual({ mode: 'victim', t: 0, text: 'victim:0' });
    expect(parse('?round=2&reveal=victim:5349').reveal).toStrictEqual({ mode: 'victim', t: 5349, text: 'victim:5349' });
    expect(parse('?round=2&reveal=absorber:2411').reveal).toStrictEqual({ mode: 'absorber', t: 2411, text: 'absorber:2411' });
    for (const search of ['?round=2&reveal=on', '?round=3&reveal=victim:77', '?round=4&reveal=absorber:1']) expect(parse(search).problems, search).toStrictEqual([]);
  });

  it('FR-351 on is valid at round 0 and without a round (the first forward step plays it)', () => {
    expect(parse('?round=0&reveal=on')).toMatchObject({ round: 0, reveal: { mode: 'on' }, problems: [] });
    expect(parse('?reveal=on').reveal).toStrictEqual({ mode: 'on', text: 'on' });
  });

  it('FR-351 without the parameter the result has no reveal key at all and the earlier results are unchanged', () => {
    expect(parse('?round=2')).toStrictEqual({ seed: 1, round: 2, camera: undefined, problems: [] });
    expect('reveal' in parse('?round=2')).toBe(false);
  });

  it('FR-351 a valid reveal does not change seed, round or camera', () => {
    expect(parse('?seed=7&round=3&x=100&y=200&zoom=4&reveal=victim:5')).toMatchObject({ seed: 7, round: 3, camera: { x: 100, y: 200, scale: 4 }, problems: [] });
  });
});

describe('FR-352 an invalid reveal is reported and ignored', () => {
  const bad = ['victim:-1', 'victim:01', 'victim:1.5', 'x', 'victim:', 'victim', ':5', 'absorber:+3', 'victim:1e3', 'ON', 'on ', '', 'victim:5:6', 'Victim:5', 'victim:123456789012'];

  it('FR-352 each bad value gives one problem that names reveal and its text, and no reveal value', () => {
    for (const text of bad) {
      const r = parse(`?round=2&reveal=${encodeURIComponent(text)}`);
      expect(r.problems, text).toHaveLength(1);
      expect(r.problems[0]?.param, text).toBe('reveal');
      expect(r.problems[0]?.text, text).toBe(text);
      expect(r.reveal, text).toBeUndefined();
      expect('reveal' in r, text).toBe(false);
      expect(r.round, text).toBe(2);
    }
  });

  it('FR-352 a repeated reveal is one problem with both texts, even when both are valid', () => {
    const r = parse('?round=2&reveal=on&reveal=victim:5');
    expect(r.problems).toStrictEqual([{ param: 'reveal', text: 'on,victim:5', reason: 'repeated' }]);
    expect(r.reveal).toBeUndefined();
  });

  it('FR-352 a frozen value at round 0 (or at a round that failed) is a problem, on is not', () => {
    for (const search of ['?round=0&reveal=victim:5', '?reveal=absorber:5', '?round=9&reveal=victim:5']) {
      const r = parse(search);
      expect(r.round, search).toBe(0);
      expect(r.problems.filter((p) => p.param === 'reveal'), search).toHaveLength(1);
      expect(r.reveal, search).toBeUndefined();
    }
    expect(parse('?round=0&reveal=on').problems).toStrictEqual([]);
  });

  it('FR-352 a valid transition wins over any reveal: one problem naming reveal, the reveal ignored, the step kept', () => {
    for (const value of ['on', 'victim:5', 'absorber:5']) {
      const r = parse(`?round=2&transition=0.5&reveal=${value}`);
      expect(r.problems, value).toStrictEqual([{ param: 'reveal', text: value, reason: 'invalid' }]);
      expect(r.reveal, value).toBeUndefined();
      expect(r.transition, value).toStrictEqual({ value: 0.5, text: '0.5' });
    }
    // An invalid transition does not freeze anything: only its own problem is reported and the reveal stays.
    const r = parse('?round=2&transition=9&reveal=on');
    expect(r.problems.map((p) => p.param)).toStrictEqual(['transition']);
    expect(r.reveal).toStrictEqual({ mode: 'on', text: 'on' });
  });

  it('FR-352 the message is Spanish, names the parameter and its text, and says what is valid', () => {
    const p: AddressProblem = { param: 'reveal', text: 'victim:01', reason: 'invalid' };
    const message = problemMessage(p);
    expect(message).toContain('«reveal»');
    expect(message).toContain('«victim:01»');
    expect(message).toMatch(/victim:t/);
    expect(message).not.toMatch(/\{/);
    expect(message).toBe(STRINGS.revealInvalid.replace('{param}', 'reveal').replace('{text}', 'victim:01'));
    // The other parameters keep their messages.
    expect(problemMessage({ param: 'transition', text: '9', reason: 'out-of-range' })).toContain('«transition»');
  });
});

describe('FR-352 the range checks that need the scene', () => {
  const living = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
  const inputs = (n: number, d: number) => ({ living: living(n), candidates: living(d) });
  const victim = (t: number) => ({ mode: 'victim', t, text: `victim:${String(t)}` }) as const;
  const absorber = (t: number) => ({ mode: 'absorber', t, text: `absorber:${String(t)}` }) as const;

  it('FR-352 a victim time up to D is accepted and 1 ms more is refused: 5,349 / 5,350 with three or more, 3,487 / 3,488 with two', () => {
    for (const n of [3, 5, 12, 70]) {
      expect(checkReveal(victim(5349), inputs(n, 1)), `n ${String(n)}`).toBeUndefined();
      expect(checkReveal(victim(5350), inputs(n, 1)), `n ${String(n)}`).toStrictEqual({ param: 'reveal', text: 'victim:5350', reason: 'out-of-range' });
    }
    expect(checkReveal(victim(3487), inputs(2, 1))).toBeUndefined();
    expect(checkReveal(victim(3488), inputs(2, 1))).toStrictEqual({ param: 'reveal', text: 'victim:3488', reason: 'out-of-range' });
    expect(checkReveal(victim(0), inputs(2, 1))).toBeUndefined();
  });

  it('FR-352 an absorber time up to 2,411 is accepted for d >= 2 and refused above it; d < 2 is refused for any time', () => {
    for (const d of [2, 3, 7]) {
      expect(checkReveal(absorber(2411), inputs(5, d)), `d ${String(d)}`).toBeUndefined();
      expect(checkReveal(absorber(2412), inputs(5, d)), `d ${String(d)}`).toStrictEqual({ param: 'reveal', text: 'absorber:2412', reason: 'out-of-range' });
    }
    for (const t of [0, 1, 2411]) {
      expect(checkReveal(absorber(t), inputs(5, 1)), `t ${String(t)}`).toStrictEqual({ param: 'reveal', text: `absorber:${String(t)}`, reason: 'out-of-range' });
      expect(checkReveal(absorber(t), inputs(5, 0))).toBeDefined();
    }
  });

  it('FR-352 on needs no check, and a problem of the check is shown with the same Spanish message', () => {
    expect(checkReveal({ mode: 'on', text: 'on' }, inputs(2, 1))).toBeUndefined();
    const refused = checkReveal(victim(9000), inputs(5, 1)) as AddressProblem;
    expect(problemMessage(refused)).toContain('«victim:9000»');
  });
});

describe('FR-351 the reveal in the written address', () => {
  it('FR-351 formatAddress keeps a valid value exactly as written, after a transition text when both are given', () => {
    const r = parse('?round=2&reveal=victim:123');
    expect(formatAddress(1, 2, CAMERA, undefined, revealText(r.reveal))).toBe('?seed=1&round=2&x=100.0&y=200.0&zoom=2.000&reveal=victim:123');
    expect(formatAddress(1, 2, CAMERA, '0.5', 'on')).toBe('?seed=1&round=2&x=100.0&y=200.0&zoom=2.000&transition=0.5&reveal=on');
    expect(formatAddress(1, 2, CAMERA)).toBe('?seed=1&round=2&x=100.0&y=200.0&zoom=2.000');
  });

  it('FR-351 an invalid value is dropped at the next write: nothing of it survives the parse', () => {
    for (const search of ['?round=2&reveal=victim:01', '?round=0&reveal=victim:5', '?round=2&transition=0.5&reveal=on', '?round=2&reveal=on&reveal=on']) {
      const r = parse(search);
      const written = formatAddress(r.seed, r.round, CAMERA, r.transition?.text, revealText(r.reveal));
      expect(written, search).not.toContain('reveal');
    }
  });

  it('FR-351 a round change drops a frozen value and keeps on (D15)', () => {
    expect(revealAfterRoundChange({ mode: 'on', text: 'on' })).toStrictEqual({ mode: 'on', text: 'on' });
    expect(revealAfterRoundChange({ mode: 'victim', t: 5, text: 'victim:5' })).toBeUndefined();
    expect(revealAfterRoundChange({ mode: 'absorber', t: 5, text: 'absorber:5' })).toBeUndefined();
    expect(revealAfterRoundChange(undefined)).toBeUndefined();
    expect(revealText(undefined)).toBeUndefined();
  });
});
