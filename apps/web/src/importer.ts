import './style.css';

import {
  assembleMap,
  BYTES_PER_PIXEL,
  detectAdjacency,
  detectFlatColorRegions,
  pointInRing,
  traceContours,
  type AssemblyResult,
  type FlatColorResult,
  type ImportIssue,
} from '@mbrg/map-tools';
import type { Coord, MapFormatV1 } from '@mbrg/shared';

import { decodeImageFile, decodeImageUrl, drawRaster, rasterForDetection } from './decode.js';
import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from './i18n.js';
import { saveMap, suggestMapName } from './library.js';
import { applyNames, cleanName, namesByColor, parseNameFile } from './naming.js';
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
const smallRatioInput = document.querySelector<HTMLInputElement>('#small-ratio')!;
const simplifyInput = document.querySelector<HTMLInputElement>('#simplify')!;
const minHoleInput = document.querySelector<HTMLInputElement>('#min-hole')!;
const maxGapInput = document.querySelector<HTMLInputElement>('#max-gap')!;
const seaSelect = document.querySelector<HTMLSelectElement>('#sea-mode')!;
const seaInfo = document.querySelector<HTMLElement>('#sea-info')!;
const nameRow = document.querySelector<HTMLElement>('#namerow')!;
const regionNameInput = document.querySelector<HTMLInputElement>('#region-name')!;
const namedCount = document.querySelector<HTMLElement>('#named-count')!;
const namesFileInput = document.querySelector<HTMLInputElement>('#names-file')!;
const busyBadge = document.querySelector<HTMLElement>('#busy')!;

interface Tuning {
  tolerance: number;
  minRegionArea: number;
  smallRegionRatio: number;
  simplify: number;
  minHoleRatio: number;
  maxGap: number;
  sea: 'auto' | 'picked' | 'transparent';
  seaColor: number;
}

let raster: RasterImage | null = null;
let mapName = '';
let result: AssemblyResult | null = null;
let selected: string | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
/** Names typed by the user, keyed by territory id so they survive re-detection. */
let names = new Map<string, string>();
/** Ids whose names did not survive the last re-detection, reported once. */
let lostNames: string[] = [];
/** Sea colour the user picked by clicking, which overrides the automatic choice. */
let pickedSea: number | null = null;
let pending = 0;

/**
 * Re-run detection after a pause in the input.
 *
 * Detection is linear in pixels, so on a real map it costs a few hundred
 * milliseconds even at the reduced size. Running it on every `input` event of a
 * slider queues a dozen runs per drag, and the page stops responding — the
 * controls feel broken rather than slow. A short debounce keeps the number
 * reachable at one, and the number shown next to the slider updates immediately
 * so the control still feels alive.
 */
const DEBOUNCE_MS = 180;

function scheduleDetect(): void {
  if (busyBadge) busyBadge.hidden = false;
  window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = 0;
    detect();
    if (busyBadge) busyBadge.hidden = true;
  }, DEBOUNCE_MS);
}

if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;
document.documentElement.lang = getLang();
if (langSelect) langSelect.value = getLang();
applyI18n();
onLangChange(() => {
  applyI18n();
  render();
});
langSelect?.addEventListener('change', () => setLang(langSelect.value as Lang));

const SLIDERS = [toleranceInput, minAreaInput, smallRatioInput, simplifyInput, minHoleInput, maxGapInput];

/** Sliders that carry a percentage sign in their readout. */
const PERCENT_SLIDERS = new Set([minHoleInput, smallRatioInput]);

function updateReadouts(): void {
  for (const el of SLIDERS) {
    if (!el) continue;
    const out = document.querySelector<HTMLOutputElement>(`#${el.id}-out`);
    if (!out) continue;
    out.textContent = PERCENT_SLIDERS.has(el) ? `${el.value}%` : el.value;
  }
}

for (const input of SLIDERS) {
  input?.addEventListener('input', () => {
    updateReadouts();
    scheduleDetect();
  });
}
updateReadouts();

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

// Renaming applies as you type: no "apply" step to forget.
regionNameInput?.addEventListener('input', () => renameSelected(regionNameInput.value));

/**
 * A name file beats typing 200 names.
 *
 * Keyed by colour, which only works on a flat-colour map, and that limitation is
 * reported rather than glossed over: a colour that matched more than one province
 * is either two provinces sharing a colour in the source map or one province the
 * detection split, and the user needs to know which before they trust the names.
 */
namesFileInput?.addEventListener('change', async () => {
  const file = namesFileInput.files?.[0];
  if (!file) return;
  try {
    const { byColor, rejected } = parseNameFile(await file.text());
    if (byColor.size === 0) {
      showFatal(t('import.namesFileEmpty'));
      return;
    }
    const applied = namesByColor(result?.territories ?? [], byColor);
    // The file wins over what is on screen: it is the deliberate act, and the
    // user can still edit any province afterwards.
    names = new Map([...names, ...applied.names]);
    lostNames = [];
    detect();
    renderNameFileNotes(applied, rejected);
  } catch (error) {
    showFatal(error instanceof Error ? error.message : String(error));
  }
});

function renderNameFileNotes(
  applied: ReturnType<typeof namesByColor>,
  rejected: number,
): void {
  issuesBox.prepend(issue('warn', t('import.namesFromFileDone', { count: applied.matched })));
  if (rejected > 0) {
    issuesBox.prepend(issue('warn', t('import.namesFileRejected', { count: rejected })));
  }
  if (applied.unmatched.length > 0) {
    issuesBox.prepend(
      issue('warn', t('import.namesFileUnmatched', { count: applied.unmatched.length })),
    );
  }
  if (applied.shared.length > 0) {
    issuesBox.prepend(
      issue(
        'warn',
        t('import.namesFileShared', {
          count: applied.shared.length,
          names: applied.shared.slice(0, 5).join(', '),
        }),
      ),
    );
  }
}

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
  const choice = seaSelect?.value ?? 'auto';
  const mode: Tuning['sea'] = choice === 'transparent' ? 'transparent' : 'auto';
  return {
    tolerance: Number(toleranceInput?.value ?? 32),
    minRegionArea: Number(minAreaInput?.value ?? 24),
    smallRegionRatio: Number(smallRatioInput?.value ?? 2) / 100,
    simplify: Number(simplifyInput?.value ?? 0.75),
    minHoleRatio: Number(minHoleInput?.value ?? 1) / 100,
    maxGap: Number(maxGapInput?.value ?? 3),
    sea: pickedSea !== null ? 'picked' : mode,
    seaColor: pickedSea ?? -1,
  };
}

/** Run detection and redraw. Debounced, because it is linear in pixels. */
function detect(): void {
  if (!raster) return;
  const options = tuning();
  const flat: FlatColorResult = detectFlatColorRegions(raster, options);
  const adjacency = detectAdjacency(flat, { maxGap: options.maxGap });
  const contours = traceContours(flat, {
    simplify: options.simplify,
    minHoleRatio: options.minHoleRatio,
  });
  const assembled = assembleMap(flat, adjacency, contours, { name: mapName || 'imported' });

  // Re-apply the names: detection re-runs on every slider move, and typing 40
  // names has to survive touching the tolerance.
  const applied = applyNames(assembled.map, names);
  lostNames = applied.dropped;
  result = { ...assembled, map: applied.map };
  if (selected && !result.map.territories.some((t) => t.id === selected)) selected = null;
  render();
  renderSeaInfo(flat);
}

/**
 * Show which colour was read as sea, so the automatic choice is never a mystery.
 *
 * This is the difference between "the map came out wrong" and "the map came out
 * wrong because that colour was the sea". If it found no sea at all, that is
 * worth saying too: usually the image has no transparency and the sea is
 * whatever the ocean happens to be painted.
 */
function renderSeaInfo(flat: FlatColorResult): void {
  if (!seaInfo) return;
  const { seaColor, seaChoice, ignored } = flat;
  const share = Math.round(((ignored.sea + ignored.transparent) / ignored.total) * 100);
  if (seaChoice === 'transparency' && ignored.transparent > 0) {
    seaInfo.textContent = t('import.seaTransparentFound', { pixels: `${share}` });
    return;
  }
  if (seaColor === null) {
    seaInfo.textContent = t('import.seaNone');
    return;
  }
  seaInfo.textContent = t('import.seaFound', {
    color: `#${seaColor.toString(16).padStart(6, '0')}`,
    pixels: `${share}`,
    picked: seaChoice === 'picked' ? t('import.seaPicked') : t('import.seaAutomatic'),
  });
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
  renderNames();
  renderRegions(territories);
  renderIssues(errors, warnings);
  // Say it out loud when a parameter change made provinces disappear, rather
  // than letting 40 typed names vanish in silence.
  if (lostNames.length > 0) {
    issuesBox.prepend(issue('warn', t('import.namesLost', { count: lostNames.length })));
  }

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

function renderRegions(territories: AssemblyResult['territories']): void {
  regionList.textContent = '';
  for (const entry of territories) {
    const territory = result?.map.territories.find((t) => t.id === entry.id);
    const name = territory?.name ?? entry.id;
    const named = name !== entry.id;

    const li = document.createElement('li');
    li.className = 'region';
    // The id, not the visible text: a renamed province shows its name, and
    // matching on that would break as soon as a name were typed.
    li.dataset.id = entry.id;
    if (selected === entry.id) li.classList.add('selected');
    li.addEventListener('mouseenter', () => highlight(entry.id));
    li.addEventListener('mouseleave', () => highlight(selected));
    // Clicking a row selects it and focuses the name field, which is the whole
    // point of a name existing: "p137" on a map says nothing.
    li.addEventListener('click', () => {
      select(entry.id);
      regionNameInput.focus();
      regionNameInput.select();
    });

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${entry.color.toString(16).padStart(6, '0')}`;

    const label = document.createElement('span');
    label.className = named ? 'region-label named' : 'region-label';
    label.textContent = name;
    label.title = entry.id;

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

/** Highlight a province in the preview and in the list; null clears it. */
function highlight(id: string | null): void {
  selected = id;
  drawPreview();
  for (const li of regionList.querySelectorAll<HTMLLIElement>('li.region')) {
    li.classList.toggle('selected', id !== null && li.dataset.id === id);
  }
}

/** Select a province and load its name into the field. */
function select(id: string | null): void {
  highlight(id);
  nameRow.hidden = id === null;
  if (id === null) return;
  const territory = result?.map.territories.find((t) => t.id === id);
  regionNameInput.value = territory?.name && territory.name !== id ? territory.name : '';
}

/** Rename a province, keeping the name keyed by id so it survives re-detection. */
function renameSelected(raw: string): void {
  if (!result || !selected) return;
  const clean = cleanName(raw);
  if (clean) names.set(selected, clean);
  else names.delete(selected);
  result = { ...result, map: applyNames(result.map, names).map };
  renderNames();
  renderRegions(result.territories);
  highlight(selected);
}

function renderNames(): void {
  if (!result) return;
  const total = result.map.territories.length;
  const named = result.map.territories.filter((t) => t.name !== t.id).length;
  namedCount.hidden = total === 0;
  namedCount.textContent = t('import.named', { named, total });
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
    case 'mostlyIslands':
      return t('import.issueMostlyIslands', { count, total });
    case 'diagonalCrossings':
      return t('import.issueDiagonal', { count });
    case 'tinyHolesDropped':
      return t('import.issueTinyHoles', { count });
    case 'smallRegionsDropped':
      return t('import.issueSmallRegions', { count });
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
//
// In "mark the sea" mode the same click means the opposite thing: it takes the
// colour under the pointer as the sea. One button, two modes, because both are
// "click a place on the map" and a second button to keep track of would be worse
// than remembering which one is armed.
preview?.addEventListener('click', (event) => {
  if (!result || !raster) return;
  const rect = preview.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * raster.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * raster.height);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  if (seaSelect?.value === 'mark') {
    pickSeaAt(x, y);
    return;
  }
  select(territoryAt(x, y, result.map));
});

// Switching sea mode cancels a hand-picked colour: keeping it would make the
// dropdown lie, since "Automatic" would silently keep the old pick.
seaSelect?.addEventListener('change', () => {
  if (seaSelect.value !== 'mark') pickedSea = null;
  detect();
});

/**
 * Take the colour of a pixel as the sea.
 *
 * The colour is read from the *raster*, not from a detected region, because the
 * sea is usually not a region: that is the whole problem. It re-runs detection
 * right away rather than waiting for the debounce, since a single deliberate
 * click should feel immediate.
 */
function pickSeaAt(x: number, y: number): void {
  if (!raster) return;
  const i = (y * raster.width + x) * BYTES_PER_PIXEL;
  if (raster.data[i + 3] < 128) {
    // Clicking transparent water is the easy case: transparency is already how
    // the sea is read by default, so the pick is "no pick".
    pickedSea = null;
    seaSelect!.value = 'auto';
    detect();
    return;
  }
  pickedSea = (raster.data[i] << 16) | (raster.data[i + 1] << 8) | raster.data[i + 2];
  detect();
}

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
