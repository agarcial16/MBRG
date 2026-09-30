import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Consume workspace packages straight from TS sources (no pre-build needed).
export default defineConfig({
  resolve: {
    alias: {
      '@mbrg/sim': fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)),
      '@mbrg/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
});
