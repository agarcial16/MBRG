// Where the live viewer reads from (H8). The server origin is the build variable `VITE_MBRG_SERVER`; without it the local
// development server in development and the page's own origin in production. No credential is read here (H9: the web
// test client page is the only reader of its credential variable).
export const DEFAULT_DEV_SERVER = 'http://127.0.0.1:8787';

export interface ConfigEnv {
  readonly VITE_MBRG_SERVER?: string;
  readonly DEV: boolean;
}

/** The server origin without a trailing slash. */
export function serverOrigin(env: ConfigEnv, pageOrigin: string): string {
  const chosen = env.VITE_MBRG_SERVER !== undefined && env.VITE_MBRG_SERVER !== '' ? env.VITE_MBRG_SERVER : env.DEV ? DEFAULT_DEV_SERVER : pageOrigin;
  return chosen.endsWith('/') ? chosen.slice(0, -1) : chosen;
}

/** The origin for this page, from the build environment. */
export const pageServerOrigin = (): string =>
  serverOrigin({ DEV: import.meta.env.DEV, VITE_MBRG_SERVER: import.meta.env.VITE_MBRG_SERVER as string | undefined }, window.location.origin);
