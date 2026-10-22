import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// NFR-53 (dependencies): no new third-party dependency; shared and sim keep none; the server uses only
// `@mbrg/*` at runtime and exactly the approved development dependencies at their pinned versions (U2).

const read = (relative: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const server = read('../package.json');
const lock = read('../../../package-lock.json');
const root = read('../../../package.json');

describe('server manifest', () => {
  it('NFR-53 apps/server depends at runtime only on workspace packages', () => {
    expect(server.name).toBe('@mbrg/server');
    expect(server.private).toBe(true);
    expect(server.type).toBe('module');
    const deps = server.dependencies as Record<string, string>;
    expect(Object.keys(deps).sort()).toStrictEqual(['@mbrg/shared', '@mbrg/sim']);
    for (const name of Object.keys(deps)) expect(name.startsWith('@mbrg/')).toBe(true);
    for (const key of ['peerDependencies', 'optionalDependencies', 'bundledDependencies']) expect(server[key]).toBeUndefined();
  });

  it('NFR-53 apps/server has exactly the two approved development dependencies, pinned', () => {
    expect(server.devDependencies).toStrictEqual({ '@types/node': '24.19.2', tsx: '4.23.15' });
  });

  it('NFR-53 apps/server scripts are limited to the runner and the check, with no install hooks', () => {
    const names = Object.keys(server.scripts ?? {});
    for (const n of names) expect(['start', 'check']).toContain(n);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(names).not.toContain(hook);
  });

  it('NFR-53 packages/shared and packages/sim keep no third-party dependency', () => {
    for (const p of ['shared', 'sim']) {
      const m = read(`../../../packages/${p}/package.json`);
      // Only workspace packages (sim uses shared); never a third-party package.
      for (const name of Object.keys(m.dependencies ?? {})) expect(name.startsWith('@mbrg/')).toBe(true);
      expect(m.devDependencies ?? {}).toStrictEqual({});
    }
  });

  it('NFR-53 the root registers the workspace and the lockfile mirrors the manifest', () => {
    expect(root.workspaces).toContain('apps/server');
    const entry = lock.packages['apps/server'];
    expect(entry.dependencies).toStrictEqual(server.dependencies);
    expect(entry.devDependencies).toStrictEqual(server.devDependencies);
    expect(lock.packages['node_modules/@mbrg/server']).toStrictEqual({ resolved: 'apps/server', link: true });
    expect(lock.packages['node_modules/tsx'].version).toBe('4.23.15');
    expect(lock.packages['node_modules/@types/node'].version).toBe('24.19.2');
  });
});
