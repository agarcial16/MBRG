// The live scene (FR-303 to FR-308, FR-156 shell): it loads nothing itself. The runner reads the public data, verifies the map
// files and then asks this port to build the scene from them; the port draws the rounds it is told and keeps the address equal
// to the displayed round and camera (D31). Any failure shows one Spanish message and draws no map.
import type { PublicMatch } from '@mbrg/protocol';
import type { MapData, PresentationData, Rgb } from '@mbrg/shared';
import { initialCamera } from '../core/camera';
import type { Camera, Viewport } from '../core/camera';
import { capabilityMessage, checkCapabilities } from '../core/capabilities';
import { assignFactionColors, paletteMessage } from '../core/colors';
import { liveProblemMessage, readLiveAddress } from '../core/live-address';
import type { LiveAddress } from '../core/live-address';
import { liveTitle } from '../core/live-text';
import { absorberRequestOf, liveTourPanel, panelView, tourReportOf, victimRequestOf } from '../core/live-view';
import { hudState, stateCard, topBar } from '../core/live-hud';
import { chronicle, factionRows } from '../core/live-stats';
import { liveMark, replayBand, roundTrack } from '../core/live-track';
import { cameraAtPoint, minimapPixels, minimapSize, viewRect } from '../core/minimap';
import type { Owners } from '../core/live-rounds';
import { STRINGS } from '../core/strings';
import type { FactionName, TourReport } from '../core/live-view';
import { checkPackage, packageErrorMessage, parsePackage } from '../core/package';
import type { PackageData } from '../core/package';
import { THEME } from '../core/theme';
import { probeCapabilities } from '../render/renderer';
import { now } from './clock';
import { attachInput } from './input';
import { pageServerOrigin } from './live-config';
import { createLiveNet } from './live-net';
import type { MapFiles } from './live-net';
import { createLivePanel, showCard } from './live-panel';
import type { LivePanel } from './live-panel';
import { startRunner } from './live-runner';
import type { LivePort, LiveRunner } from './live-runner';
import { after } from './live-timer';
import { syncLiveAddress } from './live-url';
import { createMapView } from './map-view';
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

/** Starts the live scene for a match id: the runner does the rest. */
export function startLiveScene(matchId: string): void {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const labelCanvas = document.getElementById('labels') as HTMLCanvasElement;
  const panelContainer = document.getElementById('panel') as HTMLElement;
  document.title = liveTitle();
  // Until the map files are verified there is nothing to draw: the screen says what it is doing (FR-365).
  showCard(panelContainer, { title: STRINGS.hudLoadingTitle, text: STRINGS.hudLoadingText }, true);

  let built: Built | undefined;
  let view: MapView | undefined;
  let runner: LiveRunner | undefined;
  let lastRound = 0;
  // The tour on screen, as the map view reported it (FR-330): the panel hides the victim and keeps the old legend by it.
  let tour: TourReport | undefined;

  const syncAddress = (round: number, camera: Camera): void => syncLiveAddress(matchId, round, camera);

  /** FR-359: the picture of the minimap (when `owners` is given) and the rectangle of the current view. */
  let miniOwners: Owners | undefined;
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
      const colors = assignFactionColors(map, presentation, THEME);
      if (!colors.ok) return { ok: false, message: paletteMessage(colors.errors[0]!, presentation) };
      const image = { w: pkg.width, h: pkg.height };
      const viewport: Viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      const address = readLiveAddress(window.location.search, match.appliedRounds, image, viewport);
      const panel = createLivePanel(panelContainer, colors.value, {
        onNavigate: (action) => runner?.navigate(action),
        onSkip: () => view?.completeTour(now()),
        onReset: () => {
          if (view === undefined) return;
          const next = initialCamera(image, view.viewport());
          view.userCamera(next);
          syncAddress(lastRound, next);
          drawMinimap();
        },
        onArchive: () => runner?.requestArchive(),
        onMinimap: (point) => {
          if (view === undefined) return;
          const next = cameraAtPoint(point, view.camera(), view.viewport(), image);
          view.userCamera(next);
          syncAddress(lastRound, next);
          drawMinimap();
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
          viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
          start: { round, owners, ...(address.camera === undefined ? {} : { camera: address.camera }) },
          onResize: () => {
            syncAddress(lastRound, created.camera());
            drawMinimap();
          },
          onTour: (status) => {
            tour = tourReportOf(status);
            built?.panel.showSkip(!status.runEnded);
            // The camera a tour moved is written to the address once, at the end of the run (A7).
            if (status.runEnded) syncAddress(lastRound, created.camera());
            // The result hook shows the panel on that very frame, not on the next refresh (PD9).
            runner?.refreshPanel();
            drawMinimap();
          },
        });
        view = created;
        attachInput(canvas, {
          image: { w: pkg.width, h: pkg.height },
          viewport: created.viewport,
          camera: created.camera,
          setCamera: (next) => {
            created.userCamera(next);
            syncAddress(lastRound, next);
            drawMinimap();
          },
          pointerMoved: () => undefined,
          navigate: (action) => runner?.navigate(action),
          onSkip: () => created.completeTour(now()),
        });
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
        const request = absorberRequestOf(absorber, view.owners);
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
    },

    startVictimTour(effect, at) {
      if (view === undefined || runner === undefined) return;
      const request = victimRequestOf(effect, runner.model(), view.owners);
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
      built.panel.update(panelData, {
        bar: topBar(model, panelData, at),
        state,
        card: stateCard(state, model, at, built.factions),
        live: liveMark(model),
        band: replayBand(model),
        track: roundTrack(model.totalRounds, model.displayed ?? 0, model.applied),
        rows: factionRows(model, built.factions, upTo),
        chronicle: chronicle(model, built.factions, upTo, { revealing: shown.revealing, absorbing: shown.absorbing }),
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
  });
}
