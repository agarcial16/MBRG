// The NFR-49 load procedure (plan 19.9), run BY HAND on the reference PC, alone: `node --import tsx scripts/load.ts` from
// `apps/server` (`--smoke` is the small run the suite makes). It is not part of the server: it spawns the real `src/main.ts`
// as a child process with a file database in a temporary folder and raised limits (FR-299 (f)), talks to it with `node:http`,
// and prints ONE summary JSON line on stdout (the keys of `load-stats.ts`); progress and the verdict go to stderr.
//
//   1. create the matches (dev map, clock timing), open the streams (100 per match, `lastEventId=0`);
//   2. after the warm-up, send submissions at the configured rate from the configured number of local ids;
//   3. figures: p95 of the reply times, the delay of every step to the LAST stream's receipt of its last event, failures;
//   4. restart: fill the store up to the configured number of running matches, kill the child by PID, start it again on the
//      same file and measure the time from the spawn to the `listening` line.
//
// Streams are opened in batches (a burst of 1,000 connections at once overflows the listen backlog on Windows).

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, request } from 'node:http';
import { decisionsOf, summarize } from './load-stats';
import type { DecisionEnd, LoadEvent, StreamLog } from './load-stats';

interface Config {
  readonly matches: number;
  readonly streamsPerMatch: number;
  readonly timing: { readonly i: number; readonly l1: number; readonly l2: number };
  readonly submissionsPerSecond: number;
  readonly players: number;
  readonly warmupMs: number;
  readonly measureMs: number;
  /** The number of stored running matches at the restart. */
  readonly storedRunning: number;
  readonly maxRunning: number;
}

const FULL: Config = { matches: 10, streamsPerMatch: 100, timing: { i: 20, l1: 6, l2: 2 }, submissionsPerSecond: 100, players: 1000, warmupMs: 10_000, measureMs: 60_000, storedRunning: 100, maxRunning: 110 };
const SMOKE: Config = { matches: 1, streamsPerMatch: 5, timing: { i: 3, l1: 1, l2: 0 }, submissionsPerSecond: 5, players: 20, warmupMs: 500, measureMs: 3500, storedRunning: 3, maxRunning: 10 };

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(SERVER_DIR, 'src', 'main.ts');
const DEV_MAP = fileURLToPath(new URL('../../../maps/dev', import.meta.url)).replace(/[\\/]$/, '');
const OPERATOR = 'load-operator-credential-0123456789';
const CLIENT = 'load-client-credential-0123456789ab';
const LIMIT = '1000000';
const BATCH = 100;
/** How long the streams stay open after the measurement, so that the last steps arrive (and are not counted missing). */
const TAIL_MS = 1500;

const say = (text: string): void => void process.stderr.write(`${text}\n`);
const hundredth = (ms: number): number => Math.round(ms * 100) / 100;
const wall = (): number => hundredth(performance.timeOrigin + performance.now());
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the child process -------------------------------------------------------------------------------------------------

interface Child {
  readonly proc: ChildProcess;
  readonly port: Promise<number>;
  stderr(): string;
  kill(): Promise<void>;
}

function spawnServer(env: Record<string, string>): Child {
  const clean: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('MBRG_')) delete clean[key];
  const proc = spawn(process.execPath, ['--import', 'tsx', MAIN], { cwd: SERVER_DIR, env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let err = '';
  let out = '';
  let ended = false;
  const exited = new Promise<void>((resolve) => {
    proc.once('exit', () => {
      ended = true;
      resolve();
    });
    proc.once('error', () => {
      ended = true;
      resolve();
    });
  });
  proc.stderr?.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
  const port = new Promise<number>((resolve, reject) => {
    proc.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue;
        const event = JSON.parse(line) as { event?: string; port?: number };
        if (event.event === 'listening' && typeof event.port === 'number') return resolve(event.port);
      }
    });
    void exited.then(() => reject(new Error(`the server ended before listening: ${err}`)));
  });
  port.catch(() => undefined);
  return {
    proc,
    port,
    stderr: () => err,
    async kill() {
      if (!ended) proc.kill('SIGKILL');
      await exited;
    },
  };
}

// ---- HTTP -------------------------------------------------------------------------------------------------------------

interface Reply {
  readonly status: number;
  readonly text: string;
  readonly ms: number;
}

const api = new Agent({ keepAlive: true, maxSockets: 32 });

function call(port: number, method: string, path: string, token: string | undefined, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    const started = performance.now();
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent: api }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, ms: performance.now() - started }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// ---- streams ----------------------------------------------------------------------------------------------------------

interface Live extends StreamLog {
  readonly receipts: Map<number, number>;
  status: number;
  endedEarly: boolean;
  /** The parsed events (kept for the first stream of each match only). */
  readonly events: LoadEvent[] | undefined;
}

const streamAgent = new Agent({ keepAlive: false, maxSockets: Infinity });
const state = { stopping: false };

/** Opens one stream and resolves with its record once the reply headers arrived. */
function openStream(port: number, matchId: string, keepEvents: boolean, onEvent: (event: LoadEvent) => void): Promise<Live> {
  return new Promise((resolve, reject) => {
    const live: Live = { matchId, status: 0, receipts: new Map(), endedEarly: false, events: keepEvents ? [] : undefined };
    const req = request({ host: '127.0.0.1', port, path: `/matches/${matchId}/events?lastEventId=0`, agent: streamAgent }, (res) => {
      live.status = res.statusCode ?? 0;
      let pending = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        const at = wall();
        pending += chunk;
        for (let cut = pending.indexOf('\n\n'); cut >= 0; cut = pending.indexOf('\n\n')) {
          const frame = pending.slice(0, cut);
          pending = pending.slice(cut + 2);
          if (!frame.startsWith('id: ')) continue;
          const seq = Number(frame.slice(4, frame.indexOf('\n')));
          live.receipts.set(seq, at);
          if (live.events !== undefined) {
            const event = JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as LoadEvent;
            live.events.push(event);
            onEvent(event);
          }
        }
      });
      const ended = (): void => {
        if (!state.stopping) live.endedEarly = true;
      };
      res.on('end', ended);
      res.on('close', ended);
      res.on('error', ended);
      if (live.status !== 200) res.resume();
      resolve(live);
    });
    req.on('error', (error) => {
      if (live.status === 0) reject(error);
      else if (!state.stopping) live.endedEarly = true;
    });
    req.end();
  });
}

// ---- the run ----------------------------------------------------------------------------------------------------------

interface Match {
  readonly id: string;
  /** Living factions a winner prediction may name (the revealed victim is dropped at once: it dies at the next application). */
  living: number[];
  finished: boolean;
}

const livingOf = (text: string): number[] => {
  const owners = (JSON.parse(text) as { state: { owners: [number, number][] } }).state.owners;
  return [...new Set(owners.map(([, faction]) => faction))].sort((a, b) => a - b);
};

async function createMatch(port: number, n: number, timing: unknown, label: string): Promise<string> {
  const made = await call(port, 'POST', '/matches', OPERATOR, { mapId: 'dev', timing, requestId: `${label}-${n}` });
  if (made.status !== 201) throw new Error(`creation answered ${made.status}: ${made.text}`);
  return (JSON.parse(made.text) as { matchId: string }).matchId;
}

async function main(): Promise<void> {
  const cfg = process.argv.includes('--smoke') ? SMOKE : FULL;
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-load-'));
  const env: Record<string, string> = {
    MBRG_OPERATOR_CREDENTIAL: OPERATOR,
    MBRG_MAPS: JSON.stringify({ dev: DEV_MAP }),
    MBRG_DATABASE: join(dir, 'load.sqlite'),
    MBRG_HOST: '127.0.0.1',
    MBRG_PORT: '0',
    MBRG_MAX_RUNNING_MATCHES: String(cfg.maxRunning),
    MBRG_CLIENTS: JSON.stringify([{ namespace: 'web', credential: CLIENT }]),
    MBRG_LIMIT_ANONYMOUS_STREAMS: String(Math.max(cfg.matches * cfg.streamsPerMatch, 10)),
    MBRG_LIMIT_ANONYMOUS: LIMIT,
    MBRG_LIMIT_READS: LIMIT,
    MBRG_LIMIT_COMMANDS: LIMIT,
    MBRG_LIMIT_SUBMISSIONS: LIMIT,
    MBRG_LIMIT_ADVANCES: LIMIT,
  };
  let server = spawnServer(env);
  try {
    const port = await server.port;
    say(`server on port ${port}, node ${process.version}`);

    // 1. Matches and streams.
    const matches: Match[] = [];
    for (let n = 0; n < cfg.matches; n += 1) {
      const id = await createMatch(port, n, cfg.timing, 'load');
      const shown = await call(port, 'GET', `/matches/${id}`, undefined);
      matches.push({ id, living: livingOf(shown.text), finished: false });
    }
    const streams: Live[] = [];
    for (const match of matches) {
      for (let from = 0; from < cfg.streamsPerMatch; from += BATCH) {
        const batch = Array.from({ length: Math.min(BATCH, cfg.streamsPerMatch - from) }, (_, k) =>
          openStream(port, match.id, from + k === 0, (event) => {
            if (event.type === 'victim-revealed') match.living = (event.living as number[]).filter((faction) => faction !== event.victim);
            if (event.type === 'match-finished') match.finished = true;
          }),
        );
        streams.push(...(await Promise.all(batch)));
      }
    }
    const opened = streams.filter((s) => s.status === 200).length;
    say(`${opened} of ${streams.length} streams open`);

    // 2. Warm-up, then the submissions at a steady rate.
    await sleep(cfg.warmupMs);
    const replyMs: number[] = [];
    let nonOk = 0;
    const counts = new Array<number>(cfg.players).fill(0);
    const started = performance.now();
    const pending = new Set<Promise<void>>();
    let sent = 0;
    let slot = 0;
    while (performance.now() - started < cfg.measureMs) {
      const due = Math.floor(((performance.now() - started) * cfg.submissionsPerSecond) / 1000);
      while (sent < due) {
        const player = slot % cfg.players;
        const match = matches[player % matches.length] as Match;
        const n = counts[player] as number;
        counts[player] = n + 1;
        slot += 1;
        sent += 1;
        const living = match.living;
        const faction = living[n % Math.min(2, living.length)] as number;
        const work = call(port, 'POST', `/matches/${match.id}/predictions`, CLIENT, { kind: 'winner', faction, playerId: `p${player}`, requestId: `r-${player}-${n}` })
          .then((reply) => {
            replyMs.push(hundredth(reply.ms));
            if (reply.status !== 200) {
              nonOk += 1;
              say(`submission answered ${reply.status}: ${reply.text.slice(0, 120)}`);
            }
          })
          .catch((error: unknown) => {
            nonOk += 1;
            say(`submission failed: ${String(error)}`);
          })
          .finally(() => void pending.delete(work));
        pending.add(work);
      }
      await sleep(5);
    }
    const measureEnd = wall();
    await Promise.all([...pending]);
    await sleep(TAIL_MS);
    state.stopping = true;

    // 3. Figures.
    const steps: DecisionEnd[] = [];
    for (const match of matches) {
      const first = streams.find((s) => s.matchId === match.id && s.events !== undefined);
      steps.push(...decisionsOf(match.id, first?.events ?? []).filter((d) => d.at <= measureEnd));
    }
    const running = matches.filter((m) => !m.finished).length;

    // 4. Restart with the stored running matches filled up.
    const extra = Math.max(0, cfg.storedRunning - running);
    for (let n = 0; n < extra; n += 1) await createMatch(port, n, 'manual', 'fill');
    say(`${running} clock matches still running, ${extra} manual matches added: ${running + extra} stored running`);
    await server.kill();
    const spawned = performance.now();
    server = spawnServer(env);
    await server.port;
    const restartMs = hundredth(performance.now() - spawned);

    const summary = summarize({ replyMs, nonOkReplies: nonOk, steps, streams, restartMs });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    say(`node ${process.version}; p95 ${String(summary.replyP95Ms)} ms (target 50), worst step delay ${String(summary.worstStepDelayMs)} ms (target 100), restart ${restartMs.toFixed(0)} ms (target 2000), failures ${summary.failures}`);
  } finally {
    state.stopping = true;
    streamAgent.destroy();
    api.destroy();
    await server.kill();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    say(`load run failed: ${String(error)}`);
    process.exit(1);
  },
);
