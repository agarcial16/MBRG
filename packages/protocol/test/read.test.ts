import { describe, expect, it } from 'vitest';
import { JOIN_FIELDS, START_FIELDS, readAdvance, readCreation, readJoin, readStart, readSubmission, type ReadResult } from '../src/index';

const err = (r: ReadResult<unknown>): string => (r.ok ? 'ok' : `${r.error.kind}:${(r.error.items ?? []).join(',')}`);
const creation = { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, requestId: 'req-1' };
const advance = { round: 1, step: 'phase-1-close', requestId: 'r2' };

describe('creation body reader', () => {
  it('FR-296 accepts { mapId, timing, requestId } and returns the fields', () => {
    expect(readCreation(creation)).toStrictEqual({ ok: true, value: creation });
    expect(readCreation({ ...creation, timing: 'manual' })).toStrictEqual({ ok: true, value: { ...creation, timing: 'manual' } });
  });

  it('FR-296 rejects non-objects, unknown, missing and wrongly typed fields naming the first failing field in order', () => {
    for (const bad of [undefined, null, 'x', 5, [], [creation]]) expect(err(readCreation(bad)), JSON.stringify(bad)).toBe('invalid-request:body');
    expect(err(readCreation({}))).toBe('invalid-request:mapId');
    expect(err(readCreation({ ...creation, mapId: 5 }))).toBe('invalid-request:mapId');
    expect(err(readCreation({ ...creation, mapId: 'Dev' }))).toBe('invalid-request:mapId');
    expect(err(readCreation({ mapId: 'dev', requestId: 'r' }))).toBe('invalid-request:timing');
    expect(err(readCreation({ ...creation, timing: 'weekly' }))).toBe('invalid-request:timing');
    expect(err(readCreation({ mapId: 'dev', timing: 'manual' }))).toBe('invalid-request:requestId');
    expect(err(readCreation({ ...creation, requestId: 'a b' }))).toBe('invalid-request:requestId');
    expect(err(readCreation({ ...creation, requestId: 7 }))).toBe('invalid-request:requestId');
    expect(err(readCreation({ ...creation, zeta: 1, alpha: 2 }))).toBe('invalid-request:alpha');
    // first failing field in documented order wins over a later one
    expect(err(readCreation({ mapId: 5, timing: 'x', requestId: 1 }))).toBe('invalid-request:mapId');
    expect(err(readCreation({ mapId: 'dev', timing: 'x', requestId: 1 }))).toBe('invalid-request:timing');
  });

  it('FR-296 inherited (prototype) fields are missing, an own __proto__ key is unknown', () => {
    const proto = { mapId: 'dev', timing: 'manual', requestId: 'r' };
    expect(err(readCreation(Object.create(proto) as object))).toBe('invalid-request:mapId');
    const polluted = JSON.parse('{"mapId":"dev","timing":"manual","requestId":"r","__proto__":{"x":1}}') as unknown;
    expect(err(readCreation(polluted))).toBe('invalid-request:__proto__');
  });

  it('FR-233 FR-296 a missing or text timing value is invalid-request, numeric rules are invalid-timing', () => {
    expect(err(readCreation({ ...creation, timing: { i: '3600', l1: 1, l2: 0 } }))).toBe('invalid-request:timing.i');
    expect(err(readCreation({ ...creation, timing: { i: 3.5, l1: 1, l2: 0 } }))).toBe('invalid-timing:a');
    expect(err(readCreation({ ...creation, timing: { i: 4, l1: 3, l2: 1 } }))).toBe('invalid-timing:c');
    expect(err(readCreation({ ...creation, timing: { i: 3.5, l1: 0, l2: -1 } }))).toBe('invalid-timing:a,b');
  });

  it('FR-301 invalid-request in any field wins over invalid-timing', () => {
    expect(err(readCreation({ ...creation, timing: { i: 3.5, l1: 1, l2: 0 }, requestId: 'a b' }))).toBe('invalid-request:requestId');
    expect(err(readCreation({ ...creation, timing: { i: 3.5, l1: 1, l2: 0 }, extra: 1 }))).toBe('invalid-request:extra');
  });
});

describe('advance body reader', () => {
  it('FR-296 accepts { round, step, requestId? }', () => {
    expect(readAdvance(advance)).toStrictEqual({ ok: true, value: advance });
    expect(readAdvance({ round: 3, step: 'application' })).toStrictEqual({ ok: true, value: { round: 3, step: 'application' } });
    expect(readAdvance({ round: 2, step: 'phase-2-close' }).ok).toBe(true);
  });

  it('FR-296 rejects bad bodies naming the first failing field in order', () => {
    expect(err(readAdvance(null))).toBe('invalid-request:body');
    expect(err(readAdvance({}))).toBe('invalid-request:round');
    for (const r of [0, -1, 1.5, '1', null, Number.NaN]) expect(err(readAdvance({ ...advance, round: r })), String(r)).toBe('invalid-request:round');
    expect(err(readAdvance({ round: 1 }))).toBe('invalid-request:step');
    expect(err(readAdvance({ ...advance, step: 'close' }))).toBe('invalid-request:step');
    expect(err(readAdvance({ ...advance, requestId: '' }))).toBe('invalid-request:requestId');
    expect(err(readAdvance({ ...advance, requestId: undefined }))).toBe('invalid-request:requestId');
    expect(err(readAdvance({ ...advance, extra: true }))).toBe('invalid-request:extra');
    expect(err(readAdvance({ round: 'x', step: 'y', requestId: 1 }))).toBe('invalid-request:round');
  });

  it('FR-296 inherited fields are missing', () => {
    expect(err(readAdvance(Object.create({ round: 1, step: 'application' }) as object))).toBe('invalid-request:round');
  });
});

describe('start body reader', () => {
  it('FR-296 accepts {} and { requestId } and returns the fields', () => {
    expect(readStart({})).toStrictEqual({ ok: true, value: {} });
    expect(readStart({ requestId: 'req-1' })).toStrictEqual({ ok: true, value: { requestId: 'req-1' } });
    expect([...START_FIELDS]).toStrictEqual(['requestId']);
  });

  it('FR-296 the request id uses the credential character set of the advance body', () => {
    for (const id of ['a', 'A_b-9', 'x'.repeat(64), 'x'.repeat(65), '', 'a b', 'é', 'a/b', 1, null, undefined, [], {}, true]) {
      expect(readStart({ requestId: id }).ok, String(id)).toBe(readAdvance({ round: 1, step: 'application', requestId: id }).ok);
    }
    for (const id of ['', 'a b', 'é', 'a/b', 1, null, undefined, [], {}, true]) {
      expect(err(readStart({ requestId: id })), String(id)).toBe('invalid-request:requestId');
    }
  });

  it('FR-296 rejects a body that is not an object and names the first failing field', () => {
    for (const v of [null, undefined, 'x', 1, true, [], [{}]]) expect(err(readStart(v)), String(v)).toBe('invalid-request:body');
    expect(err(readStart({ extra: 1 }))).toBe('invalid-request:extra');
    expect(err(readStart({ requestId: 'ok', zeta: 1, alpha: 2 }))).toBe('invalid-request:alpha');
    expect(err(readStart({ requestId: '', extra: 1 }))).toBe('invalid-request:requestId');
  });

  it('FR-296 inherited fields are missing', () => {
    expect(readStart(Object.create({ requestId: 'inherited' }) as object)).toStrictEqual({ ok: true, value: {} });
  });
});

describe('join body reader', () => {
  const join = { name: 'Ana', requestId: 'j-1' };

  it('FR-296 accepts { name, requestId } and returns the trimmed, normalised name', () => {
    expect([...JOIN_FIELDS]).toStrictEqual(['name', 'requestId']);
    expect(readJoin(join)).toStrictEqual({ ok: true, value: join });
    expect(readJoin({ requestId: 'j-1', name: `  Jose${String.fromCharCode(0x301)} Ruiz ` })).toStrictEqual({ ok: true, value: { name: `Jos${String.fromCharCode(0xe9)} Ruiz`, requestId: 'j-1' } });
  });

  it('FR-296 reads exactly name and requestId, in that order: the first failing field is named', () => {
    expect(err(readJoin({ name: '', requestId: '' }))).toBe('invalid-request:name');
    expect(err(readJoin({ name: 'a<b', requestId: 'j-1' }))).toBe('invalid-request:name');
    expect(err(readJoin({ requestId: 'j-1' }))).toBe('invalid-request:name');
    expect(err(readJoin({ name: 7, requestId: 'j-1' }))).toBe('invalid-request:name');
    expect(err(readJoin({ name: 'Ana' }))).toBe('invalid-request:requestId');
    expect(err(readJoin({ name: 'Ana', requestId: '' }))).toBe('invalid-request:requestId');
    expect(err(readJoin({ name: 'Ana', requestId: 'a b' }))).toBe('invalid-request:requestId');
    expect(err(readJoin({ name: 'Ana', requestId: 'x'.repeat(65) }))).toBe('invalid-request:requestId');
    expect(err(readJoin({ name: 'Ana', requestId: 'j', extra: 1 }))).toBe('invalid-request:extra');
    expect(err(readJoin({ name: 'Ana', requestId: 'j', zeta: 1, alpha: 2 }))).toBe('invalid-request:alpha');
    // A failing field comes before an extra member.
    expect(err(readJoin({ name: '', requestId: 'j', extra: 1 }))).toBe('invalid-request:name');
    expect(err(readJoin({ name: 'Ana', requestId: '', extra: 1 }))).toBe('invalid-request:requestId');
  });

  it('FR-296 a body that is not an object is refused naming body', () => {
    for (const v of [null, undefined, 'x', 1, true, [], [{}]]) expect(err(readJoin(v)), String(v)).toBe('invalid-request:body');
  });

  it('FR-296 inherited fields are missing and a player id or token in the body is an extra member', () => {
    expect(err(readJoin(Object.create(join) as object))).toBe('invalid-request:name');
    expect(err(readJoin({ ...join, playerId: 'player:abc' }))).toBe('invalid-request:playerId');
    expect(err(readJoin({ ...join, playerToken: 'x'.repeat(43) }))).toBe('invalid-request:playerToken');
  });

  it('FR-384 the name failure carries no detail of the rule', () => {
    for (const name of ['', 'x'.repeat(25), 'a<b', 'a  b', `a${String.fromCharCode(0x200b)}b`]) {
      expect(readJoin({ name, requestId: 'j' })).toStrictEqual({ ok: false, error: { kind: 'invalid-request', items: ['name'] } });
    }
  });
});

describe('submission body reader', () => {
  const victim = { kind: 'victim', round: 1, faction: 5, playerId: 'Ana_1', requestId: 'q1' };

  it('FR-296 accepts victim and absorber with a round, winner without one, requestId optional', () => {
    expect(readSubmission(victim)).toStrictEqual({ ok: true, value: victim });
    expect(readSubmission({ kind: 'absorber', round: 2, faction: 6, playerId: 'a' })).toStrictEqual({
      ok: true,
      value: { kind: 'absorber', round: 2, faction: 6, playerId: 'a' },
    });
    expect(readSubmission({ kind: 'winner', faction: 16_777_215, playerId: 'a.b-c' })).toStrictEqual({
      ok: true,
      value: { kind: 'winner', faction: 16_777_215, playerId: 'a.b-c' },
    });
  });

  it('FR-296 round is present exactly for victim and absorber', () => {
    expect(err(readSubmission({ kind: 'victim', faction: 5, playerId: 'a' }))).toBe('invalid-request:round');
    expect(err(readSubmission({ kind: 'absorber', faction: 5, playerId: 'a' }))).toBe('invalid-request:round');
    expect(err(readSubmission({ kind: 'winner', round: 1, faction: 5, playerId: 'a' }))).toBe('invalid-request:round');
    expect(err(readSubmission({ ...victim, round: 0 }))).toBe('invalid-request:round');
    expect(err(readSubmission({ ...victim, round: '1' }))).toBe('invalid-request:round');
  });

  it('FR-296 rejects unknown, missing and wrongly typed fields naming the first failing field in order', () => {
    expect(err(readSubmission(undefined))).toBe('invalid-request:body');
    expect(err(readSubmission({}))).toBe('invalid-request:kind');
    expect(err(readSubmission({ ...victim, kind: 'loser' }))).toBe('invalid-request:kind');
    expect(err(readSubmission({ ...victim, faction: 0 }))).toBe('invalid-request:faction');
    expect(err(readSubmission({ ...victim, faction: 16_777_216 }))).toBe('invalid-request:faction');
    expect(err(readSubmission({ ...victim, faction: 1.5 }))).toBe('invalid-request:faction');
    expect(err(readSubmission({ ...victim, faction: '5' }))).toBe('invalid-request:faction');
    expect(err(readSubmission({ kind: 'victim', round: 1, faction: 5 }))).toBe('invalid-request:playerId');
    expect(err(readSubmission({ ...victim, playerId: 7 }))).toBe('invalid-request:playerId');
    expect(err(readSubmission({ ...victim, requestId: 'a b' }))).toBe('invalid-request:requestId');
    expect(err(readSubmission({ ...victim, zeta: 1 }))).toBe('invalid-request:zeta');
    expect(err(readSubmission({ kind: 'x', round: 'y', faction: 'z', playerId: 1 }))).toBe('invalid-request:kind');
  });

  it('FR-296 inherited fields are missing', () => {
    expect(err(readSubmission(Object.create(victim) as object))).toBe('invalid-request:kind');
  });

  it('FR-297 P31 a namespaced, empty, overlong or invalid-charset local player id is invalid-player-id', () => {
    for (const id of ['discord:1', 'web:Ana', ':', '', 'x'.repeat(65), 'a b', 'é', 'a/b']) {
      expect(err(readSubmission({ ...victim, playerId: id })), JSON.stringify(id)).toBe('invalid-player-id:playerId');
    }
    expect(err(readSubmission({ ...victim, playerId: 'x'.repeat(64) }))).toBe('ok');
  });

  it('FR-301 invalid-request wins over invalid-player-id; a bad request id is invalid-request, not invalid-player-id', () => {
    expect(err(readSubmission({ ...victim, playerId: 'a:b', requestId: 'a b' }))).toBe('invalid-request:requestId');
    expect(err(readSubmission({ ...victim, playerId: 'a:b', extra: 1 }))).toBe('invalid-request:extra');
    expect(err(readSubmission({ ...victim, playerId: 'a:b', faction: 'x' }))).toBe('invalid-request:faction');
  });
});
