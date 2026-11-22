import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMPORT_MODES, IMPORT_USAGE, parseMode, runImport } from '../src/cli/import';
import { realFs } from '../src/io/fs-ops';

const here = dirname(fileURLToPath(import.meta.url));

async function run(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const status = await runImport(args, {
    fs: realFs,
    root: join(here, '..', '..', '..'),
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
  });
  return { status, stdout, stderr };
}

describe('the import-map command surface (command line only; the modes land in later tasks)', () => {
  it('an unknown mode exits 2 with the usage line on stderr and nothing on stdout', async () => {
    const r = await run(['paint']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(IMPORT_USAGE);
    expect(r.stderr).toContain('unknown mode: paint');
  });

  it('no mode at all is a usage error too', async () => {
    const r = await run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(IMPORT_USAGE);
  });

  it('a mode word that looks like an option is a usage error, never a mode', async () => {
    for (const word of ['--help', '-x', '', 'EXTRACT', 'import ']) {
      const r = await run([word]);
      expect(r.status, JSON.stringify(word)).toBe(2);
    }
  });

  it('the parser accepts the three known mode words and hands back the other arguments untouched', () => {
    expect([...IMPORT_MODES]).toStrictEqual(['extract', 'inspect', 'import']);
    for (const mode of IMPORT_MODES) {
      expect(parseMode([mode, '--a=1', 'b'])).toStrictEqual({ mode, rest: ['--a=1', 'b'] });
    }
    expect(parseMode(['paint'])).toBe('unknown mode: paint');
    expect(parseMode([])).toBe('a mode is required');
  });

  it('the usage line names the three modes', () => {
    for (const mode of IMPORT_MODES) expect(IMPORT_USAGE).toContain(mode);
  });

  it('the workspace script import-map runs the command through tsx', () => {
    const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['import-map']).toBe('tsx src/cli/import.ts');
    // the existing scripts stay as they were
    expect(manifest.scripts['build-map']).toBe('tsx src/cli/build.ts');
    expect(manifest.scripts['extract']).toBe('tsx src/cli/extract.ts');
  });
});
