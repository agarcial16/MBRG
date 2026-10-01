/**
 * Tiny in-house i18n — no library, no build magic.
 *
 * Spanish is the source of truth: the key union is derived from it, so adding
 * a message without translating it (or a key that doesn't exist) is a compile
 * error rather than a `undefined` at runtime.
 *
 * Resolution order: `?lang=` in the URL (so a link can force a language, handy
 * for sharing in a Discord) → the language saved from a previous visit → the
 * browser's language → English.
 */

export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];

const es = {
  'match.title': 'Partida',
  'match.play': 'Reproducir / Pausar',
  'match.restart': 'Reiniciar',
  'match.speed': 'Velocidad:',
  'match.seed': 'Semilla',
  'match.apply': 'Aplicar',
  'match.round': 'Ronda {current} / {total}',
  'match.zoomIn': 'Acercar (rueda del ratón)',
  'match.zoomOut': 'Alejar (rueda del ratón)',
  'match.zoomFit': 'Ajustar al mapa',
  'match.minimap': 'Minimapa — clic para centrar la vista',
  'match.version': 'Versión en ejecución',
  'match.language': 'Idioma',
  'match.map': 'Mapa',
  'match.import': 'Importar mapa',
  'log.title': 'Eventos',
  'log.empty': 'Sin eventos todavía — pulsa ▶',
  'stats.title': 'Estadísticas',
  'stats.during': 'Durante la partida',
  'stats.topKiller': 'Mayor asesino:',
  'stats.topCaptures': 'Más capturas:',
  'stats.wins': '{name} gana la partida',
  'import.title': 'Importar mapa',
  'import.subtitle':
    'Convierte una imagen en un mapa jugable. Funciona con un color plano por provincia.',
  'import.step1': '1 · Elige una imagen',
  'import.step2': '2 · Ajusta la detección',
  'import.step3': '3 · Revisa el resultado',
  'import.step4': '4 · Comprueba y guarda',
  'import.drop': 'Arrastra una imagen aquí o haz clic para elegirla',
  'import.hint':
    'Ideal: cada provincia de un color sólido y distinto, con fronteras oscuras. Los PNG con transparencia se leen como mar.',
  'import.showSource': 'Imagen original',
  'import.clickTip': 'Haz clic en una provincia para verla en la lista.',
  'import.regions': 'Provincias',
  'import.tolerance': 'Tolerancia de color',
  'import.minArea': 'Área mínima (px)',
  'import.simplify': 'Suavizado',
  'import.summary': '{regions} provincias · {warnings} avisos · {errors} errores',
  'import.border': 'frontera',
  'import.borders': 'fronteras',
  'import.badgeIsland': 'isla',
  'import.badgeSplit': 'partida',
  'import.badgeCorner': 'solo esquina',
  'import.noIssues': 'Sin avisos: el mapa es jugable.',
  'import.failed': 'No se pudo leer la imagen',
  'import.broken': 'El mapa tiene errores: no se puede jugar hasta arreglarlos.',
  'import.savedHint': 'Se guardará en este navegador como «{name}».',
  'import.play': 'Jugar este mapa',
  'import.export': 'Exportar JSON',
  'import.issueNoOutline': 'La región {id} ({color}) no tiene contorno y se ha descartado',
  'import.issueSplit':
    'La región {id} ({color}) está partida en {pieces} trozos; solo se guarda el mayor: únela con una vecina o redibuja el mapa',
  'import.issueIsland':
    'La región {id} ({color}) es una isla: no linda con ninguna otra, así que necesita un enlace marítimo para ser alcanzable',
  'import.issueDiagonal':
    '{count} contorno(s) se cruzan en diagonal donde se encuentran cuatro regiones; su forma es aproximada: separa las fronteras para que no se toquen en un punto',
  'import.issueSkipped': '{count} px descartados por mar, fronteras o ruido de {total}',
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  'match.title': 'Match',
  'match.play': 'Play / Pause',
  'match.restart': 'Restart',
  'match.speed': 'Speed:',
  'match.seed': 'Seed',
  'match.apply': 'Apply',
  'match.round': 'Round {current} / {total}',
  'match.zoomIn': 'Zoom in (mouse wheel)',
  'match.zoomOut': 'Zoom out (mouse wheel)',
  'match.zoomFit': 'Fit map to view',
  'match.minimap': 'Minimap — click to centre the view',
  'match.version': 'Running version',
  'match.language': 'Language',
  'match.map': 'Map',
  'match.import': 'Import map',
  'log.title': 'Events',
  'log.empty': 'No events yet — press ▶',
  'stats.title': 'Statistics',
  'stats.during': 'During the match',
  'stats.topKiller': 'Top killer:',
  'stats.topCaptures': 'Most captures:',
  'stats.wins': '{name} wins the match',
  'import.title': 'Import map',
  'import.subtitle': 'Turn an image into a playable map. Works with one flat colour per province.',
  'import.step1': '1 · Pick an image',
  'import.step2': '2 · Tune the detection',
  'import.step3': '3 · Review the result',
  'import.step4': '4 · Check and save',
  'import.drop': 'Drop an image here, or click to choose one',
  'import.hint':
    'Best case: one solid, distinct colour per province, with dark borders. Transparency in a PNG is read as sea.',
  'import.showSource': 'Source image',
  'import.clickTip': 'Click a province to find it in the list.',
  'import.regions': 'Provinces',
  'import.tolerance': 'Colour tolerance',
  'import.minArea': 'Minimum area (px)',
  'import.simplify': 'Smoothing',
  'import.summary': '{regions} provinces · {warnings} warnings · {errors} errors',
  'import.border': 'border',
  'import.borders': 'borders',
  'import.badgeIsland': 'island',
  'import.badgeSplit': 'split',
  'import.badgeCorner': 'corner only',
  'import.noIssues': 'No findings: the map is playable.',
  'import.failed': 'The image could not be read',
  'import.broken': 'The map has errors: it cannot be played until they are fixed.',
  'import.savedHint': 'It will be saved in this browser as “{name}”.',
  'import.play': 'Play this map',
  'import.export': 'Export JSON',
  'import.issueNoOutline': 'Region {id} ({color}) has no outline and was dropped',
  'import.issueSplit':
    'Region {id} ({color}) is split into {pieces} pieces; only the largest is kept: merge it with a neighbour or redraw the map',
  'import.issueIsland':
    'Region {id} ({color}) is an island: it borders nothing, so it needs a sea link to be reachable',
  'import.issueDiagonal':
    '{count} outline(s) cross diagonally where four regions meet; their shape is approximate: separate the borders so they do not touch at a point',
  'import.issueSkipped': '{count} px dropped as sea, borders or speckle out of {total}',
};

const DICTS: Record<Lang, Record<MessageKey, string>> = { es, en };
const STORAGE_KEY = 'mbrg.lang';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / blocked storage: not worth failing over
  }
}

/**
 * The browser is optional: the tests run in node and only need `resolveLang`,
 * so reading the environment is lazy and defensive.
 */
function initialLang(): Lang {
  const hasWindow = typeof window !== 'undefined';
  const query = hasWindow ? new URLSearchParams(window.location.search).get('lang') : null;
  const browser = typeof navigator === 'undefined' ? null : navigator.language;
  return resolveLang(query, hasWindow ? readStored() : null, browser);
}

let current: Lang | null = null;

/** Language of the interface, `'es'` or `'en'`. */
export function getLang(): Lang {
  return (current ??= initialLang());
}

/**
 * Pick a language from the available signals. Pure, so the precedence can be
 * tested without a browser: an explicit `?lang=` wins over a saved choice,
 * which wins over the browser's own language.
 */
export function resolveLang(
  query: string | null,
  saved: string | null,
  browser: string | null,
): Lang {
  const from = (raw: string | null): Lang | null => {
    const v = (raw ?? '').trim().toLowerCase().slice(0, 2);
    return (LANGS as readonly string[]).includes(v) ? (v as Lang) : null;
  };
  return from(query) ?? from(saved) ?? from(browser) ?? 'en';
}

const listeners = new Set<() => void>();

/** Change the language, persist it and notify subscribers. */
export function setLang(next: Lang): void {
  if (next === getLang()) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Look up a message, replacing `{placeholders}` with the given values. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = DICTS[getLang()][key] ?? DICTS.es[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Apply translations to the static markup: every `[data-i18n]` element gets its
 * text, and `[data-i18n-title]` its tooltip. Keeps index.html readable and
 * avoids building the sidebar's chrome in JavaScript.
 */
export function applyI18n(root?: ParentNode): void {
  if (typeof document === 'undefined') return;
  const scope = root ?? document;
  for (const el of scope.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of scope.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  }
}
