import { encodeEvent } from '@mbrg/protocol';
import type { MatchEvent, PublicMatch } from '@mbrg/protocol';
import { expect } from 'vitest';
import { publicOf } from './http-reads-kit';
import { openStream } from './sse-reader';
import type { SseReader } from './sse-reader';
import type { ServerHarness } from './server-harness';

// Shared by the stream tests of M3b' (FR-287 order over a full match): one stream per match from `lastEventId=0`, the
// decisions driven by the test, and the exact type sequence of plan 19.8 checked for every decision.

/** The event types of one decision, by the stage the match is in when the decision is made (plan 19.8, hand-written). */
export function typesOfDecision(shown: PublicMatch, l2: number): string[] {
  const last = shown.appliedRounds + 1 === shown.totalRounds;
  const end = last ? 'match-finished' : 'schedule';
  if (shown.stage === 'phase-1') return ['phase-closed', 'victim-revealed', 'schedule'];
  if (shown.stage === 'phase-2') return l2 > 0 ? ['phase-closed', 'schedule'] : ['phase-closed', 'round-applied', end];
  if (shown.stage === 'locked') return ['round-applied', end];
  throw new Error(`no decision in stage ${shown.stage}`);
}

export interface Played {
  /** Every event the stream carried, in order, parsed from its `data`. */
  readonly events: Record<string, unknown>[];
  /** The type list of each decision, parallel to the decisions made. */
  readonly decisions: string[][];
  /** The stored events at the end. */
  readonly stored: MatchEvent[];
  readonly reader: SseReader;
}

export async function openFromStart(h: ServerHarness, id: string, track: SseReader[]): Promise<SseReader> {
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
  track.push(reader);
  return reader;
}

/**
 * Plays the match to its end: `drive(n, shown)` makes decision number n (it must perform exactly one decision). After each
 * one the stream must carry exactly the stored events of that decision, with the stored numbers, byte-equal to
 * `encodeEvent`, in the type order of plan 19.8. At the end the stream holds nothing else.
 */
export async function playAndCheck(h: ServerHarness, id: string, reader: SseReader, l2: number, drive: (n: number, shown: PublicMatch) => void): Promise<Played> {
  const store = h.base.store;
  const first = await reader.takeEvents(1);
  expect(first[0]?.id).toBe(1);
  const frames = [...first];
  const decisions: string[][] = [];
  for (let n = 0; ; n += 1) {
    const shown = publicOf(h, id);
    if (shown.stage === 'finished') break;
    const expectedTypes = typesOfDecision(shown, l2);
    const before = shown.lastSeq;
    drive(n, shown);
    const added = store.eventsAfter(id, before);
    expect(added.map((e) => e.type), `decision ${n}`).toStrictEqual(expectedTypes);
    expect(added.map((e) => e.seq)).toStrictEqual(added.map((_, i) => before + 1 + i));
    const got = await reader.takeEvents(added.length);
    expect(got.map((f) => f.id), `decision ${n}`).toStrictEqual(added.map((e) => e.seq));
    expect(got.map((f) => f.data)).toStrictEqual(added.map((e) => encodeEvent(e)));
    frames.push(...got);
    decisions.push(expectedTypes);
    if (expectedTypes.includes('victim-revealed')) {
      const { type: _type, reportedTime: _reported, ...revealed } = JSON.parse(got[1]?.data ?? '{}') as Record<string, unknown>;
      expect(revealed).toStrictEqual(JSON.parse(JSON.stringify(publicOf(h, id).victim)));
    }
  }
  const stored = store.eventsAfter(id, 0);
  expect(frames.map((f) => f.id)).toStrictEqual(stored.map((e) => e.seq));
  expect(stored.map((e) => e.seq)).toStrictEqual(stored.map((_, i) => i + 1));
  // Nothing but the events was sent (no heartbeat: the hub's scheduler was not moved).
  expect(reader.raw()).toBe(frames.map((f) => f.raw).join(''));
  return { events: frames.map((f) => JSON.parse(f.data) as Record<string, unknown>), decisions, stored, reader };
}
