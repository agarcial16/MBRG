// An incremental parser of the server's event stream (FR-289 (d) client; plan 21.2). Pure: it takes decoded text in chunks of
// any size and gives the frames whose blank line has arrived. Lines end with LF, CRLF or CR; a line starting with a colon (a
// heartbeat) and the fields other than `id` and `data` are ignored; a block with no `data` line gives no frame.

/** One event: the `id` field of its block (undefined when absent) and its `data` lines joined with a line feed. */
export interface SseFrame {
  readonly id: string | undefined;
  readonly data: string;
}

export interface SseParser {
  /** Feeds the next chunk of text and returns the frames it completed, in order. */
  push(chunk: string): SseFrame[];
}

export function createSseParser(): SseParser {
  let line = '';
  let atStart = true;
  let skipLf = false;
  let id: string | undefined;
  let data: string | undefined;

  const field = (text: string): void => {
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const name = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'id') id = value;
    else if (name === 'data') data = data === undefined ? value : `${data}\n${value}`;
  };

  return {
    push(chunk) {
      const frames: SseFrame[] = [];
      for (const ch of chunk) {
        if (atStart) {
          atStart = false;
          if (ch.charCodeAt(0) === 0xfeff) continue;
        }
        if (skipLf) {
          skipLf = false;
          if (ch === '\n') continue;
        }
        if (ch !== '\r' && ch !== '\n') {
          line += ch;
          continue;
        }
        skipLf = ch === '\r';
        if (line !== '') {
          field(line);
          line = '';
        } else {
          if (data !== undefined) frames.push({ id, data });
          id = undefined;
          data = undefined;
        }
      }
      return frames;
    },
  };
}
