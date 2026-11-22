import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { MAP_FILE_NAMES, mapDigestBytes, type MapFileName } from '@mbrg/protocol';
import { fromRgb } from '../core/png-check';
import { NFR_136, generateScaleFixture, type ScaleFixture, type ScaleOptions } from '../importer/scale-fixture';
import { pngCodec } from '../io/png-codec';
import { realImportFs, runImportMode, runInspectMode } from './import';

/** The bound of NFR-136, in milliseconds: reading the source bytes to the three artifacts written. */
export const SCALE_BOUND_MS = 120_000;

/** The bound of the inspect mode on the same source (NFR-136). */
export const INSPECT_BOUND_MS = 30_000;

/** A reduced fixture for a quick end-to-end check of the command itself (never a measurement of the bound). */
export const SMALL_SCALE: ScaleOptions = {
  units: 399,
  islandUnits: 11,
  columns: 25,
  factions: 8,
  seas: 10,
  verticesPerSide: 12,
  side: 1024,
  minPieceSize: 8,
  insetAt: [10, 8],
};

/**
 * The curation of a fixture, ready for the real import: its factions are named by the property that groups them
 * (the T1.10 prototype never ran the faction layer, and every faction needs a name), or, for the stress proof, each
 * land unit is its own faction, named by its own name.
 */
export function scaleCuration(fixture: ScaleFixture, factionProperty: string, nameProperty: string): Uint8Array {
  const curation = { ...fixture.curation, factionBy: { property: factionProperty, nameProperty } };
  return new TextEncoder().encode(JSON.stringify(curation));
}

/** One timed import of a fixture: the files written to a fresh folder, the report captured, the clock read. */
export function importFixture(fixture: ScaleFixture, curationBytes: Uint8Array, now: () => number): { status: number; report: string; errors: string; ms: number; folder: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-scale-'));
  writeFileSync(join(dir, 'primary.geojson'), fixture.primary);
  writeFileSync(join(dir, 'context.geojson'), fixture.context);
  writeFileSync(join(dir, 'curation.json'), curationBytes);
  let report = '';
  let errors = '';
  const start = now();
  const status = runImportMode([`--curation=${join(dir, 'curation.json')}`, `--out=${join(dir, 'pkg')}`], {
    fs: realImportFs,
    root: process.cwd(),
    stdout: (s) => (report += s),
    stderr: (s) => (errors += s),
  });
  return { status, report, errors, ms: now() - start, folder: join(dir, 'pkg') };
}

/** The package load of the server (008): the three files read, `mapDigestBytes` + SHA-256, `JSON.parse`, `validateMap`. */
export function loadAsServer(folder: string): { digest: string; mapOk: boolean } {
  const files = {} as Record<MapFileName, Uint8Array>;
  for (const name of MAP_FILE_NAMES) files[name] = readFileSync(join(folder, name));
  const digest = createHash('sha256').update(mapDigestBytes(files)).digest('hex');
  const map = JSON.parse(new TextDecoder().decode(files['map.json'])) as unknown;
  return { digest, mapOk: validateMap(map).ok };
}

/** The checks the viewer runs before drawing (004 FR-133): the presentation check and the id image check. */
export function viewerChecks(folder: string): { presentationOk: boolean; imageOk: boolean } {
  const map = JSON.parse(new TextDecoder().decode(readFileSync(join(folder, 'map.json')))) as unknown;
  const presentation = JSON.parse(new TextDecoder().decode(readFileSync(join(folder, 'presentation.json')))) as unknown;
  const presentationOk = checkPresentation(map, presentation).ok;
  const decoded = pngCodec.decode(readFileSync(join(folder, 'ids.png')));
  if (!decoded.ok) return { presentationOk, imageOk: false };
  const imageOk = checkIdImage(map, decoded.value.width, decoded.value.height, fromRgb(decoded.value.rgb)).ok;
  return { presentationOk, imageOk };
}

/** What a run of the command found; the text it prints is built from this. */
export interface ScaleImportResult {
  options: ScaleOptions;
  generateMs: number;
  importMs: number;
  importStatus: number;
  /** The first error line of a failed import, empty on success. */
  importError: string;
  inspectMs: number;
  inspectStatus: number;
  stressMs: number;
  stressStatus: number;
  stressError: string;
  /** The stress package loads and passes the viewer's checks. */
  serverLoadOk: boolean;
  viewerChecksOk: boolean;
  /** The viewer-limits warnings of the stress report (factions above 255, palette-exhausted when it fires). */
  stressWarnings: string[];
  maxRssMb: number;
}

/** NFR-136 and FR-614: the scale import and the stress proof on a generated fixture. */
export function runScaleImport(options: ScaleOptions, now: () => number, rss: () => number): ScaleImportResult {
  const generateStart = now();
  const fixture = generateScaleFixture(options);
  const generateMs = now() - generateStart;

  // NFR-136: the import itself, 52 factions by province.
  const imported = importFixture(fixture, scaleCuration(fixture, 'prov', 'prov'), now);

  // NFR-136: the inspect mode on the same source.
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-scale-inspect-'));
  writeFileSync(join(dir, 'primary.geojson'), fixture.primary);
  const inspectStart = now();
  let inspectOut = '';
  const inspectStatus = runInspectMode([`--source=${join(dir, 'primary.geojson')}`], {
    fs: realImportFs,
    root: process.cwd(),
    stdout: (s) => (inspectOut += s),
    stderr: () => undefined,
  });
  const inspectMs = now() - inspectStart;
  rmSync(dir, { recursive: true, force: true });
  void inspectOut;

  // FR-614: the stress proof, the same fixture with one faction per land unit.
  const stress = importFixture(fixture, scaleCuration(fixture, 'code', 'name'), now);
  let serverLoadOk = false;
  let viewerChecksOk = false;
  if (stress.status === 0) {
    serverLoadOk = loadAsServer(stress.folder).mapOk;
    const checks = viewerChecks(stress.folder);
    viewerChecksOk = checks.presentationOk && checks.imageOk;
  }
  const stressWarnings = stress.report
    .split('\n')
    .filter((line) => line.includes('Above255') || line.includes('paletteExhausted'))
    .map((line) => line.trim());
  if (stress.status === 0) rmSync(stress.folder, { recursive: true, force: true });
  if (imported.status === 0) rmSync(imported.folder, { recursive: true, force: true });

  return {
    options,
    generateMs,
    importMs: imported.ms,
    importStatus: imported.status,
    importError: firstError(imported.errors),
    inspectMs,
    inspectStatus,
    stressMs: stress.ms,
    stressStatus: stress.status,
    stressError: firstError(stress.errors),
    serverLoadOk,
    viewerChecksOk,
    stressWarnings,
    maxRssMb: Math.round(rss()),
  };
}

/** The first JSON error line, empty when there is none. */
function firstError(errors: string): string {
  const line = errors.split('\n').find((l) => l.startsWith('{'));
  return line ?? '';
}

/** The text a run prints: every measurement and outcome, one line each. */
export function describeScaleRun(result: ScaleImportResult): string {
  const lines = [
    `fixture: units=${result.options.units} factions=${result.options.factions} seas=${result.options.seas} side=${result.options.side}`,
    `generate: ${Math.round(result.generateMs)} ms (not part of the bound)`,
    `import: ${Math.round(result.importMs)} ms (bound ${SCALE_BOUND_MS} ms), status ${result.importStatus}`,
    ...(result.importError === '' ? [] : [`importError: ${result.importError}`]),
    `inspect: ${Math.round(result.inspectMs)} ms (bound ${INSPECT_BOUND_MS} ms), status ${result.inspectStatus}`,
    `stress: ${Math.round(result.stressMs)} ms (recorded, not bounded), status ${result.stressStatus}`,
    ...(result.stressError === '' ? [] : [`stressError: ${result.stressError}`]),
    `stressServerLoad: ${result.serverLoadOk ? 'ok' : 'failed'}`,
    `stressViewerChecks: ${result.viewerChecksOk ? 'ok' : 'failed'}`,
    `stressWarnings: ${result.stressWarnings.length}`,
    ...result.stressWarnings.map((w) => `  ${w}`),
    `maxRssMb: ${result.maxRssMb}`,
  ];
  return lines.join('\n') + '\n';
}

/** True when every bound and every outcome holds. */
export function scaleRunOk(result: ScaleImportResult): boolean {
  return (
    result.importStatus === 0 &&
    result.importMs < SCALE_BOUND_MS &&
    result.inspectStatus === 0 &&
    result.inspectMs < INSPECT_BOUND_MS &&
    result.stressStatus === 0 &&
    result.serverLoadOk &&
    result.viewerChecksOk &&
    result.stressWarnings.some((w) => w.includes('factionsAbove255'))
  );
}

/** The real command: `--small` runs the reduced fixture (a check of the command, not of the bound). */
function main(): number {
  const small = process.argv.slice(2).includes('--small');
  const unknown = process.argv.slice(2).filter((a) => a !== '--small');
  if (unknown.length > 0) {
    process.stderr.write(`unknown option: ${unknown[0]}\nusage: scale:import [--small]\n`);
    return 2;
  }
  const result = runScaleImport(small ? SMALL_SCALE : NFR_136, () => performance.now(), () => process.resourceUsage().maxRSS / 1024);
  process.stdout.write(describeScaleRun(result));
  return scaleRunOk(result) ? 0 : 1;
}

// Run only as a script, never when a test imports the module.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
