import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEV_DIR } from './digests';
import { OPERATOR } from './service-harness';

// Runs the production entry point (`node --import tsx src/main.ts`) as a child process, the way an operator would. Every
// child is killed by its PID in a `finally` (never left running), its output is collected, and the temporary directories
// of a test are removed by the caller after `exited` resolves (on Windows a killed process releases its files a moment
// later, which `rmSync` retries absorb).

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const MAIN = fileURLToPath(new URL('../../src/main.ts', import.meta.url));

/** The operator credential of the child tests, the same as the in-process ones. */
export const CHILD_OPERATOR = OPERATOR;

/** The settings a child needs: the dev map, an in-memory store, any free port, limits raised for the tests. */
export const baseEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  MBRG_OPERATOR_CREDENTIAL: OPERATOR,
  MBRG_MAPS: JSON.stringify({ dev: DEV_DIR.replace(/[\\/]$/, '') }),
  MBRG_DATABASE: ':memory:',
  MBRG_HOST: '127.0.0.1',
  MBRG_PORT: '0',
  MBRG_LIMIT_COMMANDS: '100000',
  MBRG_LIMIT_READS: '100000',
  MBRG_LIMIT_ANONYMOUS: '100000',
  MBRG_LIMIT_STREAMS: '100000',
  MBRG_LIMIT_ANONYMOUS_STREAMS: '100000',
  MBRG_LIMIT_ADVANCES: '100000',
  MBRG_LIMIT_SUBMISSIONS: '100000',
  ...extra,
});

export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface MainChild {
  readonly pid: number;
  stdout(): string;
  stderr(): string;
  /** Resolves when the process has ended. */
  readonly exited: Promise<ExitInfo>;
  /** Whether the process has ended. */
  hasExited(): boolean;
  signal(name: NodeJS.Signals): boolean;
  /** Kills by PID (SIGKILL: TerminateProcess on Windows) and waits for the end. */
  kill(): Promise<ExitInfo>;
}

/** Spawns the entry point with exactly `env` (no `MBRG_*` variable of the parent) and `args`. */
export function spawnMain(env: Record<string, string>, args: readonly string[] = []): MainChild {
  const clean: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('MBRG_')) delete clean[key];
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    cwd: SERVER_DIR,
    env: { ...clean, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  let err = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
  let ended = false;
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once('exit', (code, signal) => {
      ended = true;
      resolve({ code, signal });
    });
    child.once('error', () => {
      ended = true;
      resolve({ code: null, signal: null });
    });
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('the child process did not start');
  return {
    pid,
    stdout: () => out,
    stderr: () => err,
    exited,
    hasExited: () => ended,
    signal: (name) => child.kill(name),
    async kill() {
      if (!ended) child.kill('SIGKILL');
      return exited;
    },
  };
}

/** Polls until `check` returns a value (or the child ends / the time is up: then it throws, naming the output). */
export async function waitFor<T>(child: MainChild, check: () => T | undefined, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (child.hasExited()) throw new Error(`the child ended while waiting for ${what}: stdout=${child.stdout()} stderr=${child.stderr()}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: stdout=${child.stdout()} stderr=${child.stderr()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The events a child logged on a stream, parsed (every line must be JSON). */
export const eventsOf = (text: string): Record<string, unknown>[] =>
  text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** The port of the `listening` event, once printed. */
export const listeningPort = (child: MainChild): number | undefined => {
  const event = eventsOf(child.stdout()).find((e) => e.event === 'listening');
  return typeof event?.port === 'number' ? event.port : undefined;
};

/** Starts the entry point, waits for `listening`, runs `body(child, port)` and always kills the child afterwards. */
export async function withMain<T>(env: Record<string, string>, body: (child: MainChild, port: number) => Promise<T>): Promise<T> {
  const child = spawnMain(env);
  try {
    const port = await waitFor(child, () => listeningPort(child), 'the listening event');
    return await body(child, port);
  } finally {
    await child.kill();
  }
}

/** Runs the entry point until it exits by itself (invalid settings, a busy port); killed at the time limit. */
export async function runToExit(env: Record<string, string>, args: readonly string[] = [], timeoutMs = 30_000): Promise<ExitInfo & { stdout: string; stderr: string }> {
  const child = spawnMain(env, args);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)));
    const result = await Promise.race([child.exited, limit]);
    if (result === 'timeout') throw new Error(`the child did not exit: stdout=${child.stdout()} stderr=${child.stderr()}`);
    return { ...result, stdout: child.stdout(), stderr: child.stderr() };
  } finally {
    clearTimeout(timer);
    await child.kill();
  }
}
