// The drawing shell both scenes share (spec 008 H5; FR-132, FR-135, FR-141, FR-145 to FR-158, FR-167 to FR-194): the
// renderer, the faction and territory labels, the front colouring of a round step, the playback frames, the camera and
// the resize. It takes owner tables and step data, never a seed, a round count or the sim, and it reads no clock: the
// caller hands in the reading of each request and the frame loop supplies the frames. Behaviour is the one `ui/main.ts`
// had before the extraction; the debug scene and the live scene differ only in where their rounds come from.
import type { FactionId, MapData, PresentationData, Rgb, TerritoryId } from '@mbrg/shared';
import { initialCamera, resizeCamera } from '../core/camera';
import type { Camera, Viewport } from '../core/camera';
import { factionColorList, buildEntryIndex, factionIndexOf, ownerTable } from '../core/entries';
import type { EntryIndex } from '../core/entries';
import { frontField } from '../core/front';
import type { FrontField } from '../core/front';
import { instantLabels, labelsAt } from '../core/label-frame';
import type { AnyLabelDraw, RoundLabels, StepLabels } from '../core/label-frame';
import { labelTexts, roundLabels } from '../core/label-input';
import { labelCounts } from '../core/label-counts';
import type { Counts } from '../core/label-counts';
import { LABEL_PARAMS } from '../core/label-params';
import { CENTRE_PARAMS } from '../core/centre-params';
import { placeCentredFactions, placeCentredTerritories } from '../core/label-centred-place';
import type { CentredFactionLayout } from '../core/label-centred-place';
import { frame, motionChanged, request, startPlayback } from '../core/playback';
import type { PlaybackState, RequestOutcome } from '../core/playback';
import { buildPieceIndex } from '../core/regions';
import type { StepData } from '../core/step';
import { SHAPE_PARAMS } from '../core/shape-params';
import { THEME, toMapTheme } from '../core/theme';
import { attachLabelLayer } from '../render/labels-layer';
import { createMapScene } from '../render/map-scene';
import { attachRenderer } from '../render/renderer';
import { createFrameLoop } from './frame-loop';
import { watchMotion } from './motion';
import { measureAspects } from './text-metrics';

/** Everything the drawing needs of one round: its owner table, faction label layout and label draw data. */
interface RoundView {
  table: Uint8Array;
  layout: CentredFactionLayout;
  labels: RoundLabels;
  draws: AnyLabelDraw[];
  counts: { faction: Counts; territory: Counts };
}

/** The two rounds of a step with the front distances and the label inputs of both (FR-179 to FR-181, FR-188). */
interface StepView {
  earlier: RoundView;
  later: RoundView;
  labels: StepLabels;
  field: FrontField;
}

/** A round (and the step that leads to it) ready to be shown by `commit`. */
export interface PreparedRound {
  readonly round: RoundView;
  readonly step: StepView | undefined;
}

export interface MapViewInput {
  canvas: HTMLCanvasElement;
  labelCanvas: HTMLCanvasElement;
  map: MapData;
  presentation: PresentationData;
  width: number;
  height: number;
  values: ArrayLike<number>;
  colors: ReadonlyMap<FactionId, Rgb>;
  viewport: Viewport;
  /** The round on display at load; `frozen` holds a step stopped at a forward progress (FR-191). */
  start: {
    round: number;
    owners: ReadonlyMap<TerritoryId, FactionId>;
    frozen?: { data: StepData; progress: number };
    camera?: Camera;
  };
  /** Called after every frame the loop draws (the debug scene measures frame times here). */
  onFrame?: (nowMs: number) => void;
  /** Called after the window was resized and the camera adjusted (the debug scene rewrites its address here). */
  onResize?: () => void;
}

export interface MapView {
  readonly index: EntryIndex;
  readonly owners: ReadonlyMap<FactionId, number>;
  camera(): Camera;
  viewport(): Viewport;
  /** Changes the camera and asks for a frame. */
  setCamera(next: Camera): void;
  /** What a change to round `target` needs; nothing is changed until `commit` (FR-176 to FR-178, FR-183). */
  request(target: number, nowMs: number): RequestOutcome;
  /** The views of a round (and of the step to it when `data` is given); `forward` tells the direction of the step. */
  prepare(owners: ReadonlyMap<TerritoryId, FactionId>, data: StepData | undefined, forward: boolean): PreparedRound;
  /** Shows what `prepare` made and draws the first frame at once; a running step continues frame by frame. */
  commit(outcome: RequestOutcome, prepared: PreparedRound, startedMs: number): void;
  /** The label counts of the displayed round (FR-214). */
  counts(): { faction: Counts; territory: Counts };
  /** Draws one frame at clock reading `nowMs`; true while a step is running. */
  paint(nowMs: number): boolean;
}

export function createMapView(input: MapViewInput): MapView {
  const { canvas, labelCanvas, map, presentation, width, height, values, start } = input;
  const image = { w: width, h: height };
  let viewport: Viewport = input.viewport;
  const index = buildEntryIndex(map, width, height, values);
  const colorList = factionColorList(map, input.colors);
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
  const territoryLayout = placeCentredTerritories(
    pieces,
    texts.territories.map((t) => (t === undefined ? undefined : aspectOf.get(t))),
    LABEL_PARAMS,
    SHAPE_PARAMS,
    CENTRE_PARAMS,
  );

  const viewOf = (table: Uint8Array, previous?: RoundView): RoundView => {
    const layout = placeCentredFactions(pieces, table, factionAspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, previous?.layout);
    const placement = { factions: layout.placed, territories: territoryLayout.placed };
    const labels = roundLabels(texts, table, layout.boxes, territoryLayout.boxes, placement);
    return { table, layout, labels, draws: instantLabels(labels), counts: labelCounts(texts, table, layout, territoryLayout) };
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
  if (start.frozen !== undefined) {
    const earlier = viewOf(ownerTable(index, start.frozen.data.earlier, owners));
    current = viewOf(ownerTable(index, start.owners, owners), earlier);
    stepView = stepOf(earlier, current, start.frozen.data);
  } else {
    current = viewOf(ownerTable(index, start.owners, owners));
  }
  let playback: PlaybackState = startPlayback(start.round, start.frozen?.progress);
  const motion = watchMotion(() => {
    const done = motionChanged(playback);
    if (!done.completed) return;
    playback = done.state;
    stepView = undefined;
    loop.request();
  });

  let camera: Camera = start.camera ?? initialCamera(image, viewport);
  const dpr = (): number => window.devicePixelRatio || 1;

  // One drawing at clock reading `nowMs`: the playback says whole round or step at forward progress f.
  let shownTable: Uint8Array | undefined;
  let sizedFor = '';
  const paint = (nowMs: number): boolean => {
    const out = frame(playback, nowMs, LABEL_PARAMS.durationMs);
    playback = out.state;
    if (out.finished) stepView = undefined;
    let drawn: readonly AnyLabelDraw[];
    const shown = out.drawing;
    if (shown.shape === 'step' && stepView !== undefined) {
      if (shownTable !== stepView.later.table) mapScene.setOwners(stepView.later.table);
      shownTable = stepView.later.table;
      mapScene.setFront({ before: stepView.earlier.table, field: stepView.field, forward: shown.forward });
      drawn = labelsAt(stepView.labels, shown.forward);
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

  // Frames from the loop: camera changes and the frames of a running step.
  const loop = createFrameLoop((t) => {
    const more = paint(t);
    input.onFrame?.(t);
    return more;
  });

  window.addEventListener('resize', () => {
    viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    camera = resizeCamera(camera, image, viewport);
    input.onResize?.();
    loop.request();
  });

  return {
    index,
    owners,
    camera: () => camera,
    viewport: () => viewport,
    setCamera: (next) => {
      camera = next;
      loop.request();
    },
    request: (target, nowMs) => request(playback, target, nowMs, motion.reduced()),
    prepare: (ownersAt, data, forward) => {
      const round = viewOf(ownerTable(index, ownersAt, owners), current);
      const step = data === undefined ? undefined : forward ? stepOf(current, round, data) : stepOf(round, current, data);
      return { round, step };
    },
    commit: (outcome, prepared, startedMs) => {
      playback = outcome.state;
      current = prepared.round;
      stepView = prepared.step;
      paint(startedMs);
      if (playback.running !== undefined) loop.request();
    },
    counts: () => current.counts,
    paint,
  };
}
