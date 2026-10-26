/**
 * mulberry32: small, fast, deterministic 32-bit PRNG.
 *
 * HARD RULE: the simulation must NEVER use `Math.random()` or `Date.now()`.
 * Determinism is what makes matches shareable (seed), precomputable
 * (round-by-round reveal for Discord) and forkable (influence abilities).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new Error(`Rng seed must be an integer, got ${String(seed)}`);
    }
    this.state = seed >>> 0;
  }

  /** Raw 32-bit draw. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      throw new Error(`Invalid integer range [${min}, ${maxExclusive})`);
    }
    return min + Math.floor(this.float() * (maxExclusive - min));
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[this.int(0, items.length)];
  }

  /** Index chosen with probability proportional to the weights (>= 0, sum > 0). */
  weightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) {
      throw new Error('Cannot pick from empty weights');
    }
    let total = 0;
    for (const w of weights) {
      if (!Number.isFinite(w) || w < 0) {
        throw new Error(`Invalid weight: ${String(w)}`);
      }
      total += w;
    }
    if (total <= 0) {
      throw new Error('Weights must sum to more than 0');
    }
    let roll = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return weights.length - 1; // float rounding safety net
  }

  /** Current internal state (uint32) — persist it to resume or fork a match. */
  snapshot(): number {
    return this.state >>> 0;
  }
}
