import { describe, expect, it } from 'vitest';
import { errorReply } from '@mbrg/protocol';
import type { Timing } from '@mbrg/protocol';
import { checkPublicCreation } from '../src/service/publiccreate';
import type { PublicCreation } from '../src/service/settings';

// The pure public-creation check (public map list, no manual timing, the 008 timing rules, then the public bounds). Public
// bounds here use non-round constants so an off-by-one on a boundary is caught.

const BOUNDS: PublicCreation = {
  maps: ['dev', 'second'],
  minInterval: 31,
  minPhase1: 11,
  minPhase2: 4,
  maxInterval: 3_599,
  maxOpenLobbies: 50,
  maxPublicRunning: 20,
  lobbyExpiryHours: 24,
};
const OK: Timing = { i: 101, l1: 17, l2: 9 };
const check = (timing: Timing, mapId = 'dev', bounds: PublicCreation = BOUNDS) => checkPublicCreation(bounds, mapId, timing);
const timingError = (...items: string[]) => errorReply('invalid-timing', items);

describe('public creation: the map', () => {
  it('a listed map with a timing inside the bounds is accepted', () => {
    expect(check(OK)).toBeUndefined();
    expect(check(OK, 'second')).toBeUndefined();
  });

  it('a map outside the public list is unknown-map, the same reply as for a map that does not exist', () => {
    const unlisted = check(OK, 'third');
    expect(unlisted).toStrictEqual(errorReply('unknown-map'));
    expect(JSON.stringify(unlisted)).toBe(JSON.stringify(check(OK, 'no-such-map-at-all')));
    expect(JSON.stringify(unlisted)).toBe(JSON.stringify(errorReply('unknown-map')));
  });

  it('an empty public list (public creation off) answers unknown-map for every map, before any timing error', () => {
    expect(check(OK, 'dev', { ...BOUNDS, maps: [] })).toStrictEqual(errorReply('unknown-map'));
    expect(check({ i: 0, l1: 0, l2: 0 }, 'dev', { ...BOUNDS, maps: [] })).toStrictEqual(errorReply('unknown-map'));
  });

  it('a map named like an inherited property is not listed', () => {
    expect(check(OK, 'constructor')).toStrictEqual(errorReply('unknown-map'));
    expect(check(OK, '__proto__')).toStrictEqual(errorReply('unknown-map'));
  });

  it('an unlisted map is reported before a bad timing', () => {
    expect(check('manual', 'third')).toStrictEqual(errorReply('unknown-map'));
    expect(check({ i: 1, l1: 1, l2: 1 }, 'third')).toStrictEqual(errorReply('unknown-map'));
  });
});

describe('public creation: manual timing and the 008 rules', () => {
  it('manual timing is refused with invalid-timing', () => {
    expect(check('manual')).toStrictEqual(errorReply('invalid-timing', ['manual']));
  });

  it('the 008 rules are listed by their letter in their order, first', () => {
    // a: I and L1 whole and >= 1; b: L2 whole and >= 0; c: I > L1 + L2; d: I at most 30 days.
    expect(check({ i: 0.5, l1: 20, l2: 20 })).toStrictEqual(timingError('a', 'c', 'e'));
    expect(check({ i: 120, l1: 20, l2: -1 })).toStrictEqual(timingError('b', 'g'));
    expect(check({ i: 40, l1: 30, l2: 10 })).toStrictEqual(timingError('c'));
    expect(check({ i: 2_592_001, l1: 20, l2: 10 })).toStrictEqual(timingError('d', 'h'));
  });
});

describe('public creation: the public bounds', () => {
  it('the shortest interval is allowed and one second less is refused (item e)', () => {
    expect(check({ i: 31, l1: 11, l2: 4 })).toBeUndefined();
    expect(check({ i: 30, l1: 11, l2: 4 })).toStrictEqual(timingError('e'));
  });

  it('the shortest phase 1 is allowed and one second less is refused (item f)', () => {
    expect(check({ i: 101, l1: 11, l2: 9 })).toBeUndefined();
    expect(check({ i: 101, l1: 10, l2: 9 })).toStrictEqual(timingError('f'));
  });

  it('the shortest phase 2 is allowed and one second less is refused (item g)', () => {
    expect(check({ i: 101, l1: 17, l2: 4 })).toBeUndefined();
    expect(check({ i: 101, l1: 17, l2: 3 })).toStrictEqual(timingError('g'));
    expect(check({ i: 101, l1: 17, l2: 0 })).toStrictEqual(timingError('g'));
  });

  it('the longest interval is allowed and one second more is refused (item h)', () => {
    expect(check({ i: 3_599, l1: 17, l2: 9 })).toBeUndefined();
    expect(check({ i: 3_600, l1: 17, l2: 9 })).toStrictEqual(timingError('h'));
  });

  it('every failed bound is listed once, in the order e, f, g, h', () => {
    expect(check({ i: 20, l1: 5, l2: 2 })).toStrictEqual(timingError('e', 'f', 'g'));
    const tight: PublicCreation = { ...BOUNDS, minInterval: 40, maxInterval: 30 };
    expect(check({ i: 35, l1: 5, l2: 1 }, 'dev', tight)).toStrictEqual(timingError('e', 'f', 'g', 'h'));
  });

  it('a timing that breaks a 008 rule and a bound lists the 008 letters first', () => {
    expect(check({ i: 20, l1: 15, l2: 15 })).toStrictEqual(timingError('c', 'e'));
  });

  it('the check changes nothing and gives the same answer twice', () => {
    const snapshot = JSON.stringify(BOUNDS);
    expect(check({ i: 20, l1: 5, l2: 2 })).toStrictEqual(check({ i: 20, l1: 5, l2: 2 }));
    expect(JSON.stringify(BOUNDS)).toBe(snapshot);
  });
});
