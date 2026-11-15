import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, problemMessage, type AddressProblem } from '../src/core/address';
import { initialCamera, type Camera } from '../src/core/camera';

const IMAGE = { w: 2048, h: 2048 };
const VP = { width: 1920, height: 1080 };
const FIT = 1080 / 2048;
const T = 4;

const parse = (search: string) => parseAddress(search, T, IMAGE, VP);

describe('FR-150 defaults and valid values', () => {
  it('FR-150 an empty address gives seed 1, round 0, no camera and no problem', () => {
    for (const search of ['', '?']) {
      expect(parse(search)).toStrictEqual({ seed: 1, round: 0, camera: undefined, problems: [] });
    }
  });

  it('FR-150 valid seed and round are read as given, with or without the leading question mark', () => {
    expect(parse('?seed=42&round=3')).toStrictEqual({ seed: 42, round: 3, camera: undefined, problems: [] });
    expect(parse('round=2&seed=7')).toStrictEqual({ seed: 7, round: 2, camera: undefined, problems: [] });
  });

  it('FR-150 each absent parameter takes its own default', () => {
    expect(parse('?round=2')).toStrictEqual({ seed: 1, round: 2, camera: undefined, problems: [] });
    expect(parse('?seed=9')).toStrictEqual({ seed: 9, round: 0, camera: undefined, problems: [] });
  });

  it('FR-150 the boundaries are valid: seed 0 and 4294967295, round 0 and T', () => {
    expect(parse('?seed=0&round=0').problems).toStrictEqual([]);
    expect(parse('?seed=4294967295&round=4')).toMatchObject({ seed: 4294967295, round: 4, problems: [] });
  });

  it('FR-150 leading zeros are digits and are accepted', () => {
    expect(parse('?seed=007&round=03')).toMatchObject({ seed: 7, round: 3, problems: [] });
  });
});

describe('FR-151 invalid seed or round', () => {
  const badSeeds: [string, string, AddressProblem['reason']][] = [
    ['12abc', '?seed=12abc', 'invalid'],
    ['-1', '?seed=-1', 'invalid'],
    ['1e3', '?seed=1e3', 'invalid'],
    ['4294967296', '?seed=4294967296', 'out-of-range'],
    ['1.5', '?seed=1.5', 'invalid'],
    ['', '?seed=', 'invalid'],
    [' 1', '?seed=%201', 'invalid'],
    ['+1', '?seed=%2B1', 'invalid'],
    ['0x10', '?seed=0x10', 'invalid'],
    ['99999999999999999999999999', '?seed=99999999999999999999999999', 'out-of-range'],
  ];
  for (const [text, search, reason] of badSeeds) {
    it(`FR-151 seed "${text}" is reported as ${reason} and round 0 is displayed without correction`, () => {
      const r = parse(`${search}&round=2`);
      expect(r.round).toBe(0);
      expect(r.seed).toBe(1);
      expect(r.problems).toStrictEqual([{ param: 'seed', text, reason }]);
    });
  }

  const badRounds: [string, string, AddressProblem['reason']][] = [
    ['99', '?round=99', 'out-of-range'],
    ['5', '?round=5', 'out-of-range'],
    ['1.5', '?round=1.5', 'invalid'],
    ['', '?round=', 'invalid'],
    ['-1', '?round=-1', 'invalid'],
    ['1e1', '?round=1e1', 'invalid'],
    ['two', '?round=two', 'invalid'],
  ];
  for (const [text, search, reason] of badRounds) {
    it(`FR-151 round "${text}" is reported as ${reason} and round 0 is displayed without correction`, () => {
      const r = parse(`?seed=5&${search.slice(1)}`);
      expect(r.round).toBe(0);
      expect(r.seed).toBe(5);
      expect(r.problems).toStrictEqual([{ param: 'round', text, reason }]);
    });
  }

  it('FR-151 a repeated seed or round is invalid and the problem lists the values', () => {
    expect(parse('?seed=1&seed=2').problems).toStrictEqual([{ param: 'seed', text: '1,2', reason: 'repeated' }]);
    expect(parse('?round=1&round=1').problems).toStrictEqual([{ param: 'round', text: '1,1', reason: 'repeated' }]);
    expect(parse('?seed=1&seed=2')).toMatchObject({ round: 0 });
  });

  it('FR-151 both invalid gives two problems, seed first, and still displays round 0', () => {
    const r = parse('?round=9&seed=x');
    expect(r.round).toBe(0);
    expect(r.problems.map((p) => p.param)).toStrictEqual(['seed', 'round']);
  });

  it('FR-151 a seed problem shows round 0 even when the round parameter is valid', () => {
    expect(parse('?seed=abc&round=3')).toMatchObject({ round: 0 });
  });

  it('FR-151 the message names the parameter and its text and is built from the UI strings', () => {
    const msg = problemMessage({ param: 'seed', text: '12abc', reason: 'invalid' });
    expect(msg).toContain('seed');
    expect(msg).toContain('12abc');
    expect(problemMessage({ param: 'round', text: '99', reason: 'out-of-range' })).toContain('99');
    expect(problemMessage({ param: 'seed', text: '1,2', reason: 'repeated' })).toContain('1,2');
    expect(problemMessage({ param: 'zoom', text: 'abc', reason: 'invalid' })).toContain('zoom');
    expect(msg).not.toContain('{');
  });
});

describe('FR-150 FR-151 camera parameters', () => {
  it('FR-150 valid x, y and zoom give that camera', () => {
    expect(parse('?x=512.5&y=700&zoom=2.5')).toStrictEqual({
      seed: 1,
      round: 0,
      camera: { x: 512.5, y: 700, scale: 2.5 },
      problems: [],
    });
  });

  it('FR-150 the camera is used only when all three parameters are present', () => {
    for (const search of ['?x=5', '?y=5', '?zoom=3', '?x=5&y=6', '?x=5&zoom=3']) {
      expect(parse(search)).toStrictEqual({ seed: 1, round: 0, camera: undefined, problems: [] });
    }
  });

  it('FR-150 zoom beyond the limits is clamped to 32 or to the fit scale', () => {
    expect(parse('?x=100&y=100&zoom=1000').camera).toStrictEqual({ x: 100, y: 100, scale: 32 });
    expect(parse('?x=100&y=100&zoom=0.0001').camera).toStrictEqual({ x: 100, y: 100, scale: FIT });
    expect(parse('?x=100&y=100&zoom=0').camera?.scale).toBe(FIT);
  });

  it('FR-150 a centre outside the image is clamped to the image', () => {
    expect(parse('?x=5000&y=3000&zoom=2').camera).toStrictEqual({ x: 2048, y: 2048, scale: 2 });
  });

  it('FR-151 x=abc gives a problem naming x and the initial view', () => {
    const r = parse('?x=abc&y=5&zoom=2');
    expect(r.camera).toBeUndefined();
    expect(r.problems).toStrictEqual([{ param: 'x', text: 'abc', reason: 'invalid' }]);
  });

  it('FR-151 every invalid camera parameter is reported, in the order x, y, zoom', () => {
    const r = parse('?zoom=-1&y=1e3&x=.5');
    expect(r.camera).toBeUndefined();
    expect(r.problems).toStrictEqual([
      { param: 'x', text: '.5', reason: 'invalid' },
      { param: 'y', text: '1e3', reason: 'invalid' },
      { param: 'zoom', text: '-1', reason: 'invalid' },
    ]);
  });

  it('FR-151 a repeated camera parameter is invalid', () => {
    expect(parse('?x=1&x=2&y=3&zoom=4').problems).toStrictEqual([{ param: 'x', text: '1,2', reason: 'repeated' }]);
  });

  it('FR-151 an invalid camera does not change seed or round, and an invalid seed does not drop a valid camera', () => {
    expect(parse('?seed=5&round=2&x=abc&y=1&zoom=2')).toMatchObject({ seed: 5, round: 2 });
    const r = parse('?seed=zz&x=10&y=20&zoom=3');
    expect(r.camera).toStrictEqual({ x: 10, y: 20, scale: 3 });
    expect(r.problems).toStrictEqual([{ param: 'seed', text: 'zz', reason: 'invalid' }]);
  });

  it('FR-151 decimals need digits on both sides of the point', () => {
    for (const bad of ['5.', '.5', '1.2.3', '1,5', '+3', '3e2', '0x1']) {
      const r = parse(`?x=${encodeURIComponent(bad)}&y=1&zoom=2`);
      expect(r.camera).toBeUndefined();
      expect(r.problems[0]).toMatchObject({ param: 'x', reason: 'invalid' });
    }
  });
});

describe('FR-153 address text', () => {
  it('FR-153 formatAddress writes seed, round, x, y and zoom with 1, 1 and 3 decimals', () => {
    expect(formatAddress(1, 2, { x: 512.34, y: 700, scale: 2.5 })).toBe('?seed=1&round=2&x=512.3&y=700.0&zoom=2.500');
  });

  it('FR-153 parse(format(scene)) is the same scene within the written decimals', () => {
    const cams: Camera[] = [
      { x: 512.34, y: 700.06, scale: 2.5004 },
      { x: 0, y: 2048, scale: 32 },
      initialCamera(IMAGE, VP),
    ];
    for (const cam of cams) {
      for (const [seed, round] of [[1, 0], [4294967295, 4], [0, 2]] as const) {
        const r = parse(formatAddress(seed, round, cam));
        expect(r.problems).toStrictEqual([]);
        expect(r.seed).toBe(seed);
        expect(r.round).toBe(round);
        expect(r.camera!.x).toBeCloseTo(cam.x, 1);
        expect(r.camera!.y).toBeCloseTo(cam.y, 1);
        expect(r.camera!.scale).toBeCloseTo(cam.scale, 3);
      }
    }
  });

  it('FR-153 a round change rewrites only the round and keeps seed and camera text', () => {
    const cam: Camera = { x: 300.5, y: 400.5, scale: 8 };
    const a = formatAddress(9, 1, cam);
    const b = formatAddress(9, 2, cam);
    expect(a.replace('round=1', 'round=2')).toBe(b);
  });

  it('FR-149 a different round with the same camera text gives the same parsed camera', () => {
    const cam: Camera = { x: 300.5, y: 400.5, scale: 8 };
    const a = parse(formatAddress(9, 1, cam));
    const b = parse(formatAddress(9, 3, cam));
    expect(a.camera).toStrictEqual(b.camera);
  });

  it('FR-153 formatting a clamp-limited camera parses back without a problem', () => {
    const r = parse(formatAddress(1, 0, { x: 1024, y: 1024, scale: FIT }));
    expect(r.problems).toStrictEqual([]);
    expect(r.camera!.scale).toBeGreaterThanOrEqual(FIT);
  });
});
