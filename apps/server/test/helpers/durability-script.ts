import type { PublicMatch } from '@mbrg/protocol';
import { createMapCatalog } from '../../src/service/maps';
import { createMatchService } from '../../src/service/matches';
import type { MatchService } from '../../src/service/matches';
import type { Settings } from '../../src/service/settings';
import type { Store } from '../../src/store/store';
import { DEV_DIR } from './digests';
import type { FakeClock } from './fake-clock';
import { fakeRandom } from './fake-random';
import { snapshotOf } from './results-timelines';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody } from './service-harness';

// The scripted match of the durability tests (spec 008 NFR-57, M2b' T6'), shared by the in-process tests and the child
// process that is killed for real (fixtures/kill-child.ts). A dev-map clock match with predictions and request ids:
// the creation, per round the victim and winner predictions (one replaced), the absorber prediction, a replayed request
// id, every step either by a clock tick at its anchor or by a manual advance with a request id (operator or host token)
// shortly before it, and after the finish a tick 25 h later that purges the memo. Every service of a run (the first one
// and every restarted one) draws its random bytes from a fresh fake source with the same seed, so a creation that was
// lost in a crash and is performed again gets the same match id and host token.

export const RANDOM_SEED = 7;
export const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;
const S = 1000;
const HOUR = 3600 * S;

export const settingsFor = (file: string): Settings => ({
  operatorCredential: OPERATOR,
  maps: { dev: DEV_DIR.replace(/[\\/]$/, '') },
  runningMatchLimit: 20,
  databasePath: file,
  forcedPhaseSeconds: 5,
});

/** A service on `store` as a (re)started server builds it: the fake clock, the dev map and a fresh fake random source. */
export const serviceOn = (store: Store, clock: FakeClock, file: string): MatchService => {
  const settings = settingsFor(file);
  return createMatchService({ store, clock, maps: createMapCatalog(settings.maps), settings, random: fakeRandom(RANDOM_SEED) });
};

/**
 * The results reads of the finished script match as one text (NFR-57 results part): every phase result of the four rounds, the
 * results of the two scripted players and of an unknown one, and the whole leaderboard. A restarted run must give the same text.
 */
export const resultsReads = (service: MatchService, matchId: string): string =>
  JSON.stringify(snapshotOf(service, matchId, ['web:p1', 'web:p2', 'web:nobody'], 4, 2));

/** One action of the script, plain JSON: what is sent and at which clock reading. */
export type ActionSpec =
  | { readonly kind: 'create'; readonly label: string; readonly at: number; readonly body: Record<string, unknown> }
  | { readonly kind: 'submit'; readonly label: string; readonly at: number; readonly matchId: string; readonly body: Record<string, unknown> }
  | { readonly kind: 'advance'; readonly label: string; readonly at: number; readonly matchId: string; readonly credential: string; readonly body: Record<string, unknown> }
  | { readonly kind: 'tick'; readonly label: string; readonly at: number };

/** Performs one action on a service (the caller sets the clock to `spec.at` first). */
export function perform(service: MatchService, spec: ActionSpec): unknown {
  switch (spec.kind) {
    case 'create':
      return service.create({ credential: OPERATOR, body: spec.body });
    case 'submit':
      return service.submit({ client: { ...CLIENT }, matchId: spec.matchId, body: spec.body });
    case 'advance':
      return service.advance({ credential: spec.credential, matchId: spec.matchId, body: spec.body });
    case 'tick':
      return service.tick();
  }
}

const NEXT = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' } as const;

/**
 * The script as a cursor: `next` gives the next action from the stored public data of the live service, `after` takes the
 * reply that finally counted for it (after a retry, if any). Steps alternate: a manual advance for step numbers 1 and 3
 * modulo 5 (5 s before the anchor; the host token on odd rounds), a clock tick at the anchor otherwise.
 */
export function scriptCursor(): { next(service: MatchService): ActionSpec | undefined; after(spec: ActionSpec, reply: unknown): void } {
  const st: { matchId?: string; token?: string; queue: ActionSpec[]; steps: number; at: number; created: boolean; purged: boolean } = {
    queue: [],
    steps: 0,
    at: START_MS,
    created: false,
    purged: false,
  };
  const plan = (shown: PublicMatch): ActionSpec[] => {
    const id = st.matchId!;
    const round = shown.appliedRounds + 1;
    const living = [...new Set(shown.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
    const n = st.steps;
    const out: ActionSpec[] = [];
    const submit = (label: string, body: Record<string, unknown>): void => {
      out.push({ kind: 'submit', label, at: st.at, matchId: id, body });
    };
    if (shown.stage === 'phase-1') {
      submit(`victim r${round}`, { kind: 'victim', round, faction: living[n % living.length], playerId: 'p1', requestId: `v-${round}` });
      submit(`winner r${round}`, { kind: 'winner', faction: living[(n + 1) % living.length], playerId: 'p1', requestId: `w-${round}` });
      submit(`victim replaced r${round}`, { kind: 'victim', round, faction: living[(n + 2) % living.length], playerId: 'p1', requestId: `v2-${round}` });
      submit(`victim p2 r${round}`, { kind: 'victim', round, faction: living[0], playerId: 'p2' });
    } else if (shown.stage === 'phase-2') {
      const candidates = shown.victim!.candidates;
      // A victim with one candidate is a forced absorber: the server refuses the prediction, so the script sends none.
      if (candidates.length > 1) {
        submit(`absorber r${round}`, { kind: 'absorber', round, faction: candidates[n % candidates.length], playerId: 'p1', requestId: `a-${round}` });
        submit(`absorber replay r${round}`, { kind: 'absorber', round, faction: candidates[n % candidates.length], playerId: 'p1', requestId: `a-${round}` });
      }
    }
    const stage = shown.stage as keyof typeof NEXT;
    const schedule = shown.schedule!;
    const anchor = stage === 'phase-1' ? schedule.c1 : stage === 'phase-2' ? schedule.c2 : schedule.a;
    if (n % 5 === 1 || n % 5 === 3) {
      const credential = round % 2 === 1 ? st.token! : OPERATOR;
      out.push({ kind: 'advance', label: `advance ${NEXT[stage]} r${round}`, at: anchor - 5 * S, matchId: id, credential, body: { round, step: NEXT[stage], requestId: `adv-${n}` } });
    } else {
      out.push({ kind: 'tick', label: `tick ${NEXT[stage]} r${round}`, at: anchor });
    }
    return out;
  };
  return {
    next(service) {
      if (!st.created) return { kind: 'create', label: 'create', at: START_MS, body: creationBody('c-1', { timing: { ...CLOCK_TIMING } }) };
      if (st.queue.length === 0) {
        const shown = service.publicMatch(st.matchId!)!;
        if (shown.stage === 'finished' || shown.stage === 'halted') {
          if (st.purged) return undefined;
          st.purged = true;
          return { kind: 'tick', label: 'tick purge', at: st.at + 25 * HOUR };
        }
        st.queue = plan(shown);
      }
      return st.queue.shift();
    },
    after(spec, reply) {
      st.at = spec.at;
      if (spec.kind === 'create') {
        const out = reply as { ok: boolean; reply?: { matchId: string; hostToken: string } };
        if (!out.ok || out.reply === undefined) throw new Error(`creation failed: ${JSON.stringify(reply)}`);
        st.created = true;
        st.matchId = out.reply.matchId;
        st.token = out.reply.hostToken;
      }
      if (spec.kind === 'advance' || spec.kind === 'tick') st.steps += spec.label === 'tick purge' ? 0 : 1;
    },
  };
}
