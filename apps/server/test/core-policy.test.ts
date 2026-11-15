import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { creationPolicy, joinPolicy, submitPolicy, type PolicyCaller } from '../src/core/policy';

// Spec 018 (FR-491 to FR-493, FR-496, FR-497, NFR-104): the join policy decisions are pure functions of the policy, the
// owning namespace and the caller class. The shell classifies the caller; nothing here reads a credential or a body namespace.

const owner: PolicyCaller = { role: 'client', namespace: 'discord' };
const otherClient: PolicyCaller = { role: 'client', namespace: 'telegram' };
const other: PolicyCaller = { role: 'other' };
// anonymous, host token, player token, unknown token and the operator all reach the policy as `other`
const callers: [string, PolicyCaller][] = [['owning client', owner], ['another client', otherClient], ['anonymous, host, player, unknown or operator', other]];

describe('creation policy', () => {
  it('FR-491 a client credential asking for client gets the policy client and the namespace of its credential', () => {
    expect(creationPolicy('client', owner, false)).toStrictEqual({ ok: true, policy: 'client', namespace: 'discord' });
    expect(creationPolicy('client', otherClient, false)).toStrictEqual({ ok: true, policy: 'client', namespace: 'telegram' });
  });

  it('FR-492 any caller that is not a client credential asking for client gets forbidden', () => {
    expect(creationPolicy('client', other, false)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
  });

  it('FR-490 absent and open give an open match for every caller, the owner included', () => {
    for (const [name, caller] of callers) {
      expect(creationPolicy(undefined, caller, false), name).toStrictEqual({ ok: true, policy: 'open' });
      expect(creationPolicy('open', caller, false), name).toStrictEqual({ ok: true, policy: 'open' });
    }
  });

  it('FR-493 the operator path refuses any joinPolicy naming it, and accepts a body without it', () => {
    for (const requested of ['open', 'client'] as const) {
      expect(creationPolicy(requested, other, true), requested).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['joinPolicy']) });
    }
    expect(creationPolicy(undefined, other, true)).toStrictEqual({ ok: true, policy: 'open' });
  });
});

describe('join policy', () => {
  it('FR-496 a match with an owning namespace refuses every join with joins-closed', () => {
    expect(joinPolicy('discord')).toStrictEqual({ ok: false, error: errorReply('joins-closed') });
    expect(joinPolicy('telegram')).toStrictEqual({ ok: false, error: errorReply('joins-closed') });
  });

  it('FR-496 an open match (no owner) lets the join go on', () => {
    expect(joinPolicy(undefined)).toStrictEqual({ ok: true });
  });
});

describe('submission policy', () => {
  it('FR-497 only a client credential of the owning namespace passes a client-only match', () => {
    expect(submitPolicy('discord', owner)).toStrictEqual({ ok: true });
    expect(submitPolicy('discord', otherClient)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    expect(submitPolicy('discord', other)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
  });

  it('FR-497 everybody passes an open match, as in 008', () => {
    for (const [name, caller] of callers) expect(submitPolicy(undefined, caller), name).toStrictEqual({ ok: true });
  });

  it('FR-497 the refusal is the very reply of any other forbidden caller', () => {
    const refused = submitPolicy('discord', other);
    expect(refused).toStrictEqual({ ok: false, error: { kind: 'forbidden' } });
  });
});
