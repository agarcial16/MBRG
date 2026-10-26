// The debug scene's side of the reveal tours (spec 009 FR-351, A2, D12): the tour requests of a round from the sim's inputs, what
// the panel hides while a tour runs, and the digest line of the frame on screen. Pure; the shell (`ui/main.ts`) only routes.
import type { FactionId } from '@mbrg/shared';
import { frameDigest } from './tour-digest';
import type { TourFrame } from './tour-frame';
import { fnv1a32, keyText } from './tour-key';
import type { TourKind } from './tour-key';
import type { RevealInputs, Scene } from './scene';
import { fillTemplate, STRINGS } from './strings';
import type { TourRequest, TourStatus } from './tour-session';

const VICTIM_TOUR: TourKind = 'victim';
const ABSORBER_TOUR: TourKind = 'absorber';

/**
 * The victim tour of round N and, when the victim has two or more absorption candidates, its absorber tour (FR-351, FR-350: none at
 * d = 1). Sigma comes from the debug keys `debug:<N>` and `debug:<N>:absorber`, never from the seed.
 */
export function revealRequests(
  inputs: RevealInputs,
  factionIndex: ReadonlyMap<FactionId, number>,
): { readonly victim: TourRequest; readonly absorber: TourRequest | undefined } {
  const idx = (f: FactionId): number => {
    const i = factionIndex.get(f);
    if (i === undefined) throw new RangeError(`faction ${f} has no index`);
    return i;
  };
  const victim: TourRequest = {
    kind: VICTIM_TOUR,
    result: idx(inputs.victim),
    set: inputs.living.map(idx),
    sigma: fnv1a32(keyText('debug', inputs.round, VICTIM_TOUR)),
  };
  const absorber: TourRequest | undefined =
    inputs.candidates.length >= 2
      ? {
          kind: ABSORBER_TOUR,
          result: idx(inputs.absorber),
          victim: idx(inputs.victim),
          set: inputs.candidates.map(idx),
          sigma: fnv1a32(keyText('debug', inputs.round, ABSORBER_TOUR)),
        }
      : undefined;
  return { victim, absorber };
}

/**
 * What the debug panel hides (A2): `revealing` until the victim's stop (the record line says so), `absorbing` from then until the
 * whole run ends (the absorber stays hidden, and the legend, the living count and the pointer follow the drawn state N - 1). A still
 * tour shows the victim at once. A frozen tour never ends, so it never leaves `absorbing`.
 */
export function debugTourState(status: TourStatus | undefined): { readonly revealing: boolean; readonly absorbing: boolean } {
  if (status === undefined || status.runEnded) return { revealing: false, absorbing: false };
  if (status.tour === 'absorber') return { revealing: false, absorbing: true };
  const hidden = !status.still && !status.resultShown;
  return { revealing: hidden, absorbing: !hidden };
}

/** The scene the map is drawing: the previous one (N - 1) while a tour hides anything, else the displayed scene (N). */
export function drawnScene(scene: Scene, previous: Scene | undefined, state: { readonly revealing: boolean; readonly absorbing: boolean }): Scene {
  return (state.revealing || state.absorbing) && previous !== undefined ? previous : scene;
}

/** The panel line with the digest of the tour frame actually drawn, or undefined when the last drawing was not a tour frame. */
export function digestLine(frame: TourFrame | undefined): string | undefined {
  return frame === undefined ? undefined : fillTemplate(STRINGS.tourDigest, { value: frameDigest(frame) });
}
