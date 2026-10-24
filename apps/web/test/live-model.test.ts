import { describe, expect, it } from 'vitest';
import { encodeEvent, type MatchEvent, type RecordReply } from '@mbrg/protocol';
import { estimateAt, reduce, startLive, type LiveEffect, type LiveModel } from '../src/core/live-model';
import { digestTextOf, ownersOf } from '../src/core/live-rounds';
import {
  Driver,
  MATCH_ID,
  eventsFrom,
  eventsOfRound,
  lastSeqAt,
  publicAt,
  recordReply,
  requestRounds,
  scripted,
  seqOfRound,
  stateReply,
  type Scripted,
} from './helpers/scripted-match';

const pairs = (s: Scripted, n: number) => [...(s.states[n] as [number, number][])];
const ownersAt = (m: LiveModel, n: number): [number, number][] => [...((m.held.get(n) ?? new Map()) as Map<number, number>)];
const find = <T extends LiveEffect['type']>(effects: readonly LiveEffect[], type: T) =>
  effects.filter((e): e is Extract<LiveEffect, { type: T }> => e.type === type);
const json = (e: MatchEvent): unknown => JSON.parse(encodeEvent(e)) as unknown;

describe('FR-303 the live match is loaded from the public data', () => {
  it('FR-303 a start asks for the public data and holds nothing', () => {
    const { model, effects } = startLive(MATCH_ID);
    expect(effects).toStrictEqual([{ type: 'read-public' }]);
    expect(model.phase).toBe('loading');
    expect(model.held.size).toBe(0);
    expect(model.displayed).toBeUndefined();
  });

  it('FR-303 the public data gives N, the state at N, the drawing of N and the subscription after its last sequence number', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(3);
    expect(d.model.applied).toBe(3);
    expect(d.model.displayed).toBe(3);
    expect(d.model.lastSeq).toBe(lastSeqAt(3));
    expect(d.model.totalRounds).toBe(s.total);
    expect([...d.model.held.keys()]).toStrictEqual([3]);
    expect(ownersAt(d.model, 3)).toStrictEqual(pairs(s, 3));
    expect(d.effects.map((e) => e.type)).toStrictEqual(['draw', 'open-stream']);
    expect(find(d.effects, 'draw')[0]?.round).toBe(3);
    expect(find(d.effects, 'open-stream')).toStrictEqual([{ type: 'open-stream', after: lastSeqAt(3) }]);
    expect(requestRounds(d.effects)).toStrictEqual([]);
    expect(d.model.phase).toBe('live');
  });

  it('FR-303 an address round below N is read and drawn instead of N', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(3, 1);
    expect(d.effects.map((e) => e.type)).toStrictEqual(['read-state', 'draw', 'open-stream']);
    expect(requestRounds(d.effects)).toStrictEqual([1]);
    expect(find(d.effects, 'draw')[0]?.round).toBe(1);
    expect(d.model.displayed).toBe(1);
    expect(d.model.applied).toBe(3);
    expect([...d.model.held.keys()].sort()).toStrictEqual([1, 3]);
  });

  it('FR-303 an address round above N is ignored: N is drawn', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2, 3);
    expect(d.model.displayed).toBe(2);
    expect(requestRounds(d.effects)).toStrictEqual([]);
  });

  it('FR-303 a finished or halted match is drawn and no stream is opened', async () => {
    const s = await scripted();
    const finished = new Driver(s);
    await finished.load(s.total);
    expect(finished.model.phase).toBe('closed');
    expect(finished.model.stage).toBe('finished');
    expect(finished.model.winner).toBe((s.records[s.total - 1] as RecordReply).absorber);
    expect(finished.effects.map((e) => e.type)).toStrictEqual(['draw']);
    const halted = new Driver(s);
    await halted.feed({ type: 'public', at: 1, match: publicAt(s, 2, { stage: 'halted', haltReason: 'map-changed' }) });
    expect(halted.model.phase).toBe('closed');
    expect(halted.model.haltReason).toBe('map-changed');
    expect(find(halted.effects, 'open-stream')).toStrictEqual([]);
  });

  it('FR-303 the schedule, the victim and the reported time of the public data are kept', async () => {
    const s = await scripted();
    const clock = { i: 120, l1: 30, l2: 10 } as const;
    const schedule = { c1: 100, c2: 200, a: 300 };
    const rec = s.records[1] as RecordReply;
    const victim = { round: 2, victim: rec.eliminated, candidates: [rec.absorber], living: s.living[1] as number[], revealedAt: 90, c2: 200, a: 300, seq: lastSeqAt(1) + 2 };
    const d = new Driver(s);
    await d.feed({ type: 'public', at: 77, match: publicAt(s, 1, { timing: clock, stage: 'phase-2', schedule, victim }) });
    expect(d.model.timing).toStrictEqual(clock);
    expect(d.model.schedule).toStrictEqual(schedule);
    expect(d.model.victim).toStrictEqual(victim);
    expect(d.model.stage).toBe('phase-2');
    expect(estimateAt(d.model, 77)).toBe(5100);
    expect(estimateAt(d.model, 1077)).toBe(6100);
  });

  it('FR-303 inputs before the public data, or a public data of another match, change nothing', async () => {
    const s = await scripted();
    const { model } = startLive(MATCH_ID);
    for (const input of [
      { type: 'event', at: 1, data: eventsOfRound(s, 1)[0] },
      { type: 'digest', at: 1, digest: 'x' },
      { type: 'state', at: 1, reply: stateReply(s, 0) },
      { type: 'navigate', at: 1, action: 'first' },
      { type: 'public', at: 1, match: { ...publicAt(s, 0), matchId: 'ZZZZZZZZZZZZZZZZ' } },
    ] as const) {
      const out = reduce(model, input);
      expect(out.model, input.type).toBe(model);
      expect(out.effects, input.type).toStrictEqual([]);
    }
  });
});

describe('FR-303 an applied round is played after its digest matched', () => {
  it('FR-303 while following, round-applied hashes the built state and then plays the step with the 005 data', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    d.log.length = 0;
    await d.events(eventsOfRound(s, 3));
    const hash = find(d.effects, 'hash-state');
    expect(hash).toHaveLength(1);
    expect(hash[0]?.text).toBe(digestTextOf(ownersOf(s.states[3] as never), 3));
    const steps = find(d.effects, 'play-step');
    expect(steps).toHaveLength(1);
    const step = steps[0]!;
    expect([step.from, step.to]).toStrictEqual([2, 3]);
    const rec = s.records[2] as RecordReply;
    expect([...step.data.earlier]).toStrictEqual(pairs(s, 2));
    expect([...step.data.later]).toStrictEqual(pairs(s, 3));
    expect(step.data.eliminated).toBe(rec.eliminated);
    expect(step.data.absorber).toBe(rec.absorber);
    expect(step.data.transferred).toStrictEqual(rec.transferred);
    expect(Object.keys(step.data).sort()).toStrictEqual(['absorber', 'earlier', 'eliminated', 'later', 'transferred']);
    expect(d.effects.indexOf(hash[0]!)).toBeLessThan(d.effects.indexOf(step));
    expect(find(d.effects, 'draw')).toStrictEqual([]);
    expect(d.model.applied).toBe(3);
    expect(d.model.displayed).toBe(3);
    expect(ownersAt(d.model, 3)).toStrictEqual(pairs(s, 3));
    expect(d.model.records.get(3)).toStrictEqual(rec);
    expect(requestRounds(d.effects)).toStrictEqual([]);
  });

  it('FR-303 nothing is held or played before the digest result arrives', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.defer = true;
    await d.load(2);
    await d.events(eventsOfRound(s, 3));
    expect(d.model.applied).toBe(2);
    expect(d.model.held.has(3)).toBe(false);
    expect(d.model.displayed).toBe(2);
    expect(find(d.effects, 'play-step')).toStrictEqual([]);
    expect(d.model.applying?.round).toBe(3);
    await d.resolve();
    expect(d.model.applied).toBe(3);
    expect(find(d.effects, 'play-step')).toHaveLength(1);
    expect(d.model.applying).toBeUndefined();
  });

  it('FR-303 (D32) while browsing an earlier round the displayed round and the picture stay, and N, the panel fields and the controls move', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(3, 1);
    d.log.length = 0;
    await d.events(eventsOfRound(s, 4));
    expect(d.model.displayed).toBe(1);
    expect(d.model.applied).toBe(4);
    expect(find(d.effects, 'play-step')).toStrictEqual([]);
    expect(find(d.effects, 'draw')).toStrictEqual([]);
    expect(d.model.stage).toBe(s.total === 4 ? 'finished' : 'phase-1');
    // The controls now cover 0..4: the last round is held and is drawn at once.
    d.log.length = 0;
    await d.feed({ type: 'navigate', at: 9, action: 'last' });
    expect(d.model.displayed).toBe(4);
    expect(find(d.effects, 'draw').map((e) => e.round)).toStrictEqual([4]);
  });

  it('FR-304 a digest that differs reads the state from the server and changes the picture at once', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    d.log.length = 0;
    d.corrupt = true;
    await d.events(eventsOfRound(s, 3));
    expect(requestRounds(d.effects)).toStrictEqual([3]);
    expect(find(d.effects, 'play-step')).toStrictEqual([]);
    expect(find(d.effects, 'draw').map((e) => e.round)).toStrictEqual([3]);
    expect(d.model.applied).toBe(3);
    expect(d.model.displayed).toBe(3);
    expect(ownersAt(d.model, 3)).toStrictEqual(pairs(s, 3));
    expect(d.log.find((x) => x.effect.type === 'read-state')?.applied).toBe(3);
  });

  it('FR-304 a record that lists a territory the eliminated faction does not own is a mismatch: no hashing, the state is read', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    d.log.length = 0;
    const events = eventsOfRound(s, 3) as Record<string, any>[];
    const applied = events[5] as { record: RecordReply };
    const rec = s.records[2] as RecordReply;
    const stranger = (s.states[2] as [number, number][]).find((p) => p[1] !== rec.eliminated)![0];
    applied.record = { ...applied.record, transferred: [...rec.transferred, stranger] };
    await d.events(events);
    expect(find(d.effects, 'hash-state')).toStrictEqual([]);
    expect(requestRounds(d.effects)).toStrictEqual([3]);
    expect(find(d.effects, 'play-step')).toStrictEqual([]);
    expect(ownersAt(d.model, 3)).toStrictEqual(pairs(s, 3));
  });

  it('FR-289 (d) (client order) duplicates and overlaps change nothing', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    await d.events(eventsFrom(s, 2, 3));
    const after = d.model;
    const n = d.log.length;
    // The same events again, and a replay starting inside round 2.
    await d.events(eventsFrom(s, 2, 3));
    await d.events(eventsFrom(s, 2, 3).slice(5));
    expect(d.log.length).toBe(n);
    expect(d.model).toStrictEqual(after);
    expect(d.model.lastSeq).toBe(lastSeqAt(3));
  });

  it('FR-289 (d) (client order) a gap closes the stream and reads the public data again', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    d.log.length = 0;
    const events = eventsOfRound(s, 2);
    await d.events([events[0], events[2]]);
    expect(d.effects).toStrictEqual([{ type: 'close-stream' }, { type: 'read-public' }]);
    expect(d.model.phase).toBe('resyncing');
    expect(d.model.lastSeq).toBe(seqOfRound(2));
    // Frames of the old stream are dropped while resyncing; the new public data rebuilds the model and subscribes again.
    await d.events([events[3]]);
    expect(d.model.lastSeq).toBe(seqOfRound(2));
    d.log.length = 0;
    await d.load(3);
    expect(d.model.phase).toBe('live');
    expect(d.model.applied).toBe(3);
    expect(d.model.displayed).toBe(3);
    expect(find(d.effects, 'open-stream')).toStrictEqual([{ type: 'open-stream', after: lastSeqAt(3) }]);
    expect(find(d.effects, 'draw').map((e) => e.round)).toStrictEqual([3]);
  });

  it('FR-289 (d) (client order) a round-applied of another round gives a resync', async () => {
    const s = await scripted();
    for (const wrong of [1, 3, 5]) {
      const d = new Driver(s);
      await d.load(1);
      d.log.length = 0;
      const e = eventsOfRound(s, 2)[5] as Record<string, any>;
      await d.events([...eventsOfRound(s, 2).slice(0, 5), json({ type: 'round-applied', seq: e.seq, round: wrong, record: { ...e.record, round: wrong }, stateDigest: e.stateDigest, appliedAt: 1 })]);
      expect(d.effects.slice(-2), String(wrong)).toStrictEqual([{ type: 'close-stream' }, { type: 'read-public' }]);
      expect(d.model.applied).toBe(1);
    }
  });

  it('FR-289 (d) (client order) a refused known event gives a resync; an unknown type is consumed by its number', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    d.log.length = 0;
    await d.events([{ type: 'novelty', seq: seqOfRound(2), what: ['ever'] }]);
    expect(d.model.lastSeq).toBe(seqOfRound(2));
    expect(d.effects).toStrictEqual([]);
    expect(d.model.phase).toBe('live');
    const bad = { ...(eventsOfRound(s, 2)[1] as object), seq: seqOfRound(2) + 1, victim: 'x' };
    await d.events([bad]);
    expect(d.effects).toStrictEqual([{ type: 'close-stream' }, { type: 'read-public' }]);
    const d2 = new Driver(s);
    await d2.load(1);
    d2.log.length = 0;
    await d2.events([{ type: 'novelty' }]);
    expect(d2.effects).toStrictEqual([{ type: 'close-stream' }, { type: 'read-public' }]);
  });

  it('FR-289 (d) (client order) frames that arrive while a round is being checked are handled in order after the digest', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.defer = true;
    await d.load(0);
    // A burst of rounds 1 and 2 before any digest comes back.
    await d.events(eventsFrom(s, 1, 2));
    expect(d.model.applied).toBe(0);
    expect(d.model.queue.length).toBeGreaterThan(0);
    expect(d.model.lastSeq).toBe(seqOfRound(1) + 5);
    await d.resolve();
    expect(d.model.applied).toBe(1);
    expect(d.model.applying?.round).toBe(2);
    await d.resolve();
    expect(d.model.applied).toBe(2);
    expect(d.model.queue).toStrictEqual([]);
    expect(d.model.lastSeq).toBe(lastSeqAt(2));
    expect(find(d.effects, 'play-step').map((e) => [e.from, e.to])).toStrictEqual([[0, 1], [1, 2]]);
    expect(ownersAt(d.model, 2)).toStrictEqual(pairs(s, 2));
  });

  it('FR-289 (d) (client order) a duplicate or a gap among the waiting frames is handled when it arrives', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.defer = true;
    await d.load(0);
    const all = eventsFrom(s, 1, 2);
    await d.events(all.slice(0, 7)); // up to results of round 1 (round-applied is the 6th)
    const queued = d.model.queue.length;
    await d.events([all[6]]); // duplicate of a waiting frame
    expect(d.model.queue.length).toBe(queued);
    await d.events([all[9]]); // a gap among the waiting frames
    expect(d.model.phase).toBe('resyncing');
    expect(d.model.queue).toStrictEqual([]);
    expect(d.model.applying).toBeUndefined();
  });
});

describe('FR-303 the panel fields follow the events', () => {
  it('FR-303 victim-revealed sets the victim fields, schedule sets the stage, round-applied clears the victim', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    const events = eventsOfRound(s, 2);
    const rec = s.records[1] as RecordReply;
    await d.events(events.slice(0, 2));
    expect(d.model.victim).toStrictEqual({
      round: 2, victim: rec.eliminated, candidates: [rec.absorber], living: s.living[1], revealedAt: 5200, c2: null, a: null, seq: seqOfRound(2) + 1,
    });
    await d.events(events.slice(2, 3));
    expect(d.model.stage).toBe('phase-2');
    await d.events(events.slice(3, 5));
    expect(d.model.stage).toBe('locked');
    expect(d.model.victim?.victim).toBe(rec.eliminated);
    await d.events(events.slice(5, 8));
    expect(d.model.victim).toBeUndefined();
    expect(d.model.stage).toBe('phase-1');
    expect(d.model.lastSeq).toBe(lastSeqAt(2));
  });

  it('FR-303 a victim-revealed of another round gives a resync', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    d.log.length = 0;
    const e = eventsOfRound(s, 2)[1] as Record<string, any>;
    await d.events([eventsOfRound(s, 2)[0], { ...e, round: 5 }]);
    expect(d.effects).toStrictEqual([{ type: 'close-stream' }, { type: 'read-public' }]);
  });

  it('FR-303 the schedule of a clock match comes from the schedule event', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    const event = json({ type: 'schedule', seq: seqOfRound(2), stage: 'phase-1', schedule: { c1: 10, c2: 20, a: 30 }, reportedTime: 9000 });
    await d.events([event]);
    expect(d.model.schedule).toStrictEqual({ c1: 10, c2: 20, a: 30 });
    expect(d.model.stage).toBe('phase-1');
  });

  it('FR-303 match-finished sets the winner, closes the stream and later frames change nothing', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(s.total - 1);
    d.log.length = 0;
    await d.events(eventsOfRound(s, s.total));
    expect(d.model.stage).toBe('finished');
    expect(d.model.winner).toBe((s.records[s.total - 1] as RecordReply).absorber);
    expect(d.model.phase).toBe('closed');
    expect(d.model.applied).toBe(s.total);
    expect(find(d.effects, 'close-stream')).toHaveLength(1);
    const frozen = d.model;
    await d.events([json({ type: 'results', seq: lastSeqAt(s.total) + 1, round: 1, phase: 1 })]);
    expect(d.model).toBe(frozen);
  });

  it('FR-303 match-halted sets the reason and keeps the victim revealed before the halt', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    d.log.length = 0;
    const events = eventsOfRound(s, 2);
    await d.events(events.slice(0, 2));
    const victim = d.model.victim;
    expect(victim).toBeDefined();
    await d.events([json({ type: 'match-halted', seq: seqOfRound(2) + 2, round: 2, reason: 'victim-mismatch', reportedTime: 9999 })]);
    expect(d.model.stage).toBe('halted');
    expect(d.model.haltReason).toBe('victim-mismatch');
    expect(d.model.victim).toBe(victim);
    expect(d.model.phase).toBe('closed');
    expect(d.model.applied).toBe(1);
    expect(find(d.effects, 'close-stream')).toHaveLength(1);
  });

  it('FR-303 the reported-time estimate never decreases, whatever order the reported times arrive in', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(0);
    let last = estimateAt(d.model, d.at);
    const stale = (seq: number, time: number): unknown => json({ type: 'schedule', seq, stage: 'phase-1', reportedTime: time });
    const times = [9000, 100, 9500, 5, 20_000, 19_000, 19_999, 40_000];
    for (let i = 0; i < times.length; i++) {
      d.at += 13;
      await d.feed({ type: 'event', at: d.at, data: stale(d.model.lastSeq + 1, times[i] as number) });
      const now = estimateAt(d.model, d.at);
      expect(now, `step ${i}`).toBeGreaterThanOrEqual(last);
      last = now;
      // And later instants only move forward.
      expect(estimateAt(d.model, d.at + 1000)).toBe(now + 1000);
    }
    expect(d.model.reported.value).toBe(40_000);
  });
});

describe('FR-304 browsing reads only the rounds up to N', () => {
  it('FR-304 stepping back reads the earlier state and the record of the later round, then plays the step backwards', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(4);
    d.log.length = 0;
    await d.feed({ type: 'navigate', at: 1, action: 'previous' });
    expect(requestRounds(d.effects).sort()).toStrictEqual([3, 4]);
    const step = find(d.effects, 'play-step')[0]!;
    expect([step.from, step.to]).toStrictEqual([4, 3]);
    expect([...step.data.earlier]).toStrictEqual(pairs(s, 3));
    expect([...step.data.later]).toStrictEqual(pairs(s, 4));
    expect(d.model.displayed).toBe(3);
    // Going forward again reuses everything held: no request.
    d.log.length = 0;
    await d.feed({ type: 'navigate', at: 2, action: 'next' });
    expect(requestRounds(d.effects)).toStrictEqual([]);
    expect(find(d.effects, 'play-step').map((e) => [e.from, e.to])).toStrictEqual([[3, 4]]);
  });

  it('FR-304 a jump is an instant change and asks for the target state only', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(4);
    d.log.length = 0;
    await d.feed({ type: 'navigate', at: 1, action: 'first' });
    expect(requestRounds(d.effects)).toStrictEqual([0]);
    expect(find(d.effects, 'draw').map((e) => e.round)).toStrictEqual([0]);
    expect(d.model.displayed).toBe(0);
    await d.feed({ type: 'navigate', at: 2, action: { to: 2 } });
    expect(d.model.displayed).toBe(2);
  });

  it('FR-304 an action out of 0..N changes nothing and sends no request', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(2);
    d.log.length = 0;
    const before = d.model;
    for (const action of ['next', { to: 3 }, { to: -1 }, { to: 1.5 }] as const) await d.feed({ type: 'navigate', at: 1, action });
    expect(d.model).toBe(before);
    expect(d.log).toStrictEqual([]);
    await d.feed({ type: 'navigate', at: 1, action: 'last' });
    expect(d.model).toBe(before);
  });

  it('FR-304 asking twice for the same target while the reads are out sends them once', async () => {
    const s = await scripted();
    const m0 = new Driver(s);
    await m0.load(4);
    const first = reduce(m0.model, { type: 'navigate', at: 1, action: 'first' });
    const again = reduce(first.model, { type: 'navigate', at: 2, action: 'first' });
    expect(first.effects).toStrictEqual([{ type: 'read-state', round: 0 }]);
    expect(again.effects).toStrictEqual([]);
    // A late read of a round above N is dropped.
    const late = reduce(again.model, { type: 'state', at: 3, reply: { ...stateReply(s, 1), round: 5 } });
    expect(late.model.held.has(5)).toBe(false);
    const lateRecord = reduce(again.model, { type: 'record', at: 3, reply: { ...recordReply(s, 1), round: 5 } });
    expect(lateRecord.model.records.has(5)).toBe(false);
  });

  it('FR-254 (client requests) over a whole match, for every replay pattern, no request or effect names a round above the N of that moment', async () => {
    const s = await scripted();
    const patterns: Record<string, (d: Driver) => Promise<void>> = {
      'from 0 to T': async (d) => {
        await d.load(0);
        await d.events(eventsFrom(s, 1, s.total));
      },
      'joined in the middle': async (d) => {
        await d.load(2);
        await d.events(eventsFrom(s, 3, s.total));
      },
      'browsing back and forth while rounds arrive': async (d) => {
        await d.load(1);
        for (let k = 2; k <= s.total; k++) {
          await d.events(eventsOfRound(s, k));
          await d.feed({ type: 'navigate', at: d.at, action: 'first' });
          await d.feed({ type: 'navigate', at: d.at, action: 'previous' });
          await d.feed({ type: 'navigate', at: d.at, action: 'next' });
          await d.feed({ type: 'navigate', at: d.at, action: 'last' });
        }
      },
      'with overlaps': async (d) => {
        await d.load(0);
        for (let k = 1; k <= s.total; k++) {
          await d.events(eventsOfRound(s, k));
          await d.events(eventsFrom(s, Math.max(1, k - 1), k));
        }
      },
      'with a corrupt digest': async (d) => {
        await d.load(0);
        d.corrupt = true;
        await d.events(eventsFrom(s, 1, s.total));
      },
      'with a resync in the middle': async (d) => {
        await d.load(0);
        await d.events(eventsFrom(s, 1, 2));
        await d.events([eventsOfRound(s, 3)[0], eventsOfRound(s, 3)[3]]);
        await d.load(3);
        await d.events(eventsFrom(s, 4, s.total));
      },
      'with a burst before the digests': async (d) => {
        d.defer = true;
        await d.load(0);
        await d.events(eventsFrom(s, 1, s.total));
        for (let k = 1; k <= s.total; k++) await d.resolve();
      },
    };
    for (const [name, run] of Object.entries(patterns)) {
      const d = new Driver(s);
      await run(d);
      expect(d.log.length, name).toBeGreaterThan(0);
      for (const { effect, applied } of d.log) {
        if (effect.type === 'read-state' || effect.type === 'read-record') expect(effect.round, `${name}: ${effect.type}`).toBeLessThanOrEqual(applied);
        if (effect.type === 'draw') expect(effect.round, `${name}: draw`).toBeLessThanOrEqual(applied);
        if (effect.type === 'play-step') expect(Math.max(effect.from, effect.to), `${name}: play-step`).toBeLessThanOrEqual(applied);
      }
      for (const round of [...d.model.held.keys(), ...d.model.records.keys()]) expect(round, name).toBeLessThanOrEqual(d.model.applied);
      expect(d.model.applied, name).toBe(s.total);
      expect(ownersAt(d.model, s.total), name).toStrictEqual(pairs(s, s.total));
    }
  });

  it('FR-304 the model has no field for an absorber or a state beyond N (type-level key list)', async () => {
    // Adding a key to LiveModel makes this record fail to compile until the key is listed (and reviewed) here.
    const KEYS: Record<keyof LiveModel, true> = {
      matchId: true, mapDigest: true, totalRounds: true, timing: true, stage: true, applied: true, held: true, records: true,
      displayed: true, wanted: true, lastSeq: true, reported: true, schedule: true, victim: true, winner: true, haltReason: true,
      applying: true, queue: true, phase: true,
    };
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    expect(Object.keys(d.model).sort()).toStrictEqual(Object.keys(KEYS).sort());
    for (const key of Object.keys(KEYS)) expect(key, key).not.toMatch(/absorber|seed|secret|future|next|pending|later|state/i);
    const checking = new Driver(s);
    checking.defer = true;
    await checking.load(1);
    await checking.events(eventsOfRound(s, 2));
    expect(Object.keys(checking.model.applying!).sort()).toStrictEqual(['digest', 'record', 'round', 'step']);
    // While round N + 1 is being checked the model holds the announced record and digest, never owners for it.
    expect(checking.model.held.has(2)).toBe(false);
  });
});

describe('FR-304 no live module runs the engine', () => {
  const live = import.meta.glob('../src/core/live-*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const SPECIFIER = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
  const imports = (src: string): string[] => [...src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').matchAll(SPECIFIER)].map((m) => (m[2] ?? m[4]) as string);

  it('FR-304 the scan sees the live core modules, including the model and the rounds', () => {
    const names = Object.keys(live).map((p) => p.replace('../src/core/', '')).sort();
    expect(names).toContain('live-model.ts');
    expect(names).toContain('live-rounds.ts');
    expect(names).toContain('live-address.ts');
  });

  it('FR-304 no live module imports the sim, in any form', () => {
    for (const [path, src] of Object.entries(live)) {
      expect(imports(src).filter((s) => /^@mbrg\/sim(\/|$)/.test(s)), path).toStrictEqual([]);
    }
  });

  it('FR-304 the scan flags a planted import of the sim', () => {
    for (const src of [
      "import { getState } from '@mbrg/sim';",
      "import type { MatchState } from '@mbrg/sim';",
      "export { totalRounds } from '@mbrg/sim';",
      "const m = await import('@mbrg/sim');",
      "import { playRoundWithSeed } from '@mbrg/sim/src/exports';",
    ]) {
      expect(imports(src).filter((s) => /^@mbrg\/sim(\/|$)/.test(s)), src).not.toStrictEqual([]);
    }
    expect(imports("// import x from '@mbrg/sim'\nimport y from './y';")).toStrictEqual(['./y']);
  });
});
