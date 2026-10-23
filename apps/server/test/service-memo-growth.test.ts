import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/sqlite';
import { withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { OPERATOR, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';

// FR-282 (d) as amended by spec D26 (M3a C2): an `unknown-match` reply is never memoised, so commands that carry a client
// request id and name match ids that do not exist store nothing and cannot grow the memo table. Creation is unchanged (it
// names no match). A temporary file database, where the memo rows are counted directly.

const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
const memoRows = (file: string): number => withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM memo').get()!.n));

describe('FR-282 (d) unknown-match is not memoised (spec D26)', () => {
  it('FR-282 (d) repeated unknown-match submissions and advances with a request id create no memo row', () => {
    withTempDir((dir) => {
      const file = join(dir, 'memo.sqlite');
      const h = serviceHarness({ store: openStore(file), secret: SECRETS['ascending-00-1f'] });
      const unknown = errorReply('unknown-match');
      for (let i = 0; i < 25; i++) {
        const matchId = `missing-${i}`;
        for (let repeat = 0; repeat < 2; repeat++) {
          expect(h.service.submit({ client: WEB, matchId, body: { kind: 'victim', round: 1, faction: 2, playerId: 'p1', requestId: 'r-1' } })).toStrictEqual({ ok: false, error: unknown });
          expect(h.service.advance({ credential: OPERATOR, matchId, body: { round: 1, step: 'phase-1-close', requestId: 'r-1' } })).toStrictEqual({ ok: false, error: unknown });
        }
      }
      expect(h.store.memoOldest()).toBeUndefined();
      h.close();
      expect(memoRows(file)).toBe(0);
    });
  });

  it('FR-282 (d) a match created later answers the same request id as new: nothing was kept for it', () => {
    withTempDir((dir) => {
      const file = join(dir, 'memo.sqlite');
      const h = serviceHarness({ store: openStore(file), secret: SECRETS['ascending-00-1f'] });
      // The match id the fake random source will draw for the first creation is unknown until then; ask for it first.
      const probe = serviceHarness({ secret: SECRETS['ascending-00-1f'] });
      const future = probe.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
      probe.close();
      if (!future.ok) throw new Error('creation failed');
      const id = future.reply.matchId;
      const body = { kind: 'victim', round: 1, faction: 2, playerId: 'p1', requestId: 'r-1' };
      expect(h.service.submit({ client: WEB, matchId: id, body })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
      expect(h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-1-close', requestId: 'r-2' } })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
      expect(created.ok && created.reply.matchId).toBe(id);
      // The same request ids are now processed as new: the prediction is stored and the step performed.
      const submitted = h.service.submit({ client: WEB, matchId: id, body });
      expect(submitted.ok).toBe(true);
      const advanced = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-1-close', requestId: 'r-2' } });
      expect(advanced.ok && advanced.reply.result).toBe('performed');
      h.close();
      // The creation, the submission and the advance: three memo rows, none for the unknown-match replies.
      expect(memoRows(file)).toBe(3);
    });
  });
});
