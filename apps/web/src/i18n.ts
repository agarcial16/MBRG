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
  'log.title': 'Eventos',
  'log.empty': 'Sin eventos todavía — pulsa ▶',
  'stats.title': 'Estadísticas',
  'stats.during': 'Durante la partida',
  'stats.topKiller': 'Mayor asesino:',
  'stats.topCaptures': 'Más capturas:',
  'stats.wins': '{name} gana la partida',
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
  'log.title': 'Events',
  'log.empty': 'No events yet — press ▶',
  'stats.title': 'Statistics',
  'stats.during': 'During the match',
  'stats.topKiller': 'Top killer:',
  'stats.topCaptures': 'Most captures:',
  'stats.wins': '{name} wins the match',
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
