// The reduced-motion preference of the browser (FR-177, FR-184).

/** The part of a media query list the viewer uses. */
export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener(type: 'change', handler: () => void): void;
}

export interface Motion {
  /** True while the browser reports a reduced-motion preference. */
  reduced(): boolean;
}

const QUERY = '(prefers-reduced-motion: reduce)';

/** Reads the preference and calls `onChange` whenever it changes. A browser without the query allows motion. */
export function watchMotion(onChange: () => void, query?: MediaQueryListLike): Motion {
  const list: MediaQueryListLike | undefined =
    query ?? (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined);
  list?.addEventListener('change', onChange);
  return { reduced: () => list?.matches === true };
}
