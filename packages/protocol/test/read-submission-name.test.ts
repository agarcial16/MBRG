import { describe, expect, it } from 'vitest';
import { SUBMISSION_FIELDS, readSubmission, type ReadResult } from '../src/index';

const err = (r: ReadResult<unknown>): string => (r.ok ? 'ok' : `${r.error.kind}:${(r.error.items ?? []).join(',')}`);
const victim = { kind: 'victim', round: 1, faction: 5, playerId: 'a' };

describe('submission body: optional member name', () => {
  it('the field list gains name after the old members', () => {
    expect([...SUBMISSION_FIELDS]).toStrictEqual(['kind', 'round', 'faction', 'playerId', 'requestId', 'name']);
  });

  it('a valid name is returned trimmed and NFC; a body without it has no name key', () => {
    const decomposed = 'José Luis';
    const got = readSubmission({ ...victim, name: `  ${decomposed}  ` });
    expect(got).toStrictEqual({ ok: true, value: { ...victim, name: 'José Luis' } });
    const plain = readSubmission(victim);
    expect(plain).toStrictEqual({ ok: true, value: victim });
    expect(Object.keys((plain as { value: object }).value)).not.toContain('name');
  });

  it('keeps the name with the request id when both are sent', () => {
    expect(readSubmission({ ...victim, requestId: 'r1', name: 'Ana' })).toStrictEqual({ ok: true, value: { ...victim, requestId: 'r1', name: 'Ana' } });
  });

  it('refuses a bad name naming name and no hint of the rule', () => {
    const long = 'x'.repeat(25);
    for (const bad of [5, null, true, {}, [], '', '   ', long, 'a  b', 'ana!', 'ana\n', '\u{1F600}', 'x'.repeat(300)]) {
      expect(err(readSubmission({ ...victim, name: bad })), JSON.stringify(bad)).toBe('invalid-request:name');
    }
    expect(readSubmission({ ...victim, name: 'x'.repeat(24) }).ok).toBe(true);
    expect(readSubmission({ ...victim, name: '\u{1D4D0}'.repeat(24) }).ok).toBe(true);
    expect(readSubmission({ ...victim, name: '\u{1D4D0}'.repeat(25) }).ok).toBe(false);
  });

  it('checks name after requestId and before unknown members; the player id charset still comes last', () => {
    expect(err(readSubmission({ ...victim, requestId: 'a b', name: '!' }))).toBe('invalid-request:requestId');
    expect(err(readSubmission({ ...victim, zeta: 1, name: '!' }))).toBe('invalid-request:name');
    expect(err(readSubmission({ ...victim, playerId: 'bad id', name: '!' }))).toBe('invalid-request:name');
    expect(err(readSubmission({ ...victim, playerId: 'bad id', name: 'Ana' }))).toBe('invalid-player-id:playerId');
    expect(err(readSubmission({ ...victim, zeta: 1, name: 'Ana' }))).toBe('invalid-request:zeta');
  });

  it('an inherited name is missing', () => {
    expect(readSubmission(Object.assign(Object.create({ name: '!' }) as object, victim))).toStrictEqual({ ok: true, value: victim });
  });
});
