import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getState, playRoundWithSeed } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import type { MatchService, PlayerCaller } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { absorberColumnsOutsideRecords, credentialTextColumns, encodingsOf, listColumns, needlesHeldBy, pendingStateColumns, rowsBeyondApplied, scanValues, storedFutureViolations, withRawDb } from './helpers/db-scan';
import { devMap } from './helpers/digests';
import { lobbyServiceWith } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';
import { SECRETS } from './helpers/core-timelines';
import { loadLobbyGolden, runLobbyTimeline } from './helpers/lobby-timelines';
import { PINS, ROOT, hashOf, presentFiles } from './helpers/protected-pins';
import { START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';

// NFR-74: nothing about a future round is readable in the lobby or by any new read (the players list, the who-guessed-right
// pages, the names in the results, the joined events), the sim and shared sources and the 008 secrecy suites are unchanged.
// Three proofs: (1) the storage check of 008 (`storedFutureViolations`, no column about an absorber or a seed, no row beyond the
// applied round, no secret or round seed in any cell) runs over the database of EVERY new scenario, at every restart point of
// the three golden lobbies; (2) twin matches that differ only in what is still secret give byte-identical replies to every new
// read at every stage until it is public; (3) the 008 secrecy suites and the sim and shared sources are byte-equal to their pins.

const HOUR = 3_600_000;
const GOLDEN = loadLobbyGolden();
const DEV_SECRETS = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { secret: string; rounds: { seed: number }[] }> };

/** What a database may hold about the future: one violation per readable text. */
function scan(db: DatabaseSync, secretHex: string, seeds: readonly number[]): string[] {
  const out: string[] = [];
  const columns = listColumns(db);
  for (const c of [...absorberColumnsOutsideRecords(columns), ...pendingStateColumns(columns), ...credentialTextColumns(columns)]) out.push(`column ${c}`);
  out.push(...storedFutureViolations(db));
  for (const r of rowsBeyondApplied(db)) out.push(`row beyond the applied round: ${JSON.stringify(r)}`);
  const finished = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE stage = 'finished'").get()!.n !== 0;
  // The match secret is public once the match is finished (its event and the view of a reply); before, only its own column holds it.
  const secretAllowed = finished ? ['matches.secret', 'events.payload_json', 'memo.reply_json'] : ['matches.secret'];
  for (const where of scanValues(db, encodingsOf(Uint8Array.from(Buffer.from(secretHex, 'hex'))), secretAllowed)) out.push(`secret in ${where}`);
  for (const where of scanValues(db, seeds.flatMap((s) => encodingsOf(s)))) out.push(`round seed in ${where}`);
  return out;
}

describe('the storage check of 008 over every new scenario', () => {
  for (const name of Object.keys(GOLDEN)) {
    it(`NFR-74 ${name}: the database of the scripted lobby, the operator match with joins and the late join holds nothing about a future round at any of its restart points`, () => {
      const secret = DEV_SECRETS.matches[name]!;
      const seeds = secret.rounds.map((r) => r.seed);
      withTempDir((dir) => {
        for (const flow of ['lobby-clock', 'operator-manual'] as const) {
          const violations: string[] = [];
          let points = 0;
          runLobbyTimeline(name, GOLDEN[name]!, {
            flow,
            file: join(dir, `${flow}.sqlite`),
            restart: true,
            whileClosed: (file, label) => {
              points += 1;
              withRawDb(file, (db) => violations.push(...scan(db, secret.secret, seeds).map((v) => `${flow} ${label}: ${v}`)));
            },
          });
          // A restart after each of the 5 lobby joins (operator: after the creation joins), the start (lobby only), the late join and the 12 steps.
          expect(points, flow).toBe(flow === 'lobby-clock' ? 5 + 1 + 1 + 12 : 5 + 1 + 12);
          expect(violations, flow).toStrictEqual([]);
        }
      });
    }, 120_000);
  }

  it('NFR-74 the databases of a lobby with players, an expired lobby with players and a started match with revealed victim and absorber predictions hold nothing about the future', () => {
    withTempDir((dir) => {
      const secret = SECRETS['ascending-00-1f'];
      const secretHex = Buffer.from(secret).toString('hex');
      const seeds = DEV_SECRETS.matches['ascending-00-1f']!.rounds.map((r) => r.seed);
      const run = (file: string, work: (s: MatchService, advance: (ms: number) => void) => void): string[] => {
        const clock = fakeClock(START_MS);
        // The first 32 random bytes of the first creation are the secret of the scan.
        let first = true;
        const base = fakeRandom(8);
        const service = lobbyServiceWith(openStore(file), clock, file, (length) => {
          const bytes = base(length);
          if (first && length === 32) {
            first = false;
            bytes.set(secret);
          }
          return bytes;
        });
        try {
          work(service, (ms) => clock.set(START_MS + ms));
        } finally {
          service.close();
        }
        return withRawDb(file, (db) => scan(db, secretHex, seeds));
      };
      const lobby = (s: MatchService): { matchId: string; hostToken: string } => {
        const made = s.createPublic({ source: 'src-a', body: creationBody('c-1') });
        if (!made.ok) throw new Error('creation failed');
        return made.reply;
      };
      const joinAs = (s: MatchService, matchId: string, name: string): { playerId: string; caller: PlayerCaller } => {
        const out = s.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
        if (!out.ok) throw new Error(`join refused: ${JSON.stringify(out.error)}`);
        return { playerId: out.reply.playerId, caller: { tokenDigest: credentialDigest(out.reply.playerToken), playerId: out.reply.playerId } };
      };
      expect(run(join(dir, 'lobby.sqlite'), (s, at) => {
        const { matchId } = lobby(s);
        at(1_000);
        for (const name of ['Ana', 'Bea', 'Zed']) joinAs(s, matchId, name);
      })).toStrictEqual([]);
      expect(run(join(dir, 'expired.sqlite'), (s, at) => {
        const { matchId } = lobby(s);
        at(1_000);
        joinAs(s, matchId, 'Ana');
        joinAs(s, matchId, 'Bea');
        at(HOUR);
        s.tick();
        expect(s.publicMatch(matchId)?.stage).toBe('expired');
      })).toStrictEqual([]);
      expect(run(join(dir, 'started.sqlite'), (s, at) => {
        const { matchId, hostToken } = lobby(s);
        at(1_000);
        const ana = joinAs(s, matchId, 'Ana');
        const bea = joinAs(s, matchId, 'Bea');
        at(2_000);
        expect(s.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
        const living = [...new Set(s.publicMatch(matchId)!.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
        const local = (p: { playerId: string }): string => p.playerId.slice('player:'.length);
        expect(s.submit({ client: ana.caller, matchId, body: { kind: 'victim', round: 1, faction: living[0], playerId: local(ana) } }).ok).toBe(true);
        expect(s.submit({ client: bea.caller, matchId, body: { kind: 'winner', faction: living[1], playerId: local(bea) } }).ok).toBe(true);
        // The phase-1 close reveals the victim; an absorber prediction and the reads of the pages follow.
        at(2_000 + 80_000);
        s.tick();
        const shown = s.publicMatch(matchId)!;
        expect(shown.stage).toBe('phase-2');
        expect(s.submit({ client: ana.caller, matchId, body: { kind: 'absorber', round: 1, faction: shown.victim!.candidates[0], playerId: local(ana) } }).ok).toBe(true);
        for (const phase of [1, 2] as const) {
          s.phaseResults(matchId, 1, phase, { limit: 10 });
          s.phaseWinners(matchId, 1, phase, { limit: 10 });
        }
        s.leaderboard(matchId, { limit: 10 });
        s.playerResults(matchId, ana.playerId, { limit: 10 });
      })).toStrictEqual([]);
    });
  }, 60_000);
});

// --- Twins -------------------------------------------------------------------------------------------------------------------

const MAP = devMap();
const STATE0 = ((): Parameters<typeof playRoundWithSeed>[1] => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const played = (seed: number): { victim: number; absorber: number } => {
  const r = playRoundWithSeed(MAP, STATE0, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return { victim: r.value.record.eliminated, absorber: r.value.record.absorber };
};
/** Two round-1 seeds with the same victim and another absorber, found by search (so the twins differ only in the absorber). */
const SEEDS = ((): [number, number] => {
  const base = 3_000_000_011;
  for (let first = base; first < base + 200; first += 1) {
    const a = played(first);
    for (let seed = first + 1; seed < first + 400; seed += 1) {
      const b = played(seed);
      if (b.victim === a.victim && b.absorber !== a.absorber) return [first, seed];
    }
  }
  throw new Error('no seed pair with the same victim and another absorber');
})();
const sourceOf = (round1: number) => () => (k: number) => (k === 1 ? round1 : 3_100_000_000 + k);
const SECRET = SECRETS['ascending-00-1f'];
const NEEDLES = [...encodingsOf(SECRET), ...SEEDS.flatMap((s) => encodingsOf(s)), ...[2, 3, 4].flatMap((k) => encodingsOf(3_100_000_000 + k))];

type Snap = Record<string, string>;

/** Every new read and its relatives, as texts (errors included), for one match. */
function readsOf(s: MatchService, id: string, playerIds: readonly string[], tokens: readonly string[]): Snap {
  const out: Snap = {};
  const put = (key: string, value: unknown): void => void (out[key] = JSON.stringify(value));
  put('public', s.readPublicMatch(id));
  put('list', s.listMatches({ limit: 500 }));
  put('players', s.players(id, { limit: 500 }));
  put('players page 1', s.players(id, { limit: 1 }));
  put('events', s.eventsAfter(id, 0));
  put('events after 1', s.eventsAfter(id, 1));
  put('leaderboard', s.leaderboard(id, { limit: 500 }));
  put('records', s.records(id, { limit: 500 }));
  for (const round of [0, 1, 2, 3, 4]) {
    put(`state ${round}`, s.stateAt(id, round));
    put(`record ${round}`, s.recordAt(id, round));
    for (const phase of [1, 2] as const) {
      put(`results ${round}/${phase}`, s.phaseResults(id, round, phase, { limit: 500 }));
      put(`winners ${round}/${phase}`, s.phaseWinners(id, round, phase, { limit: 500 }));
      put(`winners ${round}/${phase} page`, s.phaseWinners(id, round, phase, { limit: 1 }));
    }
  }
  for (const pid of [...playerIds, 'player:neverjoined00', 'web:nobody']) put(`player results ${pid}`, s.playerResults(id, pid, { limit: 500 }));
  for (const token of tokens) put(`token ${token.slice(0, 6)}`, s.playerTokenOf(id, token));
  return out;
}

describe('twin matches and the new reads', () => {
  it('NFR-74 twins that differ only in the absorber of round 1 give byte-identical replies to every new read, in the lobby and until the application, and none holds the secret or a round seed', () => {
    expect(played(SEEDS[0]).victim).toBe(played(SEEDS[1]).victim);
    expect(played(SEEDS[0]).absorber).not.toBe(played(SEEDS[1]).absorber);
    const stages = (seed: number): { name: string; snap: Snap }[] => {
      const h = serviceHarness({ secret: SECRET, testSeedSource: sourceOf(seed), publicCreation: { maps: ['dev'] } });
      const out: { name: string; snap: Snap }[] = [];
      try {
        const made = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
        if (!made.ok) throw new Error('creation failed');
        const id = made.reply.matchId;
        const people = ['Ana', 'Bea', 'Zed'].map((name) => {
          const j = h.service.join({ source: `src-${name}`, matchId: id, body: { name, requestId: `j-${name}` } });
          if (!j.ok) throw new Error('join failed');
          return { playerId: j.reply.playerId, token: j.reply.playerToken, caller: { tokenDigest: credentialDigest(j.reply.playerToken), playerId: j.reply.playerId } };
        });
        const [ana, bea] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number]];
        const ids = people.map((p) => p.playerId);
        const tokens = [made.reply.hostToken, ...people.map((p) => p.token)];
        const stage = (name: string): void => void out.push({ name, snap: readsOf(h.service, id, ids, tokens) });
        const local = (p: { playerId: string }): string => p.playerId.slice('player:'.length);
        const send = (p: typeof ana, body: Record<string, unknown>): void => {
          const r = h.service.submit({ client: p.caller, matchId: id, body: { ...body, playerId: local(p) } });
          if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.error)}`);
        };
        stage('lobby with three players');
        h.clock.advance(1_000);
        expect(h.service.startMatch({ credential: made.reply.hostToken, matchId: id, body: {} }).ok).toBe(true);
        stage('phase 1');
        const living = [...new Set(h.service.publicMatch(id)!.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
        const victim = played(SEEDS[0]).victim;
        send(ana, { kind: 'victim', round: 1, faction: victim });
        send(bea, { kind: 'victim', round: 1, faction: living.find((f) => f !== victim) });
        send(ana, { kind: 'winner', faction: living[0] });
        stage('phase 1 with predictions');
        const tick = (anchor: number): void => (h.clock.set(anchor), void h.service.tick());
        tick(h.service.publicMatch(id)!.schedule!.c1);
        expect(h.service.publicMatch(id)!.stage).toBe('phase-2');
        stage('phase 2, victim revealed');
        const candidates = h.service.publicMatch(id)!.victim!.candidates;
        send(ana, { kind: 'absorber', round: 1, faction: candidates[0] });
        send(bea, { kind: 'absorber', round: 1, faction: candidates[candidates.length - 1] });
        stage('phase 2 with absorber predictions');
        tick(h.service.publicMatch(id)!.schedule!.c2);
        expect(h.service.publicMatch(id)!.stage).toBe('locked');
        stage('locked');
        tick(h.service.publicMatch(id)!.schedule!.a);
        expect(h.service.publicMatch(id)!.appliedRounds).toBe(1);
        stage('applied');
        return out;
      } finally {
        h.close();
      }
    };
    const a = stages(SEEDS[0]);
    const b = stages(SEEDS[1]);
    expect(a.map((s) => s.name)).toStrictEqual(['lobby with three players', 'phase 1', 'phase 1 with predictions', 'phase 2, victim revealed', 'phase 2 with absorber predictions', 'locked', 'applied']);
    for (let i = 0; i < a.length - 1; i += 1) {
      expect(b[i]!.snap, a[i]!.name).toStrictEqual(a[i]!.snap);
      const text = Object.values(a[i]!.snap).join('\n');
      expect(needlesHeldBy(text, NEEDLES), `${a[i]!.name} holds the secret or a round seed`).toStrictEqual([]);
      expect(Object.keys(a[i]!.snap)).toHaveLength(57); // 8 list reads, 5 rounds x (state, record, 2 x 3 results and winners reads), 5 player results, 4 token lookups
    }
    // After the application the absorber is public and the twins differ (the reads are not constants).
    const last = a.length - 1;
    expect(b[last]!.snap['record 1']).not.toBe(a[last]!.snap['record 1']);
    expect(needlesHeldBy(Object.values(a[last]!.snap).join('\n'), NEEDLES)).toStrictEqual([]);
    // The reads exist: the lobby reads show the names, the winners page of phase 1 shows its winners once it is scored.
    expect(a[0]!.snap['players']).toContain('"name":"Zed"');
    expect(a[3]!.snap['winners 1/1']).toContain('"name":"Ana"');
    expect(a[3]!.snap['winners 1/1']).not.toContain('"name":"Bea"');
  }, 60_000);
});

// --- The 008 secrecy suites and the sources they protect -----------------------------------------------------------------------

const sha = (path: string): string => createHash('sha256').update(Buffer.from(readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');

describe('the 008 secrecy suites and the sources are unchanged', () => {
  // SHA-256 of the 008 secrecy suites taken from commit 11c075e (the last commit before spec 011): none of them was edited.
  const SUITES_008: Record<string, string> = {
    'apps/server/test/absorber-uniformity.test.ts': 'cc1d1626c385e521740a986f858b27f651331897e36017ab8b9bf07dd7eef37b',
    'apps/server/test/service-twins.test.ts': 'd1580482936a69e52cc5d2e809955a10dd93786a87dff6808ad063679b55b9ba',
    'apps/server/test/http-twins.test.ts': '59e05794e78f5acec239ecf11401c206f083081c74c5dc5977695d56a8339eb4',
    'apps/server/test/stream-twins.test.ts': '605fc20ed009b78f29733ff6abdd6a203c56b6d359f3de4bda840587b3a2cca2',
    'apps/server/test/http-results-twins.test.ts': '1d591c2ed7ac562d3e1b299bbe86f72b05961a272b85a12bc1315f1effa7bdc0',
    'apps/server/test/canonical-digests.test.ts': '6a1ad5a09107adf57c7e5d6d8a7286d843c58eee69ffc17dc8dad6688d6ee3cf',
    'apps/server/test/secret.test.ts': '8a3637def8fe2e8e1a8e8285c5233404530c1304d8a426867d16429baec4a328',
    'apps/server/test/seed-golden.test.ts': '03775d905a9887a8e5273d48fa6cf41ab831715ae95aa4c3926ebd3efcee255a',
  };
  // Two 008 suites received ADDITIONS only in spec 011 (`git diff 11c075e` shows no deleted line: the token allowance of the
  // storage check in M3, the new routes and names of the log scan in M4); their present text is pinned so that a later edit is seen.
  const EXTENDED: Record<string, string> = {
    'apps/server/test/service-db-secrecy.test.ts': '17b0c27e3d997607e38452c75451fafb9cd6e6dfdb5312b762f1404b967d899a',
    'apps/server/test/server-log-scan.test.ts': '80b1849796b5a0dc1813efce2ad3857fa836d9da2927d08b34e24654a321e15b',
  };

  it('NFR-74 the eight 008 secrecy suites that spec 011 does not touch are byte-equal to their 008 text, and the two it extended are as pinned', () => {
    expect(Object.keys(SUITES_008)).toHaveLength(8);
    for (const [path, pin] of Object.entries(SUITES_008)) expect(sha(path), path).toBe(pin);
    for (const [path, pin] of Object.entries(EXTENDED)) expect(sha(path), path).toBe(pin);
  });

  it('NFR-74 the sim and shared sources (the rules, the map format and the match state) are byte-equal to rewrite', () => {
    const files = presentFiles().filter((f) => f.startsWith('packages/sim/src/') || f.startsWith('packages/shared/src/'));
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => hashOf(f) !== PINS.files[f])).toStrictEqual([]);
    expect(Object.keys(PINS.files).filter((f) => (f.startsWith('packages/sim/src/') || f.startsWith('packages/shared/src/')) && !files.includes(f))).toStrictEqual([]);
  });
});
