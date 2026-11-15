// The live runner (FR-303 to FR-308, shell): runs the effects of the pure model and feeds their results back. It owns what the
// model must not: the network calls, the single retry timer, the per-second refresh of the panel and the stream. No DOM, no
// WebGL, no clock of its own: the network, the timers, the clock, the hash and the scene (`LivePort`) are injected.
//
// Order guarantees (plan 13, "Runner contract"):
//  - The three map files are read and checked against the announced digest ONCE, before the first `public` input; nothing is
//    drawn until that succeeded. `insecure-origin` and `digest-mismatch` end the scene here, outside the model.
//  - One retry timer with replace semantics: an `arm-timer` effect cancels the pending one; a `tick` with nothing due is harmless.
//  - One stream at a time; a generation counter makes the callbacks of a stale stream ignored.
import type { PublicMatch } from '@mbrg/protocol';
import { reduce, startLive, type AbsorberTour, type LiveEffect, type LiveInput, type LiveModel, type LiveRequest } from '../core/live-model';
import type { Owners } from '../core/live-rounds';
import { errorText } from '../core/live-text';
import { clockDriven } from '../core/live-view';
import type { NavAction } from '../core/navigation';
import type { StepData } from '../core/step';
import type { LiveNet, MapFiles, NetFailure, NetFatal } from './live-net';
import type { After, Cancel } from './live-timer';
import { sha256Hex } from './web-crypto';

/** The scene the runner drives: it draws what it is told and holds no match data of its own. */
export interface LivePort {
  /** Builds the scene from the verified map files; the round to show first (D31) or a message that ends the scene. */
  open(match: PublicMatch, files: MapFiles): Promise<{ readonly ok: true; readonly round: number } | { readonly ok: false; readonly message: string }>;
  draw(round: number, owners: Owners): void;
  /**
   * Plays the step of a round; `tour` is the absorber tour that comes first (FR-345). `at` is the reading of the feed that
   * produced the effect: a tour starts at it (D11), never at a later reading.
   */
  playStep(from: number, to: number, data: StepData, tour: AbsorberTour | undefined, at: number): void;
  /** FR-316: starts the victim tour of a fresh reveal at the reading `at` of the feed (D11). */
  startVictimTour(tour: Extract<LiveEffect, { type: 'victim-tour' }>, at: number): void;
  /** FR-339: completes the running tour at once; it does nothing when none runs. */
  completeTour(at: number): void;
  /** The model changed or a second passed: the panel is shown for the instant `at`. */
  show(model: LiveModel, at: number): void;
  /** The scene ends with one message and draws no map. */
  fail(message: string): void;
}

export interface RunnerDeps {
  readonly matchId: string;
  readonly net: LiveNet;
  readonly port: LivePort;
  /** The monotonic clock of the inputs, in milliseconds. */
  now(): number;
  readonly after: After;
  /** SHA-256 of bytes in lower-case hex; the platform one by default. */
  readonly digest?: (bytes: Uint8Array) => Promise<string>;
  /** Called with the data of each frame of the current stream before the model sees it (the web test client watches for `results`). */
  readonly onFrame?: (data: unknown) => void;
}

export interface LiveRunner {
  navigate(action: NavAction): void;
  /** FR-362: the user asked for the facts that need the records of the earlier rounds; the missing ones are read. */
  requestArchive(): void;
  /** The map view reported a change of the running tour: the panel is shown again at once, with the current model. */
  refreshPanel(): void;
  model(): LiveModel;
  stop(): void;
}

export function startRunner(deps: RunnerDeps): LiveRunner {
  const digest = deps.digest ?? sha256Hex;
  const started = startLive(deps.matchId);
  let model = started.model;
  let stopped = false;
  let verifiedDigest: string | undefined;
  let generation = 0;
  let controller: AbortController | undefined;
  let cancelTimer: Cancel | undefined;
  let cancelRefresh: Cancel | undefined;

  const closeStream = (): void => {
    generation++;
    controller?.abort();
    controller = undefined;
  };
  const stop = (): void => {
    stopped = true;
    closeStream();
    cancelTimer?.();
    cancelRefresh?.();
  };
  const end = (message: string): void => {
    if (stopped) return;
    stop();
    deps.port.fail(message);
  };

  /** A call that threw (a scene that cannot open, a digest function that fails) ends the scene with a visible notice. */
  const crash = (): void => end(errorText('failure'));

  /** The panel refreshes once per second while a countdown or the time of the next attempt is on show. */
  const refresh = (): void => {
    cancelRefresh?.();
    cancelRefresh = undefined;
    if (stopped || !clockDriven(model)) return;
    cancelRefresh = deps.after(1000, () => {
      cancelRefresh = undefined;
      if (stopped) return;
      deps.port.show(model, deps.now());
      refresh();
    });
  };

  const feed = (input: LiveInput): void => {
    if (stopped) return;
    const out = reduce(model, input);
    model = out.model;
    for (const effect of out.effects) run(effect, input.at);
    if (model.fatal !== undefined) return end(errorText(model.fatal));
    deps.port.show(model, input.at);
    refresh();
  };

  /** A failed request becomes the `failed` input of the model; a fatal one ends the scene outside the model. */
  const failed = (request: LiveRequest, failure: NetFailure | NetFatal): void => {
    if (failure.outcome === 'fatal') return end(errorText(failure.fatal));
    feed({ type: 'failed', at: deps.now(), request, outcome: failure.outcome, ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }) });
  };

  async function loadPublic(): Promise<void> {
    const read = await deps.net.readPublic(deps.matchId);
    if (stopped) return;
    if (!read.ok) return failed({ type: 'public' }, read);
    const match = read.value;
    if (verifiedDigest === undefined) {
      const files = await deps.net.readMapFiles(match.mapId, match.mapDigest);
      if (stopped) return;
      if (!files.ok) return failed({ type: 'public' }, files);
      const opened = await deps.port.open(match, files.value);
      if (stopped) return;
      if (!opened.ok) return end(opened.message);
      verifiedDigest = match.mapDigest;
      return feed({ type: 'public', at: deps.now(), match, round: opened.round });
    }
    // A later read of the public data (a resync) must announce the digest that was verified.
    if (match.mapDigest !== verifiedDigest) return end(errorText('digest-mismatch'));
    feed({ type: 'public', at: deps.now(), match });
  }

  async function read(request: Extract<LiveRequest, { type: 'state' | 'record' }>): Promise<void> {
    if (request.type === 'state') {
      const reply = await deps.net.readState(deps.matchId, request.round);
      if (stopped) return;
      return reply.ok ? feed({ type: 'state', at: deps.now(), reply: reply.value }) : failed(request, reply);
    }
    const reply = await deps.net.readRecord(deps.matchId, request.round);
    if (stopped) return;
    return reply.ok ? feed({ type: 'record', at: deps.now(), reply: reply.value }) : failed(request, reply);
  }

  function openStream(after: number, via: 'parameter' | 'header'): void {
    closeStream();
    const mine = generation;
    const abort = new AbortController();
    controller = abort;
    const current = (): boolean => !stopped && mine === generation;
    void deps.net
      .openStream(
        deps.matchId,
        { after, via },
        {
          opened: () => current() && feed({ type: 'opened', at: deps.now() }),
          bytes: () => current() && feed({ type: 'bytes', at: deps.now() }),
          frame: (data) => {
            if (!current()) return;
            deps.onFrame?.(data);
            feed({ type: 'event', at: deps.now(), data });
          },
        },
        abort.signal,
      )
      .then((result) => {
        if (!current()) return;
        if (result.type === 'failed') failed({ type: 'stream' }, result.failure);
        else if (result.type === 'dropped') feed({ type: 'dropped', at: deps.now() });
      })
      .catch(() => {
        if (current()) crash();
      });
  }

  async function hash(text: string): Promise<void> {
    let value = '';
    try {
      value = await digest(new TextEncoder().encode(text));
    } catch {
      // A digest that cannot be computed never matches: the model reads the state from the server instead.
    }
    feed({ type: 'digest', at: deps.now(), digest: value });
  }

  function run(effect: LiveEffect, at: number): void {
    switch (effect.type) {
      case 'read-public':
        loadPublic().catch(crash);
        return;
      case 'read-state':
        read({ type: 'state', round: effect.round }).catch(crash);
        return;
      case 'read-record':
        read({ type: 'record', round: effect.round }).catch(crash);
        return;
      case 'open-stream':
        openStream(effect.after, effect.via);
        return;
      case 'close-stream':
        closeStream();
        return;
      case 'arm-timer':
        cancelTimer?.();
        cancelTimer = deps.after(Math.max(0, effect.until - deps.now()), () => {
          cancelTimer = undefined;
          feed({ type: 'tick', at: deps.now() });
        });
        return;
      case 'hash-state':
        void hash(effect.text);
        return;
      case 'draw':
        deps.port.draw(effect.round, effect.owners);
        return;
      case 'play-step':
        deps.port.playStep(effect.from, effect.to, effect.data, effect.tour, at);
        return;
      case 'victim-tour':
        deps.port.startVictimTour(effect, at);
        return;
      case 'complete-tour':
        deps.port.completeTour(at);
        return;
    }
  }

  for (const effect of started.effects) run(effect, deps.now());
  const refreshPanel = (): void => {
    if (!stopped) deps.port.show(model, deps.now());
  };
  return {
    navigate: (action) => feed({ type: 'navigate', at: deps.now(), action }),
    requestArchive: () => feed({ type: 'archive', at: deps.now() }),
    refreshPanel,
    model: () => model,
    stop,
  };
}
