import { PUBLIC_CONFIG_KEYS } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { Route } from '../src/http/router';
import { productionRoutes } from '../src/http/server';
import { PINS, hashOf, presentFiles } from './helpers/protected-pins';
import { request } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';

// Spec 022 NFR-114: the 008, 011, 014 and 018 goldens keep the bytes they had, the sim, shared and map sources are the pinned
// files, the route table gains no route and the public config names nothing of the feature.

afterEach(closeAllServers);

const GOLDEN_SHA256: Readonly<Record<string, string>> = {
  'apps/server/test/golden/core-timelines.json': '81b33074ec57d95eec18721375e2292ab2b24abd1b714c1eaa2559a40dce0ad9',
  'apps/server/test/golden/dev-lobby.json': '710b140d8cbf6f5fc5672362e014b7ef534d7c166a28be170cae294e0cd5ea18',
  'apps/server/test/golden/dev-results.json': '3071081f328cb133a1164b94627ad835f2fffe04bb5752834f265cccd8d7aac5',
  'apps/server/test/golden/dev-secrets.json': '77727ba2aa271e4e7c62dadec9f6f285629d112427f10494ef1a4995f64513b8',
  'apps/server/test/golden/service-timelines.json': 'ef46ccd44da9cedfe980087bb92138242c036c308a68a58ec60d4111c50456ad',
  'apps/server/test/golden/wire-008.json': '073facff09537954aa3dbcd360a68cc6f143ca8ca2c9d940f20bdfc3a5a5f40c',
  'apps/server/test/golden/protected-files.json': '394be39280179389004b42d89bc426f48d6db30e4db6a7fc0738286772559f73',
};

describe('NFR-114 spec 022 leaves the existing wire and the simulation as they were', () => {
  it('NFR-114 the 008, 011, 014 and 018 goldens hash to the bytes they had before spec 022', () => {
    for (const [name, sha] of Object.entries(GOLDEN_SHA256)) expect(hashOf(name), name).toBe(sha);
  });

  it('NFR-114 the sim and shared sources, the sim goldens, the dev map and the tour goldens are the pinned files', () => {
    expect(presentFiles()).toStrictEqual(Object.keys(PINS.files).sort());
    for (const [name, sha] of Object.entries(PINS.files)) expect(hashOf(name), name).toBe(sha);
  });

  it('NFR-114 the production route table is the 19 routes of spec 014 plus the history read of spec 024 and the ranking read of spec 025, and the public config names nothing of the feature', async () => {
    let table: readonly Route[] = [];
    const h = await startServer({
      routes: (service, settings) => {
        table = productionRoutes(service, settings);
        return table;
      },
    });
    // 19 routes of spec 014, `POST /history` (spec 024) and `POST /ranking` (spec 025).
    expect(table).toHaveLength(21);
    const config = await request(h.port, { path: '/config' });
    expect(config.status).toBe(200);
    expect(Object.keys(config.json() as object)).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
    expect(config.text).not.toMatch(/name|client|display|policy/i);
  });
});
