import { createHash } from 'node:crypto';
import { encodePublicMatch, playerIdOf } from '@mbrg/protocol';
import type { MatchEvent, PublicMatch } from '@mbrg/protocol';
import type { StoredPrediction } from '../../src/core/predictions';
import { effectiveInstant } from '../../src/core/time';
import type { CoreMatch } from '../../src/core/view';
import { createMapCatalog } from '../../src/service/maps';
import { createMatchService } from '../../src/service/matches';
import type { MatchService, StartReport } from '../../src/service/matches';
import { openStore } from '../../src/store/sqlite';
import type { Store, StoredRecord, StoredStep } from '../../src/store/store';
import type { ActionSummary, CreationSummary, Scenario } from './core-timelines';
import { SECRETS, T0 } from './core-timelines';
import { OPERATOR, creationBody, serviceHarness } from './service-harness';

// The six scripted dev-map matches of the core goldens (helpers/core-timelines.ts: actions and hand-derived
// expectations), driven through the lifecycle SERVICE (spec 008 NFR-48 lifecycle goldens, FR-294, FR-315 restart after
// every step; M2b' T4'). The service runs on the store, the fake clock and the fake random source of the harness; ticks are
// `tick()` calls, manual actions are operator advances. With a database FILE the run can restart the server:
// - `after-every-action`: after every action the service and the store are closed, a new store and a new service are
//   opened on the same file, and `start()` runs (map check, late rule, arming) at the same clock reading;
// - `ticks-by-start`: every tick action is performed by `start()` of a freshly restarted service instead of `tick()`.
// This helper checks nothing itself: the tests compare its summaries with the hand-derived expectations and the goldens.

const sha = (text: string): string => createHash('sha256').update(text, 'ascii').digest('hex');

export type Restarts = 'none' | 'after-every-action' | 'ticks-by-start';

export interface ServiceRunOptions {
  /** A database file (the store is reopened on it at every restart); omitted: an in-memory database (no restart). */
  readonly file?: string;
  readonly restarts?: Restarts;
  /** Before every action, submit the open predictions of one player (victim, absorber, winner) at the current clock reading. */
  readonly predict?: boolean;
}

/** A core summary plus the sequence numbers of the events the action stored. */
export interface ServiceActionSummary extends ActionSummary {
  seqs: number[];
}

export interface ServiceCreationSummary extends CreationSummary {
  seqs: number[];
}

/** What the database holds at the end of a run, read through the store and the service. */
export interface FinalData {
  stateDigests: string[];
  records: StoredRecord[];
  steps: StoredStep[];
  events: MatchEvent[];
  predictions: StoredPrediction[];
  publicMatch: PublicMatch;
}

export interface ServiceRun {
  matchId: string;
  creation: ServiceCreationSummary;
  summaries: ServiceActionSummary[];
  /** Whether each action performed a step (parallel to `summaries`). */
  performed: boolean[];
  /** The report of every `start()` of a restarted service, in order. */
  starts: StartReport[];
  final: FinalData;
}

export const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;
export const PLAYER = 'p1';

const recordDigest = (r: StoredRecord): string => sha(`${r.round}:${r.eliminated}:${r.absorber}:${r.transferred.join(',')}`);

/** The predictions of one player that are open in the stored stage (rejections are part of the run, nothing is assumed). */
function submitOpen(service: MatchService, view: CoreMatch, matchId: string, n: number): void {
  const living = [...new Set(view.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
  const round = view.appliedRounds + 1;
  const bodies: Record<string, unknown>[] = [];
  if (view.stage === 'phase-1') {
    bodies.push({ kind: 'victim', round, faction: living[n % living.length], playerId: PLAYER, requestId: `v-${n}` });
    bodies.push({ kind: 'winner', faction: living[(n + 1) % living.length], playerId: PLAYER, requestId: `w-${n}` });
  }
  if (view.stage === 'phase-2' && view.victim !== undefined) {
    const candidates = view.victim.candidates;
    bodies.push({ kind: 'absorber', round, faction: candidates[n % candidates.length], playerId: PLAYER, requestId: `a-${n}` });
  }
  for (const body of bodies) service.submit({ client: { ...CLIENT }, matchId, body });
}

/** Runs a scenario through the service. Restarts need a database file. */
export function runServiceScenario(s: Scenario, options: ServiceRunOptions = {}): ServiceRun {
  const restarts = options.restarts ?? 'none';
  if (restarts !== 'none' && options.file === undefined) throw new Error('a restart needs a database file');
  const h = serviceHarness({ secret: SECRETS[s.secret], ...(options.file === undefined ? {} : { store: openStore(options.file) }) });
  const live: { store: Store; service: MatchService } = { store: h.store, service: h.service };
  const starts: StartReport[] = [];
  /** Stops the server (service and store closed) and starts a new one on the same file; returns its start report. */
  const restart = (): StartReport => {
    live.service.close();
    live.store = openStore(options.file!);
    live.service = createMatchService({ store: live.store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings });
    const report = live.service.start();
    starts.push(report);
    return report;
  };

  const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: s.timing }) });
  if (!created.ok) throw new Error(`creation failed: ${JSON.stringify(created.error)}`);
  const id = created.reply.matchId;
  const first = live.store.eventsAfter(id, 0);
  const creation: ServiceCreationSummary = {
    events: first.map((e) => e.type),
    seqs: first.map((e) => e.seq),
    lastSeq: created.reply.match.lastSeq,
    publicDigest: sha(encodePublicMatch(created.reply.match)),
  };

  const summaries: ServiceActionSummary[] = [];
  const performed: boolean[] = [];
  s.actions.forEach((a, n) => {
    if (options.predict === true) submitOpen(live.service, live.store.getMatch(id)!.match, id, n);
    h.clock.set(T0 + a.at);
    const before = live.store.getMatch(id)!.match;
    const effective = effectiveInstant(h.clock.now(), before.lastStepMs);
    const rowsBefore = live.store.steps(id).length;
    const recordsBefore = live.store.records(id).length;
    if (a.act === 'tick') {
      if (restarts === 'ticks-by-start') restart();
      else live.service.tick();
    } else {
      const out = live.service.advance({ credential: OPERATOR, matchId: id, body: { round: a.expect?.rows[0]?.[0] ?? before.appliedRounds + 1, step: a.act } });
      if (!out.ok) throw new Error(`advance refused at action ${n}: ${JSON.stringify(out.error)}`);
    }
    const added = live.store.steps(id).slice(rowsBefore);
    const events = live.store.eventsAfter(id, before.lastSeq);
    const view = live.store.getMatch(id)!.match;
    const records = live.store.records(id);
    const shown = live.service.publicMatch(id)!;
    performed.push(added.length > 0);
    summaries.push({
      at: a.at,
      act: a.act,
      effective,
      reported: shown.reportedTime,
      rows: added.map((r) => [r.round, r.kind, r.instant, r.cause]),
      events: events.map((e) => e.type),
      seqs: events.map((e) => e.seq),
      stage: view.stage,
      appliedRounds: view.appliedRounds,
      anchors: view.anchors === null ? null : [view.anchors.c1, view.anchors.c2, view.anchors.a],
      victim: view.victim === undefined ? null : view.victim.victim,
      recordDigest: records.length > recordsBefore ? recordDigest(records[records.length - 1]!) : null,
      publicDigest: sha(encodePublicMatch(shown)),
    });
    if (restarts === 'after-every-action') restart();
  });

  const view = live.store.getMatch(id)!.match;
  const final: FinalData = {
    stateDigests: Array.from({ length: view.appliedRounds + 1 }, (_, k) => live.store.getState(id, k)!.stateDigest),
    records: live.store.records(id),
    steps: live.store.steps(id),
    events: live.store.eventsAfter(id, 0),
    predictions: live.store.predictionsOf(id, playerIdOf(CLIENT.namespace, PLAYER)),
    publicMatch: live.service.publicMatch(id)!,
  };
  live.service.close();
  return { matchId: id, creation, summaries, performed, starts, final };
}
