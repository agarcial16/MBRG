import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUMMARY_KEYS } from '../scripts/load-stats';

// The smoke run of the load script (plan 19.9): 1 match, 5 streams, 5 submissions per second, I = 3, L1 = 1, L2 = 0, about
// 4 s. It checks the summary shape and that nothing failed; no target is asserted (the figures come from the hand run).

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

describe('the load script smoke run', () => {
  it('NFR-49 (smoke run) `load.ts --smoke` exits 0 and prints one summary line with the documented keys and no failure', async () => {
    const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx', 'scripts/load.ts', '--smoke'], { cwd: SERVER_DIR, timeout: 90_000, windowsHide: true }, (error, stdout, stderr) => {
        if (error !== null && (error as { code?: unknown }).code === undefined) reject(error);
        else resolve({ code: error === null ? 0 : ((error as { code?: number }).code ?? null), stdout, stderr });
      });
    });
    expect(run.code, run.stderr).toBe(0);
    const lines = run.stdout.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const summary = JSON.parse(lines[0] as string) as Record<string, number | null>;
    expect(Object.keys(summary)).toStrictEqual([...SUMMARY_KEYS]);
    expect(summary.failures).toBe(0);
    expect(summary.replies).toBeGreaterThan(5);
    expect(summary.steps).toBeGreaterThanOrEqual(1);
    expect(typeof summary.replyP95Ms).toBe('number');
    expect(typeof summary.worstStepDelayMs).toBe('number');
    expect(typeof summary.restartMs).toBe('number');
  }, 120_000);
});
