// Vite config of the spec 019 debug scene (see `board-debug.ts`). The viewer reads its server from `VITE_MBRG_SERVER`; with this
// config the dev server itself plays the match server, on the same origin.
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const players = Number(process.env.MBRG_DEBUG_PLAYERS ?? '1000');

const matchServer = (): Plugin => ({
  name: 'mbrg-debug-match-server',
  async configureServer(server) {
    const { debugScene } = (await server.ssrLoadModule('/test/helpers/board-debug.ts')) as typeof import('./board-debug');
    const scene = await debugScene(players);
    server.middlewares.use(async (req, res, next) => {
      const url = req.url ?? '/';
      if (!url.startsWith('/matches/') && !url.startsWith('/maps/')) return next();
      const origin = `http://${req.headers.host ?? 'localhost:5173'}`;
      const answer = await scene.fetch(`${origin}${url}`, { method: req.method });
      res.statusCode = answer.status;
      answer.headers.forEach((value, key) => res.setHeader(key, value));
      if (answer.body === null) return res.end();
      const reader = answer.body.getReader();
      req.on('close', () => void reader.cancel());
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {
        // the browser closed the stream
      }
      res.end();
    });
  },
});

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [matchServer()],
  server: { port: 5173 },
  define: { 'import.meta.env.VITE_MBRG_SERVER': JSON.stringify('http://localhost:5173') },
});
