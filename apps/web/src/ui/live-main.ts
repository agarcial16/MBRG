// The live scene (FR-303 to FR-308, FR-156 shell): it loads nothing itself. The runner reads the public data, verifies the map
// files and then asks this port to build the scene from them; the port draws the rounds it is told and keeps the address equal
// to the displayed round and camera (D31). Any failure shows one Spanish message and draws no map.
import type { PublicMatch } from '@mbrg/protocol';
import type { MapData, PresentationData, Rgb } from '@mbrg/shared';
import { initialCamera, screenToMap, withInset } from '../core/camera';
import type { Camera, Viewport } from '../core/camera';
import { mapInset } from '../core/hud-layout';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { liveProblemMessage, readLiveAddress } from '../core/live-address';
import type { LiveAddress } from '../core/live-address';
import { liveTitle } from '../core/live-text';
import { absorberRequestOf, liveTourPanel, pacedFor, panelView, tourReportOf, victimRequestOf } from '../core/live-view';
import { hudState, inPlayStage, stateCard, topBar } from '../core/live-hud';
import { chronicle, factionRows } from '../core/live-stats';
import { factionAt } from '../core/predict-model';
import type { PlayerCredentials } from '../core/play-token';
import { liveMark, replayBand, roundTrack } from '../core/live-track';
import { cameraAtPoint, cameraZoomed, minimapPixels, minimapSize, viewRect } from '../core/minimap';
import { cameraReturn, movedByUser, roundBegan, watchStart } from '../core/camera-return';
import type { CameraWatch } from '../core/camera-return';
import { pickedOf } from '../core/pick-outline';
import { pinchCamera } from '../core/pinch';
import { bannerDismiss, bannerExpiresIn, bannerNext, bannerStart, bannerView } from '../core/round-banner';
import type { BannerState } from '../core/round-banner';
import { overlayOf } from '../core/round-overlay';
import type { Owners } from '../core/live-rounds';
import { STRINGS } from '../core/strings';
import type { FactionName, TourReport } from '../core/live-view';
import { checkPackage, packageErrorMessage, parsePackage } from '../core/package';
import type { PackageData } from '../core/package';
import { THEME } from '../core/theme';
import { probeCapabilities } from '../render/renderer';
import { now } from './clock';
import { watchMotion } from './motion';
import { attachInput } from './input';
import { pageServerOrigin } from './live-config';
import { createLiveNet, createPlayNet } from './live-net';
import type { MapFiles } from './live-net';
import { createLivePanel, showCard } from './live-panel';
import type { LivePanel } from './live-panel';
import { startRunner } from './live-runner';
import type { LivePort, LiveRunner } from './live-runner';
import { after } from './live-timer';
import { syncLiveAddress } from './live-url';
import { createTerra } from './live-terra';
import type { Terra } from './live-terra';
import { ensureMapFont } from './map-font';
import { createMapView } from './map-view';
import { createPlaySession } from './play-session';
import type { PlaySession } from './play-session';
import { requestId } from './web-crypto';
import type { MapView } from './map-view';
import { showMessage } from './message';

/** Inflates a zlib stream with the platform decompressor. */
async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** What the scene keeps once the verified map files are read. */
interface Built {
  readonly pkg: PackageData;
  readonly map: MapData;
  readonly presentation: PresentationData;
  readonly colors: ReadonlyMap<number, Rgb>;
  readonly address: LiveAddress;
  readonly factions: FactionName[];
  readonly panel: LivePanel;
}

/**
 * Starts the live scene for a match id: the runner does the rest. `player` is the joined player of this browser (spec 013); without
 * one the screen is the spectator's, with the leaderboard and the who-guessed-right lines but no prediction.
 */
export function startLiveScene(matchId: string, player?: PlayerCredentials): void {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const labelCanvas = document.getElementById('labels') as HTMLCanvasElement;
  const panelContainer = document.getElementById('panel') as HTMLElement;
  document.title = liveTitle();
  // Until the map files are verified there is nothing to draw: the screen says what it is doing (FR-365).
  showCard(panelContainer, { title: STRINGS.hudLoadingTitle, text: STRINGS.hudLoadingText }, true);

  let built: Built | undefined;
  let view: MapView | undefined;
  let runner: LiveRunner | undefined;
  let session: PlaySession | undefined;
  let lastRound = 0;
  // The tour on screen, as the map view reported it (FR-330): the panel hides the victim and keeps the old legend by it.
  let tour: TourReport | undefined;

  const syncAddress = (round: number, camera: Camera): void => syncLiveAddress(matchId, round, camera);

  // FR-443: the map area is what the top bar and the open (or folded) dock leave; the camera follows the dock.
  let dockFolded = false;
  const insetNow = (): { top: number; bottom: number } => mapInset(window.innerWidth, window.innerHeight, dockFolded);
  const canvasViewport = (): Viewport => withInset({ width: canvas.clientWidth, height: canvas.clientHeight }, insetNow());

  // FR-410: whether the user moved the camera since the round began; FR-408: the round banner; FR-409/FR-401: the outline.
  let watch: CameraWatch = watchStart;
  let banner: BannerState = bannerStart;
  let bannerTimer = '';
  let pickedNow: number | undefined;
  const motion = watchMotion(() => undefined);
  /** A camera the user asked for (drag, wheel, pinch, minimap): it is theirs until the round ends (FR-410). */
  const userMoved = (next: Camera): void => {
    if (view === undefined) return;
    watch = movedByUser(watch);
    view.userCamera(next);
    syncAddress(lastRound, next);
    drawMinimap();
  };
  /** FR-410: a round ended; back to the default view unless the user moved the camera, and the next round starts unmoved. */
  const settleCamera = (): void => {
    if (view === undefined || built === undefined) return;
    const back = cameraReturn(watch, { w: built.pkg.width, h: built.pkg.height }, view.viewport());
    watch = roundBegan(watch);
    if (back === undefined) return;
    view.userCamera(back);
    syncAddress(lastRound, back);
    drawMinimap();
  };
  /** FR-359: the picture of the minimap (when `owners` is given) and the rectangle of the current view. */
  let miniOwners: Owners | undefined;
  /** FR-368: the parchment outside the map, placed again with every frame the view draws. */
  let terra: Terra | undefined;
  const drawMinimap = (owners?: Owners): void => {
    if (built === undefined || view === undefined) return;
    const image = { w: built.pkg.width, h: built.pkg.height };
    const rect = viewRect(view.camera(), view.viewport(), image);
    if (owners === undefined || owners === miniOwners) return built.panel.setMinimap(undefined, rect);
    miniOwners = owners;
    const size = minimapSize(image, 220);
    const pixels = minimapPixels(view.index, size, owners, built.colors, { sea: THEME.sea, land: THEME.background });
    built.panel.setMinimap({ pixels, width: size.w, height: size.h }, rect);
  };

  const port: LivePort = {
    async open(match: PublicMatch, files: MapFiles) {
      // The names are measured with the bundled font (FR-437): it is loaded before the first view exists.
      const font = ensureMapFont();
      const decoder = new TextDecoder('utf-8');
      const parsed = await parsePackage(
        { map: decoder.decode(files['map.json']), presentation: decoder.decode(files['presentation.json']), image: files['ids.png'] },
        inflate,
      );
      if (!parsed.ok) return { ok: false, message: packageErrorMessage(parsed.errors) };
      const pkg = parsed.value;
      const errors = checkPackage(pkg.map, pkg.presentation, pkg.width, pkg.height, pkg.values);
      if (errors.length > 0) return { ok: false, message: packageErrorMessage(errors) };
      const map = pkg.map as MapData;
      const presentation = pkg.presentation as PresentationData;
      const problems = checkCapabilities(probeCapabilities(), pkg.width, pkg.height, map.territories.length + 1);
      if (problems.length > 0) return { ok: false, message: capabilityMessage(problems[0]!) };
      await font;
      const colors = assignFactionColors(map, presentation, THEME);
      if (!colors.ok) return { ok: false, message: paletteMessage(colors.errors[0]!, presentation) };
      const image = { w: pkg.width, h: pkg.height };
      const viewport: Viewport = canvasViewport();
      const address = readLiveAddress(window.location.search, match.appliedRounds, image, viewport);
      const names = presentation.factions.map((f) => ({ id: f.id, name: f.name }));
      const origin = pageServerOrigin();
      session = createPlaySession({
        matchId,
        net: createPlayNet({ base: origin, fetch: fetch.bind(globalThis) }),
        player,
        factions: names,
        pageUrl: `${window.location.origin}${window.location.pathname}`,
        makeId: requestId,
        changed: () => runner?.refreshPanel(),
      });
      const panel = createLivePanel(panelContainer, colors.value, {
        play: session.handlers,
        onDock: (folded) => {
          dockFolded = folded;
          view?.setInset(insetNow());
        },
        onNavigate: (action) => runner?.navigate(action),
        onSkip: () => {
          banner = bannerDismiss(banner);
          view?.completeTour(now());
        },
        onReset: () => {
          if (view === undefined) return;
          const next = initialCamera(image, view.viewport());
          view.userCamera(next);
          watch = watchStart;
          syncAddress(lastRound, next);
          drawMinimap();
        },
        onBannerDismiss: () => {
          banner = bannerDismiss(banner);
          runner?.refreshPanel();
        },
        onMinimapPinch: (ratio) => {
          if (view !== undefined) userMoved(pinchCamera(view.camera(), ratio, view.viewport(), image));
        },
        onArchive: () => runner?.requestArchive(),
        onMinimapZoom: (steps) => {
          if (view === undefined) return;
          userMoved(cameraZoomed(view.camera(), steps, view.viewport(), image));
        },
        onMinimap: (point) => {
          if (view === undefined) return;
          userMoved(cameraAtPoint(point, view.camera(), view.viewport(), image));
        },
      });
      panel.showMessages(address.problems.map((problem) => liveProblemMessage(problem, address.round)));
      built = { pkg, map, presentation, colors: colors.value, address, factions: presentation.factions.map((f) => ({ id: f.id, name: f.name })), panel };
      return { ok: true, round: address.round };
    },

    draw(round, owners) {
      lastRound = round;
      if (built === undefined) return;
      if (view === undefined) {
        const { pkg, map, presentation, colors, address } = built;
        const created = createMapView({
          canvas,
          labelCanvas,
          map,
          presentation,
          width: pkg.width,
          height: pkg.height,
          values: pkg.values,
          colors,
          viewport: canvasViewport(),
          start: { round, owners, ...(address.camera === undefined ? {} : { camera: address.camera }) },
          onFrame: () => terra?.place(created.camera(), created.viewport()),
          onResize: () => {
            created.setInset(insetNow());
            syncAddress(lastRound, created.camera());
            drawMinimap();
            terra?.place(created.camera(), created.viewport());
          },
          onTour: (status) => {
            tour = tourReportOf(status);
            built?.panel.showSkip(!status.runEnded);
            // The camera a tour moved is written to the address once, at the end of the run (A7).
            if (status.runEnded) syncAddress(lastRound, created.camera());
            // FR-410: the absorber tour is the end of a round on screen; the victim tour is followed by the absorber window.
            if (status.runEnded && status.tour === 'absorber') settleCamera();
            // The result hook shows the panel on that very frame, not on the next refresh (PD9).
            runner?.refreshPanel();
            drawMinimap();
          },
        });
        view = created;
        terra = createTerra(canvas, { w: pkg.width, h: pkg.height });
        terra.place(created.camera(), created.viewport());
        attachInput(canvas, {
          image: { w: pkg.width, h: pkg.height },
          viewport: created.viewport,
          camera: created.camera,
          setCamera: (next) => userMoved(next),
          pointerMoved: () => undefined,
          onTap: (point) => {
            const live = runner?.model();
            if (live === undefined || live.displayed === undefined) return;
            const at = screenToMap(created.camera(), point, created.viewport());
            session?.tap(factionAt(at, created.index, live.held.get(live.displayed)));
          },
          navigate: (action) => runner?.navigate(action),
          onSkip: () => {
            banner = bannerDismiss(banner);
            created.completeTour(now());
          },
        });
        // A camera shared in the address is the user's own choice (FR-410).
        if (address.camera !== undefined) watch = movedByUser(watch);
        created.paint(now());
        syncAddress(round, created.camera());
        return;
      }
      // An instant change of the displayed round (a jump, or a state read from the server): no step data.
      const started = now();
      view.completeTour(started);
      const outcome = view.request(round, started);
      if (outcome.change === 'none') return;
      view.commit(outcome, view.prepare(owners, undefined, true), started);
      syncAddress(round, view.camera());
    },

    playStep(from, to, data, absorber, at) {
      lastRound = to;
      if (view === undefined) return;
      const forward = to > from;
      if (absorber !== undefined && forward) {
        // The absorber tour first, from the reading of the feed (D11); the step follows it (FR-345).
        const request = pacedFor(absorberRequestOf(absorber, view.owners), player !== undefined);
        const planned = view.request(to, at);
        if (request !== undefined && planned.change === 'step' && view.beginTour([request], at, { target: to, owners: data.later, data })) {
          syncAddress(to, view.camera());
          return;
        }
      }
      const started = now();
      view.completeTour(started);
      const outcome = view.request(to, started);
      if (outcome.change === 'none') return;
      view.commit(outcome, view.prepare(forward ? data.later : data.earlier, outcome.change === 'step' ? data : undefined, forward), started);
      syncAddress(to, view.camera());
      if (forward && outcome.change === 'step') settleCamera();
    },

    startVictimTour(effect, at) {
      if (view === undefined || runner === undefined) return;
      const request = pacedFor(victimRequestOf(effect, runner.model(), view.owners), player !== undefined);
      if (request !== undefined) view.beginTour([request], at);
    },

    completeTour(at) {
      view?.completeTour(at);
    },

    show(model, at) {
      if (built === undefined) return;
      const shown = liveTourPanel(model, tour, import.meta.env.DEV);
      const panelData = panelView(model, at, built.factions, shown);
      const state = hudState(model);
      // The facts follow the drawn round: while the absorber tour runs, the round before it (the legend rule, D12).
      const upTo = model.displayed === undefined ? 0 : shown.absorbing ? model.displayed - 1 : model.displayed;
      banner = bannerNext(banner, { displayed: model.displayed, applied: model.applied, absorbing: shown.absorbing, revealing: shown.revealing }, at);
      const bannerNow = bannerView(banner, model, built.factions, at, motion.reduced());
      const left = bannerExpiresIn(banner, at);
      const timerKey = `${banner.round}:${banner.since}`;
      if (bannerNow !== undefined && left !== undefined && bannerTimer !== timerKey) {
        bannerTimer = timerKey;
        after(left + 20, () => runner?.refreshPanel());
      }
      const play = session === undefined ? undefined : session.view(model, at, { revealing: shown.revealing, absorbing: shown.absorbing, finalised: model.beat !== undefined });
      const picked = pickedOf(play?.predict?.choices);
      if (view !== undefined && picked !== pickedNow) {
        pickedNow = picked;
        view.setPick(picked === undefined ? undefined : view.owners.get(picked));
      }
      const overlay = overlayOf(model, shown.revealing);
      built.panel.update(panelData, {
        bar: topBar(model, panelData, at),
        state,
        card: stateCard(state, model, at, built.factions),
        live: liveMark(model),
        band: replayBand(model),
        track: roundTrack(model.totalRounds, model.displayed ?? 0, model.applied, inPlayStage(model.stage)),
        hold: shown.revealing || shown.absorbing || overlay !== undefined,
        rows: factionRows(model, built.factions, upTo),
        chronicle: chronicle(model, built.factions, upTo, { revealing: shown.revealing, absorbing: shown.absorbing }),
        ...(bannerNow === undefined ? {} : { banner: bannerNow }),
        ...(overlay === undefined ? {} : { overlay }),
        ...(play === undefined ? {} : { play }),
      });
      drawMinimap(model.held.get(upTo));
    },

    fail(message) {
      showMessage(message);
    },
  };

  runner = startRunner({
    matchId,
    net: createLiveNet({ base: pageServerOrigin(), fetch: fetch.bind(globalThis) }),
    port,
    now,
    after,
    onFrame: (data) => session?.onFrame(data),
  });
}
