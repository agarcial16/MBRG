import './style.css';

import {
  assembleMap,
  detectAdjacency,
  detectFlatColorRegions,
  pointInRing,
  traceContours,
  type AssemblyResult,
  type FlatColorResult,
  type ImportIssue,
} from '@mbrg/map-tools';
import type { Coord, MapFormatV1 } from '@mbrg/shared';

import { decodeImageFile, decodeImageUrl, drawRaster } from './decode.js';
import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from './i18n.js';
import { saveMap, suggestMapName } from './library.js';
import type { RasterImage } from '@mbrg/map-tools';

/** Injected at build time from apps/web/package.json. */
declare const __APP_VERSION__: string;

/**
 * The map validation screen.
 *
 * Detection is fast enough (linear in pixels) to re-run on every slider move,
 * so the page is a loop: tweak a parameter, see the map change. That is the
 * whole point of a validation screen — you cannot tell whether a tolerance is
 * right by reading a number, only by looking.
 */

const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const dropZone = document.querySelector<HTMLLabelElement>('#drop')!;
const tuningPanel = document.querySelector<HTMLElement>('#tuning-panel')!;
const previewPanel = document.querySelector<HTMLElement>('#preview-panel')!;
const issuesPanel = document.querySelector<HTMLElement>('#issues-panel')!;
const regionsPanel = document.querySelector<HTMLElement>('#regions-panel')!;
const preview = document.querySelector<HTMLCanvasElement>('#preview')!;
const regionList = document.querySelector<HTMLOListElement>('#region-list')!;
const issuesBox = document.querySelector<HTMLElement>('#issues')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const nameInput = document.querySelector<HTMLInputElement>('#map-name')!;
const saveBtn = document.querySelector<HTMLButtonElement>('#btn-save')!;
const exportBtn = document.querySelector<HTMLButtonElement>('#btn-export')!;
const saveHint = document.querySelector<HTMLElement>('#save-hint')!;
const showSource = document.querySelector<HTMLInputElement>('#show-source')!;
const langSelect = document.querySelector<HTMLSelectElement>('#lang')!;
const versionEl = document.querySelector<HTMLElement>('#app-version')!;
const toleranceInput = document.querySelector<HTMLInputElement>('#tolerance')!;
const minAreaInput = document.querySelector<HTMLInputElement>('#min-area')!;
const simplifyInput = document.querySelector<HTMLInputElement>('#simplify')!;

interface Tuning {
  tolerance: number;
  minRegionArea: number;
  simplify: number;
}

let raster: RasterImage | null = null;
let mapName = '';
let result: AssemblyResult | null = null;
let selected: string | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;

if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;
document.documentElement.lang = getLang();
if (langSelect) langSelect.value = getLang();
applyI18n();
onLangChange(() => {
  applyI18n();
  render();
});
langSelect?.addEventListener('change', () => setLang(langSelect.value as Lang));

for (const input of [toleranceInput, minAreaInput, simplifyInput]) {
  input?.addEventListener('input', () => {
    for (const el of [toleranceInput, minAreaInput, simplifyInput]) {
      if (!el) continue;
      const out = document.querySelector<HTMLOutputElement>(`#${el.id}-out`);
      if (out) out.textContent = el.value;
    }
    detect();
  });
}

fileInput?.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void load(file);
});
dropZone?.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('over');
});
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone?.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('over');
  const file = event.dataTransfer?.files?.[0];
  if (file) void load(file);
});
showSource?.addEventListener('change', () => render());

// `?image=<url>` loads a map without going through the file picker, which is
// how a map that needs debugging gets shared.
const imageParam = new URLSearchParams(window.location.search).get('image');
if (imageParam) {
  void decodeImageUrl(imageParam)
    .then((loaded) => {
      raster = loaded;
      mapName = imageParam.split('/').pop() || 'imported';
      nameInput.value = mapName.replace(/\.[a-z0-9]+$/i, '');
      tuningPanel.hidden = false;
      detect();
    })
    .catch((error) => showFatal(error instanceof Error ? error.message : String(error)));
}

async function load(file: File): Promise<void> {
  try {
    raster = await decodeImageFile(file);
  } catch (error) {
    showFatal(error instanceof Error ? error.message : String(error));
    return;
  }
  mapName = suggestMapName(file.name);
  nameInput.value = mapName;
  selected = null;
  tuningPanel.hidden = false;
  detect();
}

function tuning(): Tuning {
  return {
    tolerance: Number(toleranceInput?.value ?? 32),
    minRegionArea: Number(minAreaInput?.value ?? 24),
    simplify: Number(simplifyInput?.value ?? 0.75),
  };
}

/** Run detection and redraw. Cheap enough to do on every slider move. */
function detect(): void {
  if (!raster) return;
  const options = tuning();
  const flat: FlatColorResult = detectFlatColorRegions(raster, options);
  const adjacency = detectAdjacency(flat);
  const contours = traceContours(flat, { simplify: options.simplify });
  result = assembleMap(flat, adjacency, contours, { name: mapName || 'imported' });
  render();
}

function render(): void {
  if (!raster || !result) return;
  previewPanel.hidden = false;
  issuesPanel.hidden = false;
  regionsPanel.hidden = false;

  const { territories, warnings, errors, map } = result;
  summary.textContent = t('import.summary', {
    regions: territories.length,
    warnings: warnings.length,
    errors: errors.length,
  });

  drawPreview();
  renderRegions(territories);
  renderIssues(errors, warnings);

  // A map with errors cannot be played, and must not be exported as if it were.
  const broken = errors.length > 0;
  saveBtn.disabled = broken;
  exportBtn.disabled = broken;
  saveHint.textContent = broken
    ? t('import.broken')
    : t('import.savedHint', { name: nameInput.value || mapName });
}

function drawPreview(): void {
  if (!raster || !result) return;
  if (!previewCtx) previewCtx = preview.getContext('2d');
  const ctx = previewCtx;
  if (!ctx) return;

  preview.width = raster.width;
  preview.height = raster.height;
  if (showSource?.checked) drawRaster(preview, raster, 0.45);
  else {
    ctx.clearRect(0, 0, raster.width, raster.height);
    ctx.fillStyle = '#0b0b18';
    ctx.fillRect(0, 0, raster.width, raster.height);
  }

  // Draw the detected map itself, not the source: this is what will be played.
  const dimmed = selected !== null;
  for (const entry of result.territories) {
    const territory = result.map.territories.find((t) => t.id === entry.id);
    if (!territory) continue;
    const isSelected = selected === entry.id;
    const alpha = !dimmed || isSelected ? 0.85 : 0.2;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    traceRing(ctx, territory.polygon);
    for (const hole of territory.holes ?? []) traceRing(ctx, hole);
    ctx.fillStyle = `#${entry.color.toString(16).padStart(6, '0')}`;
    ctx.fill('evenodd');
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function traceRing(ctx: CanvasRenderingContext2D, ring: Coord[]): void {
  ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function renderRegions(
  territories: AssemblyResult['territories'],
): void {
  regionList.textContent = '';
  for (const entry of territories) {
    const li = document.createElement('li');
    li.className = 'region';
    if (selected === entry.id) li.classList.add('selected');
    li.addEventListener('mouseenter', () => {
      selected = entry.id;
      drawPreview();
      highlightRow();
    });
    li.addEventListener('mouseleave', () => {
      selected = null;
      drawPreview();
      highlightRow();
    });

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${entry.color.toString(16).padStart(6, '0')}`;

    const label = document.createElement('span');
    label.className = 'region-label';
    label.textContent = entry.id;

    const meta = document.createElement('span');
    meta.className = 'region-meta';
    meta.textContent = `${entry.area} px · ${entry.neighbors.length} ${
      entry.neighbors.length === 1 ? t('import.border') : t('import.borders')
    }`;
    if (entry.island) meta.append(badge('import.badgeIsland'));
    if (entry.split) meta.append(badge('import.badgeSplit'));
    if (entry.cornerOnly) meta.append(badge('import.badgeCorner'));

    li.append(swatch, label, meta);
    regionList.append(li);
  }
}

function badge(key: Parameters<typeof t>[0]): HTMLElement {
  const el = document.createElement('em');
  el.className = 'badge';
  el.textContent = t(key);
  return el;
}

function highlightRow(): void {
  for (const li of regionList.querySelectorAll('li.region')) {
    li.classList.toggle('selected', li.querySelector('.region-label')?.textContent === selected);
  }
}

function renderIssues(errors: ImportIssue[], warnings: ImportIssue[]): void {
  issuesBox.textContent = '';
  if (errors.length === 0 && warnings.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'ok';
    ok.textContent = t('import.noIssues');
    issuesBox.append(ok);
    return;
  }
  for (const error of errors) issuesBox.append(issue('error', describe(error)));
  for (const warning of warnings) issuesBox.append(issue('warn', describe(warning)));
}

/** Translate a finding: the core sends a code and its parameters, not a sentence. */
function describe(finding: ImportIssue): string {
  const { id, color, pieces } = finding.params;
  const count = finding.numbers?.count ?? 0;
  const total = finding.numbers?.total ?? 0;
  switch (finding.code) {
    case 'regionWithoutOutline':
      return t('import.issueNoOutline', { id, color });
    case 'regionSplit':
      return t('import.issueSplit', { id, color, pieces: pieces ?? 0 });
    case 'island':
      return t('import.issueIsland', { id, color });
    case 'diagonalCrossings':
      return t('import.issueDiagonal', { count });
    case 'skippedPixels':
      return t('import.issueSkipped', { count, total });
    case 'invalid':
      // validateMap speaks only English; there is nothing to translate yet.
      return finding.detail;
    default:
      return finding.detail;
  }
}

function issue(kind: 'error' | 'warn', text: string): HTMLElement {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  return li;
}

function showFatal(message: string): void {
  issuesPanel.hidden = false;
  issuesBox.textContent = '';
  issuesBox.append(issue('error', `${t('import.failed')}: ${message}`));
}

// Clicking the preview selects the province under the pointer: the pixel comes
// from the detection, not from a hit test over the polygons, so it works for
// shapes a point-in-polygon would find ambiguous.
preview?.addEventListener('click', (event) => {
  if (!result || !raster) return;
  const rect = preview.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * raster.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * raster.height);
  selected = territoryAt(x, y, result.map);
  drawPreview();
  highlightRow();
});

function territoryAt(x: number, y: number, map: MapFormatV1): string | null {
  for (const territory of map.territories) {
    if (!pointInRing(territory.polygon, x, y)) continue;
    // A point inside an enclave's hole is not inside the surrounding region.
    if ((territory.holes ?? []).some((hole) => pointInRing(hole, x, y))) continue;
    return territory.id;
  }
  return null;
}

saveBtn?.addEventListener('click', () => {
  if (!result) return;
  try {
    const id = saveMap(nameInput.value || mapName, result.map, `${result.map.width}×${result.map.height}`);
    const url = new URL('./index.html', window.location.href);
    url.searchParams.set('map', id);
    window.location.href = url.toString();
  } catch (error) {
    showFatal(error instanceof Error ? error.message : String(error));
  }
});

exportBtn?.addEventListener('click', () => {
  if (!result) return;
  const blob = new Blob([JSON.stringify(result.map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${nameInput.value || mapName || 'map'}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
