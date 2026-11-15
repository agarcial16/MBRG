import { describe, expect, it } from 'vitest';
import clientHtml from '../client.html?raw';
import indexHtml from '../index.html?raw';
import viteConfig from '../vite.config.ts?raw';
import gitignore from '../../../.gitignore?raw';
import { codeOnly, htmlText, htmlTextAttributes, languageViolations } from './helpers/scan';

const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(all).map(([path, src]) => [path.replace('../src/', ''), src] as const);

describe('FR-310 (web test client) the page', () => {
  it('NFR-28 (web test client) client.html has no text nodes and no text attributes, and is ASCII only', () => {
    expect(htmlText(clientHtml)).toBe('');
    expect(htmlTextAttributes(clientHtml)).toStrictEqual([]);
    expect(/[^\x00-\x7f]/.test(clientHtml)).toBe(false);
    expect(htmlText('<p>Hola</p>')).not.toBe('');
  });

  it('FR-310 (web test client) the page loads its own module and the production page does not mention it', () => {
    expect(clientHtml).toContain('src="/src/ui/client-main.ts"');
    expect(indexHtml).not.toContain('client');
  });

  it('FR-310 (web test client) the page is not a production build input: the config names no input at all (index.html only)', () => {
    expect(viteConfig).not.toMatch(/client\.html|rollupOptions|input/);
  });

  it('FR-310 (web test client) only the client page reads the credential variable, and the credential file is ignored by version control', () => {
    const readers = sources.filter(([, src]) => /VITE_MBRG_WEB_CREDENTIAL/.test(src)).map(([path]) => path);
    expect(readers).toStrictEqual(['ui/client-main.ts']);
    expect(gitignore.split(/\r?\n/)).toContain('.env.local');
  });

  it('FR-310 (web test client) the client page sets the client marker and no other source does', () => {
    const setters = sources.filter(([, src]) => /setAttribute\(\s*['"]data-mbrg-scene['"]/.test(src)).map(([path]) => path).sort();
    expect(setters).toStrictEqual(['ui/client-main.ts', 'ui/main.ts']);
    const client = sources.find(([path]) => path === 'ui/client-main.ts')![1];
    expect(client).toMatch(/data-mbrg-scene['"]\s*,\s*['"]client['"]/);
  });

  it('NFR-28 (web test client) the client page and its form module hold no Spanish literal in a text sink', () => {
    for (const path of ['ui/client-main.ts', 'core/client-form.ts']) {
      const src = sources.find(([p]) => p === path)![1];
      expect(languageViolations(src), path).toStrictEqual([]);
      expect(codeOnly(src)).not.toMatch(/\bMath\.random\b|\bDate\.now\b/);
    }
  });
});
