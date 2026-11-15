import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_MATCH_KEYS,
  PUBLIC_VICTIM_KEYS,
  STAGES,
  encodePublicMatch,
  type PublicMatch,
  type PublicVictim,
} from '../src/index';

// The public view encoder (FR-254, FR-257): the only input of reply and event builders, with a fixed field order.

const hex = (c: string): string => c.repeat(64);
const schedule = { c1: 1_120_000, c2: 1_150_000, a: 1_160_000 };
const victim: PublicVictim = { round: 1, victim: 2, candidates: [1, 3], living: [1, 2, 3], revealedAt: 1_120_000, c2: 1_150_000, a: 1_160_000, seq: 4 };
const forcedVictim: PublicVictim = { ...victim, candidates: [1], forced: true };
const base: PublicMatch = {
  matchId: 'm-1',
  mapId: 'dev',
  mapDigest: hex('a'),
  totalRounds: 2,
  timing: { i: 120, l1: 30, l2: 10 },
  commitment: hex('c'),
  stage: 'phase-1',
  appliedRounds: 0,
  state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 3]] },
  stateDigest: hex('d'),
  lastSeq: 1,
  reportedTime: 1_000_000,
  schedule,
};
const phase2: PublicMatch = { ...base, stage: 'phase-2', lastSeq: 5, victim };
const forcedPhase2: PublicMatch = { ...phase2, victim: forcedVictim };
const locked: PublicMatch = { ...phase2, stage: 'locked' };
const finished: PublicMatch = {
  ...base,
  stage: 'finished',
  appliedRounds: 2,
  state: { mode: 'classic', round: 2, owners: [[1, 1], [2, 1], [3, 1]] },
  winner: 1,
  matchSecret: hex('5'),
  schedule: undefined,
};
const halted: PublicMatch = { ...base, stage: 'halted', schedule: undefined, haltReason: 'map-changed' };
const haltedAfterReveal: PublicMatch = { ...halted, victim, haltReason: 'victim-mismatch' };

const lobby: PublicMatch = { ...base, stage: 'lobby', playerCount: 0, schedule: undefined };
const expired: PublicMatch = { ...lobby, stage: 'expired', lastSeq: 2, playerCount: 7, reportedTime: 1_900_000 };

const withoutSchedule = (m: PublicMatch): PublicMatch => {
  const { schedule: _omit, ...rest } = m;
  return rest;
};
const reversed = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(reversed);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)]));
  return v;
};
const encodes = (m: object): string => encodePublicMatch(m as PublicMatch);

describe('the public view type', () => {
  it('NFR-47 (b) the key list of the public view is pinned exactly', () => {
    expect([...PUBLIC_MATCH_KEYS]).toStrictEqual([
      'matchId', 'mapId', 'mapDigest', 'totalRounds', 'timing', 'commitment', 'stage', 'appliedRounds', 'state',
      'stateDigest', 'lastSeq', 'reportedTime', 'playerCount', 'schedule', 'victim', 'winner', 'matchSecret', 'haltReason',
    ]);
    expect([...PUBLIC_VICTIM_KEYS]).toStrictEqual(['round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'forced', 'seq']);
  });

  it('NFR-47 (b) the public view has no absorber, pending-state, seed or secret key except the finished-match secret', () => {
    const all = [...PUBLIC_MATCH_KEYS, ...PUBLIC_VICTIM_KEYS, ...Object.keys(base.state)];
    expect(all.filter((k) => /absorb|pending|seed|record|secret/i.test(k))).toStrictEqual(['matchSecret']);
    expect(PUBLIC_VICTIM_KEYS).toContain('forced');
  });

  it('NFR-47 (b) type level: the key list and the type agree and no forbidden key exists', () => {
    type Listed = (typeof PUBLIC_MATCH_KEYS)[number];
    const noneMissing: Exclude<keyof PublicMatch, Listed> extends never ? true : false = true;
    const noneExtra: Exclude<Listed, keyof PublicMatch> extends never ? true : false = true;
    const noForbidden: Extract<keyof PublicMatch | keyof PublicVictim, 'absorber' | 'pendingState' | 'seed' | 'roundSeed' | 'secret'> extends never
      ? true
      : false = true;
    // The victim keys and the type agree too, `forced` included (an optional member).
    type VictimListed = (typeof PUBLIC_VICTIM_KEYS)[number];
    const victimNoneMissing: Exclude<keyof PublicVictim, VictimListed> extends never ? true : false = true;
    const victimNoneExtra: Exclude<VictimListed, keyof PublicVictim> extends never ? true : false = true;
    const forcedKey: 'forced' extends keyof PublicVictim ? true : false = true;
    expect([noneMissing, noneExtra, noForbidden, victimNoneMissing, victimNoneExtra, forcedKey]).toStrictEqual([true, true, true, true, true, true]);
  });
});

describe('the lobby stages in the public view', () => {
  it('FR-257 STAGES gains lobby and expired after the 008 stages', () => {
    expect([...STAGES]).toStrictEqual(['phase-1', 'phase-2', 'locked', 'finished', 'halted', 'lobby', 'expired']);
  });

  it('FR-257 a lobby and an expired view encode with playerCount between reportedTime and the optional members, and with none of them', () => {
    expect(encodePublicMatch(lobby)).toBe(
      '{"matchId":"m-1","mapId":"dev","mapDigest":"' + hex('a') + '","totalRounds":2,"timing":{"i":120,"l1":30,"l2":10},"commitment":"' +
        hex('c') + '","stage":"lobby","appliedRounds":0,"state":{"mode":"classic","round":0,"owners":[[1,1],[2,2],[3,3]]},"stateDigest":"' +
        hex('d') + '","lastSeq":1,"reportedTime":1000000,"playerCount":0}',
    );
    expect(encodePublicMatch(expired)).toContain('"stage":"expired","appliedRounds":0');
    expect(encodePublicMatch(expired)).toContain('"lastSeq":2,"reportedTime":1900000,"playerCount":7}');
    for (const m of [lobby, expired, { ...lobby, timing: 'manual' as const }]) {
      const keys = Object.keys(JSON.parse(encodePublicMatch(m)) as object);
      expect(keys.slice(-2)).toStrictEqual(['reportedTime', 'playerCount']);
      for (const k of ['schedule', 'victim', 'winner', 'matchSecret', 'haltReason']) expect(keys).not.toContain(k);
      expect(encodes(reversed(m) as object)).toBe(encodePublicMatch(m));
    }
  });

  it('FR-257 a lobby or expired view without playerCount, or with an unusable one, is refused', () => {
    for (const m of [lobby, expired]) {
      const { playerCount: _gone, ...rest } = m;
      expect(() => encodes(rest), m.stage).toThrow(RangeError);
      for (const bad of [-1, 1.5, '3', null, Number.NaN, Infinity, 2 ** 53, []]) {
        expect(() => encodes({ ...m, playerCount: bad }), `${m.stage} ${String(bad)}`).toThrow(RangeError);
      }
    }
  });

  it('FR-257 a lobby or expired view carries none of the members of a running, finished or halted view', () => {
    const extras: [string, unknown][] = [
      ['schedule', schedule],
      ['victim', victim],
      ['winner', 1],
      ['matchSecret', hex('5')],
      ['haltReason', 'map-changed'],
    ];
    for (const m of [lobby, expired]) {
      for (const [key, value] of extras) expect(() => encodes({ ...m, [key]: value }), `${m.stage} ${key}`).toThrow(RangeError);
    }
  });

  it('FR-257 a lobby and an expired view have no applied round: the counts and the state stay at round 0', () => {
    for (const m of [lobby, expired]) {
      expect(() => encodes({ ...m, appliedRounds: 1, state: { ...m.state, round: 1 } }), m.stage).toThrow(RangeError);
    }
  });

  it('FR-257 a running view with playerCount absent keeps the exact bytes of spec 008 (SHA-256 pins, one view per stage)', () => {
    const pins: [PublicMatch, string][] = [
      [base, '30b43139709d0c5db223d1e0fadeddb7e4f08d48836bed387cd71cbca5f83f16'],
      [phase2, '0e154ae74d694aef65d6b7bae4f094b3395b2299a41d32f62a83c895f8680ee4'],
      [locked, '865d216804c0e3c7361a16e67a42a23c62d176bab6140c4587dbce7f8d0131f1'],
      [finished, 'c6bc49d191cd074a4ee03322fac0eead12b3315d212f10812c5884da36ea8332'],
      [halted, 'a1a1608a743a4b8e81cac54a57ca9997efba299cacd87cce5856a94f488f18c0'],
    ];
    for (const [m, pin] of pins) {
      expect(encodePublicMatch(m)).not.toContain('playerCount');
      expect(createHash('sha256').update(encodePublicMatch(m)).digest('hex'), m.stage).toBe(pin);
    }
  });

  it('FR-257 a running view writes playerCount when it is given, also a count of 0, and only then', () => {
    expect(encodePublicMatch({ ...base, playerCount: 0 })).toContain('"reportedTime":1000000,"playerCount":0,"schedule":');
    expect(encodePublicMatch({ ...phase2, playerCount: 12 })).toContain('"playerCount":12,"schedule":');
    expect(encodePublicMatch({ ...finished, playerCount: 3 })).toContain('"reportedTime":1000000,"playerCount":3,"winner":1');
    expect(encodePublicMatch({ ...base, playerCount: undefined })).toBe(encodePublicMatch(base));
    expect(() => encodes({ ...base, playerCount: -1 })).toThrow(RangeError);
  });
});

describe('the public view encoder', () => {
  it('FR-257 writes the fields in the documented order, with the optional ones left out', () => {
    expect(encodePublicMatch(base)).toBe(
      '{"matchId":"m-1","mapId":"dev","mapDigest":"' + hex('a') + '","totalRounds":2,"timing":{"i":120,"l1":30,"l2":10},"commitment":"' +
        hex('c') + '","stage":"phase-1","appliedRounds":0,"state":{"mode":"classic","round":0,"owners":[[1,1],[2,2],[3,3]]},"stateDigest":"' +
        hex('d') + '","lastSeq":1,"reportedTime":1000000,"schedule":{"c1":1120000,"c2":1150000,"a":1160000}}',
    );
    expect(encodePublicMatch({ ...base, timing: 'manual', schedule: undefined })).toContain('"timing":"manual","commitment"');
    expect(encodePublicMatch({ ...base, timing: 'manual', schedule: undefined })).not.toContain('schedule');
  });

  it('FR-257 the bytes follow the documented order whatever the key order of the input, also in nested objects', () => {
    for (const m of [base, phase2, locked, finished, halted, haltedAfterReveal]) {
      const text = encodePublicMatch(m);
      expect(encodes(reversed(m) as object), m.stage).toBe(text);
      expect(encodePublicMatch(structuredClone(m)), m.stage).toBe(text);
      const keys = Object.keys(JSON.parse(text) as object);
      expect(keys).toStrictEqual(PUBLIC_MATCH_KEYS.filter((k) => keys.includes(k)));
    }
    const nested = (JSON.parse(encodePublicMatch(phase2)) as { victim: object }).victim;
    // `forced` is present only for a forced round, so a victim without it has every other key, in order.
    expect(Object.keys(nested)).toStrictEqual(PUBLIC_VICTIM_KEYS.filter((k) => k !== 'forced'));
    const forcedNested = (JSON.parse(encodePublicMatch(forcedPhase2)) as { victim: object }).victim;
    expect(Object.keys(forcedNested)).toStrictEqual([...PUBLIC_VICTIM_KEYS]);
  });

  it('FR-257 the forced mark is written after a and before seq, only when true, and a victim without it keeps its 008 bytes', () => {
    expect(encodePublicMatch(forcedPhase2)).toContain('"c2":1150000,"a":1160000,"forced":true,"seq":4}');
    expect(encodePublicMatch(forcedPhase2)).toBe(encodePublicMatch(reversed(forcedPhase2) as PublicMatch));
    expect(encodePublicMatch(phase2)).not.toContain('forced');
    expect(encodePublicMatch({ ...phase2, victim: { ...victim, forced: undefined } as PublicVictim })).toBe(encodePublicMatch(phase2));
    expect(() => encodes({ ...phase2, victim: { ...victim, forced: false } })).toThrow(RangeError);
    for (const bad of [1, 'true', null, [], {}]) expect(() => encodes({ ...phase2, victim: { ...victim, forced: bad } }), String(bad)).toThrow(RangeError);
    // A manual match carries the mark too (the reveal of a forced round has no clock but is still forced).
    const manualForced: PublicMatch = { ...phase2, timing: 'manual', schedule: undefined, victim: { ...forcedVictim, c2: null, a: null } };
    expect(encodePublicMatch(manualForced)).toContain('"c2":null,"a":null,"forced":true,"seq":4}');
  });

  it('FR-257 a victim without the mark encodes to exactly the bytes of spec 008 (SHA-256 pin)', () => {
    const text = JSON.stringify((JSON.parse(encodePublicMatch(phase2)) as { victim: object }).victim);
    expect(text).toBe('{"round":1,"victim":2,"candidates":[1,3],"living":[1,2,3],"revealedAt":1120000,"c2":1150000,"a":1160000,"seq":4}');
    expect(createHash('sha256').update(text).digest('hex')).toBe('3809b6300decbeb7bafb187caa825f0ce8f99ebe6395a81c44718c9444e07a6f');
  });

  it('FR-257 two inputs with equal public fields encode to identical bytes, and a changed public field changes them', () => {
    const a = { ...phase2 };
    const b = JSON.parse(JSON.stringify(phase2)) as PublicMatch;
    expect(encodePublicMatch(a)).toBe(encodePublicMatch(b));
    expect(encodePublicMatch({ ...phase2, matchId: 'm-2' })).not.toBe(encodePublicMatch(a));
    expect(encodePublicMatch({ ...phase2, victim: { ...victim, victim: 3, candidates: [1] } })).not.toBe(encodePublicMatch(a));
  });

  it('FR-257 an input carrying any field outside the public key list is rejected, so nothing unrevealed can ride along', () => {
    for (const extra of ['absorber', 'pendingState', 'seed', 'roundSeed', 'secret', 'record', 'nextVictim']) {
      expect(() => encodes({ ...phase2, [extra]: 5 }), extra).toThrow(RangeError);
    }
    expect(() => encodes({ ...phase2, victim: { ...victim, absorber: 5 } })).toThrow(RangeError);
    expect(() => encodes({ ...phase2, state: { ...phase2.state, pending: [] } })).toThrow(RangeError);
    expect(() => encodes({ ...phase2, schedule: { ...schedule, d: 1 } })).toThrow(RangeError);
  });

  it('FR-254 the victim fields exist only in phase-2 and locked, and in halted after a reveal', () => {
    expect(() => encodePublicMatch({ ...base, victim })).toThrow(RangeError); // phase-1: nothing about round k
    expect(() => encodePublicMatch({ ...finished, victim })).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...phase2, victim: undefined })).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...locked, victim: undefined })).toThrow(RangeError);
    expect(encodePublicMatch(phase2)).toContain('"victim":{"round":1,"victim":2,"candidates":[1,3],"living":[1,2,3],"revealedAt":1120000,"c2":1150000,"a":1160000,"seq":4}');
    expect(encodePublicMatch(locked)).toContain('"stage":"locked"');
    expect(encodePublicMatch(haltedAfterReveal)).toContain('"victim":{');
    expect(encodePublicMatch(halted)).not.toContain('"victim"');
  });

  it('FR-254 the revealed victim belongs to the pending round and the victim, candidates and living are consistent', () => {
    expect(() => encodes({ ...phase2, victim: { ...victim, round: 2 } })).toThrow(RangeError);
    expect(() => encodes({ ...phase2, victim: { ...victim, living: [1, 3] } })).toThrow(RangeError); // victim not living
    expect(() => encodes({ ...phase2, victim: { ...victim, candidates: [2, 3] } })).toThrow(RangeError); // victim as candidate
    expect(() => encodes({ ...phase2, victim: { ...victim, candidates: [3, 1] } })).toThrow(RangeError); // not in living order
    expect(() => encodes({ ...phase2, victim: { ...victim, candidates: [1, 9] } })).toThrow(RangeError); // not living
    expect(() => encodes({ ...phase2, victim: { ...victim, candidates: [1, 1] } })).toThrow(RangeError);
    expect(() => encodes({ ...phase2, victim: { ...victim, living: [1, 2, 2, 3] } })).toThrow(RangeError);
  });

  it('FR-254 FR-253 the winner and the secret exist only in finished, together', () => {
    expect(encodePublicMatch(finished)).toContain('"winner":1,"matchSecret":"' + hex('5') + '"');
    expect(() => encodePublicMatch({ ...finished, matchSecret: undefined })).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...finished, winner: undefined })).toThrow(RangeError);
    for (const m of [base, phase2, locked, halted, haltedAfterReveal]) {
      expect(() => encodePublicMatch({ ...m, winner: 1 }), m.stage).toThrow(RangeError);
      expect(() => encodePublicMatch({ ...m, matchSecret: hex('5') }), m.stage).toThrow(RangeError);
      expect(() => encodePublicMatch({ ...m, winner: 1, matchSecret: hex('5') }), m.stage).toThrow(RangeError);
      expect(encodePublicMatch(m), m.stage).not.toContain(hex('5'));
    }
  });

  it('FR-253 a refused input never echoes a secret or a seed in its message', () => {
    for (const bad of [{ ...phase2, matchSecret: hex('7') }, { ...base, seed: 987654321 }]) {
      try {
        encodePublicMatch(bad as PublicMatch);
        expect.unreachable();
      } catch (e) {
        expect(String((e as Error).message)).not.toMatch(/7777|987654321/);
      }
    }
  });

  it('FR-254 the halt reason exists only in halted; a halted or finished match has no schedule', () => {
    expect(encodePublicMatch(halted)).toContain('"haltReason":"map-changed"');
    expect(() => encodePublicMatch({ ...halted, haltReason: undefined })).toThrow(RangeError);
    expect(() => encodes({ ...halted, haltReason: 'other' })).toThrow(RangeError);
    for (const m of [base, phase2, locked, finished]) expect(() => encodePublicMatch({ ...m, haltReason: 'map-changed' }), m.stage).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...halted, schedule })).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...finished, schedule })).toThrow(RangeError);
  });

  it('FR-254 the schedule is present exactly while the match is running with a clock', () => {
    for (const m of [base, phase2, locked]) {
      expect(() => encodePublicMatch(withoutSchedule(m)), m.stage).toThrow(RangeError);
      expect(() => encodePublicMatch({ ...m, timing: 'manual' }), m.stage).toThrow(RangeError);
    }
    expect(encodePublicMatch({ ...base, timing: 'manual', schedule: undefined })).not.toContain('schedule');
  });

  it('FR-254 a victim of a timed match carries C2 and A, one of a manual match carries null', () => {
    const manual: PublicMatch = { ...phase2, timing: 'manual', schedule: undefined, victim: { ...victim, c2: null, a: null } };
    expect(encodePublicMatch(manual)).toContain('"c2":null,"a":null');
    expect(() => encodePublicMatch({ ...manual, victim })).toThrow(RangeError);
    expect(() => encodePublicMatch({ ...phase2, victim: { ...victim, c2: null, a: null } })).toThrow(RangeError);
  });

  it('FR-254 rejects values out of shape: digests, instants, counts, stages, state', () => {
    const bad: unknown[] = [
      { ...base, mapDigest: 'abc' },
      { ...base, commitment: hex('C') },
      { ...base, stateDigest: hex('g') },
      { ...base, stage: 'phase-3' },
      { ...base, totalRounds: 0 },
      { ...base, appliedRounds: 3 },
      { ...base, appliedRounds: 1.5 },
      { ...base, lastSeq: 0 },
      { ...base, reportedTime: -1 },
      { ...base, reportedTime: Number.NaN },
      { ...base, matchId: '' },
      { ...base, timing: { i: 3, l1: 1 } },
      { ...base, state: { ...base.state, round: 1 } },
      { ...base, state: { ...base.state, owners: [[1, 1, 1]] } },
      { ...base, state: { ...base.state, mode: 'other' } },
      { ...base, schedule: { c1: 5, c2: 4, a: 9 } },
      { ...base, schedule: { c1: 5, c2: 9, a: 8 } },
      { ...phase2, schedule: { c1: 5, c2: 9, a: 4 } },
      { ...finished, winner: 1.5 },
      { ...finished, matchSecret: hex('F') },
      null,
      [],
      'text',
    ];
    for (const b of bad) expect(() => encodes(b as object), JSON.stringify(b)).toThrow(RangeError);
    expect(STAGES).toStrictEqual(['phase-1', 'phase-2', 'locked', 'finished', 'halted', 'lobby', 'expired']);
  });

  it('FR-254 inherited fields never count: an input whose fields come from the prototype is refused', () => {
    expect(() => encodes(Object.create(base) as object)).toThrow(RangeError);
  });
});


describe('schedule order by stage (FR-244 shifts, FR-254)', () => {
  it('FR-244 FR-254 phase-1 needs c1 <= c2 <= a; phase-2 only c2 <= a; locked no order (c1 and c2 are past)', () => {
    const ok = (m: PublicMatch): void => expect(() => encodes(m)).not.toThrow();
    ok({ ...base, schedule: { c1: 5, c2: 5, a: 5 } });
    ok({ ...phase2, schedule: { c1: 900, c2: 40, a: 50 } }); // early manual phase-1 close: c1 is past and later than c2
    ok({ ...phase2, schedule: { c1: 1, c2: 7, a: 7 } });
    ok({ ...locked, schedule: { c1: 80, c2: 40, a: 30 } }); // early manual phase-2 close: only a is pending
    ok({ ...locked, schedule: { c1: 1, c2: 2, a: 3 } });
    expect(() => encodes({ ...base, schedule: { c1: 5, c2: 4, a: 9 } })).toThrow(RangeError);
    expect(() => encodes({ ...phase2, schedule: { c1: 1, c2: 9, a: 4 } })).toThrow(RangeError);
    expect(() => encodes({ ...locked, schedule: { c1: 1, c2: 2, a: 1.5 } })).toThrow(RangeError);
    expect(() => encodes({ ...locked, schedule: { c1: -1, c2: 2, a: 3 } })).toThrow(RangeError);
  });
});
