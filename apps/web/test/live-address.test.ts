import { describe, expect, it } from 'vitest';
import { clampCamera, initialCamera } from '../src/core/camera';
import { chooseScene, formatLiveAddress, liveProblemMessage, readLiveAddress } from '../src/core/live-address';
import { STRINGS } from '../src/core/strings';

const ID = 'AbCdEfGh01234567'; // 16 base64url characters (FR-236)
const OTHER = 'zzzzzzzzzzzzzzzz';
const IMAGE = { w: 2048, h: 2048 };
const VP = { width: 1920, height: 1080 };

describe('FR-306 the page address chooses the scene', () => {
  it.each([true, false])('FR-306 (a) both a seed and a match id is the error "both" in every build (dev %s)', (dev) => {
    expect(chooseScene(`?seed=1&match=${ID}`, dev)).toStrictEqual({ kind: 'message', error: 'both' });
    expect(chooseScene(`?match=${ID}&seed=1&round=2`, dev)).toStrictEqual({ kind: 'message', error: 'both' });
    // A malformed or repeated match id with a seed is still "both": that error comes first.
    expect(chooseScene('?seed=1&match=x', dev)).toStrictEqual({ kind: 'message', error: 'both' });
    expect(chooseScene(`?seed=1&match=${ID}&match=${OTHER}`, dev)).toStrictEqual({ kind: 'message', error: 'both' });
    expect(chooseScene('?seed=&match=', dev)).toStrictEqual({ kind: 'message', error: 'both' });
  });

  it.each([true, false])('FR-306 (b) a match id gives the live match in every build (dev %s), with the other parameters ignored', (dev) => {
    expect(chooseScene(`?match=${ID}`, dev)).toStrictEqual({ kind: 'live', matchId: ID });
    expect(chooseScene(`match=${ID}&round=3&x=1&y=2&zoom=3`, dev)).toStrictEqual({ kind: 'live', matchId: ID });
    expect(chooseScene(`?round=1&match=a_-Z0123456789xY`, dev)).toStrictEqual({ kind: 'live', matchId: 'a_-Z0123456789xY' });
  });

  it('FR-306 (c) a seed only is the debug scene in development and the message "need-match" in production', () => {
    expect(chooseScene('?seed=42&round=1', true)).toStrictEqual({ kind: 'debug' });
    expect(chooseScene('?seed=42&round=1', false)).toStrictEqual({ kind: 'message', error: 'need-match' });
  });

  it('FR-306 (d) neither is the debug scene in development and the message "need-match" in production', () => {
    for (const search of ['', '?', '?round=2', '?x=1&y=2&zoom=3']) {
      expect(chooseScene(search, true), search).toStrictEqual({ kind: 'debug' });
      expect(chooseScene(search, false), search).toStrictEqual({ kind: 'message', error: 'need-match' });
    }
  });

  it.each([true, false])('FR-306 a malformed or repeated match id is "bad-match" in every build (dev %s)', (dev) => {
    const bad = [
      '?match=',
      '?match=short',
      `?match=${ID}x`,
      `?match=${ID.slice(1)}`,
      '?match=AbCdEfGh0123456!',
      '?match=AbCdEfGh0123456%20',
      `?match=${ID}&match=${OTHER}`,
      `?match=${ID}&match=${ID}`,
      '?match=AbCdEfGh0123456=',
      `?match=${ID}%0A`,
    ];
    for (const search of bad) {
      expect(chooseScene(search, dev), search).toStrictEqual({ kind: 'message', error: 'bad-match' });
    }
    // The id is read as the browser decodes it.
    expect(chooseScene('?match=%41bCdEfGh01234567', dev)).toStrictEqual({ kind: 'live', matchId: ID });
  });
});

describe('FR-306 the live address (D31)', () => {
  const read = (search: string, applied = 5) => readLiveAddress(search, applied, IMAGE, VP);

  it('FR-306 without a round the live round N is shown, with no camera and no problem', () => {
    expect(read(`?match=${ID}`)).toStrictEqual({ round: 5, camera: undefined, problems: [] });
    expect(read(`?match=${ID}`, 0)).toStrictEqual({ round: 0, camera: undefined, problems: [] });
  });

  it('FR-306 a round at most N is shown as written, 0 and N included', () => {
    expect(read('?round=2').round).toBe(2);
    expect(read('?round=0').round).toBe(0);
    expect(read('?round=5')).toStrictEqual({ round: 5, camera: undefined, problems: [] });
    expect(read('?round=03').round).toBe(3);
  });

  it('FR-306 a round above N is shown as N with a notice naming the written text', () => {
    const r = read('?round=6');
    expect(r.round).toBe(5);
    expect(r.problems).toStrictEqual([{ param: 'round', text: '6', reason: 'out-of-range' }]);
    expect(read('?round=99999999999999999999').round).toBe(5);
    const message = liveProblemMessage(r.problems[0]!, r.round);
    expect(message).toContain('«6»');
    expect(message).toContain('ronda 5');
    expect(message).not.toContain('{');
  });

  it('FR-306 a round that is not a whole number, or is repeated, shows N with a notice', () => {
    for (const [text, reason] of [
      ['-1', 'invalid'],
      ['1.5', 'invalid'],
      ['x', 'invalid'],
      ['', 'invalid'],
      ['1e1', 'invalid'],
    ] as const) {
      const r = read(`?round=${text}`);
      expect(r.round, text).toBe(5);
      expect(r.problems, text).toStrictEqual([{ param: 'round', text, reason }]);
    }
    const repeated = read('?round=1&round=2');
    expect(repeated.round).toBe(5);
    expect(repeated.problems).toStrictEqual([{ param: 'round', text: '1,2', reason: 'repeated' }]);
    expect(liveProblemMessage(repeated.problems[0]!, 5)).toContain('«1,2»');
  });

  it('FR-306 the camera is used only when x, y and zoom are all valid, and is clamped as in 004', () => {
    const fit = 1080 / 2048;
    const written = read('?x=1024&y=1024&zoom=1');
    expect(written.problems).toStrictEqual([]);
    expect(written.camera).toStrictEqual(clampCamera({ x: 1024, y: 1024, scale: 1 }, IMAGE, VP));
    const wild = read('?x=99999&y=5&zoom=0.001');
    expect(wild.camera).toStrictEqual(clampCamera({ x: 99999, y: 5, scale: 0.001 }, IMAGE, VP));
    expect(wild.camera!.scale).toBeGreaterThanOrEqual(fit - 1e-9);
    expect(read('?x=1&y=2').camera).toBeUndefined();
    expect(read('?x=1&y=2').problems).toStrictEqual([]);
    expect(initialCamera(IMAGE, VP)).toBeDefined();
  });

  it('FR-306 an invalid or repeated camera number is a notice and the whole map is shown', () => {
    for (const search of ['?x=a&y=1&zoom=2', '?x=1&y=1&zoom=-2', '?x=1&x=2&y=1&zoom=2']) {
      const r = read(search);
      expect(r.camera, search).toBeUndefined();
      expect(r.problems.length, search).toBe(1);
      const message = liveProblemMessage(r.problems[0]!, r.round);
      expect(message, search).toContain('cámara');
      expect(message).not.toContain('{');
    }
  });

  it('FR-306 the address is written with the match id, the round and the camera, and never a seed', () => {
    const text = formatLiveAddress(ID, 3, { x: 10.04, y: 20.06, scale: 1.23456 });
    expect(text).toBe(`?match=${ID}&round=3&x=10.0&y=20.1&zoom=1.235`);
    expect(text).not.toMatch(/seed/i);
    expect(new URLSearchParams(text).has('seed')).toBe(false);
    expect(chooseScene(text, false)).toStrictEqual({ kind: 'live', matchId: ID });
    const back = readLiveAddress(text, 5, IMAGE, VP);
    expect(back.round).toBe(3);
    expect(back.problems).toStrictEqual([]);
  });

  it('FR-306 the notices come from the strings module', () => {
    expect(STRINGS.liveRoundAboveN).toContain('{round}');
    expect(liveProblemMessage({ param: 'round', text: '9', reason: 'out-of-range' }, 4)).toBe(
      STRINGS.liveRoundAboveN.replace('{text}', '9').replace('{round}', '4'),
    );
  });
});
