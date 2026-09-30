import './style.css';

import type { Ownership } from '@mbrg/shared';

import { handmadeMap } from './maps/handmade.js';
import { renderLog } from './log.js';
import { CameraController } from './camera.js';
import { interpolateLabels, layoutLabels, type FactionLabel } from './label.js';
import { drawMinimap, MinimapController } from './minimap.js';
import { Playback } from './playback.js';
import { drawMap, fitLabels, initialColors, interpolateFills } from './render.js';
import { renderStats, revealedEvents } from './stats.js';

const SPEEDS_MS = [2000, 1000, 500, 250, 100];
const DEFAULT_SEED = 42;
const ANIM_MAX_MS = 450;

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const playBtn = document.querySelector<HTMLButtonElement>('#btn-play');
const restartBtn = document.querySelector<HTMLButtonElement>('#btn-restart');
const roundLabel = document.querySelector<HTMLSpanElement>('#round-label');
const speedInput = document.querySelector<HTMLInputElement>('#speed');
const speedLabel = document.querySelector<HTMLSpanElement>('#speed-label');
const logList = document.querySelector<HTMLOListElement>('#log-list');
const seedInput = document.querySelector<HTMLInputElement>('#seed');
const seedBtn = document.querySelector<HTMLButtonElement>('#btn-seed');
const statsBody = document.querySelector<HTMLDivElement>('#stats-body');
const zoomInBtn = document.querySelector<HTMLButtonElement>('#btn-zoom-in');
const zoomOutBtn = document.querySelector<HTMLButtonElement>('#btn-zoom-out');
const zoomFitBtn = document.querySelector<HTMLButtonElement>('#btn-zoom-fit');
const minimapEl = document.querySelector<HTMLCanvasElement>('#minimap');

/** Seed from `?seed=…` (shareable link), or null when absent/invalid. */
function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

/** Write the seed into the URL without reloading (copy = share). */
function syncUrl(seed: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}

const playback = new Playback(handmadeMap, seedFromUrl() ?? DEFAULT_SEED);
const colors = initialColors(handmadeMap);

// Animation state: crossfade fills from `fromOwners` to `toOwners`.
let fromOwners: Ownership = playback.owners;
let toOwners: Ownership = playback.owners;
let lastCurrent = playback.current;
let animStart = 0;
let animDur = 0;
let raf: number | null = null;

function draw(
  owners: Ownership,
  fills?: ReturnType<typeof interpolateFills>,
  labels?: FactionLabel[],
): void {
  if (canvas && camera) drawMap(canvas, handmadeMap, owners, colors, camera.camera, fills, labels);
  if (minimapEl && camera) {
    drawMinimap(minimapEl, handmadeMap, owners, colors, camera.camera, camera.viewport, fills);
  }
}

/** Redraw the current frame after a camera change (pan/zoom/fit/resize). */
function onCameraChange(): void {
  if (raf !== null) return; // an animation is running; its loop redraws anyway
  draw(toOwners);
}

const camera = canvas
  ? new CameraController({
      canvas,
      mapWidth: handmadeMap.width ?? 800,
      mapHeight: handmadeMap.height ?? 600,
      onChange: onCameraChange,
    })
  : null;

// Click/drag the minimap to center the main viewport there.
if (minimapEl && camera) {
  new MinimapController({
    canvas: minimapEl,
    map: handmadeMap,
    onPick: (wx, wy) => camera.centerOn(wx, wy),
  });
  // The minimap box hugs the map's aspect ratio (set from data, not hardcoded).
  const mapW = handmadeMap.width ?? 800;
  const mapH = handmadeMap.height ?? 600;
  minimapEl.style.aspectRatio = `${mapW} / ${mapH}`;
}

zoomInBtn?.addEventListener('click', () => camera?.zoomIn());
zoomOutBtn?.addEventListener('click', () => camera?.zoomOut());
zoomFitBtn?.addEventListener('click', () => camera?.fit());

/** Labels mid-absorption: same `t` as the color crossfade, between *fitted*
 *  endpoints — the same labels the rest state draws, so the transition lands
 *  on the final size with no pop. */
function animatingLabels(t: number): FactionLabel[] {
  const ctx2d = canvas?.getContext('2d') ?? null;
  const from = ctx2d ? fitLabels(ctx2d, handmadeMap, fromOwners) : layoutLabels(handmadeMap, fromOwners);
  const to = ctx2d ? fitLabels(ctx2d, handmadeMap, toOwners) : layoutLabels(handmadeMap, toOwners);
  return interpolateLabels(from, to, t);
}

function animationFrame(now: number): void {
  const t = animDur <= 0 ? 1 : Math.min(1, (now - animStart) / animDur);
  draw(
    toOwners,
    t >= 1 ? undefined : interpolateFills(fromOwners, toOwners, colors, t),
    t >= 1 ? undefined : animatingLabels(t),
  );
  raf = t < 1 ? requestAnimationFrame(animationFrame) : null;
}

function updateHud(): void {
  if (roundLabel) {
    roundLabel.textContent = `Ronda ${playback.current} / ${playback.totalRounds}`;
  }
  if (playBtn) playBtn.textContent = playback.playing ? '⏸' : '▶';
}

function onState(): void {
  if (playback.current !== lastCurrent) {
    fromOwners = toOwners;
    toOwners = playback.owners;
    lastCurrent = playback.current;
    animStart = performance.now();
    animDur = Math.min(ANIM_MAX_MS, playback.speedMs * 0.7);
    if (raf === null) raf = requestAnimationFrame(animationFrame);
  }
  if (logList) renderLog(logList, playback.match, playback.current, colors, handmadeMap);
  if (statsBody) {
    renderStats(statsBody, {
      map: handmadeMap,
      owners: playback.owners,
      colors,
      total: handmadeMap.territories.length,
      winner: playback.finished ? playback.match.winner : null,
      events: revealedEvents(playback.match, playback.current),
    });
  }
  updateHud();
}

playback.subscribe(onState);

playBtn?.addEventListener('click', () => playback.toggle());
restartBtn?.addEventListener('click', () => playback.restart());

speedInput?.addEventListener('input', (event) => {
  const index = Number((event.target as HTMLInputElement).value);
  const ms = SPEEDS_MS[index] ?? SPEEDS_MS[2];
  playback.setSpeed(ms);
  if (speedLabel) speedLabel.textContent = `${ms} ms`;
});

function applySeed(): void {
  const value = Number(seedInput?.value);
  if (!seedInput || !Number.isInteger(value)) {
    if (seedInput) seedInput.value = String(playback.match.seed); // revert
    return;
  }
  if (value === playback.match.seed) return;
  playback.restart(value);
  syncUrl(value);
}

seedBtn?.addEventListener('click', applySeed);
seedInput?.addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter') applySeed();
});

// Initial frame + HUD.
if (seedInput) seedInput.value = String(playback.match.seed);
syncUrl(playback.match.seed);
draw(playback.owners);
if (logList) renderLog(logList, playback.match, playback.current, colors, handmadeMap);
if (statsBody) {
  renderStats(statsBody, {
    map: handmadeMap,
    owners: playback.owners,
    colors,
    total: handmadeMap.territories.length,
    winner: playback.finished ? playback.match.winner : null,
    events: revealedEvents(playback.match, playback.current),
  });
}
updateHud();
