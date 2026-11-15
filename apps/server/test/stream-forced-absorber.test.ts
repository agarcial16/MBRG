import { encodeEvent } from '@mbrg/protocol';
import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devMap } from './helpers/digests';
import { makeMatch, startReads } from './helpers/http-reads-kit';
import { closeAllServers, goldSeeds, seedSourceOf } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { START_MS } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';

// The forced absorber over the event stream (spec 011 M1 T8): the dev secret 'ascending-00-1f' forces round 4 (one candidate).
// Fake clock with I = 120, L1 = 30, L2 = 10, F = 5 s: round 4 closes phase 1 at +440 s, the shortened phase 2 at +445 s and the
// application is at +455 s. The stream bytes are the protocol encoding of the stored events, replayable from any number.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const S = 1000;
const SEEDS = goldSeeds();
const MAP = devMap();
const stateBeforeRound4 = (() => {
  const first = getState(MAP, 0, 0);
  if (!first.ok) throw new Error('no round-0 state');
  let s = first.value;
  for (const seed of SEEDS.slice(0, 3)) {
    const played = playRoundWithSeed(MAP, s, seed);
    if (!played.ok) throw new Error('round cannot be played');
    s = played.value.state;
  }
  return s;
})();
const victimOf = (seed: number): number => {
  const played = playRoundWithSeed(MAP, stateBeforeRound4, seed);
  if (!played.ok) throw new Error('round cannot be played');
  return played.value.record.eliminated;
};
const OTHER_LAST = ((): number => {
  for (let seed = 1; seed < 5000; seed += 1) if (seed !== SEEDS[3] && victimOf(seed) === victimOf(SEEDS[3]!)) return seed;
  throw new Error('no twin seed');
})();

const runTo = (h: ServerHarness, offsetS: number): void => void h.base.scheduler!.runTo(START_MS + offsetS * S);
const rawOf = (frames: readonly { raw: string }[]): string => frames.map((f) => f.raw).join('');

async function forcedMatch(last = SEEDS[3]!): Promise<{ h: ServerHarness; id: string; reader: SseReader }> {
  const h = await startReads({ service: { scheduler: true, testSeedSource: seedSourceOf([...SEEDS.slice(0, 3), last]) } });
  const { id } = makeMatch(h);
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
  readers.push(reader);
  return { h, id, reader };
}

describe('the forced absorber over the event stream', () => {
  it('FR-387 (stream) FR-388 (stream) the forced reveal carries forced after a with the shortened c2 and a, and the shortened schedule follows; no other reveal carries forced', async () => {
    const { h, id, reader } = await forcedMatch();
    runTo(h, 455);
    const stored = h.base.store.eventsAfter(id, 0);
    const frames = await reader.takeEvents(stored.length);
    expect(frames.map((f) => f.data)).toStrictEqual(stored.map((e) => encodeEvent(e)));
    const reveals = frames.filter((f) => (JSON.parse(f.data) as { type: string }).type === 'victim-revealed');
    expect(reveals).toHaveLength(4);
    // Rounds 1 to 3 have two or three candidates: the bytes carry no forced key at all.
    for (const f of reveals.slice(0, 3)) expect(f.data).not.toContain('forced');
    const forced = reveals[3]!;
    expect(forced.data).toBe(
      `{"type":"victim-revealed","seq":${forced.id},"round":4,"victim":5,"candidates":[1],"living":[1,5],"revealedAt":${START_MS + 440 * S},"c2":${START_MS + 445 * S},"a":${START_MS + 455 * S},"forced":true,"reportedTime":${START_MS + 440 * S}}`,
    );
    // The schedule event of the same decision, the close of the shortened phase 2 and the application are at the new instants.
    const after = frames.filter((f) => f.id > forced.id).map((f) => JSON.parse(f.data) as Record<string, any>);
    expect(after.map((e) => e.type)).toStrictEqual(['results', 'schedule', 'phase-closed', 'schedule', 'round-applied', 'results', 'match-finished']);
    const shortened = { c1: START_MS + 440 * S, c2: START_MS + 445 * S, a: START_MS + 455 * S };
    expect(after[1]).toMatchObject({ stage: 'phase-2', schedule: shortened });
    expect(after[2]).toMatchObject({ round: 4, phase: 2, at: START_MS + 445 * S });
    expect(after[3]).toMatchObject({ stage: 'locked', schedule: shortened });
    expect(after[4]).toMatchObject({ round: 4, appliedAt: START_MS + 455 * S });
    expect(after[5]).toMatchObject({ round: 4, phase: 2 });
  }, 30_000);

  it('FR-387 (stream) a replay from the start and a late join after the reveal carry the same forced frame bytes as the live stream', async () => {
    const { h, id, reader } = await forcedMatch();
    runTo(h, 440);
    const stored = h.base.store.eventsAfter(id, 0);
    const live = await reader.takeEvents(stored.length);
    const revealSeq = stored.find((e) => e.type === 'victim-revealed' && e.round === 4)!.seq;
    const replay = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
    readers.push(replay);
    expect(rawOf(await replay.takeEvents(stored.length))).toBe(rawOf(live));
    const late = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=${revealSeq - 1}` });
    readers.push(late);
    const tail = await late.takeEvents(stored.length - revealSeq + 1);
    expect(rawOf(tail)).toBe(rawOf(live.filter((f) => f.id >= revealSeq)));
    expect(tail[0]!.data).toContain('"forced":true');
  }, 30_000);

  it('FR-387 (stream) FR-388 (stream) twins with the same public data and another unrevealed round-4 seed give identical stream bytes through the forced reveal and the shortened close', async () => {
    expect(victimOf(OTHER_LAST)).toBe(victimOf(SEEDS[3]!));
    const a = await forcedMatch(SEEDS[3]);
    const b = await forcedMatch(OTHER_LAST);
    expect(a.id).toBe(b.id);
    for (const t of [a, b]) runTo(t.h, 445);
    const count = a.h.base.store.eventsAfter(a.id, 0).length;
    expect(b.h.base.store.eventsAfter(b.id, 0).length).toBe(count);
    const ga = await a.reader.takeEvents(count);
    const gb = await b.reader.takeEvents(count);
    expect(rawOf(ga)).toBe(rawOf(gb));
    expect(rawOf(ga)).toContain('"forced":true');
    expect(JSON.parse(ga[ga.length - 1]!.data)).toMatchObject({ type: 'schedule', stage: 'locked' });
  }, 30_000);
});
