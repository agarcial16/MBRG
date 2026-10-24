// The page address of the live viewer (FR-306, D31). Pure: the build kind, the applied round N, the image and the
// viewport are parameters. The live scene never reads, shows or writes anything that chooses a match's rounds.
import { clampCamera, type Camera, type ImageSize, type Viewport } from './camera';
import { STRINGS, fillTemplate } from './strings';

/** The reason the page shows one Spanish message and no scene (FR-306 (a), (c), (d); a malformed match id). */
export type SceneMessage = 'both' | 'need-match' | 'bad-match';

/** What the page address chooses (FR-306). */
export type SceneChoice =
  | { kind: 'debug' }
  | { kind: 'live'; matchId: string }
  | { kind: 'message'; error: SceneMessage };

/** A match id is 16 base64url characters (FR-236): anything else is refused before any request. */
const MATCH_ID = /^[A-Za-z0-9_-]{16}$/;

/**
 * Decides the scene from the query string. `dev` is true in development builds only (FR-306):
 * both parameters give an error in every build; a match id gives the live match, unless it is malformed or repeated
 * (a message, and no request is sent); otherwise the debug scene in development and a message in production.
 */
export function chooseScene(search: string, dev: boolean): SceneChoice {
  const params = new URLSearchParams(search);
  const matches = params.getAll('match');
  if (params.has('seed') && matches.length > 0) return { kind: 'message', error: 'both' };
  if (matches.length > 0) {
    const id = matches[0];
    return matches.length === 1 && id !== undefined && MATCH_ID.test(id)
      ? { kind: 'live', matchId: id }
      : { kind: 'message', error: 'bad-match' };
  }
  return dev ? { kind: 'debug' } : { kind: 'message', error: 'need-match' };
}

export type LiveParam = 'round' | 'x' | 'y' | 'zoom';
export interface LiveProblem {
  param: LiveParam;
  /** The text as written (values joined by a comma when repeated). */
  text: string;
  reason: 'invalid' | 'out-of-range' | 'repeated';
}
export interface LiveAddress {
  /** The round to show: the one written when it is a whole number at most N, else N. Never above N (D31). */
  round: number;
  /** Present only when x, y and zoom are all present and valid (already clamped); else use the initial view. */
  camera: Camera | undefined;
  problems: LiveProblem[];
}

const DIGITS = /^[0-9]+$/;
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

/** The values of one parameter: undefined when absent. */
function values(params: URLSearchParams, name: LiveParam): { text: string; repeated: boolean } | undefined {
  const all = params.getAll(name);
  return all.length === 0 ? undefined : { text: all.join(','), repeated: all.length > 1 };
}

function readDecimal(params: URLSearchParams, param: LiveParam, problems: LiveProblem[]): number | undefined {
  const v = values(params, param);
  if (v === undefined) return undefined;
  const value = Number(v.text);
  if (v.repeated || !DECIMAL.test(v.text) || !Number.isFinite(value)) {
    problems.push({ param, text: v.text, reason: v.repeated ? 'repeated' : 'invalid' });
    return undefined;
  }
  return value;
}

/**
 * Reads the round and the camera of a live address for a match with `applied` rounds (D31). A round above N shows N with a
 * problem; a round that is not a whole number, or is repeated, shows N with a problem; no round shows N. The camera is used
 * only when x, y and zoom are all present and valid, then clamped as in 004.
 */
export function readLiveAddress(search: string, applied: number, image: ImageSize, vp: Viewport): LiveAddress {
  const params = new URLSearchParams(search);
  const problems: LiveProblem[] = [];
  let round = applied;
  const written = values(params, 'round');
  if (written !== undefined) {
    if (written.repeated) problems.push({ param: 'round', text: written.text, reason: 'repeated' });
    else if (!DIGITS.test(written.text)) problems.push({ param: 'round', text: written.text, reason: 'invalid' });
    else if (Number(written.text) > applied) problems.push({ param: 'round', text: written.text, reason: 'out-of-range' });
    else round = Number(written.text);
  }
  const x = readDecimal(params, 'x', problems);
  const y = readDecimal(params, 'y', problems);
  const zoom = readDecimal(params, 'zoom', problems);
  const camera =
    x !== undefined && y !== undefined && zoom !== undefined ? clampCamera({ x, y, scale: zoom }, image, vp) : undefined;
  return { round, camera, problems };
}

/** The address text of a displayed live scene: the match id, the round and the camera (x, y with 1 decimal, zoom with 3). */
export function formatLiveAddress(matchId: string, round: number, cam: Camera): string {
  return `?match=${matchId}&round=${round}&x=${cam.x.toFixed(1)}&y=${cam.y.toFixed(1)}&zoom=${cam.scale.toFixed(3)}`;
}

/** The Spanish notice of a problem; `shown` is the round displayed instead (N). */
export function liveProblemMessage(p: LiveProblem, shown: number): string {
  const values = { param: p.param, text: p.text, round: shown };
  if (p.param !== 'round') return fillTemplate(STRINGS.cameraInvalid, values);
  return fillTemplate(p.reason === 'out-of-range' ? STRINGS.liveRoundAboveN : STRINGS.liveRoundInvalid, values);
}
