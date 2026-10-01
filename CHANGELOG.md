# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado sigue [SemVer](https://semver.org/lang/es/), con prefijo `-alpha`
mientras el API y el alcance puedan cambiar.

## [0.1.0-alpha] — 2026-10-01

Primera versión jugable. Un visor de partidas: das al play y ves cómo las
facciones se van eliminando y anexando ronda a ronda.

### Añadido

- **Simulación** determinista del modo "Clásico" (`packages/sim`): cada ronda
  cae una facción al azar y una vecina/absorbente se queda con todas sus
  provincias, hasta que queda una. PRNG con semilla (mulberry32), sin I/O.
- **Visor web** (`apps/web`): reproducción por rondas con play/pausa y control
  de velocidad, animación de absorción, registro de eventos, estadísticas en
  vivo y semilla compartible por URL (`?seed=…`).
- **Render**: un bloque continuo por facción (las fronteras internas se
  ocultan), etiquetas estilo EU4 con nombre propio por territorio, cámara con
  arrastre/zoom/minimapa y etiquetas legibles a cualquier zoom.
- **Etiquetas**: posición por polo de inaccesibilidad, orientación por
  corredor real, texto **recto por defecto** y **semiluna** (un único arco
  circular) solo cuando el recto no encaja, con sentido de lectura siempre
  garantizado.
- **40 tests** con vitest (motor, formato de mapa y geometría de etiquetas).

### Limitaciones conocidas

- **Solo un mapa**: el artesanal viene embebido en el código. El importador de
  imágenes (Fase 2) todavía no existe, así que no se pueden subir mapas propios.
- **Sin servidor**: la partida se calcula entera en el navegador a partir de la
  semilla de la URL. Cualquiera con el enlace puede leer la semilla y calcular
  las rondas futuras. Es inofensivo para un visor, pero **rompe cualquier
  apuesta o predicción** — por eso esta versión no trae nada de eso, y la Fase 3
  (precalcular en servidor y revelar ronda a ronda) es la que lo arregla.
- **Sin guardado**: no hay historial, ni rankings, ni calendario de rondas.
- **Sin Discord**: el bot es la Fase 4.

[0.1.0-alpha]: https://github.com/agarcial16/MBRG/releases/tag/v0.1.0-alpha
