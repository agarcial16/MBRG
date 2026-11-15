// An incremental parser of the server's event stream (spec 012 FR-459, FR-460). Pure: decoded text in chunks of any size, the
// frames whose blank line has arrived out. Lines end with LF, CRLF or CR; a line starting with a colon (a heartbeat) and any field
// other than `id` and `data` are ignored; a block with no `data` line gives no frame.

export interface SseFrame {
  readonly id: string | undefined;
  readonly data: string;
}

export interface SseParser {
  push(chunk: string): SseFrame[];
}

export function createSseParser(): SseParser {
  let line = '';
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
