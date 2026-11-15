import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { MAP_FILE_NAMES, decodeCursor, encodeError, encodeState, errorReply, roundNotApplied } from '@mbrg/protocol';
import type { CursorKey, ErrorReply, MapFileName, MatchSummary, OwnPrediction, Page, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService, ReadOutcome, TestSeedSource } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { DEV_DIR } from './helpers/digests';
import { OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// The reads of the lifecycle service (M3a T5): the match list, a match's public data, the state and the record of an
// applied round, the records, a client's own predictions (namespace-wide, paged, optionally one local id), the host-token
// check and the map files. Every read returns an outcome with an `ErrorReply`, writes nothing and answers `unavailable`
// on a storage failure. The HTTP routes are later tasks: here everything runs in process with the fake clock and an
// in-memory database (a temporary file where the raw rows are compared).

interface RoundGolden {
  round: number;
  seed: number;
  victim: number;
  absorber: number;
  transferred: number[];
  stateDigest: string;
}
const golden = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as { totalRounds: number; matches: Record<string, { rounds: RoundGolden[] }> };
const GOLD = golden.matches['ascending-00-1f']!.rounds;
const T = golden.totalRounds;
const SECRET = SECRETS['ascending-00-1f'];
const SECRET_HEX = Buffer.from(SECRET).toString('hex');
const KINDS: readonly StepKind[] = ['phase-1-close', 'phase-2-close', 'application'];
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
const BOT = { credential: 'client-credential-bot-0123456789ab', namespace: 'bot' };

interface Started {
  readonly h: Harness;
  readonly id: string;
  readonly hostToken: string;
}

function start(options: HarnessOptions & { timing?: unknown; requestId?: string } = {}): Started {
  const h = serviceHarness({ secret: SECRET, ...options });
  return { h, ...create(h, options.requestId ?? 'c-1', options.timing ?? 'manual') };
}

function create(h: Harness, requestId: string, timing: unknown = 'manual'): { id: string; hostToken: string } {
  const out = h.service.create({ credential: OPERATOR, body: creationBody(requestId, { timing }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { id: out.reply.matchId, hostToken: out.reply.hostToken };
}

const ok = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const refused = (out: ReadOutcome<unknown>): ErrorReply => {
  if (out.ok) throw new Error('read accepted');
  return out.error;
};
const advance = (m: Started, round: number, step: StepKind, service: MatchService = m.h.service): void => {
  const out = service.advance({ credential: OPERATOR, matchId: m.id, body: { round, step } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};
const stageOf = (m: Started): string => m.h.store.getMatch(m.id)!.match.stage;
const appliedOf = (m: Started): number => m.h.store.getMatch(m.id)!.match.appliedRounds;
const living = (m: Started): number[] => [...new Set(m.h.store.getMatch(m.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const submit = (m: Started, client: typeof WEB, body: Record<string, unknown>): void => {
  const out = m.h.service.submit({ client, matchId: m.id, body });
  if (!out.ok) throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
};

/** Every page of a paged read with `limit`, following the cursors; `between` runs after each page. */
function allPages<T, L extends 'matches' | 'records' | 'predictions'>(
  list: L,
  read: (after: CursorKey<L> | undefined) => ReadOutcome<Page<T>>,
  between: (page: number) => void = () => {},
): { items: T[]; pages: number } {
  const items: T[] = [];
  let after: CursorKey<L> | undefined;
  for (let page = 0; page < 200; page++) {
    const got = ok(read(after));
    items.push(...got.items);
    if (got.next === undefined) return { items, pages: page + 1 };
    const decoded = decodeCursor(list, got.next);
    if (!decoded.ok) throw new Error('the service issued a cursor the protocol does not decode');
    after = decoded.value;
    between(page);
  }
  throw new Error('paging did not end');
}

const readStream = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

/** Every read of one match, as outcomes (for the error checks that apply to all of them). */
const matchReads = (service: MatchService, matchId: string): ReadOutcome<unknown>[] => [
  service.readPublicMatch(matchId),
  service.stateAt(matchId, 0),
  service.recordAt(matchId, 1),
  service.records(matchId, { limit: 10 }),
  service.ownPredictionsPage({ namespace: 'web', matchId, limit: 10 }),
];

describe('FR-281 (b) (c) round states and records through the service', () => {
  it('FR-281 (b) (c) FR-302 (reads) round 0 is readable right after creation and equals the creation state and its digest', () => {
    const h = serviceHarness({ secret: SECRET });
    const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
    if (!out.ok) throw new Error('creation failed');
    const id = out.reply.matchId;
    expect(ok(h.service.readPublicMatch(id))).toStrictEqual(out.reply.match);
    expect(ok(h.service.stateAt(id, 0))).toStrictEqual({ round: 0, owners: out.reply.match.state.owners, stateDigest: out.reply.match.stateDigest, reportedTime: START_MS });
    expect(refused(h.service.stateAt(id, 1))).toStrictEqual(roundNotApplied(0));
    expect(refused(h.service.recordAt(id, 1))).toStrictEqual(roundNotApplied(0));
    expect(ok(h.service.records(id, { limit: 100 }))).toStrictEqual({ items: [] });
    h.close();
  });

  it('FR-281 (c) the states at j <= N equal the golden digests after the steps and each record is the applied record', () => {
    const m = start();
    const creationDigest = ok(m.h.service.stateAt(m.id, 0)).stateDigest;
    for (let k = 1; k <= T; k++) {
      for (const kind of KINDS) advance(m, k, kind);
      const state = ok(m.h.service.stateAt(m.id, k));
      expect(state.round).toBe(k);
      expect(state.stateDigest, `round ${k}`).toBe(GOLD[k - 1]!.stateDigest);
      expect(state.owners).toStrictEqual(m.h.store.getMatch(m.id)!.match.state.owners);
      const g = GOLD[k - 1]!;
      expect(ok(m.h.service.recordAt(m.id, k))).toStrictEqual({ round: k, eliminated: g.victim, absorber: g.absorber, transferred: g.transferred });
    }
    // Earlier rounds stay readable once later ones are applied.
    expect(ok(m.h.service.stateAt(m.id, 0)).stateDigest).toBe(creationDigest);
    for (let j = 1; j <= T; j++) expect(ok(m.h.service.stateAt(m.id, j)).stateDigest).toBe(GOLD[j - 1]!.stateDigest);
    m.h.close();
  });

  it('FR-281 (c) a round that is not a whole number >= 0 is invalid-request, and the record of round 0 is invalid-request', () => {
    const m = start();
    for (const round of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      expect(refused(m.h.service.stateAt(m.id, round)), String(round)).toStrictEqual(errorReply('invalid-request', ['round']));
      expect(refused(m.h.service.recordAt(m.id, round)), String(round)).toStrictEqual(errorReply('invalid-request', ['round']));
    }
    expect(refused(m.h.service.recordAt(m.id, 0))).toStrictEqual(errorReply('invalid-request', ['round']));
    // The round rule comes before the match lookup (FR-301 order).
    expect(refused(m.h.service.stateAt('nope', -1))).toStrictEqual(errorReply('invalid-request', ['round']));
    m.h.close();
  });

  it('FR-281 (b) (c) (d) FR-270 (read) a malformed or unknown match id is unknown-match for every match read', () => {
    const m = start();
    for (const matchId of ['nope', '', '../x', 'a'.repeat(65), 42 as unknown as string, undefined as unknown as string]) {
      for (const out of matchReads(m.h.service, matchId)) expect(refused(out), String(matchId)).toStrictEqual(errorReply('unknown-match'));
    }
    m.h.close();
  });
});

describe('FR-258 (reads) a round above N is answered from N alone', () => {
  const aboveN = (service: MatchService, id: string, n: number): string[] =>
    [n + 1, n + 2, T + 5].flatMap((j) => [encodeError(refused(service.stateAt(id, j))), encodeError(refused(service.recordAt(id, j)))]);

  it('FR-258 (reads) N + 1, N + 2 and T + 5 get the same round-not-applied naming only N, in every stage', () => {
    const m = start();
    const seen = new Set<string>();
    const check = (): void => {
      const n = appliedOf(m);
      const replies = aboveN(m.h.service, m.id, n);
      expect(new Set(replies), `${stageOf(m)} N = ${n}`).toStrictEqual(new Set([encodeError(roundNotApplied(n))]));
      seen.add(stageOf(m));
    };
    check();
    for (let k = 1; k <= T; k++) {
      for (const kind of KINDS) {
        advance(m, k, kind);
        check();
      }
    }
    expect(stageOf(m)).toBe('finished');
    // A halted match: the map left the list, the next advance halts it (FR-251).
    const h = start({ seed: 2, requestId: 'c-2' });
    const unlisted = createMatchService({ store: h.h.store, clock: h.h.clock, maps: createMapCatalog({}), settings: h.h.settings });
    expect(unlisted.advance({ credential: OPERATOR, matchId: h.id, body: { round: 1, step: 'phase-1-close' } })).toStrictEqual({ ok: false, error: errorReply('match-halted') });
    expect(stageOf(h)).toBe('halted');
    expect(new Set(aboveN(h.h.service, h.id, 0))).toStrictEqual(new Set([encodeError(roundNotApplied(0))]));
    expect([...seen].sort()).toStrictEqual(['finished', 'locked', 'phase-1', 'phase-2']);
    m.h.close();
    h.h.close();
  });

  it('FR-258 (reads) FR-257 twin matches that differ only in unrevealed outcomes answer byte-identical reads', () => {
    // Round 1 is the same in both twins; every later round seed differs, so every unrevealed outcome differs.
    const twin = (offset: number): TestSeedSource => () => (round) => (round === 1 ? GOLD[0]!.seed : (GOLD[round - 1]!.seed + offset) >>> 0);
    const a = start({ testSeedSource: twin(0) });
    const b = start({ testSeedSource: twin(7919) });
    expect(a.id).toBe(b.id);
    const reads = (m: Started): string[] => {
      const n = appliedOf(m);
      return [...aboveN(m.h.service, m.id, n), encodeState(ok(m.h.service.stateAt(m.id, n)))];
    };
    for (const kind of KINDS) {
      advance(a, 1, kind);
      advance(b, 1, kind);
      expect(reads(a), kind).toStrictEqual(reads(b));
    }
    // The twins really differ in the next round (the seeds are used): its victim is drawn differently.
    advance(a, 2, 'phase-1-close');
    advance(b, 2, 'phase-1-close');
    expect(a.h.store.getMatch(a.id)!.match.victim?.victim).not.toBe(b.h.store.getMatch(b.id)!.match.victim?.victim);
    a.h.close();
    b.h.close();
  });
});

describe('FR-281 (b) reads of halted and finished matches', () => {
  it('FR-281 (b) (c) (d) a halted match is read like a running one with its stage and reason, never its secret', () => {
    const m = start();
    for (const kind of KINDS) advance(m, 1, kind);
    const unlisted = createMatchService({ store: m.h.store, clock: m.h.clock, maps: createMapCatalog({}), settings: m.h.settings });
    unlisted.advance({ credential: OPERATOR, matchId: m.id, body: { round: 2, step: 'phase-1-close' } });
    const match = ok(m.h.service.readPublicMatch(m.id));
    expect(match.stage).toBe('halted');
    expect(match.haltReason).toBe('map-changed');
    expect('matchSecret' in match).toBe(false);
    expect(JSON.stringify(match)).not.toContain(SECRET_HEX);
    expect(ok(m.h.service.stateAt(m.id, 1)).stateDigest).toBe(GOLD[0]!.stateDigest);
    expect(ok(m.h.service.recordAt(m.id, 1)).eliminated).toBe(GOLD[0]!.victim);
    expect(ok(m.h.service.records(m.id, { limit: 10 })).items).toHaveLength(1);
    m.h.close();
  });

  it('FR-281 (b) a finished match is read with its winner and its secret', () => {
    const m = start();
    expect('matchSecret' in ok(m.h.service.readPublicMatch(m.id))).toBe(false);
    for (let k = 1; k <= T; k++) for (const kind of KINDS) advance(m, k, kind);
    const match = ok(m.h.service.readPublicMatch(m.id));
    expect(match.stage).toBe('finished');
    expect(match.matchSecret).toBe(SECRET_HEX);
    expect(match).toStrictEqual(m.h.service.publicMatch(m.id));
    m.h.close();
  });
});

describe('FR-281 (a) (d) paged lists', () => {
  it('FR-281 (d) FR-279 (keyset) the records come in round order, a page ends with a cursor exactly when more follow', () => {
    const m = start();
    for (let k = 1; k <= T; k++) for (const kind of KINDS) advance(m, k, kind);
    const first = ok(m.h.service.records(m.id, { limit: 3 }));
    expect(first.items.map((r) => r.round)).toStrictEqual([1, 2, 3]);
    expect(first.next).toBeDefined();
    const after = decodeCursor('records', first.next!);
    expect(after).toStrictEqual({ ok: true, value: [3] });
    if (!after.ok) throw new Error('cursor');
    expect(ok(m.h.service.records(m.id, { limit: 3, after: after.value }))).toStrictEqual({ items: [{ round: 4, eliminated: GOLD[3]!.victim, absorber: GOLD[3]!.absorber, transferred: GOLD[3]!.transferred }] });
    expect(ok(m.h.service.records(m.id, { limit: 4 })).next).toBeUndefined();
    expect(ok(m.h.service.records(m.id, { limit: 500 })).items.map((r) => r.eliminated)).toStrictEqual(GOLD.map((g) => g.victim));
    m.h.close();
  });

  it('FR-281 (d) FR-279 (keyset) paging the records by 1 while rounds are applied neither repeats nor skips one', () => {
    const m = start();
    for (let k = 1; k <= 2; k++) for (const kind of KINDS) advance(m, k, kind);
    let next = 3;
    const { items } = allPages('records', (after) => m.h.service.records(m.id, { limit: 1, ...(after === undefined ? {} : { after }) }), () => {
      if (next > T) return;
      for (const kind of KINDS) advance(m, next, kind);
      next += 1;
    });
    expect(items.map((r) => r.round)).toStrictEqual([1, 2, 3, 4]);
    m.h.close();
  });

  it('FR-281 (a) FR-279 (keyset) the match list is ordered by creation instant then match id; a match created between pages neither repeats nor skips one', () => {
    const h = serviceHarness({ secret: SECRET });
    const first = create(h, 'c-1');
    const ids = [first.id, create(h, 'c-2').id];
    h.clock.advance(5000);
    ids.push(create(h, 'c-3').id);
    h.clock.advance(5000);
    ids.push(create(h, 'c-4').id);
    const existing = ok(h.service.listMatches({ limit: 500 })).items;
    expect(existing).toHaveLength(4);
    const key = (s: MatchSummary): string => `${String(s.createdAt).padStart(15, '0')} ${s.matchId}`;
    expect(existing.map(key)).toStrictEqual(existing.map(key).sort());
    expect(new Set(existing.map((s) => s.matchId))).toStrictEqual(new Set(ids));
    const summary = existing.find((s) => s.matchId === ids[2])!;
    expect(summary).toStrictEqual({ matchId: ids[2], mapId: 'dev', stage: 'phase-1', appliedRounds: 0, totalRounds: T, createdAt: START_MS + 5000 });
    // The list carries no secret, host token or host-token digest.
    const listed = JSON.stringify(existing);
    for (const marker of [SECRET_HEX, first.hostToken, credentialDigest(first.hostToken)]) expect(listed).not.toContain(marker);
    let n = 5;
    const { items, pages } = allPages('matches', (after) => h.service.listMatches({ limit: 1, ...(after === undefined ? {} : { after }) }), () => {
      if (n > 7) return;
      h.clock.advance(1000);
      create(h, `c-${n}`);
      n += 1;
    });
    const seen = items.map((s) => s.matchId);
    expect(new Set(seen).size).toBe(seen.length);
    for (const s of existing) expect(seen.filter((id) => id === s.matchId), s.matchId).toHaveLength(1);
    expect(items.slice(0, 4)).toStrictEqual(existing);
    expect(pages).toBe(items.length);
    h.close();
  });
});

describe('FR-281 (h) FR-270 (read) own predictions, namespace-wide', () => {
  const page = (m: Started, namespace: string, extra: { playerId?: string; limit?: number; after?: CursorKey<'predictions'> } = {}): ReadOutcome<Page<OwnPrediction>> =>
    m.h.service.ownPredictionsPage({ namespace, matchId: m.id, limit: extra.limit ?? 100, ...extra });

  function predicted(): Started {
    const m = start();
    const [a, b, c] = living(m);
    submit(m, WEB, { kind: 'victim', round: 1, faction: a, playerId: 'p2' });
    submit(m, WEB, { kind: 'winner', faction: b, playerId: 'p1' });
    submit(m, WEB, { kind: 'victim', round: 1, faction: c, playerId: 'p1' });
    submit(m, WEB, { kind: 'victim', round: 1, faction: b, playerId: 'p1' });
    submit(m, BOT, { kind: 'victim', round: 1, faction: a, playerId: 'p1' });
    submit(m, BOT, { kind: 'winner', faction: c, playerId: 'zz' });
    return m;
  }

  it('FR-281 (h) FR-270 (read) a namespace reads every one of its own players, ordered by local id, round (winner 0) and kind, and no other namespace', () => {
    const m = predicted();
    const [a, b, c] = living(m);
    expect(ok(page(m, 'web'))).toStrictEqual({
      items: [
        { playerId: 'p1', kind: 'winner', choice: b, version: 1 },
        { playerId: 'p1', kind: 'victim', round: 1, choice: b, version: 2 },
        { playerId: 'p2', kind: 'victim', round: 1, choice: a, version: 1 },
      ],
    });
    expect(ok(page(m, 'bot'))).toStrictEqual({
      items: [
        { playerId: 'p1', kind: 'victim', round: 1, choice: a, version: 1 },
        { playerId: 'zz', kind: 'winner', choice: c, version: 1 },
      ],
    });
    for (const other of ['we', 'webx', 'discord', 'b']) expect(ok(page(m, other)), other).toStrictEqual({ items: [] });
    m.h.close();
  });

  it('FR-281 (h) FR-270 (read) an optional local id narrows the read to that player of the namespace only', () => {
    const m = predicted();
    expect(ok(page(m, 'web', { playerId: 'p2' })).items.map((p) => [p.playerId, p.kind])).toStrictEqual([['p2', 'victim']]);
    expect(ok(page(m, 'bot', { playerId: 'p1' })).items.map((p) => [p.playerId, p.kind])).toStrictEqual([['p1', 'victim']]);
    expect(ok(page(m, 'bot', { playerId: 'p2' }))).toStrictEqual({ items: [] });
    expect(ok(page(m, 'web', { playerId: 'P1' }))).toStrictEqual({ items: [] });
    m.h.close();
  });

  it('FR-281 (h) FR-279 (keyset) the own predictions are paged with the predictions cursor and the pages add up to the whole list', () => {
    const m = predicted();
    const whole = ok(page(m, 'web')).items;
    const { items, pages } = allPages('predictions', (after) => page(m, 'web', { limit: 1, ...(after === undefined ? {} : { after }) }));
    expect(items).toStrictEqual(whole);
    expect(pages).toBe(3);
    const two = ok(page(m, 'web', { limit: 2 }));
    expect(decodeCursor('predictions', two.next!)).toStrictEqual({ ok: true, value: ['p1', 1, 'victim'] });
    m.h.close();
  });

  it('FR-270 (read) a local id with a separator or outside its set is invalid-player-id, before the match is looked up', () => {
    const m = predicted();
    for (const playerId of ['bot:p1', 'web:p1', '', 'p 1', 'x'.repeat(65), '%']) {
      expect(refused(page(m, 'web', { playerId })), playerId).toStrictEqual(errorReply('invalid-player-id', ['playerId']));
      expect(refused(m.h.service.ownPredictionsPage({ namespace: 'web', matchId: 'nope', playerId, limit: 10 })), playerId).toStrictEqual(errorReply('invalid-player-id', ['playerId']));
    }
    // The namespace comes from the configured credential: one outside its set is a programming error of the caller.
    expect(() => page(m, 'Web')).toThrow(TypeError);
    m.h.close();
  });
});

describe('FR-300 (host-token check)', () => {
  it('FR-300 (host-token check) hostTokenMatches is true only for the host token of that match, by digest comparison', () => {
    const h = serviceHarness({ secret: SECRET });
    const a = create(h, 'c-1');
    const b = create(h, 'c-2');
    expect(ok(h.service.hostTokenMatches(a.id, a.hostToken))).toBe(true);
    expect(ok(h.service.hostTokenMatches(b.id, b.hostToken))).toBe(true);
    expect(ok(h.service.hostTokenMatches(a.id, b.hostToken))).toBe(false);
    expect(ok(h.service.hostTokenMatches(b.id, a.hostToken))).toBe(false);
    const flipped = (a.hostToken[0] === 'A' ? 'B' : 'A') + a.hostToken.slice(1);
    expect(ok(h.service.hostTokenMatches(a.id, flipped))).toBe(false);
    expect(ok(h.service.hostTokenMatches(a.id, OPERATOR))).toBe(false);
    expect(ok(h.service.hostTokenMatches(a.id, ''))).toBe(false);
    expect(ok(h.service.hostTokenMatches(a.id, undefined as unknown as string))).toBe(false);
    expect(ok(h.service.hostTokenMatches('nope', a.hostToken))).toBe(false);
    expect(ok(h.service.hostTokenMatches(42 as unknown as string, a.hostToken))).toBe(false);
    h.close();
  });
});

describe('FR-281 (j) the map files', () => {
  it('FR-281 (j) mapFile serves the stored bytes of the three files of a listed map, the size from the file, a stream per request', async () => {
    const h = serviceHarness();
    for (const name of MAP_FILE_NAMES) {
      const file = ok(h.service.mapFile('dev', name));
      const bytes = readFileSync(join(DEV_DIR, name));
      expect(file.size, name).toBe(statSync(join(DEV_DIR, name)).size);
      expect(file.size).toBe(bytes.length);
      const one = file.open();
      const two = file.open();
      expect(one).not.toBe(two);
      expect((await readStream(one)).equals(bytes), name).toBe(true);
      expect((await readStream(two)).equals(bytes), name).toBe(true);
    }
    h.close();
  });

  it('FR-281 (j) an unlisted map id is unknown-map and a name outside the three files is unknown-path', () => {
    const h = serviceHarness();
    for (const mapId of ['other', '__proto__', 'constructor', 'toString', '../dev', 'dev/', 'DEV', '', 7 as unknown as string]) {
      expect(refused(h.service.mapFile(mapId, 'map.json')), String(mapId)).toStrictEqual(errorReply('unknown-map'));
    }
    for (const name of ['MAP.JSON', 'map.json/', './map.json', '../map.json', 'map', 'other.json', '', 'ids.png\0', 3 as unknown as string]) {
      expect(refused(h.service.mapFile('dev', name)), String(name)).toStrictEqual(errorReply('unknown-path'));
    }
    h.close();
  });

  it('FR-281 (j) a file name can never leave the package folder', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      writeFileSync(join(dir, 'outside.txt'), 'not a map file');
      writeFileSync(join(folder, 'extra.txt'), 'not a map file');
      const h = serviceHarness({ folders: { pkg: folder } });
      for (const name of ['../outside.txt', '..\\outside.txt', 'extra.txt', join(dir, 'outside.txt'), '../pkg/map.json']) {
        expect(refused(h.service.mapFile('pkg', name)), name).toStrictEqual(errorReply('unknown-path'));
      }
      expect(ok(h.service.mapFile('pkg', 'map.json')).size).toBe(statSync(join(folder, 'map.json')).size);
      // The catalog itself joins only its fixed names: any other text is refused before a path is built.
      const catalog = createMapCatalog({ pkg: folder });
      for (const name of ['../outside.txt', 'extra.txt']) expect(() => catalog.file!('pkg', name as MapFileName), name).toThrow(RangeError);
      h.close();
    });
  });

  it('FR-281 (j) a listed package whose file cannot be read is unavailable', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', '{}');
      const h = serviceHarness({ folders: { pkg: folder, gone: join(dir, 'missing') } });
      expect(ok(h.service.mapFile('pkg', 'map.json')).size).toBe(2);
      expect(refused(h.service.mapFile('gone', 'map.json'))).toStrictEqual(errorReply('unavailable'));
      h.close();
    });
  });
});

describe('reads change nothing and report the time', () => {
  const everyRead = (service: MatchService, id: string, hostToken: string): void => {
    service.listMatches({ limit: 500 });
    service.readPublicMatch(id);
    service.publicMatch(id);
    for (const round of [0, 1, 2, 9]) {
      service.stateAt(id, round);
      service.recordAt(id, round);
    }
    service.records(id, { limit: 1 });
    service.ownPredictionsPage({ namespace: 'web', matchId: id, limit: 1 });
    service.ownPredictionsPage({ namespace: 'web', matchId: id, playerId: 'p1', limit: 500 });
    service.hostTokenMatches(id, hostToken);
    service.hostTokenMatches(id, OPERATOR);
    service.mapFile('dev', 'map.json');
  };

  it('FR-281 (a) (b) (c) (d) (h) (j) reads write nothing: the raw rows and the last step instant are unchanged', () => {
    withTempDir((dir) => {
      const file = join(dir, 'reads.sqlite');
      const m = start({ store: openStore(file) });
      for (const kind of KINDS) advance(m, 1, kind);
      submit(m, WEB, { kind: 'victim', round: 2, faction: living(m)[0], playerId: 'p1' });
      m.h.close();
      const before = withRawDb(file, dumpRows);
      const store = openStore(file);
      const lastStep = store.getMatch(m.id)!.match.lastStepMs;
      const h = serviceHarness({ store, secret: SECRET, start: START_MS + 3_600_000 });
      everyRead(h.service, m.id, m.hostToken);
      h.clock.set(START_MS - 1000);
      everyRead(h.service, m.id, m.hostToken);
      expect(store.getMatch(m.id)!.match.lastStepMs).toBe(lastStep);
      h.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
    });
  });

  it('FR-302 (reads) the state and public-data reads carry the reported time, never below an earlier one', () => {
    const m = start();
    const times = (): number[] => [ok(m.h.service.stateAt(m.id, 0)).reportedTime, ok(m.h.service.readPublicMatch(m.id)).reportedTime];
    expect(times()).toStrictEqual([START_MS, START_MS]);
    m.h.clock.advance(4321);
    expect(times()).toStrictEqual([START_MS + 4321, START_MS + 4321]);
    m.h.clock.set(START_MS - 60_000);
    expect(times()).toStrictEqual([START_MS + 4321, START_MS + 4321]);
    m.h.clock.set(START_MS + 9000);
    expect(ok(m.h.service.stateAt(m.id, 0)).reportedTime).toBe(START_MS + 9000);
    m.h.clock.set(START_MS + 5000);
    expect(ok(m.h.service.readPublicMatch(m.id)).reportedTime).toBe(START_MS + 9000);
    m.h.close();
  });
});

describe('FR-292 (reads) storage failures', () => {
  /** The store with every read failing as storage fails (the connection stays open for the cleanup). */
  const failingReads = (base: Store, error: () => Error): Store => {
    const fail = (): never => {
      throw error();
    };
    return { ...base, getMatch: fail, getState: fail, records: fail, recordsAfter: fail, listMatches: fail, predictionsInNamespace: fail, hostTokenDigest: fail, eventsAfter: fail };
  };

  it('FR-292 (reads) a storage failure of any read is unavailable', () => {
    const m = start();
    const service = createMatchService({ store: failingReads(m.h.store, () => new StoreError('store-failure', 'injected read failure')), clock: m.h.clock, maps: createMapCatalog(m.h.settings.maps), settings: m.h.settings });
    const unavailable = errorReply('unavailable');
    for (const out of matchReads(service, m.id)) expect(refused(out)).toStrictEqual(unavailable);
    expect(refused(service.listMatches({ limit: 10 }))).toStrictEqual(unavailable);
    expect(refused(service.recordAt(m.id, 1))).toStrictEqual(unavailable);
    expect(refused(service.hostTokenMatches(m.id, m.hostToken))).toStrictEqual(unavailable);
    // A closed connection is a storage failure too.
    const closed = serviceHarness({ store: openStore(':memory:') });
    closed.store.close();
    expect(refused(closed.service.listMatches({ limit: 10 }))).toStrictEqual(unavailable);
    expect(refused(closed.service.readPublicMatch(m.id))).toStrictEqual(unavailable);
    m.h.close();
  });

  it('FR-292 (reads) a programming error of a read is not hidden as unavailable', () => {
    const m = start();
    const service = createMatchService({ store: failingReads(m.h.store, () => new RangeError('inconsistent stored data')), clock: m.h.clock, maps: createMapCatalog(m.h.settings.maps), settings: m.h.settings });
    expect(() => service.stateAt(m.id, 0)).toThrow(RangeError);
    expect(() => service.listMatches({ limit: 10 })).toThrow(RangeError);
    // A page size outside 1 to 500 never comes from the protocol reader: a programming error of the caller.
    for (const limit of [0, 501, 1.5]) expect(() => m.h.service.listMatches({ limit })).toThrow(RangeError);
    m.h.close();
  });
});
