// Startup and shell (FR-132, FR-133, FR-135, FR-141, FR-145 to FR-158, FR-167 to FR-194): load -> check -> colours
// -> index -> labels -> scene -> draw, then camera input, round controls, round-step playback, the debug panel,
// address sync and timings. Any startup failure shows one Spanish message and draws no map.
// A round change updates the scene, the owner table, the labels, the panel and the address in one synchronous
// step and draws its first frame at once; a step of one round then continues frame by frame (FR-176, FR-186).
// Camera changes and step frames share one frame loop that draws at most once per animation frame; frame
// times are measured between consecutive frames of one interaction (FR-158).
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { MapData, PresentationData } from '@mbrg/shared';
import { parseAddress, problemMessage } from '../core/address';
import { initialCamera, resizeCamera, screenToMap } from '../core/camera';
import type { Camera, ScreenPoint, Viewport } from '../core/camera';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../core/entries';
import { frontField } from '../core/front';
import type { FrontField } from '../core/front';
import { instantLabels, labelsAt } from '../core/label-frame';
import type { AnyLabelDraw, LabelDraw, RoundLabels, StepLabels } from '../core/label-frame';
import { labelTexts, roundLabels } from '../core/label-input';
import { factionBoxes, territoryBoxes } from '../core/label-layout';
import type { FactionBoxes } from '../core/label-layout';
import { LABEL_PARAMS } from '../core/label-params';
import { navigate, parseTypedRound, typedRoundMessage } from '../core/navigation';
import type { NavAction } from '../core/navigation';
import { checkPackage, packageErrorMessage } from '../core/package';
import { appendSample, frameStats } from '../core/perf';
import { frame, motionChanged, request, startPlayback } from '../core/playback';
import type { PlaybackState } from '../core/playback';
import { buildPieceIndex } from '../core/regions';
import { pointerInfo, sceneAt, sceneErrorMessage } from '../core/scene';
import type { Scene } from '../core/scene';
import { frozenScenes, stepScenes } from '../core/step';
import type { StepData } from '../core/step';
import { STRINGS } from '../core/strings';
import { THEME, toMapTheme } from '../core/theme';
import { attachLabelLayer } from '../render/labels-layer';
import { createMapScene } from '../render/map-scene';
import { attachRenderer, probeCapabilities } from '../render/renderer';
import { now } from './clock';
import { createFrameLoop } from './frame-loop';
import { attachInput } from './input';
import { loadPackage } from './load';
import { watchMotion } from './motion';
import { createPanel } from './panel';
import { measureAspects } from './text-metrics';
import { syncAddress } from './url';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const labelCanvas = document.getElementById('labels') as HTMLCanvasElement;
const panelContainer = document.getElementById('panel') as HTMLElement;
document.title = STRINGS.debugTitle;

/** Frame intervals longer than this end an interaction instead of being measured. */
const INTERACTION_GAP_MS = 250;

/** Everything the drawing needs of one round: its owner table, faction label layout and label draw data. */
interface RoundView {
  table: Uint8Array;
  boxes: FactionBoxes;
  labels: RoundLabels;
  draws: LabelDraw[];
}

/** The two rounds of a step with the front distances and the label inputs of both (FR-179 to FR-181, FR-188). */
interface StepView {
  earlier: RoundView;
  later: RoundView;
  labels: StepLabels;
  field: FrontField;
}

/** Shows one message instead of the map. */
function showError(message: string): void {
  canvas.style.display = 'none';
  labelCanvas.style.display = 'none';
  const text = document.createElement('p');
  text.style.cssText = 'margin:16px;font:16px sans-serif;color:#2b2b2b';
  text.textContent = message;
  panelContainer.replaceChildren(text);
}

// Until the label layer draws shaped labels (T7, T8) the viewer places none, so every draw is a box label.
const boxDraws = (draws: readonly AnyLabelDraw[]): LabelDraw[] => draws.filter((d): d is LabelDraw => 'box' in d);

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

  const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
  const colorList = factionColorList(map, colors.value);
  const mapScene = createMapScene(index, colorList, toMapTheme(THEME));
  const owners = factionIndexOf(map);
  const renderer = attachRenderer(canvas, mapScene);
  const labelLayer = attachLabelLayer(labelCanvas);

  // Labels: the piece index and the territory boxes are computed once per page load (FR-171, NFR-32).
  const pieces = buildPieceIndex(index);
  const texts = labelTexts(map, presentation, owners);
  const aspectOf = measureAspects([...texts.factions.values(), ...texts.territories.filter((t): t is string => t !== undefined)]);
  const factionAspects = new Map<number, number>();
  for (const [faction, name] of texts.factions) {
    const aspect = aspectOf.get(name);
    if (aspect !== undefined) factionAspects.set(faction, aspect);
  }
  const territoryLayout = territoryBoxes(
    pieces,
    texts.territories.map((t) => (t === undefined ? undefined : aspectOf.get(t))),
    LABEL_PARAMS,
  );

  const viewOf = (table: Uint8Array, previous?: RoundView): RoundView => {
    const boxes = factionBoxes(pieces, table, factionAspects, LABEL_PARAMS, previous?.boxes);
    const labels = roundLabels(texts, table, boxes, territoryLayout);
    return { table, boxes, labels, draws: boxDraws(instantLabels(labels)) };
  };
  const stepOf = (earlier: RoundView, later: RoundView, data: StepData): StepView => {
    const transferred = new Set<number>();
    for (const id of data.transferred) {
      const entry = index.indexOf.get(id);
      if (entry !== undefined) transferred.add(entry);
    }
    const eliminated = owners.get(data.eliminated)!;
    const absorber = owners.get(data.absorber)!;
    return {
      earlier,
      later,
      labels: { earlier: earlier.labels, later: later.labels, eliminated, absorber, transferred },
      field: frontField(pieces, transferred, earlier.table, absorber),
    };
  };

  // The displayed round's view, and the step view while a step runs or a progress is frozen (released afterwards, FR-187).
  let current: RoundView;
  let stepView: StepView | undefined;
  if (frozenData !== undefined) {
    const earlier = viewOf(ownerTable(index, frozenData.earlier, owners));
    current = viewOf(ownerTable(index, scene.owners, owners), earlier);
    stepView = stepOf(earlier, current, frozenData);
  } else {
    current = viewOf(ownerTable(index, scene.owners, owners));
  }
  let frozenText = address.transition?.text;
  let playback: PlaybackState = startPlayback(scene.round, address.transition?.value);
  const motion = watchMotion(() => {
    const done = motionChanged(playback);
    if (!done.completed) return;
    playback = done.state;
    stepView = undefined;
    loop.request();
  });

  let camera: Camera = address.camera ?? initialCamera(image, viewport);
  const dpr = (): number => window.devicePixelRatio || 1;

  // Messages: the address problems stay; a rejected typed round is added until the next change.
  const addressMessages = address.problems.map(problemMessage);
  let typedMessage: string | undefined;
  const showMessages = (): void => {
    panel.showMessages(typedMessage === undefined ? addressMessages : [...addressMessages, typedMessage]);
  };

  // Timings (FR-158, FR-190).
  let frames: number[] = [];
  let loadMs: number | undefined;
  let roundChangeMs: number | undefined;
  let labelsMs: number | undefined;
  let lastFrame: number | undefined;
  const showTimings = (): void => {
    const timings = { frames: frameStats(frames) };
    panel.showTimings({
      ...timings,
      ...(loadMs !== undefined ? { load: loadMs } : {}),
      ...(roundChangeMs !== undefined ? { roundChange: roundChangeMs } : {}),
      ...(labelsMs !== undefined ? { labels: labelsMs } : {}),
    });
  };

  // One drawing at clock reading `nowMs`: the playback says whole round or step at forward progress f.
  let shownTable: Uint8Array | undefined;
  let sizedFor = '';
  const paint = (nowMs: number): boolean => {
    const out = frame(playback, nowMs, LABEL_PARAMS.durationMs);
    playback = out.state;
    if (out.finished) stepView = undefined;
    let drawn: readonly LabelDraw[];
    const shown = out.drawing;
    if (shown.shape === 'step' && stepView !== undefined) {
      if (shownTable !== stepView.later.table) mapScene.setOwners(stepView.later.table);
      shownTable = stepView.later.table;
      mapScene.setFront({ before: stepView.earlier.table, field: stepView.field, forward: shown.forward });
      drawn = boxDraws(labelsAt(stepView.labels, shown.forward));
    } else {
      if (shownTable !== current.table) mapScene.setOwners(current.table);
      shownTable = current.table;
      mapScene.setFront(undefined);
      drawn = current.draws;
    }
    const ratio = dpr();
    const key = `${viewport.width}x${viewport.height}@${ratio}`;
    if (key !== sizedFor) {
      sizedFor = key;
      renderer.resize(viewport, ratio);
      labelLayer.resize(viewport, ratio);
    }
    const view = { camera, viewport, dpr: ratio };
    mapScene.setView(view);
    renderer.draw();
    labelLayer.draw(drawn, view);
    return playback.running !== undefined;
  };

  // Frames from the loop: camera changes and the frames of a running step; frame times between consecutive frames.
  const loop = createFrameLoop((t) => {
    const more = paint(t);
    if (lastFrame !== undefined && t - lastFrame < INTERACTION_GAP_MS) frames = appendSample(frames, t - lastFrame);
    lastFrame = t;
    showTimings();
    return more;
  });
  const setCamera = (next: Camera): void => {
    camera = next;
    syncAddress(scene.seed, scene.round, camera, frozenText);
    loop.request();
  };

  // Round change (FR-154, FR-155, FR-176 to FR-178, FR-183, FR-186, FR-194): everything in one synchronous step.
  const showRound = (n: number): void => {
    const started = now();
    const outcome = request(playback, n, started, motion.reduced());
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
    const view = viewOf(ownerTable(index, next.owners, owners), current);
    const nextStep = data === undefined ? undefined : n > scene.round ? stepOf(current, view, data) : stepOf(view, current, data);
    labelsMs = now() - labelsStarted;

    playback = outcome.state;
    scene = next;
    current = view;
    stepView = nextStep;
    typedMessage = undefined;
    if (outcome.unfroze) frozenText = undefined;
    paint(started);
    panel.showScene(scene);
    showMessages();
    syncAddress(scene.seed, scene.round, camera, frozenText);
    roundChangeMs = now() - started;
    lastFrame = undefined;
    showTimings();
    if (playback.running !== undefined) loop.request();
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
    syncAddress(scene.seed, scene.round, camera, frozenText);
    loop.request();
  });

  paint(now());
  loadMs = now();
  showTimings();
}

void start();
