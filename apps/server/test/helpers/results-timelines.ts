import { readFileSync } from 'node:fs';
import { decodeCursor } from '@mbrg/protocol';
import type { CursorKey, LeaderboardRow, Page, PhaseResultsPage, PlayerResultsPage } from '@mbrg/protocol';
import { createMapCatalog } from '../../src/service/maps';
import { createMatchService } from '../../src/service/matches';
import type { MatchService, PageRequest, ReadOutcome } from '../../src/service/matches';
import { openStore } from '../../src/store/sqlite';
import { SECRETS } from './core-timelines';
import { OPERATOR, creationBody, serviceHarness } from './service-harness';

// The results golden timelines (spec 008 NFR-48 results, NFR-57 results, FR-294 results replay; M4' T5'): the fixed prediction
// set of golden/dev-results.json is sent at the same logical points (just before step s) in every timeline, and the match is
// driven to its end by different means; the results reads at the end must equal the golden in every one. This helper checks
// nothing itself.

export interface ResultsGolden {
  readonly predictions: readonly { before: number; playerId: string; kind: 'victim' | 'absorber' | 'winner'; round?: number; faction: number }[];
  readonly phaseResults: Readonly<Record<string, PhaseResultsPage>>;
  readonly players: Readonly<Record<string, PlayerResultsPage>>;
  readonly leaderboard: readonly LeaderboardRow[];
}

export const loadResultsGolden = (): Record<string, ResultsGolden> =>
  (JSON.parse(readFileSync(new URL('../golden/dev-results.json', import.meta.url), 'utf8')) as { secrets: Record<string, ResultsGolden> }).secrets;

const CREDENTIALS: Record<string, string> = { web: 'client-credential-web-0123456789ab', discord: 'client-credential-discord-0123456789' };
const STEP_KIND = ['phase-1-close', 'phase-2-close', 'application'] as const;
const S = 1000;

export type Mode = 'manual' | 'clock' | 'clock-l2-zero' | 'early-advance' | 'late';

const TIMING = { manual: 'manual', clock: { i: 120, l1: 30, l2: 10 }, 'clock-l2-zero': { i: 90, l1: 20, l2: 0 }, 'early-advance': { i: 120, l1: 30, l2: 10 }, late: { i: 120, l1: 30, l2: 10 } } as const;

export interface TimelineOptions {
  readonly mode: Mode;
  /** A database file: with `restart`, the server restarts on it after every step (new store and service, then `start()`). */
  readonly file?: string;
  readonly restart?: boolean;
}

/** What the results reads give at the end of a run, in the shape of the golden. */
export interface Snapshot {
  readonly phaseResults: Record<string, PhaseResultsPage>;
  readonly players: Record<string, PlayerResultsPage>;
  readonly leaderboard: LeaderboardRow[];
}

const ok = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};

/** Every page of a paged read with `limit`; the first page's own members plus all the items. */
function collect<T extends { items: readonly unknown[]; next?: string }, L extends 'phase-results' | 'player-results' | 'leaderboard'>(
  list: L,
  read: (request: PageRequest<L>) => ReadOutcome<T>,
  limit: number,
): { first: T; items: unknown[] } {
  const items: unknown[] = [];
  let first: T | undefined;
  let after: CursorKey<L> | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = ok(read({ limit, ...(after === undefined ? {} : { after }) }));
    first ??= page;
    items.push(...page.items);
    if (page.next === undefined) return { first, items };
    const decoded = decodeCursor(list, page.next);
    if (!decoded.ok) throw new Error('bad cursor');
    after = decoded.value;
  }
  throw new Error('paging did not end');
}

/** The reads of the golden, through the service, paged with `limit` (the pages are joined). */
export function snapshotOf(service: MatchService, matchId: string, playerIds: readonly string[], totalRounds: number, limit = 2): Snapshot {
  const phaseResults: Record<string, PhaseResultsPage> = {};
  for (let round = 1; round <= totalRounds; round += 1) {
    for (const phase of [1, 2] as const) {
      const { first, items } = collect('phase-results', (q) => service.phaseResults(matchId, round, phase, q), limit);
      const { next: _next, items: _items, ...meta } = first;
      phaseResults[`${round}/${phase}`] = { ...meta, items } as PhaseResultsPage;
    }
  }
  const players: Record<string, PlayerResultsPage> = {};
  for (const id of playerIds) {
    const { first, items } = collect('player-results', (q) => service.playerResults(matchId, id, q), limit);
    const { next: _next, items: _items, ...meta } = first;
    players[id] = { ...meta, items } as PlayerResultsPage;
  }
  const board = collect('leaderboard', (q) => service.leaderboard(matchId, q) as ReadOutcome<Page<LeaderboardRow>>, limit);
  return { phaseResults, players, leaderboard: board.items as LeaderboardRow[] };
}

/** Plays one dev secret's match with the golden's prediction set under `options`, and reads the results at the end. */
export function runResultsTimeline(secretName: string, golden: ResultsGolden, options: TimelineOptions): Snapshot {
  const timing = TIMING[options.mode];
  if (options.restart === true && options.file === undefined) throw new Error('a restart needs a database file');
  const h = serviceHarness({ secret: SECRETS[secretName as keyof typeof SECRETS], ...(options.file === undefined ? {} : { store: openStore(options.file) }) });
  const live: { service: MatchService } = { service: h.service };
  const restart = (): void => {
    live.service.close();
    live.service = createMatchService({ store: openStore(options.file!), clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings });
    live.service.start();
  };
  const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing }) });
  if (!created.ok) throw new Error(`creation failed: ${JSON.stringify(created.error)}`);
  const id = created.reply.matchId;
  const total = created.reply.match.totalRounds;

  const doneOf = (): number => {
    const shown = live.service.publicMatch(id)!;
    if (shown.stage === 'finished') return 3 * total;
    return 3 * shown.appliedRounds + (shown.stage === 'phase-1' ? 0 : shown.stage === 'phase-2' ? 1 : 2);
  };
  const submitWindow = (s: number): void => {
    for (const p of golden.predictions.filter((x) => x.before === s)) {
      const ns = p.playerId.slice(0, p.playerId.indexOf(':'));
      const local = p.playerId.slice(ns.length + 1);
      const out = live.service.submit({
        client: { credential: CREDENTIALS[ns]!, namespace: ns },
        matchId: id,
        body: { playerId: local, kind: p.kind, ...(p.round === undefined ? {} : { round: p.round }), faction: p.faction },
      });
      if (!out.ok) throw new Error(`submission refused before step ${s}: ${JSON.stringify(out.error)}`);
    }
  };

  for (let guard = 0; guard < 40 && doneOf() < 3 * total; guard += 1) {
    const s = doneOf();
    const j = s % 3;
    const shown = live.service.publicMatch(id)!;
    const anchor = shown.schedule === undefined ? undefined : [shown.schedule.c1, shown.schedule.c2, shown.schedule.a][j]!;
    if (options.mode === 'manual' || options.mode === 'early-advance') {
      submitWindow(s);
      const out = live.service.advance({ credential: OPERATOR, matchId: id, body: { round: shown.appliedRounds + 1, step: STEP_KIND[j]! } });
      if (!out.ok) throw new Error(`advance refused at step ${s}: ${JSON.stringify(out.error)}`);
    } else if (options.mode === 'late') {
      // Predictions one second before the anchor, then a jump far past it (an hour) and one overdue step; the next window is
      // before the next anchor again: a backward jump of the clock.
      h.clock.set(anchor! - S);
      submitWindow(s);
      h.clock.set(anchor! + 3600 * S);
      live.service.tick();
    } else {
      h.clock.set(anchor! - 1);
      submitWindow(s);
      h.clock.set(anchor!);
      live.service.tick();
    }
    if (doneOf() <= s) throw new Error(`no step was performed at step ${s}`);
    if (options.restart === true) restart();
  }
  if (doneOf() !== 3 * total) throw new Error('the match did not finish');

  const playerIds = Object.keys(golden.players);
  const snapshot = snapshotOf(live.service, id, playerIds, total);
  live.service.close();
  return snapshot;
}
