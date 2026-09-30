import './style.css';

import { handmadeMap } from './maps/handmade.js';
import { drawMap, initialColors, initialOwners } from './render.js';

const canvas = document.querySelector<HTMLCanvasElement>('#map');
if (canvas) {
  drawMap(canvas, handmadeMap, initialOwners(handmadeMap), initialColors(handmadeMap));
}
