import { describe, expect, it } from 'vitest';
import {
  ADVANCE_REPLY_KEYS,
  CREATION_REPLY_KEYS,
  ERROR_REPLY_KEYS,
  JOIN_REPLY_KEYS,
  MATCH_SUMMARY_KEYS,
  OWN_PREDICTION_KEYS,
  PAGE_KEYS,
  PLAYER_LIST_ITEM_KEYS,
  PREDICTION_REPLY_KEYS,
  RECORD_REPLY_KEYS,
  STATE_REPLY_KEYS,
  STEP_INFO_KEYS,
  encodeAdvance,
  encodeCreation,
  encodeError,
  encodeJoinReply,
  encodeMatchSummary,
  encodeOwnPrediction,
  encodePage,
  encodePlayerListItem,
  encodePrediction,
  encodePublicMatch,
  encodeRecord,
  encodeState,
  errorReply,
  rateLimited,
  roundNotApplied,
  stepMismatch,
  type AdvanceReply,
  type CreationReply,
  type JoinReply,
  type MatchSummary,
  type OwnPrediction,
  type PlayerListItem,
  type PublicMatch,
  type RecordReply,
  type StateReply,
} from '../src/index';

// The wire encoders (FR-257 (encoders), FR-301 (reply shapes), PD19): fixed key order, absent members omitted.

const hex = (c: string): string => c.repeat(64);
const view: PublicMatch = {
  matchId: 'Mx7_q-1',
  mapId: 'dev',
  mapDigest: hex('a'),
  totalRounds: 2,
  timing: 'manual',
  commitment: hex('c'),
  stage: 'phase-1',
  appliedRounds: 0,
  state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 3]] },
  stateDigest: hex('d'),
  lastSeq: 1,
  reportedTime: 1_000_003,
};
const creation: CreationReply = { matchId: 'Mx7_q-1', match: view, hostToken: 'host-token-text' };
const advance: AdvanceReply = { result: 'performed', step: { round: 1, kind: 'phase-1-close', instant: 1_000_007, cause: 'manual' }, match: view };
const summary: MatchSummary = { matchId: 'Mx7_q-1', mapId: 'dev', stage: 'phase-2', appliedRounds: 3, totalRounds: 9, createdAt: 1_000_001 };
const state: StateReply = { round: 2, owners: [[1, 3], [2, 3], [5, 7]], stateDigest: hex('e'), reportedTime: 1_000_013 };
const record: RecordReply = { round: 2, eliminated: 4, absorber: 7, transferred: [11, 13] };
const own: OwnPrediction = { playerId: 'p-1', kind: 'absorber', round: 3, choice: 7, version: 2 };

/** The same object with its own keys in reverse order (and nested objects too, one level). */
function reversed<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o).reverse()) {
    const v = (o as Record<string, unknown>)[key];
    out[key] = typeof v === 'object' && v !== null && !Array.isArray(v) ? reversed(v as object) : v;
  }
  return out as T;
}
const keysOf = (text: string): string[] => Object.keys(JSON.parse(text) as object);

describe('the key lists of the replies', () => {
  it('FR-301 (reply shapes) every reply key list is pinned and none can hold a secret, seed or credential', () => {
    expect([...CREATION_REPLY_KEYS]).toStrictEqual(['matchId', 'match', 'hostToken']);
    expect([...ADVANCE_REPLY_KEYS]).toStrictEqual(['result', 'step', 'match']);
    expect([...STEP_INFO_KEYS]).toStrictEqual(['round', 'kind', 'instant', 'cause']);
    expect([...PREDICTION_REPLY_KEYS]).toStrictEqual(['kind', 'round', 'choice', 'version']);
    expect([...OWN_PREDICTION_KEYS]).toStrictEqual(['playerId', 'kind', 'round', 'choice', 'version']);
    expect([...MATCH_SUMMARY_KEYS]).toStrictEqual(['matchId', 'mapId', 'stage', 'appliedRounds', 'totalRounds', 'createdAt']);
    expect([...STATE_REPLY_KEYS]).toStrictEqual(['round', 'owners', 'stateDigest', 'reportedTime']);
    expect([...RECORD_REPLY_KEYS]).toStrictEqual(['round', 'eliminated', 'absorber', 'transferred']);
    expect([...PAGE_KEYS]).toStrictEqual(['items', 'next']);
    // The host token is the creation reply's only credential, given once to the creator (FR-231); nothing else may carry one.
    const lists = [ERROR_REPLY_KEYS, ADVANCE_REPLY_KEYS, STEP_INFO_KEYS, PREDICTION_REPLY_KEYS, OWN_PREDICTION_KEYS, MATCH_SUMMARY_KEYS, STATE_REPLY_KEYS, RECORD_REPLY_KEYS, PAGE_KEYS];
    for (const list of lists) for (const key of list) expect(key).not.toMatch(/secret|token|credential|seed|password|absorberOf|pending/i);
    expect(CREATION_REPLY_KEYS.filter((k) => /token/i.test(k))).toStrictEqual(['hostToken']);
  });
});

describe('the wire encoders', () => {
  it('FR-257 (encoders) each encoder writes its keys in the documented order', () => {
    expect(keysOf(encodeError(stepMismatch('locked', 2)))).toStrictEqual(['kind', 'stage', 'appliedRounds']);
    expect(keysOf(encodeError({ retryAfter: 4, appliedRounds: 1, stage: 'phase-1', items: ['x'], kind: 'invalid-request' }))).toStrictEqual([...ERROR_REPLY_KEYS]);
    expect(keysOf(encodeCreation(creation))).toStrictEqual([...CREATION_REPLY_KEYS]);
    expect(keysOf(encodeAdvance(advance))).toStrictEqual([...ADVANCE_REPLY_KEYS]);
    expect(Object.keys((JSON.parse(encodeAdvance(advance)) as { step: object }).step)).toStrictEqual([...STEP_INFO_KEYS]);
    expect(keysOf(encodePrediction({ version: 1, choice: 4, round: 2, kind: 'victim' }))).toStrictEqual([...PREDICTION_REPLY_KEYS]);
    expect(keysOf(encodeOwnPrediction(own))).toStrictEqual([...OWN_PREDICTION_KEYS]);
    expect(keysOf(encodeMatchSummary(summary))).toStrictEqual([...MATCH_SUMMARY_KEYS]);
    expect(keysOf(encodeState(state))).toStrictEqual([...STATE_REPLY_KEYS]);
    expect(keysOf(encodeRecord(record))).toStrictEqual([...RECORD_REPLY_KEYS]);
    expect(keysOf(encodePage({ items: [record], next: 'abc' }, encodeRecord))).toStrictEqual([...PAGE_KEYS]);
  });

  it('FR-257 (encoders) the bytes follow the documented order whatever the key order of the input', () => {
    expect(encodeError(reversed(stepMismatch('phase-2', 5)))).toBe('{"kind":"step-mismatch","stage":"phase-2","appliedRounds":5}');
    expect(encodeError(reversed(rateLimited(9)))).toBe('{"kind":"rate-limited","retryAfter":9}');
    expect(encodeCreation(reversed(creation))).toBe(encodeCreation(creation));
    expect(encodeAdvance(reversed(advance))).toBe(encodeAdvance(advance));
    expect(encodePrediction(reversed({ kind: 'victim', round: 2, choice: 4, version: 1 }))).toBe('{"kind":"victim","round":2,"choice":4,"version":1}');
    expect(encodeOwnPrediction(reversed(own))).toBe('{"playerId":"p-1","kind":"absorber","round":3,"choice":7,"version":2}');
    expect(encodeMatchSummary(reversed(summary))).toBe(
      '{"matchId":"Mx7_q-1","mapId":"dev","stage":"phase-2","appliedRounds":3,"totalRounds":9,"createdAt":1000001}',
    );
    expect(encodeState(reversed(state))).toBe(`{"round":2,"owners":[[1,3],[2,3],[5,7]],"stateDigest":"${hex('e')}","reportedTime":1000013}`);
    expect(encodeRecord(reversed(record))).toBe('{"round":2,"eliminated":4,"absorber":7,"transferred":[11,13]}');
    expect(encodePage(reversed({ items: [record], next: 'c1' }), encodeRecord)).toBe(`{"items":[${encodeRecord(record)}],"next":"c1"}`);
  });

  it('FR-257 (encoders) the creation and advance replies embed the public view encoding unchanged', () => {
    expect(encodeCreation(creation)).toBe(`{"matchId":"Mx7_q-1","match":${encodePublicMatch(view)},"hostToken":"host-token-text"}`);
    expect(encodeAdvance(advance)).toBe(
      `{"result":"performed","step":{"round":1,"kind":"phase-1-close","instant":1000007,"cause":"manual"},"match":${encodePublicMatch(view)}}`,
    );
  });

  it('FR-257 (encoders) absent members are omitted, never written as null or undefined', () => {
    expect(encodeError(errorReply('forbidden'))).toBe('{"kind":"forbidden"}');
    expect(encodeError({ kind: 'forbidden', items: undefined, stage: undefined })).toBe('{"kind":"forbidden"}');
    expect(encodeError(roundNotApplied(4))).toBe('{"kind":"round-not-applied","appliedRounds":4}');
    expect(encodeError(errorReply('forced-absorber'))).toBe('{"kind":"forced-absorber"}');
    expect(encodePrediction({ kind: 'winner', choice: 3, version: 1 })).toBe('{"kind":"winner","choice":3,"version":1}');
    expect(encodePrediction({ kind: 'winner', round: undefined, choice: 3, version: 1 })).toBe('{"kind":"winner","choice":3,"version":1}');
    expect(encodeOwnPrediction({ playerId: 'p', kind: 'winner', choice: 3, version: 1 })).toBe('{"playerId":"p","kind":"winner","choice":3,"version":1}');
    expect(encodePage({ items: [] }, encodeRecord)).toBe('{"items":[]}');
    expect(encodePage({ items: [record], next: undefined }, encodeRecord)).toBe(`{"items":[${encodeRecord(record)}]}`);
    for (const text of [encodeError(errorReply('forbidden')), encodePrediction({ kind: 'winner', choice: 3, version: 1 }), encodePage({ items: [] }, encodeRecord)]) {
      expect(text).not.toMatch(/null|undefined/);
    }
    // null is never a value of an optional member: it is refused, not written.
    expect(() => encodeError({ kind: 'forbidden', items: null } as never)).toThrow(RangeError);
    expect(() => encodePrediction({ kind: 'winner', round: null, choice: 3, version: 1 } as never)).toThrow(RangeError);
    expect(() => encodePage({ items: [], next: null } as never, encodeRecord)).toThrow(RangeError);
  });

  it('FR-257 (encoders) equal inputs give equal bytes, and a changed field changes them', () => {
    expect(encodeMatchSummary({ ...summary })).toBe(encodeMatchSummary(summary));
    expect(encodeState({ ...state, owners: state.owners.map((p) => [p[0], p[1]] as const) })).toBe(encodeState(state));
    expect(encodeRecord({ ...record, transferred: [...record.transferred] })).toBe(encodeRecord(record));
    expect(encodeMatchSummary({ ...summary, appliedRounds: 4 })).not.toBe(encodeMatchSummary(summary));
    expect(encodeRecord({ ...record, absorber: 8 })).not.toBe(encodeRecord(record));
  });

  it('FR-257 (encoders) a field outside the key list is refused, so nothing unlisted can ride along', () => {
    const extra = { secret: hex('5') };
    expect(() => encodeError({ ...errorReply('forbidden'), ...extra } as never)).toThrow(RangeError);
    expect(() => encodeCreation({ ...creation, ...extra } as never)).toThrow(RangeError);
    expect(() => encodeAdvance({ ...advance, step: { ...advance.step, ...extra } } as never)).toThrow(RangeError);
    expect(() => encodePrediction({ kind: 'winner', choice: 3, version: 1, ...extra } as never)).toThrow(RangeError);
    expect(() => encodeOwnPrediction({ ...own, ...extra } as never)).toThrow(RangeError);
    expect(() => encodeMatchSummary({ ...summary, ...extra } as never)).toThrow(RangeError);
    expect(() => encodeState({ ...state, ...extra } as never)).toThrow(RangeError);
    expect(() => encodeRecord({ ...record, ...extra } as never)).toThrow(RangeError);
    expect(() => encodePage({ items: [], ...extra } as never, encodeRecord)).toThrow(RangeError);
    // The message names the field, never the value.
    try {
      encodeMatchSummary({ ...summary, ...extra } as never);
    } catch (e) {
      expect((e as Error).message).not.toContain(hex('5'));
    }
  });

  it('FR-257 (encoders) values out of shape are refused: kinds, stages, counts, ids and lists', () => {
    expect(() => encodeError({ kind: 'teapot' } as never)).toThrow(RangeError);
    expect(() => encodeError({ kind: 'invalid-request', items: ['a', 'b'] })).toThrow(RangeError);
    expect(() => encodeError({ kind: 'rate-limited', retryAfter: 0 })).toThrow(RangeError);
    expect(() => encodeError({ kind: 'rate-limited', retryAfter: 1.5 })).toThrow(RangeError);
    expect(() => encodeError({ kind: 'step-mismatch', stage: 'playing' as never, appliedRounds: 0 })).toThrow(RangeError);
    expect(() => encodeError({ kind: 'round-not-applied', appliedRounds: -1 })).toThrow(RangeError);
    expect(() => encodeMatchSummary({ ...summary, stage: 'over' as never })).toThrow(RangeError);
    expect(() => encodeMatchSummary({ ...summary, createdAt: 1.5 })).toThrow(RangeError);
    expect(() => encodeMatchSummary({ ...summary, mapId: 'Bad Map' })).toThrow(RangeError);
    expect(() => encodeState({ ...state, owners: [[1, 0]] })).toThrow(RangeError);
    expect(() => encodeState({ ...state, stateDigest: 'nope' })).toThrow(RangeError);
    expect(() => encodeRecord({ ...record, transferred: [1, 'x' as never] })).toThrow(RangeError);
    expect(() => encodeRecord({ ...record, round: 0 })).toThrow(RangeError);
    expect(() => encodePrediction({ kind: 'victim', choice: 3, version: 1 })).toThrow(RangeError);
    expect(() => encodePrediction({ kind: 'winner', round: 1, choice: 3, version: 1 })).toThrow(RangeError);
    expect(() => encodePrediction({ kind: 'victim', round: 1, choice: 3, version: 0 })).toThrow(RangeError);
    expect(() => encodeOwnPrediction({ ...own, playerId: 'a b' })).toThrow(RangeError);
    expect(() => encodeAdvance({ ...advance, result: 'maybe' as never })).toThrow(RangeError);
    expect(() => encodeAdvance({ ...advance, step: { ...advance.step, cause: 'magic' as never } })).toThrow(RangeError);
  });

  it('FR-257 (encoders) inherited fields never count: an input whose fields come from the prototype is refused', () => {
    const proto = Object.create(record) as RecordReply;
    expect(() => encodeRecord(proto)).toThrow(RangeError);
  });

  it('FR-301 (reply shapes) texts are JSON-escaped, so a quote in a text cannot break the reply', () => {
    const text = encodeError(errorReply('invalid-request', ['a"b\\c']));
    expect(JSON.parse(text)).toStrictEqual({ kind: 'invalid-request', items: ['a"b\\c'] });
  });
});

describe('the join reply and the players list item', () => {
  const lobbyView: PublicMatch = { ...view, stage: 'lobby', playerCount: 1, lastSeq: 2 };
  delete (lobbyView as { schedule?: unknown }).schedule;
  const token = 'Tq7_-' + 'a'.repeat(38);
  const joined: JoinReply = { playerId: 'player:Ab3_x-9.Qz1k', name: 'Ana Ruiz', playerToken: token, match: lobbyView };
  const item: PlayerListItem = { playerId: 'player:Ab3_x-9.Qz1k', name: 'Ana Ruiz', joinedSeq: 2 };

  it('FR-384 the join reply keys are playerId, name, playerToken, match; the item keys are playerId, name, joinedSeq', () => {
    expect([...JOIN_REPLY_KEYS]).toStrictEqual(['playerId', 'name', 'playerToken', 'match']);
    expect([...PLAYER_LIST_ITEM_KEYS]).toStrictEqual(['playerId', 'name', 'joinedSeq']);
    // The token is the join reply's only credential; the list item carries none.
    expect(JOIN_REPLY_KEYS.filter((k) => /token/i.test(k))).toStrictEqual(['playerToken']);
    for (const key of PLAYER_LIST_ITEM_KEYS) expect(key).not.toMatch(/secret|token|credential|seed|password|digest|key/i);
  });

  it('FR-384 the join reply is written in key order whatever the input order, with the public view encoding unchanged', () => {
    const text = encodeJoinReply(joined);
    expect(keysOf(text)).toStrictEqual([...JOIN_REPLY_KEYS]);
    expect(text).toBe(`{"playerId":"player:Ab3_x-9.Qz1k","name":"Ana Ruiz","playerToken":"${token}","match":${encodePublicMatch(lobbyView)}}`);
    expect(encodeJoinReply(reversed(joined))).toBe(text);
  });

  it('FR-384 the list item is written in key order and a page of items goes through the page encoder', () => {
    const text = encodePlayerListItem(item);
    expect(text).toBe('{"playerId":"player:Ab3_x-9.Qz1k","name":"Ana Ruiz","joinedSeq":2}');
    expect(encodePlayerListItem(reversed(item))).toBe(text);
    expect(encodePage({ items: [item], next: 'c' }, encodePlayerListItem)).toBe(`{"items":[${text}],"next":"c"}`);
  });

  it('FR-384 an extra, inherited, null or missing member is refused in both shapes', () => {
    for (const extra of ['nameKey', 'digest', 'tokenDigest', 'predictions', 'secret']) {
      expect(() => encodeJoinReply({ ...joined, [extra]: 'x' } as never), extra).toThrow(RangeError);
      expect(() => encodePlayerListItem({ ...item, [extra]: 'x' } as never), extra).toThrow(RangeError);
    }
    expect(() => encodePlayerListItem({ ...item, playerToken: token } as never)).toThrow(RangeError);
    for (const key of JOIN_REPLY_KEYS) {
      const { [key]: _gone, ...rest } = joined;
      expect(() => encodeJoinReply(rest as never), `without ${key}`).toThrow(RangeError);
      expect(() => encodeJoinReply({ ...joined, [key]: null } as never), `null ${key}`).toThrow(RangeError);
    }
    for (const key of PLAYER_LIST_ITEM_KEYS) {
      const { [key]: _gone, ...rest } = item;
      expect(() => encodePlayerListItem(rest as never), `without ${key}`).toThrow(RangeError);
      expect(() => encodePlayerListItem({ ...item, [key]: null } as never), `null ${key}`).toThrow(RangeError);
    }
    expect(() => encodeJoinReply(Object.create(joined) as JoinReply)).toThrow(RangeError);
    expect(() => encodePlayerListItem(Object.create(item) as PlayerListItem)).toThrow(RangeError);
  });

  it('FR-384 values out of shape are refused: ids, names, tokens, counts', () => {
    for (const playerId of ['', 'web:Ab3', 'Ab3', 'player:', 'player:a b', 7]) {
      expect(() => encodeJoinReply({ ...joined, playerId } as never), String(playerId)).toThrow(RangeError);
      expect(() => encodePlayerListItem({ ...item, playerId } as never), String(playerId)).toThrow(RangeError);
    }
    for (const name of ['', ' Ana', 'Ana ', 'A  B', 'x'.repeat(25), 'a"b', 'a<b', 7]) {
      expect(() => encodeJoinReply({ ...joined, name } as never), String(name)).toThrow(RangeError);
      expect(() => encodePlayerListItem({ ...item, name } as never), String(name)).toThrow(RangeError);
    }
    for (const playerToken of ['', 'short', 'a'.repeat(21), 'a'.repeat(257), 'a b' + 'c'.repeat(30), 'a/b' + 'c'.repeat(30), 7]) {
      expect(() => encodeJoinReply({ ...joined, playerToken } as never), String(playerToken)).toThrow(RangeError);
    }
    for (const joinedSeq of [0, -1, 1.5, '2']) expect(() => encodePlayerListItem({ ...item, joinedSeq } as never), String(joinedSeq)).toThrow(RangeError);
    expect(() => encodeJoinReply({ ...joined, match: { ...lobbyView, secret: 1 } } as never)).toThrow(RangeError);
  });

  it('FR-384 the messages name fields, never the token or the name', () => {
    for (const make of [() => encodeJoinReply({ ...joined, playerToken: 'bad token ' + token }), () => encodeJoinReply({ ...joined, name: 'bad<name' }), () => encodePlayerListItem({ ...item, name: 'bad<name' })]) {
      try {
        make();
        throw new Error('not thrown');
      } catch (e) {
        const message = (e as Error).message;
        expect(message).not.toContain('bad');
        expect(message).not.toContain(token);
      }
    }
  });
});
