import type { PublicState } from '@mbrg/protocol';
import type { CoreMatch } from '../../src/core/view';
import type { Store } from '../../src/store/store';

// Seeds stored matches of any stage directly through the store, as the creation (client row, community row) and the steps leave
// them, with chosen finish instants: the history tests that need an exact instant (settling, ties, the snapshot race) use it.

export const DIGEST = (c: string): string => c.repeat(64);
export const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
export const T0 = 1_700_000_000_000;
export const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });
export const id = (c: string, n = 1): string => `${c.repeat(15)}${String(n)}`;

export interface Spec {
  readonly id: string;
  readonly stage?: CoreMatch['stage'];
  readonly at?: number;
  readonly community?: string;
  readonly namespace?: string;
  readonly winner?: number;
  readonly map?: string;
}

/** One stored match as the creation (client row, community row) and the steps leave it, in any stage. */
export const put = (store: Store, spec: Spec): void => {
  const stage = spec.stage ?? 'finished';
  const finished = stage === 'finished';
  const applied = finished ? 5 : stage === 'halted' || stage === 'phase-1' || stage === 'locked' ? 2 : 0;
  const at = spec.at ?? T0 + 1000;
  const match: CoreMatch = {
    matchId: spec.id,
    mapId: spec.map ?? 'dev',
    mapDigest: DIGEST('a'),
    totalRounds: 5,
    timing: { i: 120, l1: 30, l2: 10 },
    commitment: DIGEST('c'),
    stage,
    appliedRounds: applied,
    state: state(applied),
    stateDigest: DIGEST('d'),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: at,
    anchors: null,
    ...(finished ? { winner: spec.winner ?? 10 } : {}),
    ...(stage === 'halted' ? { haltReason: 'map-changed' as const } : {}),
  };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (spec.namespace !== undefined) store.insertClientMatch(spec.id, spec.namespace);
    if (spec.community !== undefined) store.insertCommunity(spec.id, spec.community);
  });
};
