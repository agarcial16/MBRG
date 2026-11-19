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

describe('NFR-118 the guild id never leaves the bot', () => {
  const guildLines = (text: string): string[] => text.split('\n').filter((line) => /guild/i.test(line.replace(/GatewayIntentBits\.Guilds/g, '')));

  it('NFR-118 only the shell, the translation and the key module name a guild, and no line that does logs, replies, sends or builds a request', () => {
    const named = all.filter((f) => guildLines(f.text).length > 0);
    expect(named.map((f) => f.path).sort()).toEqual(['discord/shell.ts', 'discord/translate.ts', 'io/community.ts']);
    for (const file of named) {
      for (const line of guildLines(file.text)) expect(line, `${file.path}: ${line}`).not.toMatch(/log\(|console\.|reply\(|send\(|fetch\(|JSON\.stringify/);
    }
  });

  it('NFR-118 the shell reads the guild id once, to hand it to the translation, and the core never sees it', () => {
    const shell = all.find((f) => f.path === 'discord/shell.ts')!.text;
    expect(shell.match(/guildId/g)).toHaveLength(1);
    for (const file of core) expect(/guild/i.test(file.text), file.path).toBe(false);
  });
});

describe('FR-573 NFR-118 the bot logs closed codes and never a body', () => {
  const logCalls = (text: string): string[] => text.split('\n').filter((line) => /\blog\(|console\./.test(line));

  it('FR-573 NFR-118 every log call of the bot is a closed code written as a literal, and the server client logs nothing', () => {
    for (const file of all) {
      for (const line of logCalls(file.text)) {
        // Either a call with a quoted code, the definition of the logger, or one of the fixed start-up messages of the operator console.
        expect(line, `${file.path}: ${line}`).toMatch(/log\('[a-z-]+'\)|const log = |console\.(error|log)\((fill\(STRINGS\.\w+|STRINGS\.\w+)/);
      }
    }
    expect(logCalls(all.find((f) => f.path === 'io/server-client.ts')!.text)).toEqual([]);
  });

  it('FR-573 the history request is built in one place: the key, the asker and the cursor go in the body, and the path is a constant', () => {
    const client = all.find((f) => f.path === 'io/server-client.ts')!.text;
    expect(client.match(/'\/history'/g)).toHaveLength(1);
    expect(client).toMatch(/call\('POST', '\/history', decoded\(readHistoryPage\), options\.credential, \{/);
    expect(client).not.toMatch(/\/history\$\{|\/history\?/);
  });
});

describe('FR-569 FR-573 the ranking request', () => {
  it('FR-573 the ranking request is built in one place: the key, the order, the asker and the cursor go in the body, and the path is a constant', () => {
    const client = all.find((f) => f.path === 'io/server-client.ts')!.text;
    expect(client.match(/'\/ranking'/g)).toHaveLength(1);
    expect(client).toMatch(/call\('POST', '\/ranking', decoded\(readRankingPage\), options\.credential, \{/);
    expect(client).not.toMatch(/\/ranking\$\{|\/ranking\?/);
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
