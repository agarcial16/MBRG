import { ERROR_ORDER } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import type { Route } from '../src/http/router';
import { SETTING_VARIABLES } from '../src/service/settings';
import { PINS, hashOf } from './helpers/protected-pins';
import { closeAllServers, startServer } from './helpers/server-harness';

// Spec 014 T7: the one addition is `GET /config`. The route table, the error kinds, the settings variables, the 008 and 011
// goldens and the protected-files pin are what they were at the end of spec 011 (rewrite at 831ba9e): the SHA-256 below were
// taken from `git show 831ba9e:<file>`, so a changed golden is seen even though the other tests read the file they check.

afterEach(closeAllServers);

/** The route table before spec 014: the 18 routes of the end of spec 011 (the creation path is `/matches`). */
const PREVIOUS_ROUTES = [
  'GET /matches',
  'GET /matches/:id',
  'GET /matches/:id/states/:round',
  'GET /matches/:id/records',
  'GET /matches/:id/records/:round',
  'GET /matches/:id/predictions',
  'GET /matches/:id/players',
  'GET /matches/:id/results/:round/:phase',
  'GET /matches/:id/results/:round/:phase/winners',
  'GET /matches/:id/players/:playerId/results',
  'GET /matches/:id/leaderboard',
  'GET /matches/:id/events',
  'GET /maps/:mapId/:file',
  'POST /matches',
  'POST /matches/:id/advance',
  'POST /matches/:id/start',
  'POST /matches/:id/players',
  'POST /matches/:id/predictions',
];

const GOLDEN_SHA256: Readonly<Record<string, string>> = {
  'apps/server/test/golden/core-timelines.json': '81b33074ec57d95eec18721375e2292ab2b24abd1b714c1eaa2559a40dce0ad9',
  'apps/server/test/golden/dev-lobby.json': '710b140d8cbf6f5fc5672362e014b7ef534d7c166a28be170cae294e0cd5ea18',
  'apps/server/test/golden/dev-results.json': '3071081f328cb133a1164b94627ad835f2fffe04bb5752834f265cccd8d7aac5',
  'apps/server/test/golden/dev-secrets.json': '77727ba2aa271e4e7c62dadec9f6f285629d112427f10494ef1a4995f64513b8',
  'apps/server/test/golden/service-timelines.json': 'ef46ccd44da9cedfe980087bb92138242c036c308a68a58ec60d4111c50456ad',
  'apps/server/test/golden/wire-008.json': '073facff09537954aa3dbcd360a68cc6f143ca8ca2c9d940f20bdfc3a5a5f40c',
  'apps/server/test/golden/protected-files.json': '394be39280179389004b42d89bc426f48d6db30e4db6a7fc0738286772559f73',
};

const ERROR_KINDS_BEFORE = [
  'rate-limited', 'unknown-path', 'method-not-allowed', 'too-large', 'invalid-request', 'invalid-player-id', 'forbidden', 'request-id-reused', 'unknown-match',
  'unknown-map', 'map-validation', 'too-few-factions', 'invalid-timing', 'too-many-matches', 'match-halted', 'match-finished', 'name-taken', 'match-full',
  'match-started', 'match-expired', 'step-mismatch', 'round-not-applied', 'stale-cursor', 'prediction-closed', 'forced-absorber', 'invalid-choice', 'unavailable',
];

const SETTING_VARIABLES_BEFORE = [
  'MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_DATABASE', 'MBRG_CLIENTS',
  'MBRG_ALLOWED_ORIGINS', 'MBRG_HOST', 'MBRG_PORT', 'MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS',
  'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS', 'MBRG_LIMIT_STREAMS', 'MBRG_LIMIT_ANONYMOUS_STREAMS',
  'MBRG_FORCED_PHASE_SECONDS',
  'MBRG_PUBLIC_MAPS', 'MBRG_PUBLIC_MIN_INTERVAL', 'MBRG_PUBLIC_MIN_PHASE1', 'MBRG_PUBLIC_MIN_PHASE2', 'MBRG_PUBLIC_MAX_INTERVAL',
  'MBRG_MAX_OPEN_LOBBIES', 'MBRG_MAX_PUBLIC_RUNNING', 'MBRG_LOBBY_EXPIRY_HOURS',
  'MBRG_MAX_PLAYERS',
  'MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_CREATE_ALL', 'MBRG_LIMIT_JOIN_SOURCE', 'MBRG_LIMIT_JOIN_MATCH', 'MBRG_TRUSTED_PROXY_HOPS',
];

async function productionTable(): Promise<string[]> {
  let table: readonly Route[] = [];
  await startServer({
    routes: (service, settings) => {
      table = productionRoutes(service, settings);
      return table;
    },
  });
  return table.map((r) => `${r.method} ${r.path}`);
}

describe('spec 014 leaves the existing wire as it was', () => {
  it('FR-420 the production route table is the previous 18 routes plus exactly GET /config', async () => {
    const table = await productionTable();
    expect(table).toHaveLength(PREVIOUS_ROUTES.length + 1);
    expect([...table].sort()).toStrictEqual([...PREVIOUS_ROUTES, 'GET /config'].sort());
    expect(table.filter((r) => !PREVIOUS_ROUTES.includes(r))).toStrictEqual(['GET /config']);
  });

  it('FR-420 the error kinds and the 30 settings variables are the ones of spec 011', () => {
    expect([...ERROR_ORDER]).toStrictEqual(ERROR_KINDS_BEFORE);
    expect([...SETTING_VARIABLES]).toStrictEqual(SETTING_VARIABLES_BEFORE);
    expect(SETTING_VARIABLES).toHaveLength(30);
  });

  it('FR-420 wire-008, the 008 and 011 goldens and protected-files.json hash to the bytes of the end of spec 011', () => {
    for (const [name, sha] of Object.entries(GOLDEN_SHA256)) expect(hashOf(name), name).toBe(sha);
  });

  it('FR-420 the protected-files pin lists neither the protocol nor the server sources, so spec 014 needs no re-pin', () => {
    const names = Object.keys(PINS.files);
    expect(names.filter((f) => f.startsWith('packages/protocol/') || f.startsWith('apps/server/src/'))).toStrictEqual([]);
    expect(PINS.roots.filter((r) => r.startsWith('packages/protocol') || r.startsWith('apps/server/src'))).toStrictEqual([]);
  });
});
