import './style.css';

import type { Ownership } from '@mbrg/shared';

import { handmadeMap } from './maps/handmade.js';
import { Playback } from './playback.js';
import { drawMap, initialColors, interpolateFills } from './render.js';

const SPEEDS_MS = [2000, 1000, 500, 250, 100];
const DEFAULT_SEED = 42;
const ANIM_MAX_MS = 450;

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const playBtn = document.querySelector<HTMLButtonElement>('#btn-play');
const restartBtn = document.querySelector<HTMLButtonElement>('#btn-restart');
const roundLabel = document.querySelector<HTMLSpanElement>('#round-label');
const speedInput = document.querySelector<HTMLInputElement>('#speed');
const speedLabel = document.querySelector<HTMLSpanElement>('#speed-label');

const playback = new Playback(handmadeMap, DEFAULT_SEED);
const colors = initialColors(handmadeMap);

// Animation state: crossfade fills from `fromOwners` to `toOwners`.
let fromOwners: Ownership = playback.owners;
let toOwners: Ownership = playback.owners;
let lastCurrent = playback.current;
let animStart = 0;
let animDur = 0;
let raf: number | null = null;

function draw(owners: Ownership, fills?: ReturnType<typeof interpolateFills>): void {
  if (canvas) drawMap(canvas, handmadeMap, owners, colors, fills);
}

function animationFrame(now: number): void {
  const t = animDur <= 0 ? 1 : Math.min(1, (now - animStart) / animDur);
  draw(toOwners, t >= 1 ? undefined : interpolateFills(fromOwners, toOwners, colors, t));
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

// Initial frame + HUD.
draw(playback.owners);
updateHud();
