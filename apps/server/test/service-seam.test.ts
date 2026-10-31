import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roundSeed } from '../src/secret';
import { createMatchService, roundSeeds } from '../src/service/matches';
import type { TestSeedSource } from '../src/service/matches';
import { createMapCatalog } from '../src/service/maps';
import { openStore } from '../src/store/sqlite';
import { fakeClock } from './helpers/fake-clock';
import { DEV_DIR } from './helpers/digests';
import { OFF_PUBLIC, OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import { baseEnv, eventsOf, withMain } from './helpers/main-child';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import type { StepFailure } from '../src/service/matches';

// FR-260: the test-only round-seed source is a parameter of the in-process service construction and of nothing else.
// NFR-47 (f): the production entry point offers no way to set it. NFR-54 (logs): the service and the entry point log
// no credential, secret, token or player data (so far they log only fixed texts; the HTTP logs are M3a).

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const short = (file: string): string => file.replace(/^.*\/src\//, '');

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$`, 'gm');
/** Code with comments removed (strings kept, so a variable name inside a string is also seen). */
const stripComments = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => s ?? '');

const SEED_WORDS = /seed/i;
const filesNaming = (re: RegExp): string[] =>
  Object.entries(sources)
    .filter(([, raw]) => re.test(stripComments(raw)))
    .map(([f]) => short(f))
    .sort();

const main = stripComments(Object.entries(sources).find(([f]) => short(f) === 'main.ts')![1]);
const settings = stripComments(Object.entries(sources).find(([f]) => short(f) === 'service/settings.ts')![1]);

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

const runMain = (env: Record<string, string>): { code: number | null; stdout: string; stderr: string } => {
  const clean: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('MBRG_')) delete clean[key];
  const r = spawnSync(process.execPath, ['--import', 'tsx', MAIN], { cwd: SERVER_DIR, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL', env: { ...clean, ...env } });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('the test-only round-seed source', () => {
  it('FR-260 the service constructor accepts a test seed source, and its seeds replace the HMAC derivation', () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
    const asked: string[] = [];
    const source: TestSeedSource = (matchId) => {
      asked.push(matchId);
      return (round) => 1000 + round;
    };
    const h = serviceHarness({ testSeedSource: source });
    try {
      expect(h.service.create({ credential: OPERATOR, body: creationBody('a') }).ok).toBe(true);
      const seeds = roundSeeds(source)(secret, 'match-x');
      expect([seeds(1), seeds(2), seeds(70)]).toStrictEqual([1001, 1002, 1070]);
      expect(asked).toStrictEqual(['match-x']);
    } finally {
      h.close();
    }
  });

  it('FR-260 without a test source the round seeds are the HMAC seeds of the match secret (FR-252)', () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
    const seeds = roundSeeds(undefined)(secret, 'match-x');
    expect([seeds(1), seeds(2), seeds(3), seeds(4)]).toStrictEqual([3730603940, 4041377160, 3246583532, 361591214]);
    expect(seeds(70)).toBe(roundSeed(secret, 70));
  });

  it('FR-260 a source that is not a function is refused at construction, never ignored', () => {
    const store = openStore(':memory:');
    try {
      const options = { store, clock: fakeClock(0), maps: createMapCatalog({}), settings: { operatorCredential: OPERATOR, maps: {}, runningMatchLimit: 20, databasePath: ':memory:', forcedPhaseSeconds: 5, maxPlayers: 200, publicCreation: OFF_PUBLIC } };
      expect(() => createMatchService({ ...options, testSeedSource: 'fixed' as unknown as TestSeedSource })).toThrow(TypeError);
      expect(() => createMatchService({ ...options, testSeedSource: (() => (k: number) => k) as TestSeedSource })).not.toThrow();
    } finally {
      store.close();
    }
  });

  it('FR-260 once built, the service offers no way to set or read a seed source', () => {
    const h = serviceHarness({ testSeedSource: () => (k) => k });
    try {
      expect(Object.keys(h.service).sort()).toStrictEqual(['advance', 'close', 'create', 'createPublic', 'eventsAfter', 'hostTokenMatches', 'join', 'leaderboard', 'listMatches', 'mapFile', 'ownPredictions', 'ownPredictionsPage', 'phaseResults', 'playerResults', 'playerTokenOf', 'players', 'publicMatch', 'purgeMemos', 'readPublicMatch', 'recordAt', 'records', 'start', 'startMatch', 'stateAt', 'submit', 'subscribe', 'tick']);
      expect(Object.keys(h.settings).filter((k) => SEED_WORDS.test(k))).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('FR-260 the seed source type is named only in the service module and nothing in the server sources reads it from the environment', () => {
    expect(filesNaming(/\bTestSeedSource\b|\btestSeedSource\b/)).toStrictEqual(['service/matches.ts']);
    for (const [file, raw] of Object.entries(sources)) {
      const code = stripComments(raw);
      // Environment reads are allowed only in main.ts (the settings are passed down as values);
      if (short(file) !== 'main.ts') expect(/\bprocess\s*\.\s*env\b/.test(code), short(file)).toBe(false);
    }
  });
});

describe('the production entry point', () => {
  it('NFR-47 (f) main.ts builds the service from the settings alone: no seed source and no variable that could set one', () => {
    // (main.ts also calls sim's `playRoundWithSeed` in --check: only seed-SOURCE names are forbidden there.)
    expect(/testSeedSource|seedSource|seed_source|seedOf|roundSeeds|\brandom\b|\bMBRG_TEST/i.test(main)).toBe(false);
    expect(main).toContain('readSettings(process.env)');
    const call = /createMatchService\(\{([^}]*)\}\)/.exec(main);
    expect(call).not.toBeNull();
    // The service gets its store, clock, maps, settings, the scheduler and the failure report (T4'): nothing seed-like.
    expect(call![1]!.split(',').map((part) => part.trim().split(':')[0]!.trim())).toStrictEqual(['store', 'clock', 'maps', 'settings', 'scheduler', 'onFailure']);
    // The settings module reads the 30 listed variables and never anything seed-like.
    expect(SEED_WORDS.test(settings)).toBe(false);
    expect([...new Set([...settings.matchAll(/env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort()).toStrictEqual(
      [
        'MBRG_DATABASE', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_OPERATOR_CREDENTIAL', 'MBRG_CLIENTS', 'MBRG_ALLOWED_ORIGINS',
        'MBRG_HOST', 'MBRG_PORT', 'MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS', 'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS',
        'MBRG_LIMIT_STREAMS', 'MBRG_LIMIT_ANONYMOUS_STREAMS', 'MBRG_FORCED_PHASE_SECONDS',
        'MBRG_PUBLIC_MAPS', 'MBRG_PUBLIC_MIN_INTERVAL', 'MBRG_PUBLIC_MIN_PHASE1', 'MBRG_PUBLIC_MIN_PHASE2', 'MBRG_PUBLIC_MAX_INTERVAL',
        'MBRG_MAX_OPEN_LOBBIES', 'MBRG_MAX_PUBLIC_RUNNING', 'MBRG_LOBBY_EXPIRY_HOURS',
        'MBRG_MAX_PLAYERS',
        'MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_CREATE_ALL', 'MBRG_LIMIT_JOIN_SOURCE', 'MBRG_LIMIT_JOIN_MATCH', 'MBRG_TRUSTED_PROXY_HOPS',
      ].sort(),
    );
  });

  it('forced phase setting: StepDeps has exactly map, seedOf, sha256 and forcedPhaseSeconds, and the service passes the setting', () => {
    const steps = stripComments(Object.entries(sources).find(([f]) => short(f) === 'core/steps.ts')![1]);
    const body = /export interface StepDeps \{([\s\S]*?)\n\}/.exec(steps);
    expect(body).not.toBeNull();
    expect([...body![1]!.matchAll(/^\s+readonly (\w+)\s*:/gm)].map((m) => m[1]).sort()).toStrictEqual(['forcedPhaseSeconds', 'map', 'seedOf', 'sha256']);
    const matches = stripComments(Object.entries(sources).find(([f]) => short(f) === 'service/matches.ts')![1]);
    const deps = /const depsOf = [\s\S]*?\n  \};\n/.exec(matches);
    expect(deps).not.toBeNull();
    expect(deps![0]).toMatch(/forcedPhaseSeconds:\s*settings\.forcedPhaseSeconds/);
  });

  it('NFR-47 (f) a started production entry point is unchanged by environment variables named like a seed source', async () => {
    // The entry point now listens (T4'): both children print the same lifecycle lines (the port differs), then are killed.
    const run = (extra: Record<string, string>): Promise<string[]> =>
      withMain(baseEnv(extra), async (child) => eventsOf(child.stdout()).map((e) => JSON.stringify({ ...e, port: e.event === 'listening' ? 0 : undefined })));
    const plain = await run({});
    const noisy = await run({ MBRG_TEST_SEED_SOURCE: '1', MBRG_SEED_SOURCE: 'fixed', MBRG_ROUND_SEED: '5', TEST_SEED_SOURCE: '1' });
    expect(plain.map((l) => (JSON.parse(l) as { event: string }).event)).toStrictEqual(['start-report', 'listening']);
    expect(noisy).toStrictEqual(plain);
  }, 60_000);

  it('NFR-54 (logs) the entry point logs only fixed texts and the names of invalid settings, never a value', () => {
    const r = runMain({ MBRG_OPERATOR_CREDENTIAL: OPERATOR, MBRG_MAPS: '{', MBRG_MAX_RUNNING_MATCHES: '0' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim()).toBe('invalid settings: MBRG_MAPS, MBRG_MAX_RUNNING_MATCHES');
    expect(r.stderr).not.toContain(OPERATOR);
  });

  it('NFR-54 (logs) no service source writes a log line, and the entry point prints no credential, secret, token, player or choice', () => {
    const LOGGING = /\bconsole\b|\bprocess\s*\.\s*std(?:out|err)\b|\blogger\b|\bemitWarning\b/;
    const service = Object.entries(sources).filter(([f]) => short(f).startsWith('service/'));
    expect(service.length).toBeGreaterThanOrEqual(4);
    for (const [file, raw] of service) expect(LOGGING.test(stripComments(raw)), short(file)).toBe(false);
    const lines = main.split(/\r?\n/).filter((l) => /\bconsole\./.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(/credential|secret|token|player|choice|settings\.|\.operator/i.test(line.replace(/invalid settings/, ''))).toBe(false);
  });

  it('NFR-54 (logs) only main.ts touches the process output: the log sink takes writers, and no other source logs', () => {
    const OUTPUT = /\bconsole\b|\bprocess\s*\.\s*std(?:out|err)\b|\bemitWarning\b/;
    const touching = Object.entries(sources)
      .filter(([, raw]) => OUTPUT.test(stripComments(raw)))
      .map(([f]) => short(f))
      .sort();
    // warnings.ts is the platform warning filter (NFR-53), not a log.
    expect(touching).toStrictEqual(['main.ts', 'warnings.ts']);
  });
});

// FR-292 (step failures logged), NFR-54 (logs): `onFailure(failure, cause)` is called once per failed clock step with the
// original cause, and for nothing else; the service itself logs nothing.
describe('the failure report of clock steps', () => {
  const PLANTED = 'planted-secret-value-7f3a9c';
  type Mode = 'ok' | 'storage' | 'error';
  const rig = (): { h: ReturnType<typeof serviceHarness>; mode: { value: Mode }; thrown: unknown[]; calls: { failure: StepFailure; cause: unknown }[]; id: string } => {
    const mode = { value: 'ok' as Mode };
    const thrown: unknown[] = [];
    const calls: { failure: StepFailure; cause: unknown }[] = [];
    const base = openStore(':memory:');
    const store: Store = {
      ...base,
      updateMatch(match) {
        if (mode.value !== 'ok') {
          const error = mode.value === 'storage' ? new StoreError('store-failure', 'a failure', { cause: new Error(PLANTED), sqliteCode: 10 }) : new TypeError(`bad ${PLANTED}`);
          thrown.push(error);
          throw error;
        }
        base.updateMatch(match);
      },
    };
    const h = serviceHarness({ store, scheduler: true, onFailure: (failure, cause) => void calls.push({ failure, cause }) });
    const made = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
    if (!made.ok) throw new Error('creation failed');
    return { h, mode, thrown, calls, id: made.reply.matchId };
  };

  it('FR-292 (step failures logged) a failed clock step reaches onFailure once, with the failure and the original cause (a store failure, then a TypeError)', () => {
    const { h, mode, thrown, calls, id } = rig();
    try {
      h.clock.set(START_MS + 80_000);
      mode.value = 'storage';
      expect(h.service.tick().failed).toStrictEqual([{ matchId: id, kind: 'unavailable' }]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.failure).toStrictEqual({ matchId: id, kind: 'unavailable' });
      expect(calls[0]!.cause).toBe(thrown[0]);
      expect((calls[0]!.cause as StoreError).sqliteCode).toBe(10);
      mode.value = 'error';
      expect(h.service.tick().failed).toStrictEqual([{ matchId: id, kind: 'error' }]);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.failure.kind).toBe('error');
      expect(calls[1]!.cause).toBe(thrown[1]);
      expect(calls[1]!.cause).toBeInstanceOf(TypeError);
    } finally {
      h.close();
    }
  });

  it('FR-292 (step failures logged) nothing else is reported: a good tick, an empty tick, reads and a command that fails on storage', () => {
    const { h, mode, calls, id } = rig();
    try {
      h.service.tick();
      h.clock.set(START_MS + 80_000);
      expect(h.service.tick().performed).toHaveLength(1);
      h.service.readPublicMatch(id);
      mode.value = 'storage';
      const advanced = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-2-close' } });
      expect(advanced).toStrictEqual({ ok: false, error: { kind: 'unavailable' } });
      expect(calls).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('FR-292 (step failures logged) a step that keeps failing is reported on every retry (3 s apart) and not after it succeeds', () => {
    const { h, mode, thrown, calls } = rig();
    try {
      mode.value = 'error';
      h.scheduler!.runTo(START_MS + 80_000);
      expect(calls).toHaveLength(1);
      h.scheduler!.runTo(START_MS + 89_000);
      expect(calls).toHaveLength(4);
      expect(calls.map((c) => c.cause)).toStrictEqual(thrown);
      mode.value = 'ok';
      h.scheduler!.runTo(START_MS + 92_000);
      expect(calls).toHaveLength(4);
    } finally {
      h.close();
    }
  });

  it('FR-292 (step failures logged) a step that fails at server start is reported too', () => {
    const { h, mode, calls, id } = rig();
    try {
      h.clock.set(START_MS + 80_000);
      mode.value = 'error';
      const report = h.service.start();
      expect(report.failed).toStrictEqual([{ matchId: id, kind: 'error' }]);
      expect(calls).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('FR-292 (step failures logged) a report callback that throws changes nothing: the retry is armed and the tick answers as before', () => {
    const mode = { value: 'error' as Mode };
    const base = openStore(':memory:');
    const store: Store = { ...base, updateMatch: (match) => (mode.value === 'ok' ? base.updateMatch(match) : (() => { throw new TypeError(PLANTED); })()) };
    mode.value = 'ok';
    const h = serviceHarness({
      store,
      scheduler: true,
      onFailure: () => {
        throw new Error('the sink broke');
      },
    });
    try {
      const made = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
      if (!made.ok) throw new Error('creation failed');
      h.clock.set(START_MS + 80_000);
      mode.value = 'error';
      expect(h.service.tick().failed).toStrictEqual([{ matchId: made.reply.matchId, kind: 'error' }]);
      expect(h.scheduler!.pending()).toStrictEqual([START_MS + 83_000]);
    } finally {
      h.close();
    }
  });
});
