// Server settings read from the environment at start (spec 008 Definitions "Server settings", D23).
// Only the values listed here exist: there is no setting, and no variable, that can set a round-seed source (FR-260).
// A problem names the variable, never its value (no credential is ever echoed).

/** The operator values of this milestone (rate limits and origins join them in M3a). */
export interface Settings {
  /** The operator credential in plain text, as the operator set it; the service keeps only its digest. */
  readonly operatorCredential: string;
  /** Map ids and their package folders (a folder holds map.json, ids.png and presentation.json). */
  readonly maps: Readonly<Record<string, string>>;
  /** The running-match limit (FR-232, D23). */
  readonly runningMatchLimit: number;
  /** The database file path, or ':memory:'. */
  readonly databasePath: string;
}

export const DEFAULT_RUNNING_MATCH_LIMIT = 20;
export const DEFAULT_DATABASE_PATH = 'mbrg.sqlite';

/** The environment variables read, in this order. */
export const SETTING_VARIABLES = ['MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_DATABASE'] as const;

export type SettingsResult = { readonly ok: true; readonly settings: Settings } | { readonly ok: false; readonly problems: readonly string[] };

const MAP_ID = /^[a-z0-9-]{1,64}$/;
const WHOLE = /^[0-9]{1,9}$/;

const mapsOf = (text: string | undefined): Record<string, string> | undefined => {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const out: Record<string, string> = {};
  for (const [id, folder] of Object.entries(parsed as Record<string, unknown>)) {
    if (!MAP_ID.test(id) || typeof folder !== 'string' || folder.length === 0) return undefined;
    out[id] = folder;
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

/** Reads the settings from an environment object. Variables that are not in `SETTING_VARIABLES` are ignored. */
export function readSettings(env: Readonly<Record<string, string | undefined>>): SettingsResult {
  const problems: string[] = [];
  const credential = env.MBRG_OPERATOR_CREDENTIAL;
  if (credential === undefined || credential.length === 0) problems.push('MBRG_OPERATOR_CREDENTIAL');
  const maps = mapsOf(env.MBRG_MAPS);
  if (maps === undefined) problems.push('MBRG_MAPS');
  let limit = DEFAULT_RUNNING_MATCH_LIMIT;
  const limitText = env.MBRG_MAX_RUNNING_MATCHES;
  if (limitText !== undefined) {
    if (WHOLE.test(limitText) && Number(limitText) >= 1) limit = Number(limitText);
    else problems.push('MBRG_MAX_RUNNING_MATCHES');
  }
  const databasePath = env.MBRG_DATABASE === undefined || env.MBRG_DATABASE.length === 0 ? DEFAULT_DATABASE_PATH : env.MBRG_DATABASE;
  if (problems.length > 0 || credential === undefined || maps === undefined) return { ok: false, problems };
  return { ok: true, settings: { operatorCredential: credential, maps, runningMatchLimit: limit, databasePath } };
}
