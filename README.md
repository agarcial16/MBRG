# MBRG — Map Battle Royale Game

Un "Battle Royale" para mapas estilo EU4 / RISK: cada ronda una facción es eliminada al azar y una facción vecina se queda con todas sus provincias, hasta que solo queda una.

## Comandos

```bash
npm install       # instala dependencias y enlaza los paquetes del monorepo
npm run build     # compila todos los paquetes (tsc -b, project references)
npm test          # ejecuta los tests (vitest run, sin necesidad de build)
npm run test:watch
npm run clean     # borra artefactos de build (dist/, *.tsbuildinfo)
```

## Estructura

- `packages/shared` — tipos y utilidades comunes: formato de mapa `MapFormat` v1, validación, adyacencia, tipos de partida.
- `packages/sim` — motor de simulación **puro y determinista** (RNG con semilla, sin I/O). Las reglas del juego viven aquí.

Reglas, decisiones y roadmap: ver [`AGENTS.md`](./AGENTS.md).
