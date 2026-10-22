// The match lifecycle service, creation part (spec 008 FR-231, FR-232, FR-235, FR-236, FR-238, FR-259, FR-260; plan 17.1).
// The shell around the pure core: it draws the secret, the match id and the host token, reads the map package, calls the
// core and the protocol readers, and writes everything of one decision in ONE storage transaction (PD10) before it
// replies. It depends on core, protocol and store; the core never imports it. No timer lives here (scheduler: later task).
//
// Dependencies are injected: the clock, the random source (production: the platform CSPRNG through secret.ts) and the map
// catalog. The test-only round-seed source (FR-260) is a parameter of this constructor and of nothing else: the
// production entry point builds the service from the settings alone.

import { canonicalBody, encodePublicMatch, errorReply, readCreation } from '@mbrg/protocol';
import type { CreationReply, ErrorReply, Timing } from '@mbrg/protocol';
import type { Clock } from '../clock';
import { createMatch, creationEvents } from '../core/create';
import { decideMemo, isMemoisable } from '../core/memo';
import type { MemoScope } from '../core/memo';
import { effectiveInstant, reportedTime, wholeMs } from '../core/time';
import { publicOf } from '../core/view';
import type { RandomBytes } from '../secret';
import { commitment as commitmentOf, newSecret } from '../secret';
import { seedOfSecret } from '../seeds';
import type { Store } from '../store/store';
import { credentialDigest, newHostToken, newMatchId, sameDigest, sha256Ascii } from './ids';
import type { MapCatalog } from './maps';
import type { Settings } from './settings';

/** The path text of a creation in the canonical content of FR-282 (the HTTP layer of M3a uses the same text). */
export const CREATION_PATH = '/matches';

/** The reply of a creation: the first reply or the first error (both are what a replay returns). */
export type CreateOutcome = { readonly ok: true; readonly reply: CreationReply } | { readonly ok: false; readonly error: ErrorReply };

export interface CreateRequest {
  /** The credential the caller presented (a missing one is `undefined`). */
  readonly credential: string | undefined;
  /** The parsed JSON body of the creation command. */
  readonly body: unknown;
}

/**
 * TEST-ONLY round-seed source (FR-260): replaces the HMAC derivation of FR-252 for the match it is asked about. It is a
 * parameter of `createMatchService` only; no setting, variable, request or production entry point can set it.
 */
export type TestSeedSource = (matchId: string) => (round: number) => number;

export interface ServiceOptions {
  readonly store: Store;
  readonly clock: Clock;
  readonly maps: MapCatalog;
  readonly settings: Settings;
  /** The random source of secrets, match ids and host tokens; omitted in production (the platform CSPRNG). */
  readonly random?: RandomBytes;
  /** TEST-ONLY (FR-260). Production passes none. */
  readonly testSeedSource?: TestSeedSource;
}

export interface MatchService {
  /** FR-231, FR-232, FR-238: creates a match, or replays or refuses; one storage transaction. */
  create(request: CreateRequest): CreateOutcome;
  /** Deletes the memo entries past the 24 h retention, host tokens in plain form included (FR-238); returns how many. */
  purgeMemos(): number;
}

/**
 * `seedOf(secret, matchId)(k)`: the HMAC rule of FR-252, or the test-only source when one was given at construction
 * (FR-260). The steps of the next task call it; the secret never leaves the service.
 */
export const roundSeeds =
  (testSeedSource?: TestSeedSource) =>
  (secret: Uint8Array, matchId: string): ((round: number) => number) =>
    testSeedSource === undefined ? seedOfSecret(secret) : testSeedSource(matchId);

const failure = (error: ErrorReply): CreateOutcome => ({ ok: false, error });

export function createMatchService(options: ServiceOptions): MatchService {
  const { store, clock, maps, settings, random } = options;
  if (options.testSeedSource !== undefined && typeof options.testSeedSource !== 'function') throw new TypeError('the test seed source is a function');
  const operatorDigest = credentialDigest(settings.operatorCredential);
  const limit = settings.runningMatchLimit;

  /** Everything after the shape, credential and memo checks; runs inside the transaction and writes only on success. */
  const decide = (mapId: string, timing: Timing, timingError: ErrorReply | undefined, now: number): CreateOutcome => {
    const loaded = maps.load(mapId);
    if (loaded === undefined) return failure(errorReply('unknown-map'));
    // The id and the commitment are filled in below, once nothing can fail any more: errors draw no random bytes.
    const created = createMatch(
      { matchId: '', mapId, mapDigest: loaded.digest, timing, commitment: '', now },
      { map: loaded.map, sha256: sha256Ascii },
    );
    if (!created.ok) {
      // The 001 validation errors come before too-few-factions in the order of FR-301 (the shared validator may report both).
      const others = created.errors.filter((e) => e.kind !== 'too-few-factions');
      return failure(others.length === 0 ? errorReply('too-few-factions') : errorReply('map-validation', others.map((e) => e.kind)));
    }
    if (timingError !== undefined) return failure(timingError);
    if (store.runningCount() >= limit) return failure(errorReply('too-many-matches'));

    const secret = newSecret(random);
    const matchId = newMatchId(random);
    const hostToken = newHostToken(random);
    const view = { ...created.view, matchId, commitment: commitmentOf(secret) };
    const reported = reportedTime(effectiveInstant(now, view.lastStepMs), 0);
    const first = creationEvents(view, reported);
    const reply: CreationReply = { matchId, match: publicOf(first.view, reported), hostToken };
    encodePublicMatch(reply.match); // the public data must be encodable before anything is stored
    store.insertMatch({ match: first.view, secret, hostTokenDigest: credentialDigest(hostToken) });
    store.appendEvents(matchId, first.events);
    return { ok: true, reply };
  };

  return {
    create(request: CreateRequest): CreateOutcome {
      const read = readCreation(request.body);
      // Shape problems come first (FR-301); the timing rules come later in the order, so their error waits.
      if (!read.ok && read.error.kind !== 'invalid-timing') return failure(read.error);
      const body = request.body as Record<string, unknown>;
      const mapId = (read.ok ? read.value.mapId : body.mapId) as string;
      const timing = (read.ok ? read.value.timing : body.timing) as Timing;
      const requestId = (read.ok ? read.value.requestId : body.requestId) as string;
      const timingError = read.ok ? undefined : read.error;

      if (typeof request.credential !== 'string' || !sameDigest(credentialDigest(request.credential), operatorDigest)) return failure(errorReply('forbidden'));

      const scope: MemoScope = { credentialDigest: operatorDigest, match: null };
      const contentDigest = sha256Ascii(canonicalBody('POST', CREATION_PATH, request.body));
      const now = wholeMs(clock.now());
      return store.transaction((): CreateOutcome => {
        const stored = store.memoGet(scope, requestId);
        const memo = decideMemo<CreateOutcome>(
          stored === undefined ? undefined : { content: stored.contentDigest, reply: stored.reply as CreateOutcome, createdMs: stored.createdMs },
          { content: contentDigest, now },
        );
        if (memo.decision === 'replay') return memo.reply;
        if (memo.decision === 'request-id-reused') return failure(memo.error);
        const outcome = decide(mapId, timing, timingError, now);
        if (isMemoisable(outcome)) store.memoPut(scope, requestId, { contentDigest, reply: outcome, createdMs: now });
        return outcome;
      });
    },
    purgeMemos(): number {
      return store.transaction(() => store.memoPurge(wholeMs(clock.now())));
    },
  };
}

