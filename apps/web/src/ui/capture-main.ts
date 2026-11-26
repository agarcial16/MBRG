// The capture scene (spec 038 FR-713 to FR-716, NFR-187): the viewer drawn once for the bot's screenshot, with no interface, a fixed
// camera given by the address, no animation and no stream. It reads through `loadCapture` (which refuses a round that is not applied),
// draws the state after round k and then tells the page's state to the capturing browser: `data-capture` on the document element is
// "ready" once the frame is complete (map, labels, marks) or "error" when the match or the round cannot be shown.
import type { MapData, PresentationData } from '@mbrg/shared';
import { annexationBox, captureCamera, captureMarks } from '../core/capture';
import type { CaptureRequest } from '../core/capture';
import { checkCapabilities, checkCounts } from '../core/capabilities';
import type { Camera } from '../core/camera';
import { assignFactionColors } from '../core/colors';
import { factionIndexOf } from '../core/entries';
import type { EntryIndex } from '../core/entries';
import { ownersOf } from '../core/live-rounds';
import { checkPackage, parsePackage } from '../core/package';
import { THEME } from '../core/theme';
import { probeCapabilities } from '../render/renderer';
import { loadCapture } from './capture-load';
import { pageServerOrigin } from './live-config';
import { createLiveNet } from './live-net';
import { createFrameLoop } from './frame-loop';
import { ensureMapFont } from './map-font';
import { createMapView } from './map-view';

/** Inflates a zlib stream with the platform decompressor. */
async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Two frames of the frame loop: whatever was drawn is on screen when the signal is raised. */
const painted = (): Promise<void> =>
  new Promise((resolve) => {
    let left = 2;
    const loop = createFrameLoop(() => {
      left -= 1;
      if (left > 0) return true;
      resolve();
      return false;
    });
    loop.request();
  });

async function draw(request: CaptureRequest): Promise<boolean> {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const labelCanvas = document.getElementById('labels') as HTMLCanvasElement;
  const data = await loadCapture(createLiveNet({ base: pageServerOrigin(), fetch: fetch.bind(globalThis) }), request);
  if (!data.ok) return false;
  const decoder = new TextDecoder('utf-8');
  const font = ensureMapFont();
  const parsed = await parsePackage({ map: decoder.decode(data.files['map.json']), presentation: decoder.decode(data.files['presentation.json']), image: data.files['ids.png'] }, inflate);
  if (!parsed.ok) return false;
  const pkg = parsed.value;
  if (checkPackage(pkg.map, pkg.presentation, pkg.width, pkg.height, pkg.values).length > 0) return false;
  const map = pkg.map as MapData;
  const presentation = pkg.presentation as PresentationData;
  if (checkCounts(map).length > 0) return false;
  if (checkCapabilities(probeCapabilities(), pkg.width, pkg.height, map.territories.length + 1, presentation.factions.length + 1).length > 0) return false;
  await font;
  const colors = assignFactionColors(map, presentation, THEME);
  if (!colors.ok) return false;
  const owners = ownersOf(data.state.owners);
  const absorber = data.record === undefined ? undefined : factionIndexOf(map).get(data.record.absorber);
  const marks = captureMarks(request.round, absorber);
  const area = { width: canvas.clientWidth, height: canvas.clientHeight };
  // The annexation frame holds every territory the absorber owns after round k, the victim's former ones included (FR-716).
  const cameraFor = (index: EntryIndex): Camera => {
    let box;
    if (request.frame === 'round' && data.record !== undefined) {
      const wanted = new Set<number>();
      for (const [territory, faction] of owners) {
        const entry = index.indexOf.get(territory);
        if (faction === data.record.absorber && entry !== undefined) wanted.add(entry);
      }
      box = annexationBox(index.cells, pkg.width, pkg.height, wanted);
    }
    return captureCamera(request.frame, box, { w: pkg.width, h: pkg.height }, area);
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
    viewport: area,
    start: { round: request.round, owners, cameraFor, ...(marks === undefined ? {} : { marks }) },
  });
  view.paint(0);
  await painted();
  return true;
}

/** Starts capture mode; `request` is absent when the address was not a valid capture address. */
export function startCapture(request: CaptureRequest | undefined): void {
  const raise = (state: 'ready' | 'error'): void => {
    document.documentElement.dataset.capture = state;
  };
  if (request === undefined) return raise('error');
  draw(request).then(
    (done) => raise(done ? 'ready' : 'error'),
    () => raise('error'),
  );
}
