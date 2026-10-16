// Frame time statistics for the debug panel (FR-158). Pure: the caller measures, this only summarises.

/** Number of most recent frame intervals the statistics cover. */
export const FRAME_WINDOW = 120;

export interface FrameStats {
  /** Number of samples used (0 to FRAME_WINDOW). */
  count: number;
  /** Median frame time in milliseconds (mean of the two middle samples for an even count). */
  median: number;
  /** 95th percentile by the nearest-rank rule: the sample at rank ceil(0.95 x count). */
  p95: number;
}

/** Appends one sample and keeps only the most recent FRAME_WINDOW; returns a new array. */
export function appendSample(samples: readonly number[], ms: number): number[] {
  const next = [...samples, ms];
  return next.length > FRAME_WINDOW ? next.slice(next.length - FRAME_WINDOW) : next;
}

/** Median and 95th percentile of the last FRAME_WINDOW samples; all zero when there are none. */
export function frameStats(samples: readonly number[]): FrameStats {
  const recent = samples.length > FRAME_WINDOW ? samples.slice(samples.length - FRAME_WINDOW) : samples;
  const count = recent.length;
  if (count === 0) return { count: 0, median: 0, p95: 0 };
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = count >> 1;
  const median = count % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const p95 = sorted[Math.ceil(0.95 * count) - 1]!;
  return { count, median, p95 };
}
