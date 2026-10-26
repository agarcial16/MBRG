import { describe, expect, it } from 'vitest';
import manifestRaw from '../package.json?raw';
import lockRaw from '../../../package-lock.json?raw';
import rootRaw from '../../../package.json?raw';

// NFR-53 (protocol manifest): the protocol package adds no third-party dependency.
const manifest = JSON.parse(manifestRaw) as Record<string, any>;
const lock = JSON.parse(lockRaw) as { packages: Record<string, Record<string, any>> };
const root = JSON.parse(rootRaw) as Record<string, any>;

describe('protocol manifest', () => {
  it('NFR-53 (protocol manifest) @mbrg/protocol is private, a module, and has no dependency at all (B2: not even the workspaces)', () => {
    expect(manifest.name).toBe('@mbrg/protocol');
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe('module');
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'scripts']) {
      expect(manifest[key], key).toBeUndefined();
    }
  });

  it('NFR-53 (protocol manifest) the root workspaces cover it and the typecheck script checks it', () => {
    expect(root.workspaces).toContain('packages/*');
    expect(root.scripts.typecheck).toContain('tsc -p packages/protocol/tsconfig.json');
  });

  it('NFR-53 (protocol manifest) the lockfile has the workspace entry and its link, and no third-party package for it', () => {
    expect(lock.packages['packages/protocol']).toStrictEqual({
      name: '@mbrg/protocol',
      version: '0.0.0',
    });
    expect(lock.packages['node_modules/@mbrg/protocol']).toStrictEqual({ resolved: 'packages/protocol', link: true });
  });
});
