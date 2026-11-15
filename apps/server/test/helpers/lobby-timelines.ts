import { readFileSync } from 'node:fs';
import { decodeCursor } from '@mbrg/protocol';
import type { CursorKey, MatchEvent, PhaseWinnersPage } from '@mbrg/protocol';
import { credentialDigest } from '../../src/service/ids';
import { createMapCatalog } from '../../src/service/maps';
import { createMatchService } from '../../src/service/matches';
import type { MatchService, PageRequest, PlayerCaller, ReadOutcome } from '../../src/service/matches';
import { openStore } from '../../src/store/sqlite';
import { SECRETS } from './core-timelines';
import { fakeRandom } from './fake-random';
import { snapshotOf } from './results-timelines';
import { OPERATOR, START_MS, creationBody, serviceHarness } from './service-harness';

// The lobby golden timelines (spec 011 FR-390, FR-392): the scripted lobby of golden/dev-lobby.json is driven through the
// service in several ways (a public lobby ticked on time or long after the anchors, an operator match with manual advances;
// in memory, or on a file with a restart after every join and every step), and everything the spec makes readable is read at
// the end and written in the shape of the golden. The ids of players are random: the golden keys a joined player by its name
// and a client player by its namespaced id, so this helper maps every id to that key. This helper checks nothing itself; it
// reports in `order` whether each read came in the order its rule fixes (player id ascending; total descending then id).

export interface GoldenPlayer {
  readonly sent: string;
  readonly name: string;
  readonly joinStep: number;
}
export interface GoldenPrediction {
  readonly before: number;
  readonly who: string;
  readonly kind: 'victim' | 'absorber' | 'winner';
  readonly round?: number;
  readonly faction: number;
}
export interface GoldenItem {
  readonly who: string;
  readonly name?: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}
export interface GoldenPhase {
  readonly round: number;
  readonly phase: 1 | 2;
  readonly victim?: number;
  readonly record?: { round: number; eliminated: number; absorber: number; transferred: number[] };
  readonly items: GoldenItem[];
}
export interface GoldenPlayerResults {
  readonly who: string;
  readonly name?: string;
  readonly total: number;
  readonly items: { kind: string; round?: number; choice: number; correct: boolean; points: number }[];
}
export interface GoldenRow {
  readonly rank: number;
  readonly who: string;
  readonly name?: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: number;
}
export interface GoldenEvent {
  readonly seq: number;
  readonly type: string;
  readonly [member: string]: string | number | boolean;
}
export interface GoldenView {
  readonly label: string;
  readonly stage: string;
  readonly appliedRounds: number;
  readonly playerCount: number | null;
  readonly lastSeq: number;
}
/** What the reads give at the end, in the shape of the golden (the same for the golden of a secret). */
export interface Observed {
  readonly lobbyEvents: GoldenEvent[];
  readonly lobbyViews: GoldenView[];
  readonly phaseResults: Record<string, GoldenPhase>;
  readonly winners: Record<string, string[]>;
  readonly players: Record<string, GoldenPlayerResults>;
  readonly leaderboard: GoldenRow[];
}
export interface LobbyGolden extends Observed {
  readonly roster: GoldenPlayer[];
  readonly clients: string[];
  readonly predictions: GoldenPrediction[];
  readonly operatorEvents: GoldenEvent[];
  readonly operatorViews: GoldenView[];
}

export const loadLobbyGolden = (): Record<string, LobbyGolden> =>
  (JSON.parse(readFileSync(new URL('../golden/dev-lobby.json', import.meta.url), 'utf8')) as { secrets: Record<string, LobbyGolden> }).secrets;

export type Flow = 'lobby-clock' | 'lobby-late' | 'operator-manual';
export interface LobbyOptions {
  readonly flow: Flow;
  /** A database file: with `restart`, the server restarts on it after every join and every step. */
  readonly file?: string;
  readonly restart?: boolean;
  /** Called with the database file while the store is closed after a restart point (a raw scan of the rows); `label` numbers the points. */
  readonly whileClosed?: (file: string, label: string) => void;
}
export interface LobbyRun {
  readonly observed: Observed;
  /** The events and views in the shape of the golden's operator lists when the flow is the operator's. */
  readonly operator: boolean;
  readonly order: { readonly phaseItems: boolean; readonly winners: boolean; readonly leaderboard: boolean; readonly players: boolean };
  /** The joined players' tokens, by name (to scan outputs; tests only). */
  readonly tokens: ReadonlyMap<string, string>;
  /** Reads of a restarted server still resolve every token to its player. */
  readonly tokensResolve: boolean;
  readonly matchId: string;
}

const CREDENTIALS: Record<string, { credential: string; namespace: string }> = {
  web: { credential: 'client-credential-web-0123456789ab', namespace: 'web' },
  discord: { credential: 'client-credential-discord-0123456789', namespace: 'discord' },
};
const STEP_KIND = ['phase-1-close', 'phase-2-close', 'application'] as const;
const S = 1000;
const CLOCK = { i: 120, l1: 30, l2: 10 } as const;

const must = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};

/** Every page of the winners read with `limit`. */
function winnersOf(service: MatchService, id: string, round: number, phase: 1 | 2, limit: number): { items: { playerId: string; name: string }[]; pages: number } {
  const items: { playerId: string; name: string }[] = [];
  let after: CursorKey<'phase-winners'> | undefined;
  for (let pages = 1; pages < 100; pages += 1) {
    const request: PageRequest<'phase-winners'> = { limit, ...(after === undefined ? {} : { after }) };
    const page: PhaseWinnersPage = must(service.phaseWinners(id, round, phase, request));
    items.push(...page.items);
    if (page.next === undefined) return { items, pages };
    const decoded = decodeCursor('phase-winners', page.next);
    if (!decoded.ok) throw new Error('bad cursor');
    after = decoded.value;
  }
  throw new Error('paging did not end');
}

const eventOf = (e: MatchEvent, whoOf: (id: string) => string): GoldenEvent => {
  switch (e.type) {
    case 'schedule':
      return { seq: e.seq, type: e.type, stage: e.stage };
    case 'player-joined':
      return { seq: e.seq, type: e.type, name: whoOf(e.playerId) };
    case 'phase-closed':
      return { seq: e.seq, type: e.type, round: e.round, phase: e.phase };
    case 'victim-revealed':
      return { seq: e.seq, type: e.type, round: e.round, victim: e.victim, ...(e.forced === true ? { forced: true } : {}) };
    case 'results':
      return { seq: e.seq, type: e.type, round: e.round, phase: e.phase };
    case 'round-applied':
      return { seq: e.seq, type: e.type, round: e.round, eliminated: e.record.eliminated, absorber: e.record.absorber };
    case 'match-finished':
      return { seq: e.seq, type: e.type, winner: e.winner };
    case 'match-halted':
      return { seq: e.seq, type: e.type, round: e.round };
  }
};

const isSorted = (ids: readonly string[]): boolean => ids.every((id, i) => i === 0 || ids[i - 1]! < id);

/** Plays one dev secret's scripted lobby under `options` and reads everything the golden holds. */
export function runLobbyTimeline(secretName: string, golden: LobbyGolden, options: LobbyOptions): LobbyRun {
  const operator = options.flow === 'operator-manual';
  if (options.restart === true && options.file === undefined) throw new Error('a restart needs a database file');
  const h = serviceHarness({
    secret: SECRETS[secretName as keyof typeof SECRETS],
    publicCreation: { maps: ['dev'], lobbyExpiryHours: 24 },
    ...(options.file === undefined ? {} : { store: openStore(options.file) }),
  });
  const live: { service: MatchService; restarts: number } = { service: h.service, restarts: 0 };
  const restart = (): void => {
    if (options.restart !== true) return;
    live.service.close();
    live.restarts += 1;
    options.whileClosed?.(options.file!, `restart ${live.restarts}`);
    live.service = createMatchService({ store: openStore(options.file!), clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, random: fakeRandom(500 + live.restarts) });
    live.service.start();
  };

  const timing = operator ? 'manual' : CLOCK;
  const created = operator
    ? h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing }) })
    : h.service.createPublic({ source: 'src-host', body: creationBody('c-1', { timing }) });
  if (!created.ok) throw new Error(`creation failed: ${JSON.stringify(created.error)}`);
  const id = created.reply.matchId;
  const hostToken = 'hostToken' in created.reply ? created.reply.hostToken : undefined;

  const ids = new Map<string, string>(); // name -> player id
  const tokens = new Map<string, string>(); // name -> player token
  const joinOne = (index: number): void => {
    const p = golden.roster[index]!;
    const out = live.service.join({ source: `src-${index}`, matchId: id, body: { name: p.sent, requestId: `j-${index}` } });
    if (!out.ok) throw new Error(`join of ${p.name} refused: ${JSON.stringify(out.error)}`);
    ids.set(p.name, out.reply.playerId);
    tokens.set(p.name, out.reply.playerToken);
  };
  const callerOf = (name: string): PlayerCaller => {
    const found = live.service.playerTokenOf(id, tokens.get(name)!);
    if (!found.ok || found.reply === undefined) throw new Error(`the token of ${name} does not resolve`);
    return { tokenDigest: credentialDigest(tokens.get(name)!), playerId: found.reply.playerId };
  };
  const submitWindow = (s: number): void => {
    for (const p of golden.predictions.filter((x) => x.before === s)) {
      const body = { kind: p.kind, ...(p.round === undefined ? {} : { round: p.round }), faction: p.faction };
      const out = tokens.has(p.who)
        ? live.service.submit({ client: callerOf(p.who), matchId: id, body: { ...body, playerId: ids.get(p.who)!.slice('player:'.length) } })
        : live.service.submit({ client: CREDENTIALS[p.who.slice(0, p.who.indexOf(':'))]!, matchId: id, body: { ...body, playerId: p.who.slice(p.who.indexOf(':') + 1) } });
      if (!out.ok) throw new Error(`submission of ${p.who} refused before step ${s}: ${JSON.stringify(out.error)}`);
    }
  };
  const viewLog: GoldenView[] = [];
  const logView = (label: string): void => {
    const shown = live.service.publicMatch(id)!;
    viewLog.push({ label, stage: shown.stage, appliedRounds: shown.appliedRounds, playerCount: shown.playerCount ?? null, lastSeq: shown.lastSeq });
  };

  logView('created');
  const lobbyJoins = golden.roster.filter((p) => p.joinStep < 0).length;
  for (let i = 0; i < lobbyJoins; i += 1) {
    h.clock.set(START_MS + (i + 1) * S);
    joinOne(i);
    logView(`joined ${golden.roster[i]!.name}`);
    restart();
  }
  if (!operator) {
    h.clock.set(START_MS + (lobbyJoins + 1) * S);
    const started = live.service.startMatch({ credential: hostToken, matchId: id, body: {} });
    if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
    logView('started');
    restart();
  }

  const doneOf = (): number => {
    const shown = live.service.publicMatch(id)!;
    if (shown.stage === 'finished') return 12;
    return 3 * shown.appliedRounds + (shown.stage === 'phase-1' ? 0 : shown.stage === 'phase-2' ? 1 : 2);
  };
  for (let guard = 0; guard < 40 && doneOf() < 12; guard += 1) {
    const s = doneOf();
    const j = s % 3;
    const shown = live.service.publicMatch(id)!;
    const anchor = shown.schedule === undefined ? undefined : [shown.schedule.c1, shown.schedule.c2, shown.schedule.a][j]!;
    const late = golden.roster.findIndex((p) => p.joinStep === s);
    if (options.flow === 'operator-manual') {
      if (late >= 0) {
        joinOne(late);
        logView(`joined ${golden.roster[late]!.name}`);
        restart();
      }
      submitWindow(s);
      const out = live.service.advance({ credential: OPERATOR, matchId: id, body: { round: shown.appliedRounds + 1, step: STEP_KIND[j]! } });
      if (!out.ok) throw new Error(`advance refused at step ${s}: ${JSON.stringify(out.error)}`);
    } else {
      h.clock.set(options.flow === 'lobby-late' ? anchor! - S : anchor! - 1);
      if (late >= 0) {
        joinOne(late);
        logView(`joined ${golden.roster[late]!.name}`);
        restart();
      }
      submitWindow(s);
      h.clock.set(options.flow === 'lobby-late' ? anchor! + 3600 * S : anchor!);
      live.service.tick();
    }
    if (doneOf() <= s) throw new Error(`no step was performed at step ${s}`);
    logView(`step ${s}`);
    restart();
  }
  if (doneOf() !== 12) throw new Error('the match did not finish');

  // The reads, with the ids mapped back to the golden's keys.
  const nameOfId = new Map([...ids].map(([name, playerId]) => [playerId, name] as const));
  const whoOf = (playerId: string): string => nameOfId.get(playerId) ?? playerId;
  const clientIds = [...golden.clients, 'web:nobody'];
  const allIds = [...ids.values(), ...clientIds];
  const snap = snapshotOf(live.service, id, allIds, 4, 2);
  const events = must(live.service.eventsAfter(id, 0)).events.map((e) => eventOf(e, whoOf));

  const phaseResults: Record<string, GoldenPhase> = {};
  let phaseItems = true;
  for (const [key, page] of Object.entries(snap.phaseResults)) {
    phaseItems &&= isSorted(page.items.map((i) => i.playerId));
    const items = page.items.map((i) => ({ who: whoOf(i.playerId), ...(i.name === undefined ? {} : { name: i.name }), choice: i.choice, correct: i.correct, points: i.points })).sort((a, b) => (a.who < b.who ? -1 : 1));
    phaseResults[key] = { round: page.round, phase: page.phase, ...(page.victim === undefined ? {} : { victim: page.victim }), ...(page.record === undefined ? {} : { record: { round: page.record.round, eliminated: page.record.eliminated, absorber: page.record.absorber, transferred: [...page.record.transferred] } }), items };
  }
  const players: Record<string, GoldenPlayerResults> = {};
  for (const [pid, page] of Object.entries(snap.players)) {
    players[whoOf(pid)] = {
      who: whoOf(page.playerId),
      ...(page.name === undefined ? {} : { name: page.name }),
      total: page.total,
      items: page.items.map((i) => ({ kind: i.kind, ...(i.round === undefined ? {} : { round: i.round }), choice: i.choice, correct: i.correct, points: i.points })),
    };
  }
  const playersOrder = Object.keys(players).length === allIds.length;
  const board = snap.leaderboard;
  const leaderboard = board
    .map((r) => ({ rank: r.rank, who: whoOf(r.playerId), ...(r.name === undefined ? {} : { name: r.name }), total: r.total, correctVictims: r.correctVictims, correctAbsorbers: r.correctAbsorbers, correctWinner: r.correctWinner }))
    .sort((a, b) => a.rank - b.rank || (a.who < b.who ? -1 : 1));
  const boardOrder = board.every((r, i) => i === 0 || board[i - 1]!.total > r.total || (board[i - 1]!.total === r.total && board[i - 1]!.playerId < r.playerId));
  const winners: Record<string, string[]> = {};
  let winnersOrder = true;
  for (let round = 1; round <= 4; round += 1) {
    for (const phase of [1, 2] as const) {
      const a = winnersOf(live.service, id, round, phase, 1);
      const b = winnersOf(live.service, id, round, phase, 500);
      winnersOrder &&= isSorted(b.items.map((i) => i.playerId)) && JSON.stringify(a.items) === JSON.stringify(b.items) && a.pages === Math.max(1, b.items.length);
      winners[`${round}/${phase}`] = b.items.map((i) => i.name).sort();
    }
  }
  let tokensResolve = true;
  for (const [name, token] of tokens) {
    const found = live.service.playerTokenOf(id, token);
    tokensResolve &&= found.ok && found.reply?.playerId === ids.get(name);
  }
  const result: LobbyRun = {
    observed: { lobbyEvents: events, lobbyViews: viewLog, phaseResults, winners, players, leaderboard },
    operator,
    order: { phaseItems, winners: winnersOrder, leaderboard: boardOrder, players: playersOrder },
    tokens,
    tokensResolve,
    matchId: id,
  };
  live.service.close();
  return result;
}
