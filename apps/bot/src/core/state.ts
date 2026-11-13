// What the bot keeps between runs (spec 012 FR-459, FR-460, OQ2): per channel the followed match, its host token, the last event
// number it announced and the little it needs to announce the next events alone. Plain JSON, pure functions only.
// A host token is stored only for a followed match (NFR-89): `unfollow` drops the whole entry.

export interface Followed {
  readonly matchId: string;
  readonly mapId: string;
  readonly hostToken: string;
  /** The number of the last event announced (or skipped on purpose): the stream resumes after it. */
  readonly lastSeq: number;
  /** Applied rounds as the announced events told them (the round open now is this plus one). */
  readonly appliedRounds: number;
  /** The round whose absorber was forced, 0 when none (its phase 2 is never scored). */
  readonly forcedRound: number;
}

export interface BotState {
  readonly version: 1;
  readonly channels: Readonly<Record<string, Followed>>;
}

export const emptyState = (): BotState => ({ version: 1, channels: {} });

const CHANNEL_ID = /^[0-9]{1,25}$/;
const MATCH_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAP_ID = /^[a-z0-9-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{22,256}$/;
const FOLLOWED_KEYS = ['matchId', 'mapId', 'hostToken', 'lastSeq', 'appliedRounds', 'forcedRound'] as const;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

export const isChannelId = (text: string): boolean => CHANNEL_ID.test(text);

function readFollowed(v: unknown): Followed | undefined {
  if (!isObject(v)) return undefined;
  const keys = Object.keys(v);
  if (keys.length !== FOLLOWED_KEYS.length || !FOLLOWED_KEYS.every((k) => hasOwn(v, k))) return undefined;
  const { matchId, mapId, hostToken, lastSeq, appliedRounds, forcedRound } = v;
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId) || typeof mapId !== 'string' || !MAP_ID.test(mapId)) return undefined;
  if (typeof hostToken !== 'string' || !TOKEN.test(hostToken)) return undefined;
  if (!isCount(lastSeq, 0) || !isCount(appliedRounds, 0) || !isCount(forcedRound, 0)) return undefined;
  return { matchId, mapId, hostToken, lastSeq, appliedRounds, forcedRound };
}

/** The state from its JSON text, or undefined when the text is not exactly a state (it is never partly read). */
export function parseState(text: string): BotState | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(json) || Object.keys(json).length !== 2 || !hasOwn(json, 'version') || !hasOwn(json, 'channels') || json.version !== 1) return undefined;
  const raw = json.channels;
  if (!isObject(raw)) return undefined;
  const channels: Record<string, Followed> = {};
  for (const id of Object.keys(raw)) {
    const entry = readFollowed(raw[id]);
    if (!CHANNEL_ID.test(id) || entry === undefined) return undefined;
    channels[id] = entry;
  }
  return { version: 1, channels };
}

export function serializeState(state: BotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export const followedOf = (state: BotState, channelId: string): Followed | undefined => (hasOwn(state.channels, channelId) ? state.channels[channelId] : undefined);

export const follow = (state: BotState, channelId: string, entry: Followed): BotState => ({ version: 1, channels: { ...state.channels, [channelId]: entry } });

export function unfollow(state: BotState, channelId: string): BotState {
  const { [channelId]: _gone, ...rest } = state.channels;
  return { version: 1, channels: rest };
}
