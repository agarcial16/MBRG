// Every sentence the bot says (spec 012 FR-461): Spanish for now, one module so another language can be added later. Templates
// use {name} holes filled by `fill`. This is the only source file of the bot that may hold non-ASCII text.

export const STRINGS = {
  // Lobby, rounds and results announced in the channel (FR-451, FR-453, FR-456).
  lobby: 'Nueva partida **{match}** en el mapa **{map}**. Quien gestione el canal puede iniciarla con el botón.',
  startButton: 'Iniciar',
  predictButton: 'Predecir',
  viewerButton: 'Ver en el visor',
  roundOpened: 'Ronda {round} abierta. ¿Qué facción será eliminada? Pulsa Predecir.',
  victimRevealed: 'Ronda {round}: la víctima es **{victim}**. ¿Quién la absorberá? Pulsa Predecir.',
  victimForced: 'Ronda {round}: la víctima es **{victim}** y solo puede absorberla **{absorber}** (absorbente forzado).',
  roundApplied: 'Ronda {round} aplicada: **{victim}** cae y **{absorber}** absorbe sus territorios. {left}',
  factionsLeftOne: 'Queda 1 facción.',
  factionsLeftMany: 'Quedan {n} facciones.',
  matchFinished: 'Partida terminada. Ganadora: **{winner}**.',
  matchHalted: 'La partida se ha detenido en la ronda {round}.',
  winnersVictim: 'Acertaron la víctima: {mentions}.',
  winnersAbsorber: 'Acertaron el absorbente: {mentions}.',
  winnersNoneVictim: 'Nadie acertó la víctima.',
  winnersNoneAbsorber: 'Nadie acertó el absorbente.',
  winnersMore: '{list} y {n} más',
  factionFallback: 'Facción {id}',

  // Leaderboard (FR-457).
  boardTitle: 'Clasificación',
  boardRow: '{rank}. {who} - {points} pts',
  boardEmpty: 'Todavía no hay puntos.',

  // Replies to commands and presses (FR-452, FR-454, FR-455, FR-458).
  noPermission: 'Solo quien gestiona el canal puede hacer eso.',
  alreadyFollowing: 'Este canal ya sigue una partida. Usa /mbrg stop antes de crear otra.',
  notFollowing: 'Este canal no sigue ninguna partida.',
  serverDown: 'El servidor no está disponible ahora. Inténtalo más tarde.',
  createDisabled: 'La creación de partidas públicas no está activa.',
  unknownMap: 'Ese mapa no está disponible.',
  unknownPace: 'Ese ritmo no existe.',
  started: 'Partida iniciada.',
  stopped: 'Este canal deja de seguir la partida. La partida continúa en el servidor.',
  chosen: 'Elegido: {name}.',
  pickVictim: 'Elige la víctima.',
  pickAbsorber: 'Elige quién absorberá.',
  pickPlaceholder: 'Facción',
  findTitle: 'Buscar facción',
  findLabel: 'Parte del nombre',
  findPick: 'Coincidencias para "{text}". Elige una.',
  findNone: 'Ninguna facción coincide con "{text}".',
  notStarted: 'La partida aún no ha empezado.',
  phaseClosed: 'Ahora no hay ninguna fase abierta.',
  expired: 'La partida expiró sin empezar.',
  errClosed: 'La fase está cerrada. No se cambió nada.',
  errForced: 'Esta ronda tiene absorbente forzado: no hay nada que predecir.',
  errRate: 'Vas demasiado rápido. Espera {n} s.',
  errFinished: 'La partida ya terminó.',
  errHalted: 'La partida está detenida.',
  errChoice: 'Esa facción no es una opción ahora.',
  errUnknownMatch: 'El servidor no conoce esta partida.',
  errOther: 'El servidor no aceptó la petición.',
  errUnexpected: 'Algo falló. Inténtalo de nuevo.',

  // Slash command definitions (FR-451 to FR-458).
  cmdRoot: 'mbrg',
  cmdRootText: 'Partidas de Map Battle Royale',
  cmdCreate: 'create',
  cmdCreateText: 'Crea una partida pública en este canal',
  cmdStart: 'start',
  cmdStartText: 'Inicia la partida de este canal',
  cmdStop: 'stop',
  cmdStopText: 'Deja de seguir la partida en este canal',
  cmdBoard: 'board',
  cmdBoardText: 'Muestra la clasificación',
  cmdPredict: 'predict',
  cmdPredictText: 'Predice en la fase abierta',
  optMap: 'map',
  optMapText: 'Mapa de la partida',
  optPace: 'pace',
  optPaceText: 'Ritmo de la partida',
  optFaction: 'faction',
  optFactionText: 'Facción (parte del nombre)',
  paceFast: 'Rápido',
  paceNormal: 'Normal',
  paceSlow: 'Lento',

  // Start-up (operator console).
  envMissing: 'Falta la variable de entorno {name}.',
  stateUnreadable: 'No se puede leer el archivo de estado del bot.',
  loginFailed: 'No se pudo conectar con Discord. Revisa DISCORD_TOKEN.',
  botReady: 'Bot listo.',
} as const;

export type StringKey = keyof typeof STRINGS;

/** A template with its {name} holes filled; a hole with no value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (hole, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : hole));
}
