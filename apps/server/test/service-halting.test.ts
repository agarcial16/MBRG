import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { encodePublicMatch, errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { haltReasonOf } from '../src/core/steps';
import type { CoreMatch } from '../src/core/view';
import { createMatchService } from '../src/service/matches';
import type { AdvanceOutcome, MatchService, SubmitOutcome, TestSeedSource } from '../src/service/matches';
import type { MapCatalog } from '../src/service/maps';
import { openStore } from '../src/store/sqlite';
import { scanValues, withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { DEV_DIR, devMap } from './helpers/digests';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// Map check and halting through the lifecycle service (M2b' T2'): the shell gives the core no map (null) when the listed
// package is missing, fails validation or has another digest than the stored one, before every step (the check at server
// start comes with `start()` in T3'); the core then halts with `map-changed`, an engine `isolated-faction` answer halts
// with `isolated-faction` and a recomputed victim that differs from the stored one halts with `victim-mismatch`. A halted
// match keeps what it had and answers `match-halted`. The scoring part of FR-251 (c) is M4: here no result row exists and
// the stored predictions stay as they were. Fake clock and scheduler, in-memory SQLite, temporary folders for map packages
// and a temporary file database where the stored columns are scanned (NFR-52).

const S = 1000;
const C1 = START_MS + 80 * S;
const C2 = START_MS + 110 * S;
const A = START_MS + 120 * S;
const SECRET = SECRETS['ascending-00-1f'];
const SECRET_HEX = Buffer.from(SECRET).toString('hex');
const DEV_MAP_JSON = readFileSync(join(DEV_DIR, 'map.json'), 'utf8');
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };

interface Started {
  readonly h: Harness;
  readonly id: string;
  readonly hostToken: string;
  /** Every publication, in order. */
  readonly published: MatchEvent[];
}

function start(options: HarnessOptions & { mapId?: string } = {}): Started {
  const h = serviceHarness({ secret: SECRET, ...options });
  const published: MatchEvent[] = [];
  h.service.subscribe((_, events) => published.push(...events));
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { mapId: options.mapId ?? 'dev' }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId, hostToken: out.reply.hostToken, published };
}

/** A second service over the same store and clock with another map catalog (the map list changed, as at a restart). */
const withCatalog = (m: Started, maps: MapCatalog): MatchService => createMatchService({ store: m.h.store, clock: m.h.clock, maps, settings: m.h.settings });

const advanceWith = (service: MatchService, m: Started, round: number, step: StepKind, credential: string = OPERATOR, extra: Record<string, unknown> = {}): AdvanceOutcome =>
  service.advance({ credential, matchId: m.id, body: { round, step, ...extra } });
const advance = (m: Started, round: number, step: StepKind, credential: string = OPERATOR, extra: Record<string, unknown> = {}): AdvanceOutcome =>
  advanceWith(m.h.service, m, round, step, credential, extra);
const submit = (m: Started, body: Record<string, unknown>): SubmitOutcome => m.h.service.submit({ client: WEB, matchId: m.id, body });
const view = (m: Started): CoreMatch => m.h.store.getMatch(m.id)!.match;
const living = (m: Started): number[] => [...new Set(view(m).state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const lastEvent = (m: Started): MatchEvent => {
  const events = m.h.store.eventsAfter(m.id, 0);
  return events[events.length - 1]!;
};
const halted = { ok: false, error: errorReply('match-halted') };

/** Asserts the stored halt of FR-251 (a): stage, reason, no schedule, one `match-halted` event (round, reason), stored and published. */
function expectHalted(m: Started, reason: string, round = 1): void {
  const v = view(m);
  expect(v.stage).toBe('halted');
  expect(v.haltReason).toBe(reason);
  expect(v.anchors).toBeNull();
  const event = lastEvent(m);
  expect(event).toMatchObject({ type: 'match-halted', round, reason });
  expect(m.published.filter((e) => e.type === 'match-halted')).toStrictEqual([event]);
  const pub = m.h.service.publicMatch(m.id)!;
  expect(pub.stage).toBe('halted');
  expect(pub.haltReason).toBe(reason);
  expect(pub.schedule).toBeUndefined();
  expect(pub).not.toHaveProperty('matchSecret');
  expect(() => encodePublicMatch(pub)).not.toThrow();
}

/** A catalog that always answers `loaded` for the id `dev` (a package as the shell would read it). */
const fixedCatalog = (loaded: { map: unknown; digest: string }): MapCatalog => ({ ids: () => ['dev'], load: (id) => (id === 'dev' ? loaded : undefined) });

describe('FR-250 the map check before every step', () => {
  it('FR-250 FR-241 map check before the step: a deleted package file halts the match with map-changed at the phase-1 close, with no step row', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder }, scheduler: true });
      rmSync(join(folder, 'map.json'));
      expect(advance(m, 1, 'phase-1-close')).toStrictEqual(halted);
      expectHalted(m, 'map-changed');
      expect(m.h.store.steps(m.id)).toStrictEqual([]);
      expect(view(m).victim).toBeUndefined();
      expect(view(m).appliedRounds).toBe(0);
      expect(m.h.scheduler!.pending()).toStrictEqual([]);
      m.h.close();
    });
  });

  it('FR-250 FR-241 map check before the step: a package with another digest than the stored one halts at the clock phase-1 close although its map.json still validates', () => {
    withTempDir((dir) => {
      const same = writeMapPackage(dir, 'same', DEV_MAP_JSON);
      const edited = writeMapPackage(dir, 'edited', DEV_MAP_JSON);
      const folders = { dev: same, other: edited };
      const kept = start({ folders, scheduler: true });
      const out = kept.h.service.create({ credential: OPERATOR, body: creationBody('c-2', { mapId: 'other' }) });
      if (!out.ok) throw new Error('creation failed');
      const changed: Started = { ...kept, id: out.reply.matchId };
      expect(view(changed).mapDigest).toBe(view(kept).mapDigest);
      // Only presentation.json changes: map.json is the same text and still validates, but the package digest differs.
      appendFileSync(join(edited, 'presentation.json'), '\n');
      kept.h.scheduler!.runTo(C1);
      expect(view(kept).stage).toBe('phase-2');
      expect(view(changed).stage).toBe('halted');
      expect(view(changed).haltReason).toBe('map-changed');
      expect(kept.h.store.steps(changed.id)).toStrictEqual([]);
      expect(lastEvent(changed)).toMatchObject({ type: 'match-halted', round: 1, reason: 'map-changed' });
      kept.h.close();
    });
  });

  it('FR-250 a map id that is no longer listed gives the core no map: the next step halts with map-changed', () => {
    const m = start();
    const service = withCatalog(m, { ids: () => [], load: () => undefined });
    expect(advanceWith(service, m, 1, 'phase-1-close')).toStrictEqual(halted);
    expect(view(m).stage).toBe('halted');
    expect(view(m).haltReason).toBe('map-changed');
    expect(m.h.store.steps(m.id)).toStrictEqual([]);
    m.h.close();
  });

  it('FR-250 a listed package that fails validation halts with map-changed even when it reports the stored digest', () => {
    const m = start();
    const service = withCatalog(m, fixedCatalog({ map: { territories: [] }, digest: view(m).mapDigest }));
    expect(advanceWith(service, m, 1, 'phase-1-close')).toStrictEqual(halted);
    expect(view(m).haltReason).toBe('map-changed');
    m.h.close();
  });

  it('FR-250 the shell compares the whole stored digest: a package with the same map and a one-character digest difference halts', () => {
    const m = start();
    const stored = view(m).mapDigest;
    const other = `${stored.slice(0, -1)}${stored.endsWith('0') ? '1' : '0'}`;
    const service = withCatalog(m, fixedCatalog({ map: devMap(), digest: other }));
    expect(advanceWith(service, m, 1, 'phase-1-close')).toStrictEqual(halted);
    expect(view(m).haltReason).toBe('map-changed');
    // The same map with the stored digest steps normally.
    const m2 = start();
    const ok = withCatalog(m2, fixedCatalog({ map: devMap(), digest: view(m2).mapDigest }));
    expect(advanceWith(ok, m2, 1, 'phase-1-close').ok).toBe(true);
    expect(view(m2).stage).toBe('phase-2');
    m.h.close();
    m2.h.close();
  });

  it('FR-250 isolated-faction is unreachable on a valid map: a map with an unreachable faction fails validation first and halts as map-changed, while the engine answer maps to isolated-faction', () => {
    const lonely = { territories: [{ id: 1, owner: 1, neighbors: [2] }, { id: 2, owner: 2, neighbors: [1] }, { id: 3, owner: 3, neighbors: [] }] };
    const m = start();
    const service = withCatalog(m, fixedCatalog({ map: lonely, digest: view(m).mapDigest }));
    expect(advanceWith(service, m, 1, 'phase-1-close')).toStrictEqual(halted);
    expect(view(m).haltReason).toBe('map-changed');
    // The reason the shell stores for an engine isolated-faction answer at a phase-1 close (FR-250).
    expect(haltReasonOf([{ kind: 'isolated-faction', faction: 3, round: 1 }])).toBe('isolated-faction');
    m.h.close();
  });

  it('FR-243 FR-241 map check before the step: a package changed while locked halts the application at A with map-changed, keeps the revealed victim fields and writes no record', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder }, scheduler: true });
      m.h.scheduler!.runTo(C2);
      expect(view(m).stage).toBe('locked');
      const revealed = view(m).victim!;
      appendFileSync(join(folder, 'ids.png'), Buffer.from([0]));
      m.h.scheduler!.runTo(A + 5 * S);
      expectHalted(m, 'map-changed');
      expect(m.h.store.records(m.id)).toStrictEqual([]);
      expect(view(m).appliedRounds).toBe(0);
      expect(m.h.store.steps(m.id).map((s) => s.kind)).toStrictEqual(['phase-1-close', 'phase-2-close']);
      // FR-251 (e): the FR-288 fields of the revealed victim stay in the stored view and the public data.
      expect(view(m).victim).toStrictEqual(revealed);
      expect(m.h.service.publicMatch(m.id)!.victim).toStrictEqual(revealed);
      m.h.close();
    });
  });
});

/** A test seed source whose first draw of each round differs from the later ones: the application recomputes another victim. */
function flippingSource(): { source: TestSeedSource; set(first: number, later: number): void } {
  const seeds = { first: 0, later: 0 };
  const calls = new Map<number, number>();
  const source: TestSeedSource = () => (k) => {
    const n = calls.get(k) ?? 0;
    calls.set(k, n + 1);
    return n === 0 ? seeds.first : seeds.later;
  };
  return { source, set: (first, later) => Object.assign(seeds, { first, later }) };
}

/** Two seeds whose round-1 victims differ on the dev map from `state`. */
function differingSeeds(state: MatchState): [number, number] {
  const victimOf = (seed: number): number => {
    const r = playRoundWithSeed(devMap(), state, seed);
    if (!r.ok) throw new Error('the round cannot be played');
    return r.value.record.eliminated;
  };
  const first = 7;
  for (let s = 8; s < 1000; s++) if (victimOf(s) !== victimOf(first)) return [first, s];
  throw new Error('no differing seed');
}

describe('FR-251 a halted match', () => {
  it('FR-243 FR-251 halt with victim-mismatch: a forced victim difference halts the application, keeps the victim fields and the stored predictions, and keeps the victim result row and writes no record, absorber or winner row', () => {
    withTempDir((dir) => {
      const file = join(dir, 'halt.sqlite');
      const flip = flippingSource();
      const m = start({ store: openStore(file), testSeedSource: flip.source });
      const state0 = m.h.store.getState(m.id, 0)!.state as MatchState;
      const [first, later] = differingSeeds(state0);
      flip.set(first, later);
      const [a, b] = living(m);
      expect(submit(m, { kind: 'victim', round: 1, faction: a, playerId: 'p1' }).ok).toBe(true);
      expect(submit(m, { kind: 'winner', faction: b, playerId: 'p1' }).ok).toBe(true);
      expect(advance(m, 1, 'phase-1-close').ok).toBe(true);
      const revealed = view(m).victim!;
      const absorber = revealed.candidates[0]!;
      expect(submit(m, { kind: 'absorber', round: 1, faction: absorber, playerId: 'p1' }).ok).toBe(true);
      expect(advance(m, 1, 'phase-2-close').ok).toBe(true);
      const before = m.h.store.predictionsOf(m.id, 'web:p1');
      expect(before.map((p) => p.kind).sort()).toStrictEqual(['absorber', 'victim', 'winner']);
      expect(advance(m, 1, 'application')).toStrictEqual(halted);
      expectHalted(m, 'victim-mismatch');
      expect(m.h.store.records(m.id)).toStrictEqual([]);
      expect(view(m).appliedRounds).toBe(0);
      expect(view(m).state).toStrictEqual(m.h.store.getState(m.id, 0)!.state);
      expect(m.h.store.steps(m.id).map((s) => s.kind)).toStrictEqual(['phase-1-close', 'phase-2-close']);
      expect(view(m).victim).toStrictEqual(revealed);
      expect(m.h.service.publicMatch(m.id)!.victim).toStrictEqual(revealed);
      // FR-251 (c): the stored predictions stay as they were; the victim phase was scored at the phase-1 close and keeps its row.
      expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual(before);
      m.h.close();
      withRawDb(file, (db) => {
        const rows = db.prepare('SELECT round, kind, player_id, choice, correct, points FROM results ORDER BY rowid').all().map((r) => ({ ...r }));
        expect(rows).toStrictEqual([{ round: 1, kind: 'victim', player_id: 'web:p1', choice: a, correct: revealed.victim === a ? 1 : 0, points: revealed.victim === a ? revealed.living.length : 0 }]);
        expect(db.prepare('SELECT COUNT(*) AS n FROM records').get()!.n).toBe(0);
      });
    });
  });

  it('FR-251 FR-245 match-halted on a halted match: no further step by advance or clock, every advance answers match-halted and nothing changes', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder }, scheduler: true });
      rmSync(join(folder, 'map.json'));
      m.h.scheduler!.runTo(C1);
      expectHalted(m, 'map-changed');
      // The package comes back unchanged (same digest): a halted match still never steps again.
      appendFileSync(join(folder, 'map.json'), DEV_MAP_JSON);
      const frozen = view(m);
      const events = m.h.store.eventsAfter(m.id, 0).length;
      for (const credential of [OPERATOR, m.hostToken]) {
        for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) {
          expect(advance(m, 1, kind, credential)).toStrictEqual(halted);
          expect(advance(m, 2, kind, credential)).toStrictEqual(halted);
        }
      }
      expect(advance(m, 1, 'phase-1-close', OPERATOR, { requestId: 'adv-1' })).toStrictEqual(halted);
      expect(advance(m, 1, 'phase-1-close', OPERATOR, { requestId: 'adv-1' })).toStrictEqual(halted);
      expect(advance(m, 1, 'phase-1-close', 'not-a-credential')).toStrictEqual({ ok: false, error: errorReply('forbidden') });
      m.h.clock.set(START_MS + 10 * 120 * S);
      expect(m.h.service.tick().performed).toStrictEqual([]);
      expect(m.h.scheduler!.runTo(START_MS + 20 * 120 * S)).toBe(0);
      expect(m.h.scheduler!.pending()).toStrictEqual([]);
      expect(view(m)).toStrictEqual(frozen);
      expect(m.h.store.steps(m.id)).toStrictEqual([]);
      expect(m.h.store.eventsAfter(m.id, 0)).toHaveLength(events);
      expect(m.h.store.runningMatchIds()).not.toContain(m.id);
      m.h.close();
    });
  });

  it('FR-251 FR-266 match-halted to a submission: every kind of prediction is refused with match-halted and nothing is stored', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder } });
      const [a] = living(m);
      expect(submit(m, { kind: 'victim', round: 1, faction: a, playerId: 'p1' }).ok).toBe(true);
      const before = m.h.store.predictionsOf(m.id, 'web:p1');
      rmSync(join(folder, 'map.json'));
      expect(advance(m, 1, 'phase-1-close')).toStrictEqual(halted);
      for (const body of [
        { kind: 'victim', round: 1, faction: living(m)[1], playerId: 'p1' },
        { kind: 'victim', round: 1, faction: a, playerId: 'p2' },
        { kind: 'absorber', round: 1, faction: a, playerId: 'p1' },
        { kind: 'winner', faction: a, playerId: 'p1' },
        { kind: 'victim', round: 2, faction: a, playerId: 'p1', requestId: 'sub-1' },
      ]) {
        expect(submit(m, body)).toStrictEqual(halted);
      }
      expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual(before);
      expect(m.h.store.predictionsOf(m.id, 'web:p2')).toStrictEqual([]);
      m.h.close();
    });
  });

  it('FR-251 FR-259 secret never revealed when halted: no reply, event, public data or stored column other than matches.secret holds it', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const file = join(dir, 'secret.sqlite');
      const m = start({ folders: { dev: folder }, store: openStore(file) });
      const texts: string[] = [];
      expect(advance(m, 1, 'phase-1-close').ok).toBe(true);
      rmSync(join(folder, 'map.json'));
      const out = advance(m, 1, 'phase-2-close');
      expect(out).toStrictEqual(halted);
      texts.push(JSON.stringify(out));
      texts.push(JSON.stringify(advance(m, 1, 'application')));
      texts.push(JSON.stringify(submit(m, { kind: 'absorber', round: 1, faction: 1, playerId: 'p1' })));
      texts.push(JSON.stringify(m.h.service.publicMatch(m.id)));
      texts.push(JSON.stringify(m.published));
      texts.push(JSON.stringify(m.h.store.eventsAfter(m.id, 0)));
      expectHalted(m, 'map-changed');
      for (const text of texts) expect(text).not.toContain(SECRET_HEX);
      expect(m.published.some((e) => 'matchSecret' in e)).toBe(false);
      m.h.close();
      withRawDb(file, (db) => {
        expect(scanValues(db, [SECRET_HEX, SECRET_HEX.toUpperCase()])).toStrictEqual([]);
        expect(scanValues(db, [SECRET], ['matches.secret'])).toStrictEqual([]);
      });
    });
  });

  it('FR-251 a halted match does not count toward the running-match limit', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder }, limit: 1 });
      const refused = m.h.service.create({ credential: OPERATOR, body: creationBody('c-2') });
      expect(refused).toStrictEqual({ ok: false, error: errorReply('too-many-matches') });
      rmSync(join(folder, 'map.json'));
      expect(advance(m, 1, 'phase-1-close')).toStrictEqual(halted);
      expect(m.h.store.runningCount()).toBe(0);
      appendFileSync(join(folder, 'map.json'), DEV_MAP_JSON);
      const second = m.h.service.create({ credential: OPERATOR, body: creationBody('c-3') });
      expect(second.ok).toBe(true);
      expect(m.h.store.runningCount()).toBe(1);
      m.h.close();
    });
  });

  it('FR-251 a halt published by the clock is stored before its publication and the clock timing of the other match goes on', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', DEV_MAP_JSON);
      const m = start({ folders: { dev: folder, plain: DEV_DIR.replace(/[\\/]$/, '') }, scheduler: true });
      const out = m.h.service.create({ credential: OPERATOR, body: creationBody('c-2', { mapId: 'plain', timing: { ...CLOCK_TIMING } }) });
      if (!out.ok) throw new Error('creation failed');
      const seenStage: string[] = [];
      m.h.service.subscribe((id, events) => {
        if (id === m.id && events.some((e) => e.type === 'match-halted')) seenStage.push(m.h.store.getMatch(id)!.match.stage);
      });
      rmSync(join(folder, 'map.json'));
      m.h.scheduler!.runTo(C1);
      expect(seenStage).toStrictEqual(['halted']);
      expect(m.h.store.getMatch(out.reply.matchId)!.match.stage).toBe('phase-2');
      m.h.close();
    });
  });
});
