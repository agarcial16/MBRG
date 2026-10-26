import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import entrySource from '../src/ui/entry.ts?raw';
import liveConfigSource from '../src/ui/live-config.ts?raw';
import mainSource from '../src/ui/main.ts?raw';
import { codeOnly } from './helpers/scan';

// Production build output (spec 008 plan 21.10): the debug scene, the development map assets, the web test client and the
// development credential never reach a production page. The build runs in memory through the Vite API (no files written).
type Env = Record<string, string | undefined>;
const processEnv = (globalThis as unknown as { process: { env: Env } }).process.env;

const PLANTED = 'planted-credential-7f3a9c1e5b';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
/** Strings that only the debug path (the sim and its errors) carries. */
const DEBUG_MARKERS = ['invalid-seed', 'round-out-of-range', 'invalid-round'];
const MAP_FILE = /(?:^|\/)(?:map|ids|presentation)[-.][^/]*\.(?:json|png)$|(?:^|\/)(?:map|ids|presentation)\.(?:json|png)$/;

interface Built {
  names: string[];
  text: string;
}

/** Builds the viewer for `nodeEnv` with a planted credential in the environment; returns every output file name and text. */
async function buildViewer(nodeEnv: 'production' | 'development'): Promise<Built> {
  const saved = { NODE_ENV: processEnv.NODE_ENV, cred: processEnv.VITE_MBRG_WEB_CREDENTIAL };
  processEnv.NODE_ENV = nodeEnv;
  processEnv.VITE_MBRG_WEB_CREDENTIAL = PLANTED;
  try {
    const result = (await build({
      root: ROOT,
      configFile: `${ROOT}vite.config.ts`,
      logLevel: 'silent',
      mode: nodeEnv,
      build: { write: false, outDir: 'out-test', emptyOutDir: false },
    })) as { output: { fileName: string; type: string; code?: string; source?: string | Uint8Array }[] };
    const names = result.output.map((o) => o.fileName);
    const text = result.output
      .map((o) => (o.type === 'chunk' ? (o.code ?? '') : typeof o.source === 'string' ? o.source : new TextDecoder().decode(o.source)))
      .join('\n');
    return { names, text };
  } finally {
    if (saved.NODE_ENV === undefined) delete processEnv.NODE_ENV;
    else processEnv.NODE_ENV = saved.NODE_ENV;
    if (saved.cred === undefined) delete processEnv.VITE_MBRG_WEB_CREDENTIAL;
    else processEnv.VITE_MBRG_WEB_CREDENTIAL = saved.cred;
  }
}

describe('FR-309 FR-311 FR-306 (production build) the production output holds no debug scene, no test client and no credential', () => {
  it('FR-311 FR-309 (production build) a production build with a planted credential has no planted value, no dev map asset, no debug or client marker and no client page', async () => {
    const out = await buildViewer('production');
    expect(out.names.some((n) => n.endsWith('.js'))).toBe(true);
    expect(out.names).toContain('index.html');
    // FR-311: the development credential never reaches the output.
    expect(out.text).not.toContain(PLANTED);
    expect(out.text).not.toContain('VITE_MBRG_WEB_CREDENTIAL');
    // FR-309: the debug scene and the development map package are out of the production page.
    expect(out.names.filter((n) => MAP_FILE.test(n))).toStrictEqual([]);
    expect(out.names.filter((n) => /\.(png|json)$/.test(n))).toStrictEqual([]);
    expect(out.text).not.toMatch(/data-mbrg-scene/);
    expect(out.text).not.toMatch(/data-mbrg-scene["']?\s*,\s*["'](debug|client)/);
    expect(out.names.some((n) => n.includes('client'))).toBe(false);
    for (const marker of DEBUG_MARKERS) expect(out.text, marker).not.toContain(marker);
  }, 120_000);

  it('FR-309 (production build) a development build does carry the debug scene and the map assets (the markers are not vacuous)', async () => {
    const out = await buildViewer('development');
    expect(out.names.filter((n) => MAP_FILE.test(n)).length).toBeGreaterThanOrEqual(3);
    expect(out.text).toContain('data-mbrg-scene');
    for (const marker of DEBUG_MARKERS) expect(out.text, marker).toContain(marker);
  }, 120_000);

  it('FR-306 (production build) the entry imports the debug scene only behind the development constant and never reads the credential', () => {
    expect(codeOnly(entrySource)).toMatch(/import\.meta\.env\.DEV\s*\?\s*\(\)\s*=>\s*import\(/);
    expect(liveConfigSource).not.toMatch(/WEB_CREDENTIAL/);
    expect(entrySource).not.toMatch(/WEB_CREDENTIAL/);
  });

  it('FR-309 (production build) the debug scene stays on the development server for a seed-only address and never connects to the server', () => {
    // The scene choice for a seed-only address is `debug` in development (live-entry covers the production message).
    const code = codeOnly(mainSource);
    expect(code).not.toMatch(/\bfetch\b|\bEventSource\b|\bXMLHttpRequest\b/);
    expect(mainSource).not.toMatch(/from\s+['"]\.\/(?:live-|web-crypto)/);
    expect(mainSource).toMatch(/setAttribute\(\s*['"]data-mbrg-scene['"]\s*,\s*['"]debug['"]\s*\)/);
  });
});
