// The only clock reads of the viewer (NFR-25), for the debug panel timings (FR-158).

/** Milliseconds since the page started (the time origin of the page). */
export function now(): number {
  return performance.now();
}
