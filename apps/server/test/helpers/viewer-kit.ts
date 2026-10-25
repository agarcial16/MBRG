import type { PublicMatch } from '@mbrg/protocol';
import type { LiveModel } from '../../../web/src/core/live-model';
import { createLiveNet } from '../../../web/src/ui/live-net';
import type { FetchLike } from '../../../web/src/ui/live-net';
import { startRunner } from '../../../web/src/ui/live-runner';
import type { LivePort, LiveRunner } from '../../../web/src/ui/live-runner';

// The viewer core against the real server (spec 008 H6): the viewer's pure model, transport and runner imported by relative
// path, driven with Node's `fetch` over the real listener, a manual clock for the runner's timers and a recording scene.

/** A manual clock and scheduler: the runner's timers fire only when the test advances time. */
export class ManualClock {
  time = 10_000;
  private timers: { at: number; fn: () => void; live: boolean }[] = [];
  readonly now = (): number => this.time;
  readonly after = (ms: number, fn: () => void): (() => void) => {
    const timer = { at: this.time + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  active(): number {
    return this.timers.filter((t) => t.live).length;
  }
  /** Fires every timer due within `ms`, in order. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.live = false;
      this.time = Math.max(this.time, due.at);
      due.fn();
      await pause(20);
    }
    this.time = target;
  }
}

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` holds (real time), or throws naming `what`. */
export async function until(check: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(10);
  }
}

/** A scene that records what the runner tells it. */
export class RecordingScene implements LivePort {
  opens = 0;
  draws: number[] = [];
  steps: { from: number; to: number }[] = [];
  failures: string[] = [];
  /** The round the address asks for; default N. */
  roundAsked: ((applied: number) => number) | undefined;
  async open(match: PublicMatch): Promise<{ ok: true; round: number }> {
    this.opens++;
    return { ok: true, round: this.roundAsked === undefined ? match.appliedRounds : this.roundAsked(match.appliedRounds) };
  }
  draw(round: number): void {
    this.draws.push(round);
  }
  playStep(from: number, to: number): void {
    this.steps.push({ from, to });
  }
  show(): void {}
  fail(message: string): void {
    this.failures.push(message);
  }
}

export interface Viewer {
  readonly runner: LiveRunner;
  readonly scene: RecordingScene;
  readonly clock: ManualClock;
  /** Every request the viewer sent: the URL, the headers and the N of the model when it was sent. */
  readonly requests: { url: string; headers: Record<string, string>; applied: number }[];
  readonly model: () => LiveModel;
}

export interface ViewerOptions {
  readonly port: number;
  readonly matchId: string;
  readonly scene?: RecordingScene;
  /** Wraps the `fetch` the viewer uses (a gate that holds a request, for example). */
  readonly wrap?: (inner: FetchLike) => FetchLike;
}

/** Starts a viewer on the match: the real net over Node's `fetch`, recorded requests, a manual clock. */
export function startViewer(options: ViewerOptions): Viewer {
  const scene = options.scene ?? new RecordingScene();
  const clock = new ManualClock();
  const requests: Viewer['requests'] = [];
  let runner: LiveRunner | undefined;
  const recording: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    requests.push({ url, headers, applied: runner?.model().applied ?? 0 });
    return fetch(url, init);
  };
  const net = createLiveNet({ base: `http://127.0.0.1:${options.port}`, fetch: options.wrap === undefined ? recording : options.wrap(recording) });
  runner = startRunner({ matchId: options.matchId, net, port: scene, now: clock.now, after: clock.after });
  const started = runner;
  return { runner: started, scene, clock, requests, model: () => started.model() };
}
