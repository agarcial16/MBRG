import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// Version comes from package.json (single source of truth) and is shown in the UI,
// so a player can tell which build they're running.
const version = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version as string;

// Relative base: the same build works from a domain root and from a GitHub
// Pages subpath (https://user.github.io/mbrg/), with no config per environment.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@mbrg/sim': fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)),
      '@mbrg/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
});
