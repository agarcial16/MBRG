import { describe, expect, it } from 'vitest';
import { createSseParser, type SseFrame } from '../src/core/live-sse';
import { eventsFrom, scripted } from './helpers/scripted-match';

/** The stream text of the server: one `id:` + `data:` frame per event, a comment (heartbeat) between some of them. */
function recordedStream(events: readonly unknown[]): { text: string; frames: SseFrame[] } {
  let text = '';
  const frames: SseFrame[] = [];
  events.forEach((event, i) => {
    const data = JSON.stringify(event);
    const id = String((event as { seq: number }).seq);
    text += `id: ${id}\ndata: ${data}\n\n`;
    frames.push({ id, data });
    if (i % 3 === 1) text += ': heartbeat\n\n';
  });
  return { text, frames };
}

const parseAll = (chunks: readonly string[]): SseFrame[] => {
  const parser = createSseParser();
  return chunks.flatMap((c) => parser.push(c));
};

describe('FR-289 (d) (frame parser) the event stream is cut into frames', () => {
  it('FR-289 (d) (frame parser) a recorded stream gives the same frames split at every byte, with LF, CRLF and CR endings', async () => {
    const s = await scripted();
    const { text, frames } = recordedStream(eventsFrom(s, 1, 2));
    expect(frames.length).toBeGreaterThan(10);
    for (const [name, ending] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']] as const) {
      const stream = text.replace(/\n/g, ending);
      expect(parseAll([stream]), name).toStrictEqual(frames);
      expect(parseAll([...stream]), `${name} byte by byte`).toStrictEqual(frames);
      // Every two-chunk split: the cut may fall inside a field name, a value, a line ending or between a CR and an LF.
      for (let cut = 0; cut <= stream.length; cut++) {
        expect(parseAll([stream.slice(0, cut), stream.slice(cut)]), `${name} cut at ${cut}`).toStrictEqual(frames);
      }
    }
  });

  it('FR-289 (d) (frame parser) comments, an id without data and unknown fields give no frame', () => {
    const parser = createSseParser();
    expect(parser.push(': heartbeat\n\n')).toStrictEqual([]);
    expect(parser.push('id: 7\n\n')).toStrictEqual([]);
    expect(parser.push('retry: 3000\nevent: x\n\n')).toStrictEqual([]);
    expect(parser.push('id: 8\ndata: {}\n\n')).toStrictEqual([{ id: '8', data: '{}' }]);
    // The id of an earlier block does not leak into the next frame.
    expect(parser.push('data: a\n\n')).toStrictEqual([{ id: undefined, data: 'a' }]);
  });

  it('FR-289 (d) (frame parser) the space after the colon is optional and only one is removed; a field with no colon has an empty value', () => {
    const parser = createSseParser();
    expect(parser.push('data:{"a":1}\n\n')).toStrictEqual([{ id: undefined, data: '{"a":1}' }]);
    expect(parser.push('data:  two spaces\n\n')).toStrictEqual([{ id: undefined, data: ' two spaces' }]);
    expect(parser.push('data\n\n')).toStrictEqual([{ id: undefined, data: '' }]);
    expect(parser.push('id\ndata: x\n\n')).toStrictEqual([{ id: '', data: 'x' }]);
  });

  it('FR-289 (d) (frame parser) several data lines of one frame are joined with a line feed', () => {
    const parser = createSseParser();
    expect(parser.push('id: 1\ndata: first\ndata: second\ndata:\n\n')).toStrictEqual([{ id: '1', data: 'first\nsecond\n' }]);
  });

  it('FR-289 (d) (frame parser) a frame is given only when its blank line has arrived', () => {
    const parser = createSseParser();
    expect(parser.push('id: 4\ndata: {"seq":4}\n')).toStrictEqual([]);
    expect(parser.push('\n')).toStrictEqual([{ id: '4', data: '{"seq":4}' }]);
    expect(parser.push('id: 5\r')).toStrictEqual([]);
    expect(parser.push('\ndata: x\r\n')).toStrictEqual([]);
    expect(parser.push('\r\n')).toStrictEqual([{ id: '5', data: 'x' }]);
  });

  it('FR-289 (d) (frame parser) a byte order mark at the start of the stream is dropped', () => {
    expect(parseAll(['﻿id: 1\ndata: z\n\n'])).toStrictEqual([{ id: '1', data: 'z' }]);
    expect(parseAll(['﻿', 'id: 1\ndata: z\n\n'])).toStrictEqual([{ id: '1', data: 'z' }]);
  });

  it('FR-289 (d) (frame parser) frames come out in order and independent parsers share nothing', () => {
    const a = createSseParser();
    const b = createSseParser();
    a.push('id: 1\ndata: partial');
    expect(b.push('\n\n')).toStrictEqual([]);
    expect(a.push('\n\nid: 2\ndata: second\n\n')).toStrictEqual([{ id: '1', data: 'partial' }, { id: '2', data: 'second' }]);
  });
});
