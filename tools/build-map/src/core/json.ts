/**
 * FR-125: the fixed JSON text of the map and the presentation data: two-space indentation, one
 * object field or list element per line, empty lists as `[]`, raw UTF-8 (never `\u` escapes for
 * printable text), no byte order mark, LF line endings and one final newline. Key order is the
 * order the value's objects were built in (the callers build them in the FR-125 order); numbers
 * are plain integers. Pure: the same value always gives the same bytes (NFR-14).
 */
export function formatJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
}
