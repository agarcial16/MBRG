import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { HEARTBEAT_FRAME, HEARTBEAT_MS, STREAM_BUFFER_LIMIT, STREAM_RETRY_SECONDS, frameOf, readStreamStart } from '../src/http/sse';
import { scriptedMatchEvents } from './helpers/stream-events';

// The pure parts of the event stream (M3b T2): the frame of one event, the heartbeat frame, the constants and the reading
// of the starting number (FR-289 (stream framing), (d), (e), (f)); and the stored events of a scripted dev-map match against
// the event encoder (FR-257 (event encoders)).

describe('http sse: framing', () => {
  it('FR-289 (stream framing) one frame is `id: <seq>`, `data: <json>` and a blank line, nothing else', () => {
    expect(frameOf(41, '{"a":1}')).toBe('id: 41\ndata: {"a":1}\n\n');
    expect(frameOf(1, '{}')).toBe('id: 1\ndata: {}\n\n');
    expect(frameOf(Number.MAX_SAFE_INTEGER, '{}')).toBe(`id: ${Number.MAX_SAFE_INTEGER}\ndata: {}\n\n`);
    const frame = frameOf(7, encodeEvent({ type: 'results', seq: 7, round: 1, phase: 2 }));
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.slice(0, -2).split('\n')).toHaveLength(2);
    expect(frame).not.toMatch(/event:|retry:/);
  });

  it('FR-289 (stream framing) a json holding CR or LF is refused, and so is a number that is not a whole number from 1', () => {
    for (const json of ['{"a":\n1}', '{"a":\r1}', '\n', '\r\n{}', '{}\n']) expect(() => frameOf(1, json), JSON.stringify(json)).toThrow(RangeError);
    for (const seq of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => frameOf(seq, '{}'), String(seq)).toThrow(RangeError);
  });

  it('FR-289 (f) the heartbeat frame is the comment `:` and a blank line: no id, no data', () => {
    expect(HEARTBEAT_FRAME).toBe(':\n\n');
    expect(HEARTBEAT_FRAME).not.toMatch(/id:|data:/);
  });

  it('FR-289 (f) the heartbeat interval keeps the 15 s bound with a margin, the retry wait is one interval, the buffer limit is 1 MiB', () => {
    expect(HEARTBEAT_MS).toBe(14_000);
    expect(STREAM_RETRY_SECONDS).toBe(15);
    expect(STREAM_BUFFER_LIMIT).toBe(1_048_576);
  });

  it('FR-257 (event encoders) every event a scripted dev-map match stores is framed and reads back equal', () => {
    const events = scriptedMatchEvents();
    expect(events.length).toBeGreaterThan(30);
    expect(new Set(events.map((e) => e.type))).toStrictEqual(new Set(['phase-closed', 'victim-revealed', 'round-applied', 'results', 'schedule', 'match-finished', 'match-halted']));
    for (const event of events) {
      const json = encodeEvent(event);
      expect(JSON.parse(json), `${event.type} ${event.seq}`).toStrictEqual(event);
      expect(frameOf(event.seq, json)).toBe(`id: ${event.seq}\ndata: ${json}\n\n`);
    }
  });
});

describe('http sse: the starting number', () => {
  const live = { kind: 'live' };
  const after = (n: number) => ({ kind: 'after', after: n });

  it('FR-289 (e) neither the header nor the parameter means live events only', () => {
    expect(readStreamStart(undefined, undefined)).toStrictEqual(live);
    expect(readStreamStart([], undefined)).toStrictEqual(live);
  });

  it('FR-289 (d) the header alone, the parameter alone: the number is the last one received', () => {
    expect(readStreamStart(['41'], undefined)).toStrictEqual(after(41));
    expect(readStreamStart(undefined, '41')).toStrictEqual(after(41));
    expect(readStreamStart(['0'], undefined)).toStrictEqual(after(0));
    expect(readStreamStart(undefined, '0')).toStrictEqual(after(0));
    expect(readStreamStart(undefined, '12345678901')).toStrictEqual(after(12_345_678_901));
  });

  it('FR-289 (d) when both are given the header wins, even over an invalid parameter', () => {
    expect(readStreamStart(['5'], '9')).toStrictEqual(after(5));
    expect(readStreamStart(['0'], '9')).toStrictEqual(after(0));
    expect(readStreamStart(['5'], 'abc')).toStrictEqual(after(5));
  });

  it('FR-289 (d) a header that is invalid is not rescued by a valid parameter', () => {
    expect(readStreamStart(['01'], '9')).toStrictEqual({ kind: 'invalid', field: 'Last-Event-ID' });
  });

  it('FR-289 (d) 2^53 - 1 is a number, one more is beyond (no event will ever be later)', () => {
    expect(readStreamStart([String(Number.MAX_SAFE_INTEGER)], undefined)).toStrictEqual(after(Number.MAX_SAFE_INTEGER));
    expect(readStreamStart(undefined, String(Number.MAX_SAFE_INTEGER))).toStrictEqual(after(Number.MAX_SAFE_INTEGER));
    expect(readStreamStart(['9007199254740992'], undefined)).toStrictEqual({ kind: 'beyond' });
    expect(readStreamStart(undefined, '9007199254740992')).toStrictEqual({ kind: 'beyond' });
    expect(readStreamStart(undefined, '9'.repeat(400))).toStrictEqual({ kind: 'beyond' });
  });

  it('FR-289 (d) a sign, a leading zero, a fraction, an exponent, an empty or padded text, a hex or a non-ASCII digit is invalid and names the field', () => {
    for (const bad of ['-1', '+1', '01', '00', '1.5', '1e3', '', ' 1', '1 ', '0x10', 'abc', '١', '１', '1,2', '1\n']) {
      expect(readStreamStart([bad], undefined), `header ${JSON.stringify(bad)}`).toStrictEqual({ kind: 'invalid', field: 'Last-Event-ID' });
      expect(readStreamStart(undefined, bad), `parameter ${JSON.stringify(bad)}`).toStrictEqual({ kind: 'invalid', field: 'lastEventId' });
    }
  });

  it('FR-289 (d) two header values are invalid', () => {
    expect(readStreamStart(['1', '2'], undefined)).toStrictEqual({ kind: 'invalid', field: 'Last-Event-ID' });
    expect(readStreamStart(['1', '1'], '3')).toStrictEqual({ kind: 'invalid', field: 'Last-Event-ID' });
  });
});
