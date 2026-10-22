import { describe, expect, it } from 'vitest';
import webManifestRaw from '../package.json?raw';
import lockRaw from '../../../package-lock.json?raw';

// The dependency set of spec 005 (merged at 2f6f25c): spec 006 adds none.
const WEB_005 = {
  name: '@mbrg/web',
  version: '0.0.0',
  dependencies: { '@mbrg/shared': '*', '@mbrg/sim': '*', three: '0.186.1' },
  devDependencies: { '@types/three': '0.186.0', vite: '8.3.4' },
};
const LOCK_ENTRIES_005 = 138;
const LOCK_FNV_005 = '9907d04f21f33617';

/** FNV-1a 64 over the UTF-8 bytes of a text. */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

describe('spec 006 dependencies', () => {
  it('NFR-42 the viewer manifest dependencies equal the spec 005 set', () => {
    const manifest = JSON.parse(webManifestRaw) as Record<string, unknown>;
    expect(manifest.dependencies).toStrictEqual(WEB_005.dependencies);
    expect(manifest.devDependencies).toStrictEqual(WEB_005.devDependencies);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('NFR-42 the lockfile workspace entry of the viewer equals the spec 005 one', () => {
    const lock = JSON.parse(lockRaw) as { packages: Record<string, Record<string, unknown>> };
    expect(lock.packages['apps/web']).toStrictEqual(WEB_005);
  });

  it('NFR-42 the lockfile lists the same packages and versions as at spec 005', () => {
    const lock = JSON.parse(lockRaw) as { packages: Record<string, { version?: string }> };
    // Spec 008 adds the server workspace and its link only (NFR-53); the 005 entries are unchanged.
    const keys = Object.keys(lock.packages)
      .filter((k) => k !== 'apps/server' && k !== 'node_modules/@mbrg/server')
      .sort();
    expect(keys).toHaveLength(LOCK_ENTRIES_005);
    const text = keys.map((k) => `${k}@${lock.packages[k]!.version ?? ''}`).join('\n');
    expect(fnv1a64(text)).toBe(LOCK_FNV_005);
  });
});
