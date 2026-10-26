import { describe, expect, it } from 'vitest';
import { controlsState, keyAction, navigate, parseTypedRound, shortcutApplies, typedRoundMessage } from '../src/core/navigation';
import { initialCamera } from '../src/core/camera';

const T = 4;

describe('FR-154 round navigation', () => {
  it('FR-154 first, previous, next and last from a middle round', () => {
    expect(navigate(2, T, 'first')).toBe(0);
    expect(navigate(2, T, 'previous')).toBe(1);
    expect(navigate(2, T, 'next')).toBe(3);
    expect(navigate(2, T, 'last')).toBe(T);
  });

  it('FR-154 at round 0 previous is invalid, next and last move on, first stays', () => {
    expect(navigate(0, T, 'previous')).toBe('invalid');
    expect(navigate(0, T, 'first')).toBe(0);
    expect(navigate(0, T, 'next')).toBe(1);
    expect(navigate(0, T, 'last')).toBe(T);
  });

  it('FR-154 at round T next is invalid, previous and first move back, last stays', () => {
    expect(navigate(T, T, 'next')).toBe('invalid');
    expect(navigate(T, T, 'last')).toBe(T);
    expect(navigate(T, T, 'previous')).toBe(T - 1);
    expect(navigate(T, T, 'first')).toBe(0);
  });

  it('FR-154 a jump is valid only for an integer from 0 to T', () => {
    expect(navigate(1, T, { to: 0 })).toBe(0);
    expect(navigate(1, T, { to: T })).toBe(T);
    expect(navigate(1, T, { to: 3 })).toBe(3);
    for (const to of [-1, T + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(navigate(1, T, { to })).toBe('invalid');
    }
  });

  it('FR-154 with T = 0 every move is invalid except staying at 0', () => {
    expect(navigate(0, 0, 'next')).toBe('invalid');
    expect(navigate(0, 0, 'previous')).toBe('invalid');
    expect(navigate(0, 0, 'last')).toBe(0);
    expect(navigate(0, 0, { to: 0 })).toBe(0);
  });

  it('FR-154 control states: previous and first disabled at 0, next and last disabled at T', () => {
    expect(controlsState(0, T)).toStrictEqual({
      firstDisabled: true,
      previousDisabled: true,
      nextDisabled: false,
      lastDisabled: false,
    });
    expect(controlsState(2, T)).toStrictEqual({
      firstDisabled: false,
      previousDisabled: false,
      nextDisabled: false,
      lastDisabled: false,
    });
    expect(controlsState(T, T)).toStrictEqual({
      firstDisabled: false,
      previousDisabled: false,
      nextDisabled: true,
      lastDisabled: true,
    });
    expect(controlsState(0, 0)).toStrictEqual({
      firstDisabled: true,
      previousDisabled: true,
      nextDisabled: true,
      lastDisabled: true,
    });
  });

  it('FR-154 a typed round is valid only as digits from 0 to T', () => {
    expect(parseTypedRound('0', T)).toBe(0);
    expect(parseTypedRound('3', T)).toBe(3);
    expect(parseTypedRound('4', T)).toBe(4);
    for (const text of ['5', '', ' 3', '3 ', '-1', '+1', '1.5', '1e1', 'abc', '0x1', '99999999999999999999999']) {
      expect(parseTypedRound(text, T)).toBe('invalid');
    }
  });

  it('FR-154 the invalid typed round message is Spanish text built from the UI strings and names text and T', () => {
    const msg = typedRoundMessage('99', T);
    expect(msg).toContain('99');
    expect(msg).toContain(String(T));
    expect(msg).not.toContain('{');
  });

  it('FR-149 navigation takes no camera: the camera is never an input or an output of a round change', () => {
    expect(navigate.length).toBe(3);
    const cam = initialCamera({ w: 2048, h: 2048 }, { width: 1920, height: 1080 });
    const before = JSON.stringify(cam);
    navigate(1, T, 'next');
    expect(JSON.stringify(cam)).toBe(before);
    expect(typeof navigate(1, T, 'next')).toBe('number');
  });
});

describe('FR-154 keyboard shortcuts', () => {
  it('FR-154 the arrow keys move one round, Home and End jump to the ends, other keys do nothing', () => {
    expect(keyAction('ArrowLeft')).toBe('previous');
    expect(keyAction('ArrowRight')).toBe('next');
    expect(keyAction('Home')).toBe('first');
    expect(keyAction('End')).toBe('last');
    for (const key of ['ArrowUp', 'ArrowDown', 'a', ' ', 'Enter', 'Escape', '', 'home', 'PageUp']) {
      expect(keyAction(key), key).toBeUndefined();
    }
  });

  it('FR-154 shortcuts are ignored while the target is a text field, in any letter case', () => {
    for (const tag of ['INPUT', 'input', 'TEXTAREA', 'textarea', 'SELECT', 'Input']) {
      expect(shortcutApplies(tag), tag).toBe(false);
    }
    for (const tag of ['BODY', 'CANVAS', 'BUTTON', 'DIV', 'body', '', undefined]) {
      expect(shortcutApplies(tag), String(tag)).toBe(true);
    }
  });
});
