import type { StreamTarget } from '../../src/http/streams';
import type { FakeClock } from './fake-clock';

/** A response as the stream hub sees it: records the head, every write with the clock reading, and the end or destroy. */
export class FakeResponse implements StreamTarget {
  head: { status: number; headers: Record<string, string> } | undefined;
  flushed = 0;
  /** Every write, in order, with the fake clock reading of the moment. */
  readonly writes: { at: number; chunk: string }[] = [];
  ended = 0;
  destroyed = 0;
  writableLength = 0;
  /** When set, `write` throws this after the call count below. */
  throwOnWrite: Error | undefined;
  private readonly handlers = new Map<string, (() => void)[]>();

  constructor(private readonly clock: FakeClock) {}

  writeHead(status: number, headers: Record<string, string>): void {
    this.head = { status, headers };
  }
  flushHeaders(): void {
    this.flushed += 1;
  }
  write(chunk: string): boolean {
    if (this.throwOnWrite !== undefined) throw this.throwOnWrite;
    this.writes.push({ at: this.clock.now(), chunk });
    return true;
  }
  end(): void {
    this.ended += 1;
  }
  destroy(): void {
    this.destroyed += 1;
  }
  on(event: 'close' | 'error', listener: () => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
  }
  emit(event: 'close' | 'error'): void {
    for (const listener of this.handlers.get(event) ?? []) listener();
  }

  /** The text written, in order. */
  get text(): string {
    return this.writes.map((w) => w.chunk).join('');
  }
  get chunks(): string[] {
    return this.writes.map((w) => w.chunk);
  }
}
