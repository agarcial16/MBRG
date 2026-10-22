import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getState, playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { roundSeed, secretHex } from '../src/secret';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import {
  absorberColumnsOutsideRecords,
  credentialTextColumns,
  encodingsOf,
  listColumns,
  pendingStateColumns,
  rowsBeyondApplied,
  scanValues,
  storedFutureViolations,
  withRawDb,
} from './helpers/db-scan';
import { DEV_DIR, devMap, stateDigest } from './helpers/digests';
import { OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';

// The database never holds the future (spec 008 NFR-47 (d); FR-255 and FR-256, storage parts; M2b' T5'). A scripted
// dev-map match runs through the service with a PLANTED secret (so its round seeds are known: `roundSeed(secret, k)`),
// next to a second match that a map change halts; the server is stopped after every action and the closed database is
// read raw. At every stage: no column can hold an absorber outside `records` or a pending state or seed; no `records` or
// `states` row of a round above N; no event or memoised reply about the pending round beyond what its stage reveals; no
// round seed of either match (decimal, hexadecimal both cases, base64 with and without padding, base64url, raw bytes) in
// any table, column or value; no digest or owner list of a state above N; the secret only in its own `matches.secret`
// BLOB until the match finishes (then its lowercase hex also as the published `matchSecret` of the `match-finished`
// event and of a memoised reply's finished public match, FR-259); the plain host
// token only in the creation memo and only for 24 h (FR-238). The log scan of NFR-47 (c) is M3a.

const S = 1000;
const DEV_MAP_JSON = readFileSync(join(DEV_DIR, 'map.json'), 'utf8');
/** A planted secret whose bytes appear nowhere else (SHA-256 of a label). */
const PLANTED = Uint8Array.from(createHash('sha256').update('mbrg/spec-008/t5/planted-secret').digest());

/** What the test knows about a match: its secret (planted or read from the draws), host token and the states of every round under its real seeds. */
interface Known {
  readonly id: string;
  readonly secret: Uint8Array;
  readonly hostToken: string;
  readonly seeds: readonly number[];
  readonly states: readonly MatchState[];
}

function knownOf(id: string, secret: Uint8Array, hostToken: string): Known {
  const map = devMap();
  const first = getState(map, 0, 0);
  if (!first.ok) throw new Error('no round-0 state');
  const states: MatchState[] = [first.value];
  const seeds: number[] = [];
  for (let k = 1; k <= 4; k++) {
    seeds.push(roundSeed(secret, k));
    const played = playRoundWithSeed(map, states[k - 1]!, seeds[k - 1]!);
    if (!played.ok) throw new Error('the round cannot be played');
    states.push(played.value.state);
  }
  return { id, secret, hostToken, seeds, states };
}

interface Audit {
  columns: string[];
  rowsBeyondApplied: string[];
  future: string[];
  roundSeeds: string[];
  futureStates: string[];
  secret: string[];
  secretColumn: string[];
  hostToken: string[];
}

const EMPTY: Audit = { columns: [], rowsBeyondApplied: [], future: [], roundSeeds: [], futureStates: [], secret: [], secretColumn: [], hostToken: [] };

/**
 * Every check of the storage at one stage, as lists of violations (all empty when the storage holds no future).
 * `tokenInMemo`: whether the creation memo may still hold the plain host token (within the 24 h retention).
 */
function audit(db: DatabaseSync, known: readonly Known[], tokenInMemo: boolean): Audit {
  const columns = listColumns(db);
  const out: Audit = {
    columns: [...absorberColumnsOutsideRecords(columns), ...pendingStateColumns(columns), ...credentialTextColumns(columns)],
    rowsBeyondApplied: rowsBeyondApplied(db).map((r) => `${r.table} ${r.matchId} round ${r.round}`),
    future: storedFutureViolations(db),
    roundSeeds: [],
    futureStates: [],
    secret: [],
    secretColumn: [],
    hostToken: [],
  };
  // A state another match has already applied is public data (two dev-map matches often play the same round): only the
  // states that no match has applied yet are scanned.
  const applied = new Set<string>();
  for (const m of known) {
    const n = Number(db.prepare('SELECT n FROM matches WHERE id = ?').get(m.id)!.n);
    m.states.slice(0, n + 1).forEach((state) => applied.add(stateDigest(state)));
  }
  for (const m of known) {
    const row = db.prepare('SELECT stage, n, secret FROM matches WHERE id = ?').get(m.id)!;
    const n = Number(row.n);
    const finished = row.stage === 'finished';
    // FR-255 (storage): no round seed, of any round, applied or not, in any encoding anywhere (the secret BLOB included).
    m.seeds.forEach((seed, i) => {
      for (const where of scanValues(db, encodingsOf(seed))) out.roundSeeds.push(`${m.id} s_${i + 1} in ${where}`);
    });
    // FR-256 (storage): nothing of a state above N (its digest or its owner list).
    m.states.forEach((state, k) => {
      if (k <= n || applied.has(stateDigest(state))) return;
      const digest = Uint8Array.from(Buffer.from(stateDigest(state), 'hex'));
      for (const where of scanValues(db, [...encodingsOf(digest), JSON.stringify(state.owners)])) out.futureStates.push(`${m.id} state ${k} in ${where}`);
    });
    // The secret: its own BLOB holds exactly its bytes; no other place holds it in any encoding, except its lowercase hex
    // as the published `matchSecret` once the match is finished (FR-259).
    if (!(row.secret instanceof Uint8Array) || Buffer.compare(Buffer.from(row.secret), Buffer.from(m.secret)) !== 0) out.secretColumn.push(`${m.id} matches.secret`);
    const hex = secretHex(m.secret);
    for (const where of scanValues(db, encodingsOf(m.secret).filter((e) => e !== hex), ['matches.secret'])) out.secret.push(`${m.id} secret in ${where}`);
    const published = ['events.payload_json', 'memo.reply_json'];
    for (const where of scanValues(db, [hex], ['matches.secret'])) if (!finished || !published.includes(where)) out.secret.push(`${m.id} secret hex in ${where}`);
    if (finished) {
      // Only as the published `matchSecret` field: of the match-finished event, or of a memoised reply's finished public match.
      const field = `"matchSecret":"${hex}"`;
      const only = (text: string): boolean => text.split(hex).length === text.split(field).length;
      for (const e of db.prepare('SELECT seq, type, payload_json FROM events WHERE match_id = ?').all(m.id)) {
        const text = String(e.payload_json);
        if (text.includes(hex) && (e.type !== 'match-finished' || !only(text))) out.secret.push(`${m.id} secret hex in event ${String(e.seq)} ${String(e.type)}`);
      }
      for (const r of db.prepare('SELECT request_id, reply_json FROM memo').all()) {
        const text = String(r.reply_json);
        if (text.includes(hex) && !only(text)) out.secret.push(`${m.id} secret hex in memo ${String(r.request_id)}`);
      }
    }
    // The host token: plain only in the creation memo while it is kept; its raw bytes in no other encoding anywhere.
    const tokenBytes = Uint8Array.from(Buffer.from(m.hostToken, 'base64url'));
    for (const where of scanValues(db, encodingsOf(tokenBytes).filter((e) => e !== m.hostToken))) out.hostToken.push(`${m.id} token bytes in ${where}`);
    for (const where of scanValues(db, [m.hostToken])) if (!tokenInMemo || where !== 'memo.reply_json') out.hostToken.push(`${m.id} token in ${where}`);
    if (tokenInMemo) {
      const memos = db.prepare('SELECT scope, reply_json FROM memo').all().filter((r) => String(r.reply_json).includes(m.hostToken));
      for (const r of memos) if (!String(r.scope).endsWith(',null]') || !String(r.reply_json).includes('"hostToken"')) out.hostToken.push(`${m.id} token in memo ${String(r.scope)}`);
    }
  }
  return out;
}

const NEXT = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' } as const;
const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;

describe('NFR-47 (d) the database never holds the future', () => {
  it('NFR-47 (d) FR-255 (storage) FR-256 (storage) a full match and a halted one, stopped and restarted after every action: no absorber, pending state, later round, round seed or secret in storage', () => {
    withTempDir((dir) => {
      const file = join(dir, 'secrecy.sqlite');
      const pkg = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const folders = { dev: DEV_DIR.replace(/[\\/]$/, ''), pkg };
      const h = serviceHarness({ store: openStore(file), secret: PLANTED, folders });
      const a = h.service.create({ credential: OPERATOR, body: creationBody('c-a') });
      const b = h.service.create({ credential: OPERATOR, body: creationBody('c-b', { mapId: 'pkg' }) });
      if (!a.ok || !b.ok) throw new Error('creation failed');
      // Draw order per creation: secret (32 bytes), match id (12), host token (32).
      const secrets = h.draws.filter((_, i) => i % 3 === 0).map((d) => d.bytes);
      expect(secrets.map((s) => s.length)).toStrictEqual([32, 32]);
      expect(Buffer.from(secrets[0]!).equals(Buffer.from(PLANTED))).toBe(true);
      const known = [knownOf(a.reply.matchId, secrets[0]!, a.reply.hostToken), knownOf(b.reply.matchId, secrets[1]!, b.reply.hostToken)];
      const [A, B] = known as [Known, Known];

      const live: { store: Store; service: MatchService } = { store: h.store, service: h.service };
      const stages: string[] = [];
      /** Stops the server, audits the closed database, starts a new server on it (start(): purge, map check, late rule). */
      const checkpoint = (label: string, tokenInMemo = true): void => {
        live.service.close();
        const found = withRawDb(file, (db) => audit(db, known, tokenInMemo));
        const stage = withRawDb(file, (db) => known.map((m) => `${String(db.prepare('SELECT stage, n FROM matches WHERE id = ?').get(m.id)!.stage)}`).join('/'));
        stages.push(stage);
        expect({ label, ...found }).toStrictEqual({ label, ...EMPTY });
        live.store = openStore(file);
        live.service = createMatchService({ store: live.store, clock: h.clock, maps: createMapCatalog(folders), settings: h.settings });
        live.service.start();
      };
      const submitOpen = (id: string, n: number): void => {
        const shown = live.service.publicMatch(id)!;
        const living = [...new Set(shown.state.owners.map(([, f]) => f))].sort((x, y) => x - y);
        const round = shown.appliedRounds + 1;
        const bodies: Record<string, unknown>[] = [];
        if (shown.stage === 'phase-1') {
          bodies.push({ kind: 'victim', round, faction: living[n % living.length], playerId: 'p1', requestId: `v-${id}-${n}` });
          bodies.push({ kind: 'winner', faction: living[(n + 1) % living.length], playerId: 'p1', requestId: `w-${id}-${n}` });
        }
        if (shown.stage === 'phase-2') bodies.push({ kind: 'absorber', round, faction: shown.victim!.candidates[n % shown.victim!.candidates.length], playerId: 'p1', requestId: `a-${id}-${n}` });
        for (const body of bodies) live.service.submit({ client: { ...CLIENT }, matchId: id, body });
      };

      checkpoint('created');
      for (let n = 0; n < 20; n++) {
        const shown = live.service.publicMatch(A.id)!;
        if (shown.stage === 'finished') break;
        submitOpen(A.id, n);
        submitOpen(B.id, n);
        checkpoint(`step ${n}: predictions in ${shown.stage}`);
        const stage = shown.stage as keyof typeof NEXT;
        if (n % 2 === 1) {
          // A manual advance with a request id (its reply is memoised), alternately by the operator and the host token.
          const credential = n % 4 === 1 ? A.hostToken : OPERATOR;
          const out = live.service.advance({ credential, matchId: A.id, body: { round: shown.appliedRounds + 1, step: NEXT[stage], requestId: `adv-${n}` } });
          expect(out.ok).toBe(true);
        } else {
          const schedule = shown.schedule!;
          h.clock.set(stage === 'phase-1' ? schedule.c1 : stage === 'phase-2' ? schedule.c2 : schedule.a);
          live.service.tick();
        }
        // The second match's package disappears after the first step: the next start() halts it (map check, FR-250).
        if (n === 0) rmSync(join(pkg, 'map.json'));
        checkpoint(`step ${n}: after ${NEXT[stage]}`);
      }
      // After 24 h the next start() purges the creation memos; then the plain host tokens are gone too.
      h.clock.set(START_MS + MEMO_RETENTION_MS + 3600 * S);
      checkpoint('a day later, before the purge');
      checkpoint('after the purge', false);
      live.service.close();
      // The script covered every stage of A (and B halted before its reveal), restarts included.
      expect(new Set(stages.map((s) => s.split('/')[0]))).toStrictEqual(new Set(['phase-1', 'phase-2', 'locked', 'finished']));
      expect(stages.at(-1)).toBe('finished/halted');
      // B revealed its victim at the first step, then halted at the next start (victim kept, absorber never stored).
      expect(stages.some((s) => s === 'phase-2/halted')).toBe(true);
    });
  });
});

describe('NFR-47 (d) the storage scanners can fail', () => {
  /** A database with one created match (store closed), for planting violations with a raw connection. */
  const withPlanted = (body: (db: DatabaseSync, known: Known) => void): void =>
    withTempDir((dir) => {
      const file = join(dir, 'planted.sqlite');
      const h = serviceHarness({ store: openStore(file), secret: PLANTED });
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
      if (!created.ok) throw new Error('creation failed');
      h.close();
      const known = knownOf(created.reply.matchId, PLANTED, created.reply.hostToken);
      withRawDb(file, (db) => {
        expect(audit(db, [known], true)).toStrictEqual(EMPTY);
        body(db, known);
      });
    });
  const event = (db: DatabaseSync, id: string, seq: number, payload: Record<string, unknown>): void => {
    db.prepare('INSERT INTO events (match_id, seq, type, payload_json) VALUES (?, ?, ?, ?)').run(id, seq, String(payload.type), JSON.stringify(payload));
  };

  it('NFR-47 (d) FR-255 (storage) a planted round seed is found in every scanned encoding and every column kind', () => {
    withPlanted((db, m) => {
      const seed = m.seeds[0]!;
      const forms = encodingsOf(seed);
      expect(forms.length).toBeGreaterThanOrEqual(6);
      for (const form of forms) {
        const text = typeof form === 'string' ? `x${form}x` : form;
        db.prepare("UPDATE memo SET reply_json = ? WHERE request_id = 'c-1'").run(typeof text === 'string' ? text : Buffer.from(text).toString('latin1'));
        if (typeof form === 'string') expect(audit(db, [m], true).roundSeeds).toContain(`${m.id} s_1 in memo.reply_json`);
      }
      db.prepare('UPDATE matches SET secret = ? WHERE id = ?').run(Buffer.concat([Buffer.from(m.secret.slice(0, 28)), Buffer.from(seed.toString(16).padStart(8, '0'), 'hex')]), m.id);
      const found = audit(db, [m], true);
      expect(found.roundSeeds).toContain(`${m.id} s_1 in matches.secret`);
      expect(found.secretColumn).toStrictEqual([`${m.id} matches.secret`]);
      db.prepare('UPDATE matches SET winner = ? WHERE id = ?').run(m.seeds[3]!, m.id);
      expect(audit(db, [m], true).roundSeeds).toContain(`${m.id} s_4 in matches.winner`);
    });
  });

  it('NFR-47 (d) FR-256 (storage) a planted absorber, pending state, later round or early victim is found', () => {
    withPlanted((db, m) => {
      const next = m.states[1]!;
      event(db, m.id, 2, { type: 'schedule', seq: 2, stage: 'phase-1', absorber: 3, reportedTime: START_MS });
      event(db, m.id, 3, { type: 'phase-closed', seq: 3, round: 1, phase: 1, at: START_MS });
      event(db, m.id, 4, { type: 'round-applied', seq: 4, round: 1, record: { round: 1, eliminated: 1, absorber: 2, transferred: [] }, stateDigest: stateDigest(next), appliedAt: START_MS });
      event(db, m.id, 5, { type: 'match-halted', seq: 5, round: 3, reason: 'map-changed', reportedTime: START_MS, victim: 2 });
      db.prepare("UPDATE matches SET victim = 2, reveal_ms = ?, winner = 3, halt_reason = 'map-changed' WHERE id = ?").run(START_MS, m.id);
      db.prepare("UPDATE memo SET reply_json = ? WHERE request_id = 'c-1'").run(JSON.stringify({ match: { nextOwners: JSON.stringify(next.owners), state: { owners: [] }, victim: { victim: 1 } }, victim: 1 }));
      db.prepare('INSERT INTO records (match_id, round, eliminated, absorber, transferred_json) VALUES (?, 1, 1, 2, ?)').run(m.id, '[]');
      const found = audit(db, [m], true);
      expect(found.rowsBeyondApplied).toStrictEqual([`records ${m.id} round 1`]);
      expect(found.future).toStrictEqual([
        `${m.id}: victim column set in stage phase-1`,
        `${m.id}: winner column set in stage phase-1`,
        `${m.id}: halt reason column set in stage phase-1`,
        `${m.id} event 2 schedule: key absorber`,
        `${m.id} event 3 phase-closed: round 1 revealed in stage phase-1`,
        `${m.id} event 4 round-applied: applied round 1 above N = 0`,
        `${m.id} event 5 match-halted: round 3 above N + 1 = 1`,
        `${m.id} event 5 match-halted: key victim`,
        'memo c-1: key match.nextOwners',
        'memo c-1: key victim',
      ]);
      expect(found.futureStates).toStrictEqual([`${m.id} state 1 in events.payload_json`, `${m.id} state 1 in memo.reply_json`]);
      db.exec('ALTER TABLE matches ADD COLUMN pending_absorber INTEGER');
      db.exec('ALTER TABLE states ADD COLUMN absorber INTEGER');
      expect(audit(db, [m], true).columns).toStrictEqual(['matches.pending_absorber', 'states.absorber', 'matches.pending_absorber']);
    });
  });

  it('NFR-47 (d) a planted secret or host token outside the allowed places is found', () => {
    withPlanted((db, m) => {
      const hex = secretHex(m.secret);
      event(db, m.id, 2, { type: 'schedule', seq: 2, stage: 'phase-1', reportedTime: START_MS, note: hex });
      expect(audit(db, [m], true).secret).toStrictEqual([`${m.id} secret hex in events.payload_json`]);
      db.prepare('UPDATE events SET payload_json = ? WHERE seq = 2').run(JSON.stringify({ type: 'schedule', note: Buffer.from(m.secret).toString('base64url') }));
      expect(audit(db, [m], true).secret).toStrictEqual([`${m.id} secret in events.payload_json`]);
      // Finished: the hex is allowed in the match-finished event only.
      db.prepare("UPDATE matches SET stage = 'finished' WHERE id = ?").run(m.id);
      db.prepare('UPDATE events SET payload_json = ? WHERE seq = 2').run(JSON.stringify({ type: 'schedule', note: hex }));
      expect(audit(db, [m], true).secret).toStrictEqual([`${m.id} secret hex in event 2 schedule`]);
      db.prepare("UPDATE events SET type = 'match-finished' WHERE seq = 2").run();
      expect(audit(db, [m], true).secret).toStrictEqual([`${m.id} secret hex in event 2 match-finished`]);
      db.prepare('UPDATE events SET payload_json = ? WHERE seq = 2').run(JSON.stringify({ type: 'match-finished', matchSecret: hex }));
      expect(audit(db, [m], true).secret).toStrictEqual([]);
      db.prepare("UPDATE memo SET reply_json = ? WHERE request_id = 'c-1'").run(JSON.stringify({ hostToken: m.hostToken, note: hex }));
      expect(audit(db, [m], true).secret).toStrictEqual([`${m.id} secret hex in memo c-1`]);
      db.prepare("UPDATE memo SET reply_json = ? WHERE request_id = 'c-1'").run(JSON.stringify({ hostToken: m.hostToken, match: { matchSecret: hex } }));
      expect(audit(db, [m], true).secret).toStrictEqual([]);
      // The host token: allowed in the creation memo within the retention only; never anywhere else.
      expect(audit(db, [m], false).hostToken).toStrictEqual([`${m.id} token in memo.reply_json`]);
      db.prepare('UPDATE matches SET map_id = ? WHERE id = ?').run(m.hostToken, m.id);
      expect(audit(db, [m], true).hostToken).toStrictEqual([`${m.id} token in matches.map_id`]);
      db.prepare('UPDATE matches SET map_id = ? WHERE id = ?').run(Buffer.from(m.hostToken, 'base64url').toString('hex'), m.id);
      expect(audit(db, [m], true).hostToken).toStrictEqual([`${m.id} token bytes in matches.map_id`]);
    });
  });
});
