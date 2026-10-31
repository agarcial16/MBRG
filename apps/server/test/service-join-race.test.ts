import { errorReply } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Two joins with the same name key (spec 011 M3 T6): the check before the draws is a courtesy; the unique index decides.

const PUBLIC = { maps: ['dev'] } as const;

const lobbyOf = (h: Harness): string => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  return out.reply.matchId;
};
const join = (h: Harness, matchId: string, name: string, requestId: string, source: string) => h.service.join({ source, matchId, body: { name, requestId } });

/** The store with a name check that is blind to rows written by a join that ran in between (the second join read before the first one committed). */
const blind = (base: Store): Store => ({ ...base, nameKeyTaken: () => false });

describe('two joins with the same name key', () => {
  it('FR-377 interleaved so that the second check sees nothing, the unique index refuses the second inside its transaction: exactly one name-taken, nothing of the second stored', () => {
    const real = openStore(':memory:');
    const h = serviceHarness({ store: blind(withFaults(real, {})), publicCreation: PUBLIC });
    try {
      const matchId = lobbyOf(h);
      const first = join(h, matchId, 'Ana', 'j-1', 'src-a');
      expect(first.ok).toBe(true);
      const seen: MatchEvent[] = [];
      h.service.subscribe((_id, events) => seen.push(...events));
      const second = join(h, matchId, 'ANA', 'j-2', 'src-b');
      expect(second).toStrictEqual({ ok: false, error: errorReply('name-taken') });
      expect(second.ok === false && second.error.kind).not.toBe('unavailable');
      expect(real.playerCount(matchId)).toBe(1);
      expect(real.eventsAfter(matchId, 0)).toHaveLength(2);
      expect(real.getMatch(matchId)!.match.lastSeq).toBe(2);
      expect(real.memoGet({ credentialDigest: credentialDigest('join:src-b'), match: matchId }, 'j-2')).toBeUndefined();
      expect(seen).toStrictEqual([]);
      // The refusal is not memoised and the service is still usable.
      expect(join(h, matchId, 'Bea', 'j-2', 'src-b').ok).toBe(true);
      expect(real.playerCount(matchId)).toBe(2);
    } finally {
      h.close();
    }
  });

  it('FR-377 FR-376 a join made from inside the callback of another join, with the same name, gives exactly one name-taken', () => {
    const h = serviceHarness({ publicCreation: PUBLIC });
    try {
      const matchId = lobbyOf(h);
      const inner: { out?: ReturnType<typeof join> } = {};
      let once = true;
      h.service.subscribe(() => {
        if (!once) return;
        once = false;
        inner.out = join(h, matchId, 'ana', 'j-2', 'src-b');
      });
      expect(join(h, matchId, 'Ana', 'j-1', 'src-a').ok).toBe(true);
      expect(inner.out).toStrictEqual({ ok: false, error: errorReply('name-taken') });
      expect(h.store.playerCount(matchId)).toBe(1);
    } finally {
      h.close();
    }
  });

  it('a storage failure inside a join is unavailable, never name-taken', () => {
    const real = openStore(':memory:');
    const h = serviceHarness({ store: withFaults(real, { failWrite: { transaction: 3, afterWrites: 0 } }), publicCreation: PUBLIC });
    try {
      const matchId = lobbyOf(h);
      expect(join(h, matchId, 'Ana', 'j-1', 'src-a').ok).toBe(true);
      // Transaction 3 is the next join: its first write fails as a storage failure, which is `unavailable`, not `name-taken`.
      expect(join(h, matchId, 'Bea', 'j-2', 'src-a')).toStrictEqual({ ok: false, error: errorReply('unavailable') });
      expect(real.playerCount(matchId)).toBe(1);
    } finally {
      h.close();
    }
  });
});
