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
  /** The Discord id of the member who created the match: the only one who may start it (FR-464). Absent in an older file. */
  readonly creatorId?: string;
}

/** A match the channel no longer follows (finished, halted or stopped): only what `/ff board` needs; no host token (FR-466). */
export interface LastMatch {
  readonly matchId: string;
  readonly mapId: string;
}

export interface BotState {
  readonly version: 1;
  readonly channels: Readonly<Record<string, Followed>>;
  /** The last match of a channel; absent when no channel has one (an older file has none). */
  readonly last?: Readonly<Record<string, LastMatch>>;
}

export const emptyState = (): BotState => ({ version: 1, channels: {} });

const build = (channels: Readonly<Record<string, Followed>>, last: Readonly<Record<string, LastMatch>> | undefined): BotState =>
  last === undefined || Object.keys(last).length === 0 ? { version: 1, channels } : { version: 1, channels, last };

const CHANNEL_ID = /^[0-9]{1,25}$/;
const MATCH_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAP_ID = /^[a-z0-9-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{22,256}$/;
const FOLLOWED_KEYS = ['matchId', 'mapId', 'hostToken', 'lastSeq', 'appliedRounds', 'forcedRound'] as const;
const OPTIONAL_KEYS = ['creatorId', 'phases'] as const;
const USER_ID = /^[0-9]{1,25}$/;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

export const isChannelId = (text: string): boolean => CHANNEL_ID.test(text);

function readFollowed(v: unknown): Followed | undefined {
  if (!isObject(v)) return undefined;
  const keys = Object.keys(v);
  if (!FOLLOWED_KEYS.every((k) => hasOwn(v, k))) return undefined;
  if (keys.some((k) => !(FOLLOWED_KEYS as readonly string[]).includes(k) && !(OPTIONAL_KEYS as readonly string[]).includes(k))) return undefined;
  const { matchId, mapId, hostToken, lastSeq, appliedRounds, forcedRound } = v;
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId) || typeof mapId !== 'string' || !MAP_ID.test(mapId)) return undefined;
  if (typeof hostToken !== 'string' || !TOKEN.test(hostToken)) return undefined;
  if (!isCount(lastSeq, 0) || !isCount(appliedRounds, 0) || !isCount(forcedRound, 0)) return undefined;
  const entry: Followed = { matchId, mapId, hostToken, lastSeq, appliedRounds, forcedRound };
  // `phases` (the pace's phase lengths) was kept by an earlier version: a valid one is read and dropped, the countdown now uses the server's schedule.
  if (hasOwn(v, 'phases')) {
    const p = v.phases;
    if (!isObject(p) || Object.keys(p).length !== 2 || !isCount(p.l1, 1) || !isCount(p.l2, 1)) return undefined;
  }
  if (hasOwn(v, 'creatorId')) {
    if (typeof v.creatorId !== 'string' || !USER_ID.test(v.creatorId)) return undefined;
    return { ...entry, creatorId: v.creatorId };
  }
  return entry;
}

function readLast(v: unknown): LastMatch | undefined {
  if (!isObject(v) || Object.keys(v).length !== 2 || !hasOwn(v, 'matchId') || !hasOwn(v, 'mapId')) return undefined;
  const { matchId, mapId } = v;
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId) || typeof mapId !== 'string' || !MAP_ID.test(mapId)) return undefined;
  return { matchId, mapId };
}

/** The state from its JSON text, or undefined when the text is not exactly a state (it is never partly read). */
export function parseState(text: string): BotState | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(json) || !hasOwn(json, 'version') || !hasOwn(json, 'channels') || json.version !== 1) return undefined;
  if (Object.keys(json).some((k) => k !== 'version' && k !== 'channels' && k !== 'last')) return undefined;
  const raw = json.channels;
  if (!isObject(raw)) return undefined;
  const channels: Record<string, Followed> = {};
  for (const id of Object.keys(raw)) {
    const entry = readFollowed(raw[id]);
    if (!CHANNEL_ID.test(id) || entry === undefined) return undefined;
    channels[id] = entry;
  }
  const last: Record<string, LastMatch> = {};
  if (hasOwn(json, 'last')) {
    if (!isObject(json.last)) return undefined;
    for (const id of Object.keys(json.last)) {
      const entry = readLast(json.last[id]);
      if (!CHANNEL_ID.test(id) || entry === undefined) return undefined;
      last[id] = entry;
    }
  }
  return build(channels, last);
}

export function serializeState(state: BotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export const followedOf = (state: BotState, channelId: string): Followed | undefined => (hasOwn(state.channels, channelId) ? state.channels[channelId] : undefined);

export const lastOf = (state: BotState, channelId: string): LastMatch | undefined =>
  state.last !== undefined && hasOwn(state.last, channelId) ? state.last[channelId] : undefined;

/** The channel follows a new match: the last match it had is replaced (FR-466). */
export function follow(state: BotState, channelId: string, entry: Followed): BotState {
  const { [channelId]: _old, ...last } = state.last ?? {};
  return build({ ...state.channels, [channelId]: entry }, last);
}

export function unfollow(state: BotState, channelId: string): BotState {
  const { [channelId]: _gone, ...rest } = state.channels;
  return build(rest, state.last);
}

/** The channel stops following a match (finished, halted, stopped): it becomes the last match, without its host token (FR-466). */
export function retire(state: BotState, channelId: string): BotState {
  const entry = followedOf(state, channelId);
  if (entry === undefined) return state;
  const { [channelId]: _gone, ...rest } = state.channels;
  return build(rest, { ...state.last, [channelId]: { matchId: entry.matchId, mapId: entry.mapId } });
}
