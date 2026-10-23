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
import { OPERATOR, creationBody, serviceHarness } from './helpers/service-harness';

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
      const options = { store, clock: fakeClock(0), maps: createMapCatalog({}), settings: { operatorCredential: OPERATOR, maps: {}, runningMatchLimit: 20, databasePath: ':memory:' } };
      expect(() => createMatchService({ ...options, testSeedSource: 'fixed' as unknown as TestSeedSource })).toThrow(TypeError);
      expect(() => createMatchService({ ...options, testSeedSource: (() => (k: number) => k) as TestSeedSource })).not.toThrow();
    } finally {
      store.close();
    }
  });

  it('FR-260 once built, the service offers no way to set or read a seed source', () => {
    const h = serviceHarness({ testSeedSource: () => (k) => k });
    try {
      expect(Object.keys(h.service).sort()).toStrictEqual(['advance', 'close', 'create', 'hostTokenMatches', 'listMatches', 'mapFile', 'ownPredictions', 'ownPredictionsPage', 'publicMatch', 'purgeMemos', 'readPublicMatch', 'recordAt', 'records', 'start', 'stateAt', 'submit', 'subscribe', 'tick']);
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
    expect(call![1]!.split(',').map((part) => part.trim().split(':')[0]!.trim())).toStrictEqual(['store', 'clock', 'maps', 'settings']);
    // The settings module reads the thirteen listed variables and never anything seed-like.
    expect(SEED_WORDS.test(settings)).toBe(false);
    expect([...new Set([...settings.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]))].sort()).toStrictEqual(
      [
        'MBRG_DATABASE', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_OPERATOR_CREDENTIAL', 'MBRG_CLIENTS', 'MBRG_ALLOWED_ORIGINS',
        'MBRG_HOST', 'MBRG_PORT', 'MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS', 'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS',
      ].sort(),
    );
  });

  it('NFR-47 (f) a started production entry point is unchanged by environment variables named like a seed source', () => {
    const env = { MBRG_OPERATOR_CREDENTIAL: OPERATOR, MBRG_MAPS: JSON.stringify({ dev: DEV_DIR.replace(/[\\/]$/, '') }), MBRG_DATABASE: ':memory:' };
    const plain = runMain(env);
    const noisy = runMain({ ...env, MBRG_TEST_SEED_SOURCE: '1', MBRG_SEED_SOURCE: 'fixed', MBRG_ROUND_SEED: '5', TEST_SEED_SOURCE: '1' });
    expect(plain.code).toBe(0);
    expect(plain.stdout.trim()).toBe('service ready; no listener yet');
    expect(noisy).toStrictEqual(plain);
  });

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
});
