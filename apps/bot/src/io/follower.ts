// The followed matches (spec 012 FR-453, FR-456, FR-459, FR-460): one event stream per followed channel, every event announced once.
// An event is announced in this order: decode, fetch the public data it needs, post, then save the new last number. A failure
// before the save throws, the stream is re-opened after the backoff and the same event is tried again; an event whose number is
// not above the saved one is never announced again (a restart or a re-sent event). The bot never asks for a future round.
import { readEvent } from '@mbrg/protocol';
import { advanceFollow, buildAnnouncement, endsFollowing, needOf } from '../core/announce';
import type { Extras } from '../core/announce';
import type { OutMessage } from '../core/model';
import { nameBook } from '../core/names';
import type { NameBook } from '../core/names';
import { summarizeWinners } from '../core/results';
import type { SseFrame } from '../core/sse-parser';
import type { ServerClient } from './server-client';
import type { StateStore } from './state-file';
import { followStream, sleepMs } from './stream';

/** Posts one message in a channel; throws when it cannot. */
export interface Poster {
  post(channelId: string, message: OutMessage): Promise<void>;
}

export interface NamesProvider {
  get(mapId: string): Promise<NameBook>;
}

/** The names of the factions of a map, read once from its public presentation file; unreadable: numbers only (not remembered). */
export function createNames(client: ServerClient): NamesProvider {
  const cache = new Map<string, NameBook>();
  return {
    async get(mapId) {
      const known = cache.get(mapId);
      if (known !== undefined) return known;
      const read = await client.factions(mapId);
      if (!read.ok) return nameBook([]);
      const book = nameBook(read.value);
      cache.set(mapId, book);
      return book;
    },
  };
}

export interface FollowerOptions {
  readonly baseUrl: string;
  readonly client: ServerClient;
  readonly store: StateStore;
  readonly poster: Poster;
  readonly names: NamesProvider;
  readonly viewerUrl: string | undefined;
  readonly log: (code: string) => void;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface Follower {
  follow(channelId: string): void;
  unfollow(channelId: string): void;
  /** Follows every channel of the saved state (the restart of FR-459). */
  followAll(): void;
  stopAll(): void;
  /** One frame of a channel's stream; exported for the tests of the order above. */
  handleFrame(channelId: string, frame: SseFrame): Promise<void>;
}

export function createFollower(options: FollowerOptions): Follower {
  const { client, store, poster, names, log } = options;
  const running = new Map<string, AbortController>();

  async function extrasFor(channelId: string, matchId: string, need: ReturnType<typeof needOf>): Promise<Extras> {
    if (need.type === 'left') {
      const left = await client.livingAt(matchId, need.round);
      if (!left.ok) throw new Error('read-failed');
      return { left: left.value };
    }
    if (need.type === 'winners') {
      const correct = await client.correctPlayers(matchId, need.round, need.phase);
      if (!correct.ok) throw new Error('read-failed');
      return { winners: summarizeWinners(correct.value) };
    }
    return {};
  }

  async function handleFrame(channelId: string, frame: SseFrame): Promise<void> {
    const entry = store.get(channelId);
    if (entry === undefined) return;
    let json: unknown;
    try {
      json = JSON.parse(frame.data);
    } catch {
      log('frame-invalid');
      return;
    }
    const read = readEvent(json);
    if (read.status === 'invalid') {
      log('frame-invalid');
      return;
    }
    const seq = read.status === 'unknown' ? read.seq : read.event.seq;
    if (seq <= entry.lastSeq) return;
    if (read.status === 'unknown') {
      store.set(channelId, { ...entry, lastSeq: seq });
      return;
    }
    const { event } = read;
    const extras = await extrasFor(channelId, entry.matchId, needOf(event, entry));
    const book = await names.get(entry.mapId);
    const messages = buildAnnouncement(event, { follow: entry, names: book, ...(options.viewerUrl === undefined ? {} : { viewerUrl: options.viewerUrl }) }, extras);
    for (const message of messages) await poster.post(channelId, message);
    // The channel may have been stopped or replaced while this event was being read and posted: then nothing is saved.
    const current = store.get(channelId);
    if (current === undefined || current.matchId !== entry.matchId) return;
    log('announced');
    if (endsFollowing(event)) {
      unfollow(channelId);
      return;
    }
    store.set(channelId, advanceFollow(current, event));
  }

  function follow(channelId: string): void {
    running.get(channelId)?.abort();
    const controller = new AbortController();
    running.set(channelId, controller);
    const entry = store.get(channelId);
    if (entry === undefined) return;
    void followStream({
      url: `${options.baseUrl}/matches/${encodeURIComponent(entry.matchId)}/events`,
      lastSeq: () => store.get(channelId)?.lastSeq ?? 0,
      onFrame: (frame) => handleFrame(channelId, frame),
      signal: controller.signal,
      sleep: options.sleep ?? sleepMs,
      log,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  function unfollow(channelId: string): void {
    running.get(channelId)?.abort();
    running.delete(channelId);
    store.remove(channelId);
  }

  return {
    follow,
    unfollow,
    followAll: () => store.channelIds().forEach(follow),
    stopAll() {
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
    handleFrame,
  };
}
