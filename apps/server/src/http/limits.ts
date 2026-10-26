// The rate limiter (spec 008 FR-299 (a), (c) to (e); plan 18.6, PD14, PD16) and the open-stream gauge (FR-299 (b); plan 19.4). Pure: the instant is a parameter; no
// clock, no timer. State lives in memory only (FR-299 (d)) and follows the last minute of traffic.
// - Per key, the instants of the ACCEPTED requests of the last 60,000 ms (sliding window). A refused request records
//   nothing anywhere (FR-299 (c)).
// - `admit(keys, now)` refuses when any key already holds its limit; the wait is the LARGEST over the exceeded keys of
//   `ceil((opening - now) / 1000)`, at least 1 (FR-299 (e)); otherwise it records `now` under every key and returns a ticket.
// - `ticket.extend(keys, now)` is the second phase of a submission (the per-player limit after the body is read): on a
//   refusal it cancels the whole ticket, so the request is counted nowhere. `ticket.cancel()` removes what it recorded.
// - An instant is pruned once 60,000 ms old (`t <= now - 60,000`); a key left empty is deleted; a full sweep runs every
//   1,000 admissions, so keys of quiet clients disappear.

import type { Identity } from './identity';
import type { Limits } from '../service/settings';

export const WINDOW_MS = 60_000;
/** A full sweep of every key runs once per this many calls of `admit`. */
export const SWEEP_EVERY = 1_000;

export interface LimitKey {
  readonly key: string;
  /** Accepted requests per window under this key. */
  readonly limit: number;
}

export type Admission = { readonly ok: true; readonly ticket: Ticket } | { readonly ok: false; readonly retryAfter: number };
export type Extension = { readonly ok: true } | { readonly ok: false; readonly retryAfter: number };

export interface Ticket {
  /** Admits the same request under more keys (all or nothing); a refusal cancels the whole ticket. */
  extend(keys: readonly LimitKey[], now: number): Extension;
  /** Removes every instant this ticket recorded; later calls do nothing. */
  cancel(): void;
}

export interface Limiter {
  admit(keys: readonly LimitKey[], now: number): Admission;
  /** The instants held under a key in the window ending at `now` (prunes it). */
  count(key: string, now: number): number;
  /** Prunes every key at `now`. */
  sweep(now: number): void;
  /** The number of keys held (memory follows the traffic of the last minute). */
  keyCount(): number;
}

/** The limiter class of a request: GET and OPTIONS are reads, POST a command (plan 18.2 stage 1). */
export type RequestClass = 'read' | 'command';

/**
 * The first-phase keys of a request: the operator and a client by credential digest and class; the host token by its
 * digest under the advances limit (a host token can only advance); anything else, including a token no configured
 * credential or match confirmed, by network address (no key is created for an unverified token, PD16).
 */
export function limitKeys(identity: Identity, requestClass: RequestClass, address: string, limits: Limits): LimitKey[] {
  switch (identity.role) {
    case 'operator':
    case 'client':
      return [{ key: `${requestClass}:${identity.digest}`, limit: requestClass === 'read' ? limits.reads : limits.commands }];
    case 'host':
      return [{ key: `advance:${identity.digest}`, limit: limits.advances }];
    default:
      return [{ key: `address:${address}`, limit: limits.anonymous }];
  }
}

/**
 * The keys of an event stream (FR-299 (b), plan 19.4): the operator and a client by credential digest (the client values,
 * C4); every other role, a host token included, by network address: only the advance route resolves host tokens (PD16).
 */
export function streamKeys(identity: Identity, address: string, limits: Limits): LimitKey[] {
  if (identity.role === 'operator' || identity.role === 'client') return [{ key: `streams:${identity.digest}`, limit: limits.streams }];
  return [{ key: `streams-address:${address}`, limit: limits.anonymousStreams }];
}

/** The key of the per-player limit of a match (a NUL separates the two parts: neither can hold one). */
export const playerKey = (matchId: string, playerId: string): string => `player:${matchId}\u0000${playerId}`;

const checkNow = (now: number): void => {
  if (!Number.isFinite(now)) throw new RangeError('the instant is a finite number of milliseconds');
};

const checkKeys = (keys: readonly LimitKey[]): void => {
  if (keys.length === 0) throw new RangeError('a request is admitted under at least one key');
  for (const k of keys) if (!Number.isSafeInteger(k.limit) || k.limit < 1) throw new RangeError('a limit is a whole number >= 1');
};

export function createLimiter(): Limiter {
  /** Per key, the accepted instants in ascending order. */
  const held = new Map<string, number[]>();
  let calls = 0;

  /** Drops the instants of a key that are 60,000 ms old or older; deletes the key when none is left. */
  const prune = (key: string, now: number): number[] | undefined => {
    const list = held.get(key);
    if (list === undefined) return undefined;
    let old = 0;
    while (old < list.length && (list[old] as number) <= now - WINDOW_MS) old += 1;
    if (old > 0) list.splice(0, old);
    if (list.length === 0) {
      held.delete(key);
      return undefined;
    }
    return list;
  };

  const sweep = (now: number): void => {
    for (const key of [...held.keys()]) prune(key, now);
  };

  /** The largest wait over the keys that hold their limit, or 0 when every key admits. */
  const waitFor = (keys: readonly LimitKey[], now: number): number => {
    let wait = 0;
    for (const { key, limit } of keys) {
      const list = prune(key, now);
      if (list === undefined || list.length < limit) continue;
      // The request is admitted once all but limit - 1 of the held instants have left the window.
      const opening = (list[list.length - limit] as number) + WINDOW_MS;
      wait = Math.max(wait, Math.max(1, Math.ceil((opening - now) / 1000)));
    }
    return wait;
  };

  /** Records `now` under every key, keeping each list in ascending order (a clock that moved back stays counted). */
  const record = (keys: readonly LimitKey[], now: number): string[] => {
    const recorded: string[] = [];
    for (const { key } of keys) {
      let list = held.get(key);
      if (list === undefined) {
        list = [];
        held.set(key, list);
      }
      let at = list.length;
      while (at > 0 && (list[at - 1] as number) > now) at -= 1;
      list.splice(at, 0, now);
      recorded.push(key);
    }
    return recorded;
  };

  const remove = (key: string, at: number): void => {
    const list = held.get(key);
    if (list === undefined) return;
    const index = list.lastIndexOf(at);
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) held.delete(key);
  };

  const ticketOf = (firstKeys: string[], now: number): Ticket => {
    const recorded: { key: string; at: number }[] = firstKeys.map((key) => ({ key, at: now }));
    let spent = false;
    const cancel = (): void => {
      if (spent) return;
      spent = true;
      for (const { key, at } of recorded) remove(key, at);
      recorded.length = 0;
    };
    return {
      extend(keys, at) {
        checkNow(at);
        checkKeys(keys);
        if (spent) throw new RangeError('the ticket was cancelled');
        const wait = waitFor(keys, at);
        if (wait > 0) {
          cancel();
          return { ok: false, retryAfter: wait };
        }
        for (const key of record(keys, at)) recorded.push({ key, at });
        return { ok: true };
      },
      cancel,
    };
  };

  return {
    admit(keys, now) {
      checkNow(now);
      checkKeys(keys);
      calls += 1;
      if (calls % SWEEP_EVERY === 0) sweep(now);
      const wait = waitFor(keys, now);
      if (wait > 0) return { ok: false, retryAfter: wait };
      return { ok: true, ticket: ticketOf(record(keys, now), now) };
    },
    count(key, now) {
      checkNow(now);
      return prune(key, now)?.length ?? 0;
    },
    sweep(now) {
      checkNow(now);
      sweep(now);
    },
    keyCount: () => held.size,
  };
}

/** One open stream's place in the gauge; `release` gives it back once. */
export interface StreamLease {
  /** Gives the place back under every key; later calls do nothing. */
  release(): void;
}

export type StreamOpening = { readonly ok: true; readonly lease: StreamLease } | { readonly ok: false };

/** Counts open event streams per key (FR-299 (b)): no window, a stream stays counted until its lease is released. */
export interface Gauge {
  /** Takes a place under every key, or refuses when any key already holds its limit (nothing is recorded then). */
  open(keys: readonly LimitKey[]): StreamOpening;
  /** The open streams under a key. */
  count(key: string): number;
  /** The number of keys with at least one open stream. */
  keyCount(): number;
}

export function createGauge(): Gauge {
  const open = new Map<string, number>();
  return {
    open(keys) {
      checkKeys(keys);
      for (const { key, limit } of keys) if ((open.get(key) ?? 0) >= limit) return { ok: false };
      const names = keys.map((k) => k.key);
      for (const name of names) open.set(name, (open.get(name) ?? 0) + 1);
      let released = false;
      return {
        ok: true,
        lease: {
          release() {
            if (released) return;
            released = true;
            for (const name of names) {
              const left = (open.get(name) ?? 0) - 1;
              if (left > 0) open.set(name, left);
              else open.delete(name);
            }
          },
        },
      };
    },
    count: (key) => open.get(key) ?? 0,
    keyCount: () => open.size,
  };
}
