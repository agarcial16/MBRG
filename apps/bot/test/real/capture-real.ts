// A real capture run (spec 038 done criteria, NFR-188, NFR-189): the real server and the real viewer (Vite) on this machine, a real
// match on each map advancing in real time, and the capture service with the real chrome-headless-shell. It saves the images and
// prints the time and the peak memory of each capture. Manual, not part of `npm test`:
//   MBRG_CHROME_PATH=<chrome-headless-shell> npx tsx apps/bot/test/real/capture-real.ts <out-dir>
// It starts and stops its own server (port 8787, the viewer's development default) and viewer (port 5173).
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaptureService, realAfter } from '../../src/io/capture';
import { createChromeDriver } from '../../src/io/capture-chrome';
import { pngSize } from '../../src/core/capture';

const ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, '.claude', 'review', '038'));
const CHROME = process.env.MBRG_CHROME_PATH;
if (CHROME === undefined || CHROME === '') throw new Error('Set MBRG_CHROME_PATH to chrome-headless-shell');
const OPERATOR = 'operator-credential-for-the-real-capture-run-0123456789';
const SERVER = 'http://127.0.0.1:8787';
const VIEWER = 'http://localhost:5173/';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const children: ChildProcess[] = [];
function start(command: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(child);
  return child;
}
function stopAll(): void {
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  }
}

async function until(check: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The memory the browser holds right now: the sum of the working sets of every chrome-headless-shell process, in MB (shared pages count once per process). */
function browserMb(): number {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome-headless-shell.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    let kb = 0;
    for (const line of out.split(/\r?\n/)) {
      const cells = line.split('","');
      const mem = cells[4]?.replace(/[^0-9]/g, '');
      if (mem !== undefined && mem !== '') kb += Number(mem);
    }
    return kb / 1024;
  } catch {
    return 0;
  }
}

async function createMatch(mapId: string, timing: { i: number; l1: number; l2: number }): Promise<string> {
  const response = await fetch(`${SERVER}/matches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPERATOR}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mapId, timing, requestId: `real-${mapId}-${Date.now()}`.slice(0, 60) }),
  });
  const body = (await response.json()) as { matchId?: string; match?: { matchId?: string } };
  const id = body.matchId ?? body.match?.matchId;
  if (typeof id !== 'string') throw new Error(`creation failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  return id;
}

async function applied(matchId: string): Promise<number> {
  const response = await fetch(`${SERVER}/matches/${matchId}`);
  return ((await response.json()) as { appliedRounds: number }).appliedRounds;
}

interface Measure {
  readonly what: string;
  readonly ms: number;
  readonly peakMb: number;
  readonly bytes: number;
  readonly size: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  start(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], ROOT, {
    MBRG_OPERATOR_CREDENTIAL: OPERATOR,
    MBRG_MAPS: JSON.stringify({ dev: join(ROOT, 'maps', 'dev'), 'world-countries': join(ROOT, 'maps', 'world-countries') }),
    MBRG_DATABASE: ':memory:',
    MBRG_PORT: '8787',
  });
  // MBRG_VIEWER_DIST: a production build of the viewer (built with VITE_MBRG_SERVER=${SERVER}) is served instead of the development viewer.
  const dist = process.env.MBRG_VIEWER_DIST;
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  start(process.execPath, dist === undefined ? [vite, '--port', '5173', '--strictPort', '--host', 'localhost'] : [vite, 'preview', '--outDir', dist, '--port', '5173', '--strictPort', '--host', 'localhost'], join(ROOT, 'apps', 'web'));
  await until(async () => (await fetch(`${SERVER}/config`)).status === 200, 60_000, 'the server');
  await until(async () => (await fetch(VIEWER)).status === 200, 60_000, 'the viewer');
  const timing = { i: 5, l1: 2, l2: 1 };
  const matches = { dev: await createMatch('dev', timing), world: await createMatch('world-countries', timing) };
  console.log('matches', matches);
  await until(async () => (await applied(matches.world)) >= 3 && (await applied(matches.dev)) >= 3, 120_000, 'three applied rounds');

  const service = createCaptureService({
    viewerUrl: VIEWER,
    driver: createChromeDriver(CHROME as string),
    mapSize: async (mapId) => {
      const response = await fetch(`${SERVER}/maps/${mapId}/ids.png`);
      return pngSize(new Uint8Array(await response.arrayBuffer()));
    },
    after: realAfter,
    log: (code) => console.log('log', code),
    idleMs: 3_000,
  });
  const measures: Measure[] = [];
  async function shoot(what: string, matchId: string, mapId: string, round: number, frame: 'round' | 'full', file: string): Promise<void> {
    service.reveal(matchId, round);
    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, browserMb());
        await sleep(120);
      }
    })();
    const started = performance.now();
    const png = await service.request({ matchId, mapId, round, frame });
    const ms = performance.now() - started;
    sampling = false;
    await sampler;
    if (png === undefined) throw new Error(`capture failed: ${what}`);
    writeFileSync(join(OUT, file), png);
    const size = pngSize(png);
    measures.push({ what, ms: Math.round(ms), peakMb: Math.round(peak), bytes: png.length, size: `${size?.width}x${size?.height}` });
    console.log(measures.at(-1));
  }

  // World countries: the first one is cold (the browser starts for it), the rest reuse the browser.
  await shoot('world cold round 3', matches.world, 'world-countries', 3, 'round', 'world-round-3.png');
  await shoot('world warm round 2', matches.world, 'world-countries', 2, 'round', 'world-round-2.png');
  if (process.env.MBRG_QUICK === '1') {
    await shoot('world full round 3', matches.world, 'world-countries', 3, 'full', 'world-full-3.png');
    await service.close();
    return;
  }
  await shoot('world full round 3', matches.world, 'world-countries', 3, 'full', 'world-full-3.png');
  await shoot('world full round 0', matches.world, 'world-countries', 0, 'full', 'world-full-0.png');
  await shoot('dev round 2', matches.dev, 'dev', 2, 'round', 'dev-round-2.png');
  await shoot('dev full round 3', matches.dev, 'dev', 3, 'full', 'dev-full-3.png');
  // Cold again after the idle close, for the timing of a capture that must start the browser.
  await sleep(4_000);
  console.log('browser memory after idle (MB):', Math.round(browserMb()));
  await shoot('world cold again round 1', matches.world, 'world-countries', 1, 'round', 'world-round-1.png');
  writeFileSync(join(OUT, 'measures.json'), JSON.stringify(measures, null, 2));
  await service.close();
}

try {
  await main();
} finally {
  stopAll();
}
process.exit(0);
