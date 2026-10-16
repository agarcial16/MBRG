// Startup and shell (FR-132, FR-133, FR-135, FR-141, FR-145 to FR-158): load -> check -> colours -> index ->
// scene -> draw, then camera input, round controls, the debug panel, address sync and timings.
// Any startup failure shows one Spanish message and draws no map.
// A round change is synchronous: scene -> owner table -> draw -> panel -> address (FR-155).
// Camera changes are drawn on demand, at most once per animation frame; frame times are measured
// between consecutive frames of one interaction (FR-158).
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { MapData, PresentationData } from '@mbrg/shared';
import { parseAddress, problemMessage } from '../core/address';
import { initialCamera, resizeCamera, screenToMap } from '../core/camera';
import type { Camera, ScreenPoint, Viewport } from '../core/camera';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../core/entries';
import { navigate, parseTypedRound, typedRoundMessage } from '../core/navigation';
import type { NavAction } from '../core/navigation';
import { checkPackage, packageErrorMessage } from '../core/package';
import { appendSample, frameStats } from '../core/perf';
import { pointerInfo, sceneAt, sceneErrorMessage } from '../core/scene';
import type { Scene } from '../core/scene';
import { STRINGS } from '../core/strings';
import { THEME, toMapTheme } from '../core/theme';
import { createMapScene } from '../render/map-scene';
import { attachRenderer, probeCapabilities } from '../render/renderer';
import { now } from './clock';
import { attachInput } from './input';
import { loadPackage } from './load';
import { createPanel } from './panel';
import { syncAddress } from './url';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const panelContainer = document.getElementById('panel') as HTMLElement;
document.title = STRINGS.debugTitle;

/** Frame intervals longer than this end an interaction instead of being measured. */
const INTERACTION_GAP_MS = 250;

/** Shows one message instead of the map. */
function showError(message: string): void {
  canvas.style.display = 'none';
  const text = document.createElement('p');
  text.style.cssText = 'margin:16px;font:16px sans-serif;color:#2b2b2b';
  text.textContent = message;
  panelContainer.replaceChildren(text);
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
  const sim = { totalRounds, getState, getRounds, ownerOf };
  const first = sceneAt(map, presentation, address.seed, address.round, sim);
  if (!first.ok) return showError(sceneErrorMessage(first.errors));
  let scene: Scene = first.value;

  const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
  const mapScene = createMapScene(index, factionColorList(map, colors.value), toMapTheme(THEME));
  const owners = factionIndexOf(map);
  mapScene.setOwners(ownerTable(index, scene.owners, owners));
  const renderer = attachRenderer(canvas, mapScene);

  let camera: Camera = address.camera ?? initialCamera(image, viewport);
  const dpr = (): number => window.devicePixelRatio || 1;
  const drawNow = (): void => {
    renderer.resize(viewport, dpr());
    mapScene.setView({ camera, viewport, dpr: dpr() });
    renderer.draw();
  };

  // Messages: the address problems stay; a rejected typed round is added until the next change.
  const addressMessages = address.problems.map(problemMessage);
  let typedMessage: string | undefined;
  const showMessages = (): void => {
    panel.showMessages(typedMessage === undefined ? addressMessages : [...addressMessages, typedMessage]);
  };

  // Timings (FR-158).
  let frames: number[] = [];
  let loadMs: number | undefined;
  let roundChangeMs: number | undefined;
  let lastFrame: number | undefined;
  const showTimings = (): void => {
    const timings = { frames: frameStats(frames) };
    panel.showTimings({
      ...timings,
      ...(loadMs !== undefined ? { load: loadMs } : {}),
      ...(roundChangeMs !== undefined ? { roundChange: roundChangeMs } : {}),
    });
  };

  // Camera changes: draw at most once per animation frame, and measure the interval between frames.
  let framePending = false;
  const requestDraw = (): void => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      const t = now();
      drawNow();
      if (lastFrame !== undefined && t - lastFrame < INTERACTION_GAP_MS) frames = appendSample(frames, t - lastFrame);
      lastFrame = t;
      showTimings();
    });
  };
  const setCamera = (next: Camera): void => {
    camera = next;
    syncAddress(scene.seed, scene.round, camera);
    requestDraw();
  };

  // Round change (FR-154, FR-155): everything in one synchronous step.
  const showRound = (n: number): void => {
    const started = now();
    const next = sceneAt(map, presentation, scene.seed, n, sim);
    if (!next.ok) {
      typedMessage = sceneErrorMessage(next.errors);
      showMessages();
      return;
    }
    scene = next.value;
    typedMessage = undefined;
    mapScene.setOwners(ownerTable(index, scene.owners, owners));
    drawNow();
    panel.showScene(scene);
    showMessages();
    syncAddress(scene.seed, scene.round, camera);
    roundChangeMs = now() - started;
    lastFrame = undefined;
    showTimings();
  };
  const go = (action: NavAction): void => {
    const target = navigate(scene.round, scene.total, action);
    if (target !== 'invalid') showRound(target);
  };

  let pointer: ScreenPoint | undefined;
  const showPointer = (): void => {
    panel.showPointer(
      pointer === undefined ? undefined : pointerInfo(index, scene, presentation, screenToMap(camera, pointer, viewport)),
    );
  };

  const panel = createPanel(panelContainer, presentation, colors.value, {
    onNavigate: go,
    onTypedRound: (text) => {
      const target = parseTypedRound(text, scene.total);
      if (target === 'invalid') {
        typedMessage = typedRoundMessage(text, scene.total);
        showMessages();
        return;
      }
      showRound(target);
    },
    onReset: () => {
      setCamera(initialCamera(image, viewport));
      showPointer();
    },
  });
  panel.showScene(scene);
  showMessages();
  panel.showPointer(undefined);

  attachInput(canvas, {
    image,
    viewport: () => viewport,
    camera: () => camera,
    setCamera: (next) => {
      setCamera(next);
      showPointer();
    },
    pointerMoved: (point) => {
      pointer = point;
      showPointer();
    },
    navigate: go,
  });
  window.addEventListener('resize', () => {
    viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    camera = resizeCamera(camera, image, viewport);
    syncAddress(scene.seed, scene.round, camera);
    requestDraw();
  });

  drawNow();
  loadMs = now();
  showTimings();
}

void start();
