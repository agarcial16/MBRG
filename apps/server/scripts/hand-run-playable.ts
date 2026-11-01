// The hand run of spec 011 (done criterion 3), run BY HAND: `node --import tsx scripts/hand-run-playable.ts` from `apps/server`.
// It spawns the real `src/main.ts` as a child process on the dev map (an in-memory store, any free port, public creation on),
// drives it over HTTP with `node:http` and prints a transcript to stdout:
//
//   1. create a lobby without any credential;           6. every round: victim predictions, the host's three steps,
//   2. two players join with a name and get a token;       absorber predictions (a forced absorber is refused);
//   3. the players list;                                 7. the match is finished;
//   4. only the host starts the match;                   8. the leaderboard shows both names;
//   5. each player predicts the winner with its token;   9. who guessed right and the player results carry the names.
//
// Public creation refuses the `manual` timing (spec 011 D7), so the lobby gets a long clock timing and the host steps the match
// with `advance`, exactly as under `manual`: the clock never fires during the run. No secret is printed: a token is shown as its
// first six characters. The exit code is 1 when a check fails. The server is killed by its PID at the end, whatever happens.
//
// The flow itself (`runHandRun`) takes a `call` function, so the suite runs it against an in-process server with the fake clock.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- the pure parts -----------------------------------------------------------------------------------------------------

export const HAND_RUN_STEPS = [
  'create a lobby without a credential',
  'two players join with a name',
  'the players list shows both names in join order',
  'only the host starts the match',
  'each player predicts the winner with its own token',
  'every round: victim predictions, three host steps, absorber predictions',
  'the match is finished and its secret is public',
  'the leaderboard shows both names',
  'who guessed right and the player results carry the names',
  'no token was printed',
] as const;

/** How a token is shown: its first six characters and three dots (never more). */
export const tokenPrefix = (token: string): string => (token.length > 6 ? `${token.slice(0, 6)}...` : '...');

/** The text with every occurrence of every token replaced by its prefix. */
export function redact(text: string, tokens: readonly string[]): string {
  let shown = text;
  for (const token of tokens) if (token.length > 0) shown = shown.split(token).join(tokenPrefix(token));
  return shown;
}

/** The first and the last of a non-empty list of factions (the two players take different ones when there are two). */
export function pickFactions(factions: readonly number[]): { readonly first: number; readonly last: number } {
  const first = factions[0];
  const last = factions[factions.length - 1];
  if (first === undefined || last === undefined) throw new RangeError('no faction to pick from');
  return { first, last };
}

const ROW_KEYS = ['rank', 'playerId', 'total', 'correctVictims', 'correctAbsorbers', 'correctWinner'];

/** What is wrong with a parsed leaderboard page `items` list: each named player has a row, every row has a name, the ranks do not fall. */
export function leaderboardProblems(items: unknown, names: readonly string[]): string[] {
  if (!Array.isArray(items)) return ['the leaderboard is not a list of rows'];
  const problems: string[] = [];
  const rows = items as Record<string, unknown>[];
  let previous = 0;
  rows.forEach((row, at) => {
    const keys = Object.keys(row);
    const named = keys[keys.length - 1] === 'name';
    const base = named ? keys.slice(0, -1) : keys;
    if (base.join(',') !== ROW_KEYS.join(',')) problems.push(`row ${at + 1} has the members ${keys.join(',')}, not the documented ones`);
    else if (!named || typeof row.name !== 'string') problems.push(`row ${at + 1} has no name`);
    if (typeof row.rank !== 'number' || row.rank < previous) {
      if (!problems.includes(`ranks fall at row ${at + 1}`)) problems.push(`ranks fall at row ${at + 1}`);
    } else previous = row.rank;
  });
  for (const name of names) if (!rows.some((row) => row.name === name)) problems.push(`the leaderboard has no row named ${name}`);
  return problems;
}

// ---- the flow -----------------------------------------------------------------------------------------------------------

export interface Reply {
  readonly status: number;
  readonly text: string;
}
export type Call = (method: string, path: string, token?: string, body?: unknown) => Promise<Reply>;

export interface Figures {
  requests: number;
  totalRounds: number;
  rounds: number;
  hostSteps: number;
  forcedRounds: number;
  predictionsAccepted: number;
  refusals: number;
  rightGuesses: number;
  slowestMs: number;
  names: string[];
  leaderboard: { rank: number; name: string; total: number }[];
}
export interface Report {
  readonly lines: string[];
  readonly failures: string[];
  readonly figures: Figures;
}

class Abort extends Error {}

type Json = Record<string, unknown>;
const TIMING = { i: 600, l1: 200, l2: 100 };
const STEP_KINDS = ['phase-1-close', 'phase-2-close', 'application'] as const;

export async function runHandRun(call: Call, out: (line: string) => void = () => undefined): Promise<Report> {
  const lines: string[] = [];
  const failures: string[] = [];
  const tokens: string[] = [];
  const figures: Figures = { requests: 0, totalRounds: 0, rounds: 0, hostSteps: 0, forcedRounds: 0, predictionsAccepted: 0, refusals: 0, rightGuesses: 0, slowestMs: 0, names: [], leaderboard: [] };
  const say = (text: string): void => {
    const line = redact(text, tokens);
    lines.push(line);
    out(line);
  };
  const check = (ok: boolean, what: string): void => {
    say(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
  };
  let heading = 0;
  const begin = (): void => {
    const label = HAND_RUN_STEPS[heading];
    heading += 1;
    say(`[${heading}/${HAND_RUN_STEPS.length}] ${label}`);
  };
  /** One request. A status other than the expected one is a failure and ends the run (nothing after it would mean anything). */
  async function send(method: string, path: string, token: string | undefined, body: unknown, expected: number, note = ''): Promise<Json> {
    const started = performance.now();
    const reply = await call(method, path, token, body);
    const ms = performance.now() - started;
    figures.requests += 1;
    figures.slowestMs = Math.max(figures.slowestMs, ms);
    say(`  ${method} ${path} -> ${reply.status} (${ms.toFixed(0)} ms)${note === '' ? '' : ` ${note}`}`);
    if (reply.status !== expected) {
      failures.push(`${method} ${path} answered ${reply.status}, expected ${expected}: ${redact(reply.text.slice(0, 160), tokens)}`);
      throw new Abort(`${method} ${path}`);
    }
    try {
      const parsed = JSON.parse(reply.text) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : {};
    } catch {
      return {};
    }
  }
  const get = (path: string): Promise<Json> => send('GET', path, undefined, undefined, 200);
  const factionsOf = (state: Json): number[] => [...new Set((state.owners as [number, number][]).map(([, faction]) => faction))].sort((a, b) => a - b);

  try {
    // 1. A lobby, created with no credential.
    begin();
    const made = await send('POST', '/matches', undefined, { mapId: 'dev', timing: TIMING, requestId: 'hand-run-create' }, 201);
    const hostToken = made.hostToken as string;
    tokens.push(hostToken);
    const matchId = made.matchId as string;
    check((made.match as Json).stage === 'lobby', `the new match is a lobby; the host token is ${tokenPrefix(hostToken)}`);
    const base = `/matches/${matchId}`;

    // 2. Two joins, two tokens.
    begin();
    const players: { name: string; playerId: string; local: string; token: string }[] = [];
    for (const name of ['Ana', 'Bea']) {
      const joined = await send('POST', `${base}/players`, undefined, { name, requestId: `hand-run-join-${name}` }, 201);
      const token = joined.playerToken as string;
      tokens.push(token);
      const playerId = joined.playerId as string;
      players.push({ name, playerId, local: playerId.slice('player:'.length), token });
      check(joined.name === name, `${name} joined as ${playerId}, token ${tokenPrefix(token)}`);
    }
    const [ana, bea] = players as [(typeof players)[number], (typeof players)[number]];
    check(ana.token !== bea.token && ana.playerId !== bea.playerId, 'the two players have different ids and different tokens');

    // 3. The players list.
    begin();
    const listed = (await get(`${base}/players`)).items as { playerId: string; name: string; joinedSeq: number }[];
    figures.names = listed.map((p) => p.name);
    check(JSON.stringify(listed.map((p) => [p.playerId, p.name])) === JSON.stringify([[ana.playerId, 'Ana'], [bea.playerId, 'Bea']]), 'the list holds Ana then Bea, in join order');
    check(JSON.stringify((await get(base)).playerCount) === '2', 'the match read counts 2 players');

    // 4. Only the host starts it.
    begin();
    await send('POST', `${base}/start`, ana.token, {}, 403, '(a player token)');
    const started = await send('POST', `${base}/start`, hostToken, {}, 200, '(the host token)');
    check(started.stage === 'phase-1', 'the host started the match: phase 1');
    figures.totalRounds = started.totalRounds as number;

    // 5. The winner predictions, each under its own token.
    begin();
    const living0 = factionsOf(await get(`${base}/states/0`));
    const winners = pickFactions(living0);
    const predict = async (who: (typeof players)[number], body: Json, note: string): Promise<void> => {
      await send('POST', `${base}/predictions`, who.token, { ...body, playerId: who.local }, 200, `${who.name} ${note}`);
      figures.predictionsAccepted += 1;
    };
    await predict(ana, { kind: 'winner', faction: winners.first }, `winner ${winners.first}`);
    await predict(bea, { kind: 'winner', faction: winners.last }, `winner ${winners.last}`);
    await send('POST', `${base}/predictions`, ana.token, { kind: 'winner', faction: winners.first, playerId: bea.local }, 403, "(Ana's token under Bea's id)");
    figures.refusals += 1;

    // 6. The rounds: the host steps every one, each player predicts the victim and the absorber.
    begin();
    for (let round = 1; round <= figures.totalRounds; round += 1) {
      say(`  round ${round}`);
      const living = pickFactions(factionsOf(await get(`${base}/states/${round - 1}`)));
      await predict(ana, { kind: 'victim', round, faction: living.first }, `victim ${living.first}`);
      await predict(bea, { kind: 'victim', round, faction: living.last }, `victim ${living.last}`);
      const step = async (kind: (typeof STEP_KINDS)[number]): Promise<void> => {
        const performed = await send('POST', `${base}/advance`, hostToken, { round, step: kind }, 200, `(host, ${kind})`);
        check(performed.result === 'performed', `${kind} of round ${round} performed`);
        figures.hostSteps += 1;
      };
      await step('phase-1-close');
      const victim = (await get(base)).victim as Json;
      const forced = victim.forced === true;
      if (forced) {
        figures.forcedRounds += 1;
        const refused = await send('POST', `${base}/predictions`, ana.token, { kind: 'absorber', round, faction: (victim.candidates as number[])[0], playerId: ana.local }, 409, '(Ana, absorber)');
        check(refused.kind === 'forced-absorber', `victim ${String(victim.victim)} has one candidate: the absorber is forced and a prediction is refused`);
        figures.refusals += 1;
      } else {
        const absorbers = pickFactions(victim.candidates as number[]);
        await predict(ana, { kind: 'absorber', round, faction: absorbers.first }, `absorber ${absorbers.first}`);
        await predict(bea, { kind: 'absorber', round, faction: absorbers.last }, `absorber ${absorbers.last}`);
      }
      await step('phase-2-close');
      await step('application');
      figures.rounds = round;
    }

    // 7. Finished, and the secret is public.
    begin();
    const finished = await get(base);
    check(finished.stage === 'finished' && finished.appliedRounds === figures.totalRounds, `the match is finished after ${figures.totalRounds} rounds`);
    check(typeof finished.matchSecret === 'string', 'the match secret is public once the match is finished');

    // 8. The leaderboard.
    begin();
    const board = (await get(`${base}/leaderboard`)).items as Json[];
    const problems = leaderboardProblems(board, ['Ana', 'Bea']);
    check(problems.length === 0, problems.length === 0 ? 'both names are on the leaderboard, ranks in order' : problems.join('; '));
    figures.leaderboard = board.map((row) => ({ rank: row.rank as number, name: String(row.name), total: row.total as number }));
    for (const row of figures.leaderboard) say(`    #${row.rank} ${row.name}: ${row.total} points`);

    // 9. The names in the other reads.
    begin();
    for (const round of Array.from({ length: figures.totalRounds }, (_, k) => k + 1)) {
      for (const phase of [1, 2]) {
        const page = (await get(`${base}/results/${round}/${phase}/winners`)).items as Json[];
        const wellFormed = page.every((item) => Object.keys(item).join(',') === 'playerId,name' && figures.names.includes(String(item.name)));
        check(wellFormed, `round ${round} phase ${phase}: ${page.map((item) => String(item.name)).join(', ') || 'nobody'} guessed right`);
        figures.rightGuesses += page.length;
      }
    }
    for (const who of players) {
      const own = await get(`${base}/players/${who.playerId}/results`);
      check(own.name === who.name, `the results of ${who.playerId} carry the name ${who.name}`);
    }
    const phaseRows = (await get(`${base}/results/1/1`)).items as Json[];
    check(phaseRows.length > 0 && phaseRows.every((row) => typeof row.name === 'string'), 'the phase results of round 1 name their players');

    // 10. No token in the transcript.
    begin();
    check(!tokens.some((token) => lines.join('\n').includes(token)), 'no full token appears in the transcript');
  } catch (error) {
    if (!(error instanceof Abort)) failures.push(`the run stopped: ${error instanceof Error ? error.message : String(error)}`);
    say(`  stopped: ${failures[failures.length - 1] ?? 'unknown'}`);
  }
  say(`figures: ${JSON.stringify({ ...figures, slowestMs: Math.round(figures.slowestMs) })}`);
  say(failures.length === 0 ? 'result: ok' : `result: ${failures.length} failure(s)`);
  return { lines, failures, figures };
}

// ---- the process --------------------------------------------------------------------------------------------------------

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const DEV_MAP = fileURLToPath(new URL('../../../maps/dev', import.meta.url)).replace(/[\\/]$/, '');
const LIMIT = '100000';

function spawnServer(): { proc: ChildProcess; port: Promise<number>; stderr: () => string; kill: () => Promise<void> } {
  const clean: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('MBRG_')) delete clean[key];
  const env = {
    ...clean,
    MBRG_OPERATOR_CREDENTIAL: randomBytes(24).toString('hex'),
    MBRG_MAPS: JSON.stringify({ dev: DEV_MAP }),
    MBRG_DATABASE: ':memory:',
    MBRG_HOST: '127.0.0.1',
    MBRG_PORT: '0',
    MBRG_PUBLIC_MAPS: 'dev',
    MBRG_LIMIT_ANONYMOUS: LIMIT,
    MBRG_LIMIT_READS: LIMIT,
    MBRG_LIMIT_COMMANDS: LIMIT,
    MBRG_LIMIT_SUBMISSIONS: LIMIT,
    MBRG_LIMIT_ADVANCES: LIMIT,
  };
  const proc = spawn(process.execPath, ['--import', 'tsx', MAIN], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

const callOn = (port: number): Call => (method, path, token, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = { connection: 'close' };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });

async function main(): Promise<number> {
  const server = spawnServer();
  try {
    const port = await server.port;
    process.stdout.write(`server on port ${port}, node ${process.version}\n`);
    const report = await runHandRun(callOn(port), (line) => void process.stdout.write(`${line}\n`));
    return report.failures.length === 0 ? 0 : 1;
  } finally {
    await server.kill();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`hand run failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
}
