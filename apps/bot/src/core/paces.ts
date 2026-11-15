// The timing of each pace inside the server's public bounds (spec 012 FR-451). Same rule as the web client's create screen:
// `fast` is the shortest timing the server allows, the others are their target lifted to the bounds. Pure.
import type { PublicConfig } from '@mbrg/protocol';
import type { Pace } from './model';

export const PACES: readonly Pace[] = ['fast', 'normal', 'slow'];
export const isPace = (text: string): text is Pace => (PACES as readonly string[]).includes(text);

export interface PaceTiming {
  readonly i: number;
  readonly l1: number;
  readonly l2: number;
}

const TARGETS: Readonly<Record<Exclude<Pace, 'fast'>, PaceTiming>> = {
  normal: { i: 60, l1: 30, l2: 5 },
  slow: { i: 300, l1: 150, l2: 5 },
};

export function paceTiming(pace: Pace, config: PublicConfig): PaceTiming {
  const shortest: PaceTiming = { i: config.minInterval, l1: config.minPhase1, l2: config.minPhase2 };
  if (pace === 'fast') return shortest;
  const target = TARGETS[pace];
  const l1 = Math.max(target.l1, config.minPhase1);
  const l2 = Math.max(target.l2, config.minPhase2);
  const i = Math.min(config.maxInterval, Math.max(target.i, config.minInterval, l1 + l2 + 1));
  return i > l1 + l2 ? { i, l1, l2 } : shortest;
}
