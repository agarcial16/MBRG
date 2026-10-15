// Startup (FR-132, FR-133, FR-135, FR-141, FR-152): load -> check -> colours -> index -> scene -> draw.
// Any failure shows one Spanish message and draws no map. Camera input, controls and the debug panel
// arrive in the next task; here the page address picks the scene and the camera (FR-150) and the map is
// drawn once at the fit view, or at the camera of the address.
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { MapData, PresentationData } from '@mbrg/shared';
import { parseAddress } from '../core/address';
import { initialCamera, resizeCamera } from '../core/camera';
import type { Camera, Viewport } from '../core/camera';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../core/entries';
import { checkPackage, packageErrorMessage } from '../core/package';
import { sceneAt, sceneErrorMessage } from '../core/scene';
import { THEME, toMapTheme } from '../core/theme';
import { createMapScene } from '../render/map-scene';
import { attachRenderer, probeCapabilities } from '../render/renderer';
import { loadPackage } from './load';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

/** Shows one message instead of the map. */
function showError(message: string): void {
  canvas.style.display = 'none';
  const text = document.createElement('p');
  text.style.cssText = 'margin:16px;font:16px sans-serif;color:#2b2b2b';
  text.textContent = message;
  panel.replaceChildren(text);
}

async function start(): Promise<void> {
  const loaded = await loadPackage();
  if (!loaded.ok) return showError(packageErrorMessage(loaded.errors));
  const pkg = loaded.value;

  const errors = checkPackage(pkg.map, pkg.presentation, pkg.width, pkg.height, pkg.values);
  if (errors.length > 0) return showError(packageErrorMessage(errors));
  const map = pkg.map as MapData;
  const presentation = pkg.presentation as PresentationData;
  const entryCount = map.territories.length;

  const problems = checkCapabilities(probeCapabilities(), pkg.width, pkg.height, entryCount + 1);
  if (problems.length > 0) return showError(capabilityMessage(problems[0]!));

  const colors = assignFactionColors(map, presentation, THEME);
  if (!colors.ok) return showError(paletteMessage(colors.errors[0]!, presentation));

  const total = totalRounds(map);
  if (!total.ok) return showError(sceneErrorMessage(total.errors));
  const image = { w: pkg.width, h: pkg.height };
  let viewport: Viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
  const address = parseAddress(window.location.search, total.value, image, viewport);
  const scene = sceneAt(map, presentation, address.seed, address.round, { totalRounds, getState, getRounds, ownerOf });
  if (!scene.ok) return showError(sceneErrorMessage(scene.errors));

  const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
  const mapScene = createMapScene(index, factionColorList(map, colors.value), toMapTheme(THEME));
  mapScene.setOwners(ownerTable(index, scene.value.owners, factionIndexOf(map)));
  const renderer = attachRenderer(canvas, mapScene);

  let camera: Camera = address.camera ?? initialCamera(image, viewport);
  const dpr = (): number => window.devicePixelRatio || 1;
  const draw = (): void => {
    renderer.resize(viewport, dpr());
    mapScene.setView({ camera, viewport, dpr: dpr() });
    renderer.draw();
  };
  window.addEventListener('resize', () => {
    viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    camera = resizeCamera(camera, image, viewport);
    draw();
  });
  draw();
}

void start();
