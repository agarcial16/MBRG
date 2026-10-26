// The drawing shell both scenes share (spec 008 H5; FR-132, FR-135, FR-141, FR-145 to FR-158, FR-167 to FR-194): the
// renderer, the faction and territory labels, the front colouring of a round step, the playback frames, the camera and
// the resize. It takes owner tables and step data, never a seed, a round count or the sim, and it reads no clock: the
// caller hands in the reading of each request and the frame loop supplies the frames. Behaviour is the one `ui/main.ts`
// had before the extraction; the debug scene and the live scene differ only in where their rounds come from.
// It also plays the reveal tours of spec 009 (dim, labels, marker, camera, hand-over to the round step): the decisions are
// the pure `core/tour-session.ts`; this file applies what the session answers and calls no layout function while a tour paints.
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
import { completeRunning, frame, motionChanged, request, startPlayback } from '../core/playback';
import type { PlaybackState, RequestOutcome } from '../core/playback';
import { buildPieceIndex } from '../core/regions';
import type { StepData } from '../core/step';
import { SHAPE_PARAMS } from '../core/shape-params';
import { THEME, toMapTheme } from '../core/theme';
import { framingBoxOf } from '../core/tour-camera';
import type { Box } from '../core/tour-camera';
import { tourLabelDraws } from '../core/tour-frame';
import {
  beginSession,
  completeSession,
  freezeSession,
  frozenStart,
  motionChangedSession,
  paintSession,
  planTours,
  sameStatus,
  takeCamera,
} from '../core/tour-session';
import type { SessionPaint, SessionView, TourRequest, TourSession, TourStatus } from '../core/tour-session';
import { attachLabelLayer } from '../render/labels-layer';
import type { TourOverlay } from '../render/labels-layer';
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

/**
 * The round step that follows an absorber tour (FR-345): the owners and step data of round k are held, never drawn, until the
 * tour's end frame; the round-k views are computed on the tour's second frame (NFR-58).
 */
export interface TourThen {
  readonly target: number;
  readonly owners: ReadonlyMap<TerritoryId, FactionId>;
  readonly data: StepData;
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
  /** Called when the tour on screen changes: it started, its result shows, it ended, the next tour began, the run ended. */
  onTour?: (status: TourStatus) => void;
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
  /** Draws one frame at clock reading `nowMs`; true while a step or a tour is running. */
  paint(nowMs: number): boolean;
  /**
   * Plays the tours asked for from the handling reading (t = 0, D11), drawn over the held view of the displayed round; `then` is
   * the round step that follows the last one. False, with nothing changed, when no tour plays (reduced motion, a short budget).
   * A running tour is completed first, then a running round step (FR-339, FR-340).
   */
  beginTour(requests: readonly TourRequest[], handlingMs: number, then?: TourThen): boolean;
  /** Draws one tour of the held view frozen at elapsed time `t`, with no clock; `taken` when an address camera counts as the user's. */
  freezeTour(request: TourRequest, t: number, taken: boolean): boolean;
  /** Completes the running tour at once (skip, request, halt, FR-339); with no tour running it does nothing at all. */
  completeTour(nowMs: number): void;
  /** The user's camera (pan, zoom, reset): changes the camera and takes it from a running tour (FR-333). */
  userCamera(next: Camera): void;
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
  // Tours (spec 009): the session, the round step held for the end of an absorber tour, its views once made, the last status reported.
  let session: TourSession | undefined;
  let held: TourThen | undefined;
  let heldViews: PreparedRound | undefined;
  let reported: TourStatus | undefined;
  let motionPending = false;
  const motion = watchMotion(() => {
    if (session !== undefined) {
      // A tour completes at the next frame, which brings the clock reading its step needs (FR-344).
      motionPending = true;
      loop.request();
    }
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
  /** The framing box of each faction of the drawn round, from its label set (PD6). */
  const boxesOf = (factions: readonly number[]): ReadonlyMap<number, Box> => {
    const out = new Map<number, Box>();
    for (const f of factions) {
      const box = framingBoxOf(current.layout.boxes, current.table, [f]);
      if (box !== undefined) out.set(f, box);
    }
    return out;
  };
  const sessionView = (): SessionView => ({ area: viewport, image, current: camera });

  const present = (drawn: readonly AnyLabelDraw[], overlay?: TourOverlay): void => {
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
    labelLayer.draw(drawn, view, overlay);
  };

  const report = (status: TourStatus): void => {
    if (reported !== undefined && sameStatus(reported, status)) return;
    reported = status;
    input.onTour?.(status);
  };

  // What a tour frame draws: the held view of the displayed round (never round k), the dim, the label factors, the overlay, the camera.
  const applyTour = (out: SessionPaint): boolean => {
    session = out.session;
    if (out.prepare && held !== undefined && heldViews === undefined) heldViews = self.prepare(held.owners, held.data, true);
    if (out.ended) reported = undefined;
    if (out.ended && out.step !== undefined && held !== undefined) {
      // The end frame: the 005 step of round k starts at this frame's reading and the round-k views become the drawn ones.
      const pending = held;
      const prepared = heldViews ?? self.prepare(pending.owners, pending.data, true);
      held = undefined;
      heldViews = undefined;
      mapScene.setTour(undefined);
      self.commit(request(playback, pending.target, out.step.startMs, motion.reduced()), prepared, out.step.startMs);
      input.onTour?.(out.status);
      return playback.running !== undefined;
    }
    if (out.ended) held = undefined;
    if (out.frame.camera !== undefined) camera = out.frame.camera;
    if (shownTable !== current.table) mapScene.setOwners(current.table);
    shownTable = current.table;
    mapScene.setFront(undefined);
    mapScene.setTour({ lit: out.frame.lit, dim: out.frame.dim });
    const overlay: TourOverlay = {
      ...(out.frame.marker === undefined ? {} : { marker: out.frame.marker }),
      ...(out.frame.indicator === undefined ? {} : { indicator: out.frame.indicator }),
    };
    present(tourLabelDraws(current.labels, out.frame.lit, out.frame.factors.other), overlay);
    if (out.ended) input.onTour?.(out.status);
    else report(out.status);
    return session !== undefined && session.run !== undefined;
  };

  const paint = (nowMs: number): boolean => {
    if (session !== undefined) {
      const v = sessionView();
      const done = motionPending ? motionChangedSession(session, nowMs, v) : undefined;
      motionPending = false;
      return applyTour(done ?? paintSession(session, nowMs, v));
    }
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
    mapScene.setTour(undefined);
    present(drawn);
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

  const self: MapView = {
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
    beginTour: (requests, handlingMs, then) => {
      const plan = planTours(requests, motion.reduced(), boxesOf);
      if (plan.tours.length === 0) return false;
      // A running tour completes first, then a running round step (FR-339, FR-340); both end before the first tour frame.
      const prior = completeSession(session, handlingMs, sessionView());
      if (prior !== undefined) applyTour(prior);
      const stepDone = completeRunning(playback);
      if (stepDone.completed) {
        playback = stepDone.state;
        stepView = undefined;
      }
      held = then;
      heldViews = undefined;
      reported = undefined;
      motionPending = false;
      session = beginSession(plan, handlingMs, { camera }, then !== undefined);
      paint(handlingMs);
      loop.request();
      return true;
    },
    freezeTour: (request, t, taken) => {
      const plan = planTours([request], false, boxesOf);
      if (plan.tours.length === 0) return false;
      held = undefined;
      heldViews = undefined;
      reported = undefined;
      session = freezeSession(plan.tours[0]!, false, t, frozenStart(request, boxesOf), taken);
      paint(0);
      return true;
    },
    completeTour: (nowMs) => {
      const out = completeSession(session, nowMs, sessionView());
      if (out === undefined) return;
      applyTour(out);
    },
    userCamera: (next) => {
      session = takeCamera(session);
      camera = next;
      loop.request();
    },
  };
  return self;
}
