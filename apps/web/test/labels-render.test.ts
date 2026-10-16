import { describe, expect, it } from 'vitest';
import webManifestRaw from '../package.json?raw';
import lockRaw from '../../../package-lock.json?raw';

// NFR-36 (spec 005 adds no dependency). The rendering-part tests of this file arrive in task T7.
// The set below is the 004 set (libraries.test.ts pins the versions and licences).
const RUNTIME = { '@mbrg/shared': '*', '@mbrg/sim': '*', three: '0.186.1' };
const DEV = { '@types/three': '0.186.0', vite: '8.3.4' };
/** Number of entries of package-lock.json at the end of spec 004 (root, workspaces and every package). */
const LOCK_ENTRIES = 138;

const manifest = JSON.parse(webManifestRaw) as any;
const lock = JSON.parse(lockRaw) as any;

describe('NFR-36 no dependency is added for labels and transitions', () => {
  it('NFR-36 the viewer manifest declares exactly the 004 dependencies and nothing else', () => {
    expect(manifest.dependencies).toStrictEqual(RUNTIME);
    expect(manifest.devDependencies).toStrictEqual(DEV);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('NFR-36 the lockfile entry of the viewer equals its manifest and the lockfile has the 004 entries', () => {
    const entry = lock.packages['apps/web'];
    expect(entry).toBeDefined();
    expect(entry.dependencies).toStrictEqual(RUNTIME);
    expect(entry.devDependencies).toStrictEqual(DEV);
    expect(entry.peerDependencies).toBeUndefined();
    expect(entry.optionalDependencies).toBeUndefined();
    expect(Object.keys(lock.packages)).toHaveLength(LOCK_ENTRIES);
  });
});
