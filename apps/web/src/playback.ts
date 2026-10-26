import type { MapFormatV1, MatchState, Ownership } from '@mbrg/shared';
import { simulate } from '@mbrg/sim';

/**
 * Playback state for a precomputed match.
 * `current` is 0 for the initial state and k after k rounds.
 * Subscribers are notified on every visible change (round, play state, speed…).
 */
export class Playback {
  readonly map: MapFormatV1;
  match: MatchState;
  readonly initialOwners: Ownership;
  current = 0;
  playing = false;
  speedMs = 500;

  private timer: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(map: MapFormatV1, seed: number) {
    this.map = map;
    this.match = simulate(map, { seed });
    const owners: Ownership = {};
    for (const t of map.territories) owners[t.id] = t.id;
    this.initialOwners = owners;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get totalRounds(): number {
    return this.match.log.length;
  }

  get finished(): boolean {
    return this.current >= this.totalRounds;
  }

  /** Owners shown at the current round (initial identity map at round 0). */
  get owners(): Ownership {
    if (this.current === 0) return this.initialOwners;
    return this.match.log[this.current - 1].owners;
  }

  play(): void {
    if (this.playing) return;
    if (this.finished) this.current = 0; // "play again" when the match is over
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), this.speedMs);
    this.emit();
  }

  pause(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.playing) return;
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(ms: number): void {
    this.speedMs = ms;
    if (this.playing) {
      // Restart the interval so the new speed applies immediately.
      window.clearInterval(this.timer!);
      this.timer = window.setInterval(() => this.tick(), this.speedMs);
    }
    this.emit();
  }

  restart(seed?: number): void {
    this.pause();
    if (seed !== undefined) this.match = simulate(this.map, { seed });
    this.current = 0;
    this.emit();
  }

  private tick(): void {
    if (this.finished) {
      this.pause();
      return;
    }
    this.current++;
    if (this.finished) {
      this.pause(); // emits once more; state is already final
    } else {
      this.emit();
    }
  }
}
