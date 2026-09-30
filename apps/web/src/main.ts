import './style.css';

import { handmadeMap } from './maps/handmade.js';
import { drawMap, initialColors } from './render.js';
import { Playback } from './playback.js';

const SPEEDS_MS = [2000, 1000, 500, 250, 100];
const DEFAULT_SEED = 42;

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const playBtn = document.querySelector<HTMLButtonElement>('#btn-play');
const restartBtn = document.querySelector<HTMLButtonElement>('#btn-restart');
const roundLabel = document.querySelector<HTMLSpanElement>('#round-label');
const speedInput = document.querySelector<HTMLInputElement>('#speed');
const speedLabel = document.querySelector<HTMLSpanElement>('#speed-label');

const playback = new Playback(handmadeMap, DEFAULT_SEED);
const colors = initialColors(handmadeMap);

function render(): void {
  if (canvas) drawMap(canvas, handmadeMap, playback.owners, colors);
  if (roundLabel) {
    roundLabel.textContent = `Ronda ${playback.current} / ${playback.totalRounds}`;
  }
  if (playBtn) playBtn.textContent = playback.playing ? '⏸' : '▶';
}

playback.subscribe(render);

playBtn?.addEventListener('click', () => playback.toggle());
restartBtn?.addEventListener('click', () => playback.restart());

speedInput?.addEventListener('input', (event) => {
  const index = Number((event.target as HTMLInputElement).value);
  const ms = SPEEDS_MS[index] ?? SPEEDS_MS[2];
  playback.setSpeed(ms);
  if (speedLabel) speedLabel.textContent = `${ms} ms`;
});

render();
