// Address parameters (FR-150, FR-151, FR-153). Pure: total rounds, image and viewport are parameters.
import { clampCamera, type Camera, type ImageSize, type Viewport } from './camera';
import { STRINGS, fillTemplate } from './strings';
import { nominalEnd } from './tour';

export type AddressParam = 'seed' | 'round' | 'x' | 'y' | 'zoom' | 'transition' | 'reveal';
export type AddressReason = 'invalid' | 'out-of-range' | 'repeated';
export interface AddressProblem {
  param: AddressParam;
  /** The text as written (values joined by a comma when repeated). */
  text: string;
  reason: AddressReason;
}
export interface AddressResult {
  seed: number;
  round: number;
  /** Present only when x, y and zoom are all present and valid (already clamped); else use the initial view. */
  camera: Camera | undefined;
  problems: AddressProblem[];
  /**
   * The frozen forward progress of FR-191, present only when `transition` is valid and the displayed round is
   * at least 1. `text` is the value as written, so the address can repeat it exactly (FR-193).
   */
  transition?: { value: number; text: string };
  /**
   * The debug `reveal` parameter (FR-351), present only when it is valid, no `transition` freezes the step and (for a
   * frozen value) the displayed round is at least 1. `text` is the value as written. The range checks that need the
   * scene (t within the tour, d >= 2) are `checkReveal`.
   */
  reveal?: RevealParam;
}

/** `on`: every forward step plays the tours; `victim:<t>` / `absorber:<t>`: that tour frozen at t ms (FR-351). */
export type RevealParam =
  | { readonly mode: 'on'; readonly text: string }
  | { readonly mode: 'victim' | 'absorber'; readonly t: number; readonly text: string };

const MAX_SEED = 4294967295;
const DIGITS = /^[0-9]+$/;
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

type Read = { present: false } | { present: true; text: string; repeated: boolean };

function read(params: URLSearchParams, name: AddressParam): Read {
  const values = params.getAll(name);
  if (values.length === 0) return { present: false };
  return { present: true, text: values.join(','), repeated: values.length > 1 };
}

/** Reads an integer parameter in [0, max]: a value, a problem, or undefined when absent. */
function readInteger(r: Read, param: AddressParam, max: number): number | AddressProblem | undefined {
  if (!r.present) return undefined;
  if (r.repeated) return { param, text: r.text, reason: 'repeated' };
  if (!DIGITS.test(r.text)) return { param, text: r.text, reason: 'invalid' };
  const value = Number(r.text);
  return value > max ? { param, text: r.text, reason: 'out-of-range' } : value;
}

/** Reads a camera number: a finite value, a problem, or undefined when absent. */
function readDecimal(r: Read, param: AddressParam): number | AddressProblem | undefined {
  if (!r.present) return undefined;
  if (r.repeated) return { param, text: r.text, reason: 'repeated' };
  const value = Number(r.text);
  if (!DECIMAL.test(r.text) || !Number.isFinite(value)) return { param, text: r.text, reason: 'invalid' };
  return value;
}

const isProblem = (v: number | AddressProblem | undefined): v is AddressProblem => typeof v === 'object';

const REVEAL_FROZEN = /^(victim|absorber):(0|[1-9][0-9]*)$/;
/** The most digits of a frozen time that is read as a number (a longer one is out of range for any tour). */
const REVEAL_DIGITS = 9;

/** Reads `reveal`: `on`, `victim:<t>` or `absorber:<t>` (t whole, no sign, no leading zero besides 0), a problem, or undefined when absent. */
function readReveal(r: Read): RevealParam | AddressProblem | undefined {
  if (!r.present) return undefined;
  if (r.repeated) return { param: 'reveal', text: r.text, reason: 'repeated' };
  if (r.text === 'on') return { mode: 'on', text: r.text };
  const m = REVEAL_FROZEN.exec(r.text);
  if (m === null) return { param: 'reveal', text: r.text, reason: 'invalid' };
  if ((m[2] as string).length > REVEAL_DIGITS) return { param: 'reveal', text: r.text, reason: 'out-of-range' };
  return { mode: m[1] as 'victim' | 'absorber', t: Number(m[2]), text: r.text };
}

/**
 * Parses the query string of the page address for a match of `total` rounds.
 * Any seed or round problem displays round 0 (seed 1, which round 0 does not depend on) with no clamping.
 * The camera is used only when x, y and zoom are all present and valid; then it is clamped.
 */
export function parseAddress(search: string, total: number, image: ImageSize, vp: Viewport): AddressResult {
  const params = new URLSearchParams(search);
  const problems: AddressProblem[] = [];

  const seed = readInteger(read(params, 'seed'), 'seed', MAX_SEED);
  const round = readInteger(read(params, 'round'), 'round', total);
  if (isProblem(seed)) problems.push(seed);
  if (isProblem(round)) problems.push(round);

  const x = readDecimal(read(params, 'x'), 'x');
  const y = readDecimal(read(params, 'y'), 'y');
  const zoom = readDecimal(read(params, 'zoom'), 'zoom');
  for (const v of [x, y, zoom]) if (isProblem(v)) problems.push(v);
  const camera =
    typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number'
      ? clampCamera({ x, y, scale: zoom }, image, vp)
      : undefined;

  const seedFailed = isProblem(seed);
  const roundFailed = isProblem(round);
  const shown = seedFailed || roundFailed || round === undefined ? 0 : round;

  // `transition` (FR-191, FR-192): a number from 0 to 1, and a displayed round with a previous round.
  // It never touches the camera or the round.
  const raw = read(params, 'transition');
  const progress = readDecimal(raw, 'transition');
  let transition: { value: number; text: string } | undefined;
  if (isProblem(progress)) problems.push(progress);
  else if (progress !== undefined && raw.present) {
    if (progress > 1 || shown < 1) problems.push({ param: 'transition', text: raw.text, reason: 'out-of-range' });
    else transition = { value: progress, text: raw.text };
  }

  // `reveal` (FR-351, FR-352): a frozen step (`transition`) wins over it, and a frozen tour needs a displayed round >= 1.
  const reveal = readReveal(read(params, 'reveal'));
  let revealed: RevealParam | undefined;
  if (reveal !== undefined && 'param' in reveal) problems.push(reveal);
  else if (reveal !== undefined) {
    if (transition !== undefined) problems.push({ param: 'reveal', text: reveal.text, reason: 'invalid' });
    else if (reveal.mode !== 'on' && shown < 1) problems.push({ param: 'reveal', text: reveal.text, reason: 'out-of-range' });
    else revealed = reveal;
  }

  const result: AddressResult = {
    seed: seedFailed || seed === undefined ? 1 : seed,
    round: shown,
    camera,
    problems,
  };
  if (transition !== undefined) result.transition = transition;
  if (revealed !== undefined) result.reveal = revealed;
  return result;
}

/** What the range checks of `reveal` need of the scene: the participants and the candidates of the round (FR-352). */
export interface RevealRange {
  readonly living: readonly number[];
  readonly candidates: readonly number[];
}

/**
 * FR-352: the checks of a frozen `reveal` that need the scene. t must not exceed the duration D of its tour at nominal speed
 * (5,349 ms for 3 or more participants, 3,487 ms for 2, 2,411 ms for the absorber tour) and `absorber:` needs d >= 2.
 * `on` needs none. Returns the problem to show, or undefined.
 */
export function checkReveal(reveal: RevealParam, range: RevealRange): AddressProblem | undefined {
  if (reveal.mode === 'on') return undefined;
  const refused: AddressProblem = { param: 'reveal', text: reveal.text, reason: 'out-of-range' };
  const size = reveal.mode === 'victim' ? range.living.length : range.candidates.length;
  if (size < 2) return refused;
  return reveal.t > nominalEnd(reveal.mode, size) ? refused : undefined;
}

/** The value of `reveal` as written in the address (FR-351), or undefined when there is none. */
export const revealText = (reveal: RevealParam | undefined): string | undefined => reveal?.text;

/** A round change leaves a frozen tour and drops its value; `on` stays (D15, as 005 FR-194 does for `transition`). */
export const revealAfterRoundChange = (reveal: RevealParam | undefined): RevealParam | undefined =>
  reveal?.mode === 'on' ? reveal : undefined;

/**
 * The address text of a displayed scene: x and y with 1 decimal, zoom with 3 (FR-153). While a frozen
 * progress is shown, `transitionText` is appended exactly as it was written (FR-193); a round change passes none (FR-194).
 * A valid `reveal` value is appended exactly as written (FR-351); an invalid one is never passed, so it leaves the address.
 */
export function formatAddress(seed: number, round: number, cam: Camera, transitionText?: string, revealValue?: string): string {
  const base = `?seed=${seed}&round=${round}&x=${cam.x.toFixed(1)}&y=${cam.y.toFixed(1)}&zoom=${cam.scale.toFixed(3)}`;
  const frozen = transitionText === undefined ? base : `${base}&transition=${transitionText}`;
  return revealValue === undefined ? frozen : `${frozen}&reveal=${revealValue}`;
}

/** The Spanish message of a problem, naming the parameter and its text (FR-151). */
export function problemMessage(p: AddressProblem): string {
  const values = { param: p.param, text: p.text };
  if (p.param === 'transition') return fillTemplate(STRINGS.transitionInvalid, values);
  if (p.param === 'reveal') return fillTemplate(STRINGS.revealInvalid, values);
  if (p.param !== 'seed' && p.param !== 'round') return fillTemplate(STRINGS.cameraInvalid, values);
  if (p.reason === 'out-of-range') return fillTemplate(STRINGS.paramOutOfRange, values);
  if (p.reason === 'repeated') return fillTemplate(STRINGS.paramRepeated, values);
  return fillTemplate(STRINGS.paramInvalid, values);
}
