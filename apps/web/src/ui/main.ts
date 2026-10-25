// Startup and shell (FR-132, FR-133, FR-135, FR-141, FR-145 to FR-158, FR-167 to FR-194): load -> check -> colours
// -> index -> labels -> scene -> draw, then camera input, round controls, round-step playback, the debug panel,
// address sync and timings. Any startup failure shows one Spanish message and draws no map.
// A round change updates the scene, the owner table, the labels, the panel and the address in one synchronous
// step and draws its first frame at once; a step of one round then continues frame by frame (FR-176, FR-186).
// Camera changes and step frames share one frame loop that draws at most once per animation frame; frame
// times are measured between consecutive frames of one interaction (FR-158).
// The drawing itself (renderer, labels, front, playback frames, camera, resize) lives in `map-view.ts`, shared with
// the live scene (spec 008 H5); this file keeps what is specific to the debug scene: the sim, the seed, the panel.
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { MapData, PresentationData } from '@mbrg/shared';
import { parseAddress, problemMessage } from '../core/address';
import { initialCamera, screenToMap } from '../core/camera';
import type { Camera, ScreenPoint, Viewport } from '../core/camera';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { navigate, parseTypedRound, typedRoundMessage } from '../core/navigation';
import type { NavAction } from '../core/navigation';
import { checkPackage, packageErrorMessage } from '../core/package';
import { appendSample, frameStats } from '../core/perf';
import { pointerInfo, sceneAt, sceneErrorMessage } from '../core/scene';
import type { Scene } from '../core/scene';
import { frozenScenes, stepScenes } from '../core/step';
import type { StepData } from '../core/step';
import { STRINGS } from '../core/strings';
import { THEME } from '../core/theme';
import { probeCapabilities } from '../render/renderer';
import { now } from './clock';
import { attachInput } from './input';
import { loadPackage } from './load';
import { createMapView } from './map-view';
import { createPanel } from './panel';
import { syncAddress } from './url';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const labelCanvas = document.getElementById('labels') as HTMLCanvasElement;
const panelContainer = document.getElementById('panel') as HTMLElement;
document.title = STRINGS.debugTitle;
// The marker the production build check looks for: the debug scene must never reach a production page (FR-309).
document.documentElement.setAttribute('data-mbrg-scene', 'debug');

/** Frame intervals longer than this end an interaction instead of being measured. */
const INTERACTION_GAP_MS = 250;

/** Shows one message instead of the map. */
function showError(message: string): void {
  canvas.style.display = 'none';
  labelCanvas.style.display = 'none';
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
  const viewport: Viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
  const address = parseAddress(window.location.search, total.value, image, viewport);
  const sim = { totalRounds, getState, getRounds, ownerOf };

  // A valid `transition` freezes the step between rounds N - 1 and N (FR-191); the sim is asked for those two only (FR-187).
  let scene: Scene;
  let frozenData: StepData | undefined;
  if (address.transition !== undefined) {
    const frozen = frozenScenes(map, presentation, address.seed, address.round, sim);
    if (!frozen.ok) return showError(sceneErrorMessage(frozen.errors));
    scene = frozen.value.scene;
    frozenData = frozen.value.data;
  } else {
    const first = sceneAt(map, presentation, address.seed, address.round, sim);
    if (!first.ok) return showError(sceneErrorMessage(first.errors));
    scene = first.value;
  }

  // Timings (FR-158, FR-190).
  let frames: number[] = [];
  let loadMs: number | undefined;
  let roundChangeMs: number | undefined;
  let labelsMs: number | undefined;
  let lastFrame: number | undefined;
  let frozenText = address.transition?.text;
  const showTimings = (): void => {
    const timings = { frames: frameStats(frames) };
    panel.showTimings({
      ...timings,
      ...(loadMs !== undefined ? { load: loadMs } : {}),
      ...(roundChangeMs !== undefined ? { roundChange: roundChangeMs } : {}),
      ...(labelsMs !== undefined ? { labels: labelsMs } : {}),
    });
  };

  const view = createMapView({
    canvas,
    labelCanvas,
    map,
    presentation,
    width: pkg.width,
    height: pkg.height,
    values: pkg.values,
    colors: colors.value,
    viewport,
    start: {
      round: scene.round,
      owners: scene.owners,
      ...(frozenData !== undefined && address.transition !== undefined ? { frozen: { data: frozenData, progress: address.transition.value } } : {}),
      ...(address.camera !== undefined ? { camera: address.camera } : {}),
    },
    // Frame times between consecutive frames of one interaction.
    onFrame: (t) => {
      if (lastFrame !== undefined && t - lastFrame < INTERACTION_GAP_MS) frames = appendSample(frames, t - lastFrame);
      lastFrame = t;
      showTimings();
    },
    onResize: () => syncAddress(scene.seed, scene.round, view.camera(), frozenText),
  });
  const { index } = view;

  // Messages: the address problems stay; a rejected typed round is added until the next change.
  const addressMessages = address.problems.map(problemMessage);
  let typedMessage: string | undefined;
  const showMessages = (): void => {
    panel.showMessages(typedMessage === undefined ? addressMessages : [...addressMessages, typedMessage]);
  };

  const setCamera = (next: Camera): void => {
    view.setCamera(next);
    syncAddress(scene.seed, scene.round, next, frozenText);
  };

  // Round change (FR-154, FR-155, FR-176 to FR-178, FR-183, FR-186, FR-194): everything in one synchronous step.
  const showRound = (n: number): void => {
    const started = now();
    const outcome = view.request(n, started);
    if (outcome.change === 'none') {
      if (typedMessage !== undefined) {
        typedMessage = undefined;
        showMessages();
      }
      return;
    }
    let next: Scene;
    let data: StepData | undefined;
    if (outcome.change === 'step') {
      const stepped = stepScenes(map, presentation, scene.seed, scene, n, sim);
      if (!stepped.ok) {
        typedMessage = sceneErrorMessage(stepped.errors);
        showMessages();
        return;
      }
      next = stepped.value.scene;
      data = stepped.value.data;
    } else {
      const instant = sceneAt(map, presentation, scene.seed, n, sim);
      if (!instant.ok) {
        typedMessage = sceneErrorMessage(instant.errors);
        showMessages();
        return;
      }
      next = instant.value;
    }
    const labelsStarted = now();
    const prepared = view.prepare(next.owners, data, n > scene.round);
    labelsMs = now() - labelsStarted;

    scene = next;
    typedMessage = undefined;
    if (outcome.unfroze) frozenText = undefined;
    view.commit(outcome, prepared, started);
    panel.showScene(scene);
    panel.showCounts(view.counts());
    showMessages();
    syncAddress(scene.seed, scene.round, view.camera(), frozenText);
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
      pointer === undefined ? undefined : pointerInfo(index, scene, presentation, screenToMap(view.camera(), pointer, view.viewport())),
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
      setCamera(initialCamera(image, view.viewport()));
      showPointer();
    },
  });
  panel.showScene(scene);
  panel.showCounts(view.counts());
  showMessages();
  panel.showPointer(undefined);

  attachInput(canvas, {
    image,
    viewport: view.viewport,
    camera: view.camera,
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

  view.paint(now());
  loadMs = now();
  showTimings();
}

void start();
