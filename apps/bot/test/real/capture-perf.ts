// Capture timing (spec 040 FR-744): the real server, a production build of the viewer and the real chrome-headless-shell. For each
// map it runs N captures, each with a cold browser (a fresh service, so Chrome starts for it), and prints the time and the peak
// memory (sum of the working sets of every chrome-headless-shell process, sampled every 120 ms; shared pages count once per process,
// so it overstates). Manual, not part of `npm test`:
//   MBRG_CHROME_PATH=<chrome-headless-shell> MBRG_VIEWER_DIST=<viewer build> npx tsx apps/bot/test/real/capture-perf.ts <out-dir>
// The viewer build must be made with VITE_MBRG_SERVER=http://127.0.0.1:8787. Options (environment):
//   MBRG_PERF_MAPS  extra maps as `id=directory,id=directory` (default: dev and world-countries from maps/)
//   MBRG_PERF_RUNS  captures per map and frame (default 3)
//   MBRG_PERF_FULL  `1` also times the full-map image
//   MBRG_PERF_VIEWER_PORT  port of the viewer preview (default 5173; use another one when that port is taken)
// It starts and stops its own server (port 8787) and viewer preview.
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaptureService, realAfter } from '../../src/io/capture';
import { createChromeDriver } from '../../src/io/capture-chrome';
import { pngSize } from '../../src/core/capture';

const ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, '.claude', 'review', '040'));
const CHROME = process.env.MBRG_CHROME_PATH;
const DIST = process.env.MBRG_VIEWER_DIST;
if (CHROME === undefined || CHROME === '') throw new Error('Set MBRG_CHROME_PATH to chrome-headless-shell');
if (DIST === undefined || DIST === '') throw new Error('Set MBRG_VIEWER_DIST to a production build of the viewer');
const RUNS = Number(process.env.MBRG_PERF_RUNS ?? '3');
const FULL = process.env.MBRG_PERF_FULL === '1';
const OPERATOR = 'operator-credential-for-the-capture-perf-run-0123456789';
const SERVER = 'http://127.0.0.1:8787';
const VIEWER_PORT = process.env.MBRG_PERF_VIEWER_PORT ?? '5173';
const VIEWER = `http://localhost:${VIEWER_PORT}/`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const maps: Record<string, string> = { dev: join(ROOT, 'maps', 'dev'), 'world-countries': join(ROOT, 'maps', 'world-countries') };
for (const item of (process.env.MBRG_PERF_MAPS ?? '').split(',')) {
  const at = item.indexOf('=');
  if (at > 0) maps[item.slice(0, at)] = resolve(item.slice(at + 1));
}

const children: ChildProcess[] = [];
function start(args: string[], cwd: string, env: Record<string, string> = {}): void {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(child);
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

function browserMb(): number {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome-headless-shell.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    let kb = 0;
    for (const line of out.split(/\r?\n/)) {
      const mem = line.split('","')[4]?.replace(/[^0-9]/g, '');
      if (mem !== undefined && mem !== '') kb += Number(mem);
    }
    return kb / 1024;
  } catch {
    return 0;
  }
}

async function createMatch(mapId: string): Promise<string> {
  const response = await fetch(`${SERVER}/matches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPERATOR}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mapId, timing: { i: 5, l1: 2, l2: 1 }, requestId: `perf-${mapId}-${Date.now()}`.slice(0, 60) }),
  });
  const body = (await response.json()) as { matchId?: string };
  if (typeof body.matchId !== 'string') throw new Error(`creation failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.matchId;
}

async function applied(matchId: string): Promise<number> {
  return ((await (await fetch(`${SERVER}/matches/${matchId}`)).json()) as { appliedRounds: number }).appliedRounds;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  start(['--import', 'tsx', 'apps/server/src/main.ts'], ROOT, {
    MBRG_OPERATOR_CREDENTIAL: OPERATOR,
    MBRG_MAPS: JSON.stringify(maps),
    MBRG_DATABASE: ':memory:',
    MBRG_PORT: '8787',
  });
  start([join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', resolve(DIST as string), '--port', VIEWER_PORT, '--strictPort', '--host', 'localhost'], join(ROOT, 'apps', 'web'));
  await until(async () => (await fetch(`${SERVER}/config`)).status === 200, 60_000, 'the server');
  await until(async () => (await fetch(VIEWER)).status === 200, 60_000, 'the viewer');
  const rows: string[] = [];
  for (const mapId of Object.keys(maps)) {
    const matchId = await createMatch(mapId);
    await until(async () => (await applied(matchId)) >= 3, 120_000, `three rounds of ${mapId}`);
    for (const frame of FULL ? (['round', 'full'] as const) : (['round'] as const)) {
      const times: number[] = [];
      const peaks: number[] = [];
      for (let run = 1; run <= RUNS; run++) {
        const service = createCaptureService({
          viewerUrl: VIEWER,
          driver: createChromeDriver(CHROME as string),
          mapSize: async (id) => pngSize(new Uint8Array(await (await fetch(`${SERVER}/maps/${id}/ids.png`)).arrayBuffer())),
          after: realAfter,
          log: (code) => console.log('log', code),
          idleMs: 1_000,
        });
        service.reveal(matchId, 3);
        let peak = 0;
        let sampling = true;
        const sampler = (async () => {
          while (sampling) {
            peak = Math.max(peak, browserMb());
            await sleep(120);
          }
        })();
        const started = performance.now();
        const png = await service.request({ matchId, mapId, round: 3, frame });
        const ms = performance.now() - started;
        sampling = false;
        await sampler;
        // A failed capture (refused, over 20 s) is reported and left out of the medians, so a loaded machine does not end the run.
        if (png === undefined) {
          console.log(JSON.stringify({ mapId, frame, run, failed: true, ms: Math.round(ms) }));
          await service.close();
          continue;
        }
        if (times.length === 0) writeFileSync(join(OUT, `${mapId}-${frame}.png`), png);
        times.push(Math.round(ms));
        peaks.push(Math.round(peak));
        console.log(JSON.stringify({ mapId, frame, run, ms: Math.round(ms), peakMb: Math.round(peak), bytes: png.length }));
        await service.close();
        await sleep(500);
      }
      if (times.length > 0) rows.push(`| ${mapId} | ${frame} | ${times.join(' / ')} | ${median(times)} | ${peaks.join(' / ')} | ${Math.max(...peaks)} |`);
    }
  }
  console.log('\n| map | frame | ms per run | median ms | peak MB per run | max MB |\n|---|---|---|---|---|---|\n' + rows.join('\n'));
}

try {
  await main();
} finally {
  stopAll();
}
process.exit(0);
