import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, problemMessage } from '../src/core/address';
import type { AddressProblem } from '../src/core/address';
import type { Camera } from '../src/core/camera';
import { STRINGS } from '../src/core/strings';

const IMAGE = { w: 2048, h: 2048 };
const VP = { width: 1920, height: 1080 };
const T = 4;
const parse = (search: string) => parseAddress(search, T, IMAGE, VP);

describe('FR-191 the transition parameter', () => {
  it('FR-191 0, 1, 0.5 and 0.25 are valid at round 1 or later and keep their text', () => {
    for (const text of ['0', '1', '0.5', '0.25']) {
      const r = parse(`?seed=1&round=2&transition=${text}`);
      expect(r.problems, text).toStrictEqual([]);
      expect(r.transition, text).toStrictEqual({ value: Number(text), text });
      expect(r.round).toBe(2);
    }
  });

  it('FR-191 the syntax is the camera syntax: leading zeros, many decimals and 1.000 are valid', () => {
    for (const text of ['00.5', '0.50', '1.000', '0.0000001', '000', '0.123456789012345678']) {
      const r = parse(`?round=1&transition=${text}`);
      expect(r.problems, text).toStrictEqual([]);
      expect(r.transition, text).toStrictEqual({ value: Number(text), text });
    }
  });

  it('FR-191 without the parameter the result has no transition key at all', () => {
    expect(parse('?round=2')).toStrictEqual({ seed: 1, round: 2, camera: undefined, problems: [] });
    expect('transition' in parse('?round=2')).toBe(false);
  });

  it('FR-191 a valid transition does not change seed, round or camera', () => {
    const r = parse('?seed=7&round=3&x=100&y=200&zoom=4&transition=0.5');
    expect(r).toMatchObject({ seed: 7, round: 3, camera: { x: 100, y: 200, scale: 4 }, problems: [] });
  });

  it('FR-191 it applies at round T as well', () => {
    expect(parse(`?round=${T}&transition=0.75`).transition).toStrictEqual({ value: 0.75, text: '0.75' });
  });
});

describe('FR-192 an invalid transition', () => {
  const bad: [string, string, AddressProblem['reason']][] = [
    ['2', '2', 'out-of-range'],
    ['1.0001', '1.0001', 'out-of-range'],
    ['abc', 'abc', 'invalid'],
    ['-0.5', '-0.5', 'invalid'],
    ['1e-1', '1e-1', 'invalid'],
    ['.5', '.5', 'invalid'],
    ['5.', '5.', 'invalid'],
    ['', '', 'invalid'],
    ['+0.5', '%2B0.5', 'invalid'],
    ['0,5', '0%2C5', 'invalid'],
    ['0x1', '0x1', 'invalid'],
    ['99999999999999999999999', '99999999999999999999999', 'out-of-range'],
  ];
  for (const [text, query, reason] of bad) {
    it(`FR-192 "${text}" at round 2 is reported as ${reason}, ignored, and round 2 is still displayed`, () => {
      const r = parse(`?round=2&transition=${query}`);
      expect(r.transition).toBeUndefined();
      expect('transition' in r).toBe(false);
      expect(r.round).toBe(2);
      expect(r.problems).toStrictEqual([{ param: 'transition', text: query.includes('%') ? decodeURIComponent(query) : text, reason }]);
    });
  }

  it('FR-192 a number too long to be finite is invalid', () => {
    const r = parse(`?round=2&transition=${'9'.repeat(400)}`);
    expect(r.problems.map((p) => [p.param, p.reason])).toStrictEqual([['transition', 'invalid']]);
  });

  it('FR-192 a repeated transition is invalid and the problem lists the values', () => {
    const r = parse('?round=2&transition=0.1&transition=0.2');
    expect(r.transition).toBeUndefined();
    expect(r.problems).toStrictEqual([{ param: 'transition', text: '0.1,0.2', reason: 'repeated' }]);
    expect(parse('?round=2&transition=0.5&transition=0.5').problems).toStrictEqual([
      { param: 'transition', text: '0.5,0.5', reason: 'repeated' },
    ]);
  });

  it('FR-192 round 0 has no previous round: a valid number is still a problem', () => {
    for (const search of ['?round=0&transition=0.5', '?transition=0.5', '?seed=3&transition=0']) {
      const r = parse(search);
      expect(r.round, search).toBe(0);
      expect(r.transition, search).toBeUndefined();
      expect(r.problems, search).toStrictEqual([{ param: 'transition', text: search.endsWith('=0') ? '0' : '0.5', reason: 'out-of-range' }]);
    }
  });

  it('FR-192 an invalid seed or round shows round 0, so a valid transition is a problem too, after the seed or round problem', () => {
    const seedBad = parse('?seed=abc&round=3&transition=0.5');
    expect(seedBad.round).toBe(0);
    expect(seedBad.transition).toBeUndefined();
    expect(seedBad.problems.map((p) => p.param)).toStrictEqual(['seed', 'transition']);
    const roundBad = parse('?round=99&transition=0.5');
    expect(roundBad.problems.map((p) => p.param)).toStrictEqual(['round', 'transition']);
  });

  it('FR-192 the camera is unaffected by a transition problem (valid, partial and absent cameras)', () => {
    const withCamera = parse('?round=2&x=100&y=200&zoom=4&transition=abc');
    expect(withCamera.camera).toStrictEqual({ x: 100, y: 200, scale: 4 });
    expect(withCamera.problems.map((p) => p.param)).toStrictEqual(['transition']);
    const without = parse('?round=2&transition=2');
    expect(without.camera).toBeUndefined();
    const zero = parse('?round=0&x=100&y=200&zoom=4&transition=0.5');
    expect(zero.camera).toStrictEqual({ x: 100, y: 200, scale: 4 });
  });

  it('FR-192 a camera problem and a transition problem are both reported, camera first', () => {
    const r = parse('?round=2&x=abc&y=1&zoom=2&transition=7');
    expect(r.problems.map((p) => p.param)).toStrictEqual(['x', 'transition']);
    expect(r.camera).toBeUndefined();
  });

  it('FR-192 the message is Spanish, built from the UI strings, and names the parameter and its text', () => {
    for (const reason of ['invalid', 'out-of-range', 'repeated'] as const) {
      const msg = problemMessage({ param: 'transition', text: 'abc', reason });
      expect(msg, reason).toContain('transition');
      expect(msg, reason).toContain('abc');
      expect(msg, reason).not.toContain('{');
      expect(msg, reason).toBe(STRINGS.transitionInvalid.replace('{param}', 'transition').replace('{text}', 'abc'));
    }
  });

  it('NFR-37 the message of the transition parameter lives in the UI strings module and differs from the camera message', () => {
    expect(STRINGS.transitionInvalid).toMatch(/\{param\}/);
    expect(STRINGS.transitionInvalid).toMatch(/\{text\}/);
    expect(STRINGS.transitionInvalid).not.toBe(STRINGS.cameraInvalid);
    expect(problemMessage({ param: 'transition', text: '2', reason: 'out-of-range' })).not.toBe(
      problemMessage({ param: 'zoom', text: '2', reason: 'out-of-range' }),
    );
  });

  it('FR-192 the 004 messages are unchanged for the other parameters', () => {
    expect(problemMessage({ param: 'zoom', text: 'abc', reason: 'invalid' })).toContain('cámara');
    expect(problemMessage({ param: 'seed', text: '1,2', reason: 'repeated' })).toContain('repetido');
  });
});

describe('FR-193 the address keeps the transition text while frozen', () => {
  const cam: Camera = { x: 300.5, y: 400.5, scale: 8 };

  it('FR-193 formatAddress appends the transition text as written when it is given', () => {
    expect(formatAddress(1, 2, cam, '0.25')).toBe('?seed=1&round=2&x=300.5&y=400.5&zoom=8.000&transition=0.25');
    expect(formatAddress(1, 2, cam, '1.000')).toBe('?seed=1&round=2&x=300.5&y=400.5&zoom=8.000&transition=1.000');
  });

  it('FR-193 without the text the address is the 004 address (three arguments unchanged)', () => {
    expect(formatAddress(1, 2, cam)).toBe('?seed=1&round=2&x=300.5&y=400.5&zoom=8.000');
    expect(formatAddress(1, 2, cam, undefined)).toBe(formatAddress(1, 2, cam));
  });

  it('FR-193 a camera change keeps the text and changes only the camera parameters', () => {
    const a = formatAddress(9, 3, cam, '0.5');
    const b = formatAddress(9, 3, { x: 10.2, y: 20.4, scale: 2 }, '0.5');
    expect(a.slice(a.indexOf('&transition='))).toBe(b.slice(b.indexOf('&transition=')));
    expect(b).toBe('?seed=9&round=3&x=10.2&y=20.4&zoom=2.000&transition=0.5');
  });

  it('FR-193 parse(format(...)) returns the same text, so a copied address reproduces the drawing', () => {
    for (const text of ['0', '0.25', '1', '0.3333', '00.5']) {
      const r = parse(formatAddress(4, 3, cam, text));
      expect(r.problems, text).toStrictEqual([]);
      expect(r.transition, text).toStrictEqual({ value: Number(text), text });
      expect(r.round).toBe(3);
      expect(r.camera).toStrictEqual(cam);
    }
  });

  it('FR-194 a round change writes the address without the parameter (no text given)', () => {
    expect(formatAddress(9, 4, cam)).not.toContain('transition');
  });
});
