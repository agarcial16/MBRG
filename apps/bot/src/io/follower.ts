// The followed matches (spec 012 FR-453, FR-456, FR-459, FR-460): one event stream per followed channel, every event announced once.
// An event is announced in this order: decode, fetch the public data it needs, post, then save the new last number. A failure
// before the save throws, the stream is re-opened after the backoff and the same event is tried again; an event whose number is
// not above the saved one is never announced again (a restart or a re-sent event). The bot never asks for a future round.
import { readEvent } from '@mbrg/protocol';
import { COUNTDOWN_STEP, advanceFollow, buildAnnouncement, closesPhase, countdownMessage, endsFollowing, needOf, openPhaseSeconds } from '../core/announce';
import type { Extras } from '../core/announce';
import type { OutMessage } from '../core/model';
import { nameBook } from '../core/names';
import type { NameBook } from '../core/names';
import { BOARD_SIZE, summarizeWinners } from '../core/results';
import type { SseFrame } from '../core/sse-parser';
import type { ServerClient } from './server-client';
import type { StateStore } from './state-file';
import { followStream, sleepMs } from './stream';

/** Posts and edits messages in a channel; each throws when it cannot. */
export interface Poster {
  /** Posts a message and gives the id of its first part, to edit it later (FR-465). */
  post(channelId: string, message: OutMessage): Promise<string | undefined>;
  /** Replaces the text and buttons of a message this poster posted. */
  edit(channelId: string, messageId: string, message: OutMessage): Promise<void>;
}

/** Runs `tick` every `ms` until the returned function is called. */
export type Every = (ms: number, tick: () => void) => () => void;

const everyMs: Every = (ms, tick) => {
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
};

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
  /** The repeating timer of the countdown (injected by the tests). */
  readonly every?: Every;
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
  const every = options.every ?? everyMs;
  const countdowns = new Map<string, () => void>();

  function stopCountdown(channelId: string): void {
    countdowns.get(channelId)?.();
    countdowns.delete(channelId);
  }

  // FR-465: every COUNTDOWN_STEP seconds the open-phase message is edited with the seconds left, counted from the pace's phase
  // length. It stops when the time is out, at the next event, when the stream drops or the channel stops. A failed edit is ignored.
  function startCountdown(channelId: string, messageId: string, base: OutMessage, seconds: number): void {
    stopCountdown(channelId);
    let left = seconds;
    const cancel = every(COUNTDOWN_STEP * 1000, () => {
      left -= COUNTDOWN_STEP;
      if (left <= 0) return stopCountdown(channelId);
      void (async () => {
        try {
          await poster.edit(channelId, messageId, countdownMessage(base, left));
        } catch {
          // an edit that fails changes nothing and posts nothing
        }
      })();
    });
    countdowns.set(channelId, cancel);
  }

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
    if (need.type === 'board') {
      const rows = await client.leaderboard(matchId, BOARD_SIZE);
      if (!rows.ok) throw new Error('read-failed');
      return { board: rows.value };
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
    // An event that closes or replaces the open phase ends its countdown.
    if (read.status === 'known' && closesPhase(read.event)) stopCountdown(channelId);
    if (read.status === 'unknown') {
      store.set(channelId, { ...entry, lastSeq: seq });
      return;
    }
    const { event } = read;
    const extras = await extrasFor(channelId, entry.matchId, needOf(event, entry));
    const book = await names.get(entry.mapId);
    const messages = buildAnnouncement(event, { follow: entry, names: book, ...(options.viewerUrl === undefined ? {} : { viewerUrl: options.viewerUrl }) }, extras);
    let firstId: string | undefined;
    for (const [i, message] of messages.entries()) {
      const id = await poster.post(channelId, message);
      if (i === 0) firstId = id;
    }
    // The channel may have been stopped or replaced while this event was being read and posted: then nothing is saved.
    const current = store.get(channelId);
    if (current === undefined || current.matchId !== entry.matchId) return;
    log('announced');
    if (endsFollowing(event)) {
      unfollow(channelId);
      return;
    }
    store.set(channelId, advanceFollow(current, event));
    const seconds = openPhaseSeconds(event, current);
    const first = messages[0];
    if (seconds !== undefined && firstId !== undefined && first !== undefined) startCountdown(channelId, firstId, first, seconds);
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
      onDrop: () => stopCountdown(channelId),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  function unfollow(channelId: string): void {
    running.get(channelId)?.abort();
    running.delete(channelId);
    stopCountdown(channelId);
    store.retire(channelId);
  }

  return {
    follow,
    unfollow,
    followAll: () => store.channelIds().forEach(follow),
    stopAll() {
      for (const controller of running.values()) controller.abort();
      running.clear();
      for (const channelId of [...countdowns.keys()]) stopCountdown(channelId);
    },
    handleFrame,
  };
}
