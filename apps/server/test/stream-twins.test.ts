import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devMap } from './helpers/digests';
import { encodingsOf } from './helpers/db-scan';
import { advanceSteps, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { START_MS } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';

// Twin matches over the event stream (FR-257 and NFR-47 (a)): two servers run matches whose public data are equal and whose
// unrevealed outcomes differ. The stream bytes must be identical up to each reveal. Also the scan of the stream bytes
// (NFR-47 (c), FR-259): the match secret and the round seeds are in no byte before `match-finished`.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const S = 1000;
const MAP = devMap();
const STATE0 = ((): Parameters<typeof playRoundWithSeed>[1] => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const recordOf = (seed: number): { eliminated: number; absorber: number } => {
  const r = playRoundWithSeed(MAP, STATE0, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return r.value.record;
};
const FIRST = 101;
/** Two seeds for round 1 with different victims. */
const VICTIM_PAIR = ((): [number, number] => {
  for (let seed = FIRST + 1; seed < 5000; seed += 1) if (recordOf(seed).eliminated !== recordOf(FIRST).eliminated) return [FIRST, seed];
  throw new Error('no seed pair');
})();
/** Two seeds for round 1 with the same victim and different absorbers (the victim needs at least two candidates). */
const ABSORBER_PAIR = ((): [number, number] => {
  const firstOf = new Map<string, number>();
  for (let seed = 1; seed < 20000; seed += 1) {
    const record = recordOf(seed);
    const key = String(record.eliminated);
    const earlier = firstOf.get(key);
    if (earlier === undefined) firstOf.set(key, seed);
    else if (recordOf(earlier).absorber !== record.absorber) return [earlier, seed];
  }
  throw new Error('no seed pair');
})();
const sourceOf = (round1: number) => () => (k: number) => (k === 1 ? round1 : 7000 + k);

interface Twin {
  readonly h: ServerHarness;
  readonly id: string;
  readonly reader: SseReader;
}
async function twin(round1: number): Promise<Twin> {
  const h = await startReads({ service: { scheduler: true, testSeedSource: sourceOf(round1) } });
  const { id } = makeMatch(h);
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
  readers.push(reader);
  return { h, id, reader };
}
const runTo = (t: Twin, offsetS: number): void => void t.h.base.scheduler!.runTo(START_MS + offsetS * S);
const rawOf = (frames: readonly { raw: string }[]): string => frames.map((f) => f.raw).join('');

describe('twin matches over the event stream', () => {
  it('FR-257 (event encoders) NFR-47 (a) twins with another unrevealed victim give identical stream bytes until the phase-1 close', async () => {
    expect(recordOf(VICTIM_PAIR[0]).eliminated).not.toBe(recordOf(VICTIM_PAIR[1]).eliminated);
    const a = await twin(VICTIM_PAIR[0]);
    const b = await twin(VICTIM_PAIR[1]);
    expect(a.id).toBe(b.id);
    expect(publicOf(a.h, a.id)).toStrictEqual(publicOf(b.h, b.id));
    const created = [await a.reader.takeEvents(1), await b.reader.takeEvents(1)];
    expect(created[0]?.[0]?.raw).toBe(created[1]?.[0]?.raw);
    // Heartbeats and a clock just before C1: still identical bytes.
    for (const t of [a, b]) {
      expect(t.h.scheduler.fireAll()).toBe(1);
      runTo(t, 80 - 1);
      expect(await t.reader.next()).toMatchObject({ kind: 'comment' });
    }
    expect(a.reader.raw()).toBe(b.reader.raw());
    expect(a.reader.raw()).toBe(`${created[0]?.[0]?.raw}:\n\n`);
    // The close of phase 1 reveals the victim: the first frame is the same, the reveal differs.
    runTo(a, 80);
    runTo(b, 80);
    const ga = await a.reader.takeEvents(3);
    const gb = await b.reader.takeEvents(3);
    expect(ga[0]?.raw).toBe(gb[0]?.raw);
    expect(ga[1]?.raw).not.toBe(gb[1]?.raw);
    expect(JSON.parse(ga[1]!.data).victim).toBe(recordOf(VICTIM_PAIR[0]).eliminated);
    expect(JSON.parse(gb[1]!.data).victim).toBe(recordOf(VICTIM_PAIR[1]).eliminated);
  }, 30_000);

  it('FR-257 (event encoders) NFR-47 (a) twins with the same victim and another unrevealed absorber give identical stream bytes until the application', async () => {
    expect(recordOf(ABSORBER_PAIR[0]).eliminated).toBe(recordOf(ABSORBER_PAIR[1]).eliminated);
    expect(recordOf(ABSORBER_PAIR[0]).absorber).not.toBe(recordOf(ABSORBER_PAIR[1]).absorber);
    const a = await twin(ABSORBER_PAIR[0]);
    const b = await twin(ABSORBER_PAIR[1]);
    // Close of phase 1 (victim revealed) and of phase 2: every byte so far is the same, the absorber is still unknown.
    for (const offset of [80, 110]) {
      runTo(a, offset);
      runTo(b, offset);
    }
    await a.reader.takeEvents(1 + 4 + 2);
    await b.reader.takeEvents(1 + 4 + 2);
    expect(a.reader.raw().length).toBeGreaterThan(300);
    expect(a.reader.raw()).toBe(b.reader.raw());
    expect(publicOf(a.h, a.id).stage).toBe('locked');
    // The application reveals the outcome: the bytes differ at the round-applied event.
    runTo(a, 120);
    runTo(b, 120);
    const ga = await a.reader.takeEvents(3);
    const gb = await b.reader.takeEvents(3);
    expect(ga[0]?.raw).not.toBe(gb[0]?.raw);
    expect(JSON.parse(ga[0]!.data).record.absorber).toBe(recordOf(ABSORBER_PAIR[0]).absorber);
    expect(JSON.parse(gb[0]!.data).record.absorber).toBe(recordOf(ABSORBER_PAIR[1]).absorber);
  }, 30_000);
});

describe('the stream bytes and the secret', () => {
  const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
  const SECRET_HEX = Buffer.from(SECRET).toString('hex');
  const seedOf = (k: number): number => 3_000_000_000 + 7919 * k;

  it('NFR-47 (c) (stream bytes) FR-259 (stream) no byte before match-finished holds the secret or a round seed in any encoding; the secret first appears in match-finished', async () => {
    const h = await startReads({ service: { secret: SECRET, testSeedSource: () => seedOf } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const live = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
    readers.push(live);
    advanceSteps(h, id, 12);
    expect(publicOf(h, id).stage).toBe('finished');
    const stored = h.base.store.eventsAfter(id, 0);
    const liveFrames = await live.takeEvents(stored.length);
    expect(liveFrames.map((f) => f.id)).toStrictEqual(stored.map((e) => e.seq));
    const needles = [...encodingsOf(SECRET), ...[1, 2, 3, 4].flatMap((k) => encodingsOf(seedOf(k)))];
    const holds = (text: string, needle: string | Uint8Array): boolean => (typeof needle === 'string' ? text.includes(needle) : Buffer.from(text, 'utf8').includes(Buffer.from(needle)));
    // A replay of the whole log from the start gives the same bytes as the live stream.
    const replay = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
    readers.push(replay);
    const all = await replay.takeEvents(stored.length);
    const last = all[all.length - 1]!;
    expect(JSON.parse(last.data).type).toBe('match-finished');
    expect(JSON.parse(last.data).matchSecret).toBe(SECRET_HEX);
    const before = rawOf(all.slice(0, -1));
    for (const needle of needles) expect(holds(before, needle), String(needle).slice(0, 14)).toBe(false);
    // The scan can see the secret: it is in the last frame, and only there.
    expect(last.raw).toContain(SECRET_HEX);
    expect(all.filter((f) => f.raw.includes(SECRET_HEX))).toHaveLength(1);
    expect(replay.raw()).toBe(rawOf(all));
    expect(live.raw()).toBe(replay.raw());
    expect(rawOf(liveFrames.slice(0, -1))).toBe(before);
  }, 30_000);
});
