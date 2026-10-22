import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSqliteExperimentalWarning } from '../src/warnings';

// NFR-53 (D7, plan sections 7 and 8): `tsx` is the runner, and the only warning ever hidden is the
// `node:sqlite` ExperimentalWarning. Child processes run `process.execPath`, wait, and are killed on timeout.

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const SERVER_DIR = path('..');
const ROOT_DIR = path('../../..');
const MAIN = path('../src/main.ts');
const PLAIN = path('./fixtures/sqlite-plain.mjs');
const FILTERED = path('./fixtures/sqlite-filtered.ts');
const SQLITE_WARNING = /ExperimentalWarning: SQLite is an experimental feature/;

const run = (args: string[], cwd: string): { code: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL' });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const viaTsx = (file: string, ...rest: string[]): string[] => ['--import', 'tsx', file, ...rest];

describe('warning filter predicate', () => {
  it('NFR-53 drops only an ExperimentalWarning whose message mentions SQLite', () => {
    expect(isSqliteExperimentalWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning')).toBe(true);
    expect(isSqliteExperimentalWarning('the sqlite thing', 'ExperimentalWarning')).toBe(true);
    expect(isSqliteExperimentalWarning('SQLite is an experimental feature', 'TestWarning')).toBe(false);
    expect(isSqliteExperimentalWarning('SQLite is an experimental feature', undefined)).toBe(false);
    expect(isSqliteExperimentalWarning('Type stripping is an experimental feature', 'ExperimentalWarning')).toBe(false);
    expect(isSqliteExperimentalWarning('', 'ExperimentalWarning')).toBe(false);
    expect(isSqliteExperimentalWarning('SQLite', 'DeprecationWarning')).toBe(false);
  });
});

describe('runner', () => {
  it('NFR-53 without the filter, Node may print the SQLite ExperimentalWarning (recorded, version dependent)', () => {
    const r = run([PLAIN], SERVER_DIR);
    expect(r.code).toBe(0);
    // Recorded in plan section 13: printed on Node v24.0.0; Node v24.21.0 (CI) no longer prints it. The filter must
    // work either way, so the warning is only checked for its exact text when it is there.
    if (SQLITE_WARNING.test(r.stderr)) {
      expect(r.stderr).toMatch(/ExperimentalWarning: SQLite is an experimental feature/);
    }
    expect(r.stderr).toContain('TestWarning');
  });

  it('NFR-53 with the filter installed first, the SQLite warning is gone and other warnings stay', () => {
    const r = run(viaTsx(FILTERED), SERVER_DIR);
    expect(r.code).toBe(0);
    expect(SQLITE_WARNING.test(r.stderr)).toBe(false);
    expect(r.stderr).toContain('TestWarning: planted');
    expect(r.stderr).toContain('ExperimentalWarning: other experimental');
  });

  it.each([
    ['apps/server', SERVER_DIR],
    ['the repository root', ROOT_DIR],
  ])('NFR-53 main.ts --check runs through tsx from %s and exits 0 with a quiet stderr', (_name, cwd) => {
    const r = run(viaTsx(MAIN, '--check'), cwd);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('check ok');
    expect(SQLITE_WARNING.test(r.stderr)).toBe(false);
    expect(r.stderr).not.toMatch(/Warning/);
  });

  it('NFR-53 main.ts without --check does nothing visible and exits 0 (no server in M1)', () => {
    const r = run(viaTsx(MAIN), SERVER_DIR);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });
});
