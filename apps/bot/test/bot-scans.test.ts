import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/core/strings';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
const all = files(SRC).map((path) => ({ path: relative(SRC, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }));
const core = all.filter((f) => f.path.startsWith('core/'));

describe('FR-461 one strings module', () => {
  it('FR-461 every file but the strings module is ASCII only, so no sentence lives elsewhere', () => {
    for (const file of all) {
      if (file.path === 'core/strings.ts') continue;
      expect(/[^\x00-\x7f]/.test(file.text), file.path).toBe(false);
    }
    expect(/[^\x00-\x7f]/.test(readFileSync(join(SRC, 'core', 'strings.ts'), 'utf8'))).toBe(true);
  });

  it('FR-461 every sentence of the strings module is used by code (no dead sentence)', () => {
    const code = all.filter((f) => f.path !== 'core/strings.ts').map((f) => f.text).join('\n');
    const unused = Object.keys(STRINGS).filter((key) => !new RegExp(`STRINGS\\.${key}\\b`).test(code));
    expect(unused).toEqual([]);
  });
});

describe('NFR-90 the core is pure', () => {
  it('NFR-90 core files import no Discord library, no node module and no I/O, and use no clock, chance or timer', () => {
    for (const file of core) {
      expect(file.text, file.path).not.toMatch(/from 'discord\.js'|from 'node:|require\(/);
      expect(file.text, file.path).not.toMatch(/Date\.now|new Date|Math\.random|setTimeout|setInterval|performance\.now|fetch\(|process\./);
      expect(file.text, file.path).not.toMatch(/from '\.\.\/(io|discord)\//);
    }
  });

  it('NFR-90 only the shell touches the Discord library, and no file imports the simulation or another app', () => {
    const importers = all.filter((f) => /from 'discord\.js'/.test(f.text)).map((f) => f.path);
    expect(importers).toEqual(['discord/shell.ts']);
    for (const file of all) {
      expect(file.text, file.path).not.toMatch(/@mbrg\/sim|@mbrg\/shared|apps\/web|apps\/server/);
    }
  });
});

describe('NFR-89 start-up', () => {
  it('NFR-89 the bot refuses to start naming the missing variable and echoes no secret', () => {
    const entry = join(SRC, 'main.ts');
    const run = spawnSync(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', DISCORD_TOKEN: 'PLANTED-DISCORD-TOKEN-0123456789' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('MBRG_SERVER_URL');
    expect(run.stderr).toContain('MBRG_DISCORD_CREDENTIAL');
    expect(run.stderr).toContain('MBRG_BOT_STATE_FILE');
    expect(run.stderr).not.toContain('DISCORD_TOKEN');
    expect(run.stdout + run.stderr).not.toContain('PLANTED');
  }, 90_000);
});
