import { describe, expect, it } from 'vitest';
import { EVENT_KEYS, encodeEvent, type MatchEvent } from '../src/index';

// The event encoder (FR-257 (event encoders), PD19): each of the 7 event types is written in its EVENT_KEYS order whatever
// the order of the input, an absent optional member is omitted, and an extra, inherited or null member, an unknown type
// or a value out of shape is refused.

const hex = (c: string): string => c.repeat(64);

const events: Record<string, MatchEvent> = {
  'phase-closed': { type: 'phase-closed', seq: 2, round: 1, phase: 1, at: 1_012_000 },
  'victim-revealed': {
    type: 'victim-revealed',
    seq: 3,
    round: 1,
    victim: 4,
    candidates: [2, 7],
    living: [1, 2, 4, 7],
    revealedAt: 1_012_000,
    c2: 1_018_000,
    a: 1_020_000,
    reportedTime: 1_012_003,
  },
  'round-applied': {
    type: 'round-applied',
    seq: 6,
    round: 1,
    record: { round: 1, eliminated: 4, absorber: 7, transferred: [11, 13] },
    stateDigest: hex('d'),
    appliedAt: 1_020_000,
  },
  results: { type: 'results', seq: 8, round: 1, phase: 2 },
  schedule: { type: 'schedule', seq: 7, stage: 'phase-1', schedule: { c1: 1_032_000, c2: 1_038_000, a: 1_040_000 }, reportedTime: 1_020_002 },
  'match-finished': { type: 'match-finished', seq: 30, winner: 2, matchSecret: hex('b'), rule: 'hmac-sha256 rule text', reportedTime: 1_100_000 },
  'match-halted': { type: 'match-halted', seq: 9, round: 2, reason: 'map-changed', reportedTime: 1_050_000 },
};

/** The same object with its own keys in reverse order (nested objects too). */
function reversed<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o).reverse()) {
    const v = (o as Record<string, unknown>)[key];
    out[key] = typeof v === 'object' && v !== null && !Array.isArray(v) ? reversed(v as object) : v;
  }
  return out as T;
}
const keysOf = (text: string): string[] => Object.keys(JSON.parse(text) as object);
const withMember = (e: MatchEvent, member: string, value: unknown): MatchEvent => ({ ...e, [member]: value }) as MatchEvent;

describe('the event encoder', () => {
  it('FR-257 (event encoders) the key list of each of the 7 types is pinned and holds no secret, seed or credential', () => {
    expect(Object.keys(EVENT_KEYS).sort()).toStrictEqual(Object.keys(events).sort());
    expect([...EVENT_KEYS['phase-closed']]).toStrictEqual(['type', 'seq', 'round', 'phase', 'at']);
    expect([...EVENT_KEYS['victim-revealed']]).toStrictEqual(['type', 'seq', 'round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'reportedTime']);
    expect([...EVENT_KEYS['round-applied']]).toStrictEqual(['type', 'seq', 'round', 'record', 'stateDigest', 'appliedAt']);
    expect([...EVENT_KEYS.results]).toStrictEqual(['type', 'seq', 'round', 'phase']);
    expect([...EVENT_KEYS.schedule]).toStrictEqual(['type', 'seq', 'stage', 'schedule', 'reportedTime']);
    expect([...EVENT_KEYS['match-finished']]).toStrictEqual(['type', 'seq', 'winner', 'matchSecret', 'rule', 'reportedTime']);
    expect([...EVENT_KEYS['match-halted']]).toStrictEqual(['type', 'seq', 'round', 'reason', 'reportedTime']);
    // Only `match-finished` may name the match secret (FR-259); no event can carry an absorber before its application.
    for (const [type, keys] of Object.entries(EVENT_KEYS)) {
      for (const key of keys) {
        if (type !== 'match-finished') expect(key, type).not.toMatch(/secret|token|credential|seed|password|absorberOf|pending/i);
      }
    }
    expect(EVENT_KEYS['victim-revealed']).not.toContain('absorber');
  });

  it('FR-257 (event encoders) each type is written in its EVENT_KEYS order whatever the order of the input', () => {
    for (const [type, event] of Object.entries(events)) {
      const text = encodeEvent(event);
      expect(keysOf(text), type).toStrictEqual([...EVENT_KEYS[type as MatchEvent['type']]]);
      expect(encodeEvent(reversed(event)), type).toBe(text);
    }
    expect(encodeEvent(reversed(events['victim-revealed'] as MatchEvent))).toBe(
      '{"type":"victim-revealed","seq":3,"round":1,"victim":4,"candidates":[2,7],"living":[1,2,4,7],"revealedAt":1012000,"c2":1018000,"a":1020000,"reportedTime":1012003}',
    );
    expect(encodeEvent(reversed(events['round-applied'] as MatchEvent))).toBe(
      `{"type":"round-applied","seq":6,"round":1,"record":{"round":1,"eliminated":4,"absorber":7,"transferred":[11,13]},"stateDigest":"${hex('d')}","appliedAt":1020000}`,
    );
    expect(encodeEvent(reversed(events.schedule as MatchEvent))).toBe(
      '{"type":"schedule","seq":7,"stage":"phase-1","schedule":{"c1":1032000,"c2":1038000,"a":1040000},"reportedTime":1020002}',
    );
  });

  it('FR-257 (event encoders) JSON.parse of the text gives back the event', () => {
    for (const [type, event] of Object.entries(events)) expect(JSON.parse(encodeEvent(event)), type).toStrictEqual(event);
  });

  it('FR-257 (event encoders) an absent optional schedule is omitted, never written as null or undefined', () => {
    const none: MatchEvent = { type: 'schedule', seq: 5, stage: 'phase-1', reportedTime: 1_000_000 };
    expect(encodeEvent(none)).toBe('{"type":"schedule","seq":5,"stage":"phase-1","reportedTime":1000000}');
    expect(encodeEvent({ ...none, schedule: undefined } as never)).toBe(encodeEvent(none));
    expect(encodeEvent(none)).not.toMatch(/null|undefined/);
  });

  it('FR-257 (event encoders) a manual victim-revealed writes c2 and a as null, both or neither', () => {
    const manual: MatchEvent = { ...(events['victim-revealed'] as MatchEvent), c2: null, a: null } as MatchEvent;
    expect(encodeEvent(manual)).toContain('"revealedAt":1012000,"c2":null,"a":null,"reportedTime":1012003');
    expect(JSON.parse(encodeEvent(manual))).toStrictEqual(manual);
    expect(() => encodeEvent({ ...manual, c2: 5 } as never)).toThrow(RangeError);
    expect(() => encodeEvent({ ...manual, a: 5 } as never)).toThrow(RangeError);
  });

  it('FR-257 (event encoders) an extra member is refused for every type', () => {
    for (const [type, event] of Object.entries(events)) {
      expect(() => encodeEvent(withMember(event, 'absorber', 7)), type).toThrow(RangeError);
      expect(() => encodeEvent(withMember(event, 'matchSecret2', hex('1'))), type).toThrow(RangeError);
    }
    expect(() => encodeEvent(withMember(events['match-halted'] as MatchEvent, 'matchSecret', hex('b')))).toThrow(RangeError);
    expect(() => encodeEvent({ ...(events['round-applied'] as MatchEvent), record: { round: 1, eliminated: 4, absorber: 7, transferred: [], seed: 5 } } as never)).toThrow(RangeError);
  });

  it('FR-257 (event encoders) an inherited member is refused, also an inherited optional schedule', () => {
    for (const [type, event] of Object.entries(events)) {
      const { seq: _seq, ...rest } = event as MatchEvent & { seq: number };
      const inherited = Object.create({ seq: 2 }) as Record<string, unknown>;
      Object.assign(inherited, rest);
      expect(() => encodeEvent(inherited as never), type).toThrow(RangeError);
    }
    const none = { type: 'schedule', seq: 5, stage: 'phase-1', reportedTime: 1 };
    const inheritedSchedule = Object.assign(Object.create({ schedule: { c1: 1, c2: 2, a: 3 } }) as object, none);
    expect(() => encodeEvent(inheritedSchedule as never)).toThrow(RangeError);
  });

  it('FR-257 (event encoders) a null member is refused, c2 and a of a victim apart', () => {
    for (const [type, event] of Object.entries(events)) {
      for (const key of Object.keys(event)) {
        if ((type === 'victim-revealed' && (key === 'c2' || key === 'a')) || key === 'type') continue;
        expect(() => encodeEvent(withMember(event, key, null)), `${type}.${key}`).toThrow(RangeError);
      }
    }
    expect(() => encodeEvent(withMember(events.schedule as MatchEvent, 'schedule', null))).toThrow(RangeError);
  });

  it('FR-257 (event encoders) an unknown type, a non-object and a missing member are refused', () => {
    for (const bad of [undefined, null, 'phase-closed', 7, [], { type: 'results2', seq: 1 }, { seq: 1, round: 1, phase: 1 }, { type: 'toString' }, { type: '__proto__' }]) {
      expect(() => encodeEvent(bad as never), JSON.stringify(bad)).toThrow(RangeError);
    }
    for (const [type, event] of Object.entries(events)) {
      for (const key of Object.keys(event)) {
        if (type === 'schedule' && key === 'schedule') continue;
        const { [key]: _gone, ...rest } = event as unknown as Record<string, unknown>;
        expect(() => encodeEvent(rest as never), `${type} without ${key}`).toThrow(RangeError);
      }
    }
  });

  it('FR-257 (event encoders) a value out of shape is refused and the message names fields, never values', () => {
    const e = events as Record<string, MatchEvent>;
    const cases: [MatchEvent, string, unknown][] = [
      [e['phase-closed'] as MatchEvent, 'seq', 0],
      [e['phase-closed'] as MatchEvent, 'phase', 3],
      [e['phase-closed'] as MatchEvent, 'at', -1],
      [e['phase-closed'] as MatchEvent, 'round', 1.5],
      [e['victim-revealed'] as MatchEvent, 'candidates', [0]],
      [e['victim-revealed'] as MatchEvent, 'living', 'x'],
      [e['round-applied'] as MatchEvent, 'stateDigest', 'abc'],
      [e['round-applied'] as MatchEvent, 'record', []],
      [e.results as MatchEvent, 'phase', 0],
      [e.schedule as MatchEvent, 'stage', 'finished'],
      [e.schedule as MatchEvent, 'schedule', { c1: 1, c2: 2 }],
      [e['match-finished'] as MatchEvent, 'matchSecret', 'SECRETSECRET'],
      [e['match-finished'] as MatchEvent, 'rule', ''],
      [e['match-halted'] as MatchEvent, 'reason', 'unknown-reason'],
    ];
    for (const [event, key, value] of cases) {
      expect(() => encodeEvent(withMember(event, key, value)), `${event.type}.${key}`).toThrow(RangeError);
    }
    try {
      encodeEvent(withMember(e['match-finished'] as MatchEvent, 'matchSecret', 'SECRETSECRET'));
    } catch (error) {
      expect((error as Error).message).toContain('matchSecret');
      expect((error as Error).message).not.toContain('SECRETSECRET');
    }
  });
});
