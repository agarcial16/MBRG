// Server settings read from the environment at start (spec 008 Definitions "Server settings", D23; plan 18.5).
// Only the values listed here exist: there is no setting, and no variable, that can set a round-seed source (FR-260).
// A problem names the variable, never its value (no credential is ever echoed). Pure: no clock, timer, random or I/O.

/** The values the lifecycle service needs. */
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

/** A client credential and the namespace of its player ids (FR-283). */
export interface ClientSetting {
  readonly namespace: string;
  /** The credential in plain text, as the operator set it. */
  readonly credential: string;
}

/** Per-minute rate limits (FR-299 (b), plan 18.5). The operator credential uses the client values (C4). */
export interface Limits {
  /** Commands per client (or operator) credential per minute. */
  readonly commands: number;
  /** Reads per client (or operator) credential per minute. */
  readonly reads: number;
  /** Submissions per player id per match per minute. */
  readonly submissions: number;
  /** Advances per host token per minute. */
  readonly advances: number;
  /** Requests per network address without a valid credential per minute. */
  readonly anonymous: number;
  /** Open event streams per client (or operator) credential (FR-299 (b)). */
  readonly streams: number;
  /** Open event streams per network address without a valid credential (FR-299 (b)). */
  readonly anonymousStreams: number;
}

/** The settings of the HTTP server: the service settings plus clients, origins, listener and limits. */
export interface ServerSettings extends Settings {
  readonly clients: readonly ClientSetting[];
  /** Origins allowed for credentialed cross-origin requests (FR-286), exactly as a browser sends them. */
  readonly allowedOrigins: readonly string[];
  readonly host: string;
  /** The listener port; 0 means any free port (tests). */
  readonly port: number;
  readonly limits: Limits;
}

export const DEFAULT_RUNNING_MATCH_LIMIT = 20;
export const DEFAULT_DATABASE_PATH = 'mbrg.sqlite';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
export const DEFAULT_LIMITS: Limits = Object.freeze({ commands: 600, reads: 1200, submissions: 30, advances: 30, anonymous: 120, streams: 50, anonymousStreams: 5 });

/** Connection hardening of the listener (plan PD21, C4): fixed values, not settings. */
export const CONNECTION_OPTIONS = Object.freeze({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 });
/** How long a shutdown waits for requests in flight (plan 18.8, C4). */
export const SHUTDOWN_GRACE_MS = 5_000;

/** The environment variables read, in this order (problems are listed in this order too). */
export const SETTING_VARIABLES = [
  'MBRG_OPERATOR_CREDENTIAL',
  'MBRG_MAPS',
  'MBRG_MAX_RUNNING_MATCHES',
  'MBRG_DATABASE',
  'MBRG_CLIENTS',
  'MBRG_ALLOWED_ORIGINS',
  'MBRG_HOST',
  'MBRG_PORT',
  'MBRG_LIMIT_COMMANDS',
  'MBRG_LIMIT_READS',
  'MBRG_LIMIT_SUBMISSIONS',
  'MBRG_LIMIT_ADVANCES',
  'MBRG_LIMIT_ANONYMOUS',
  'MBRG_LIMIT_STREAMS',
  'MBRG_LIMIT_ANONYMOUS_STREAMS',
] as const;

export type SettingsResult = { readonly ok: true; readonly settings: ServerSettings } | { readonly ok: false; readonly problems: readonly string[] };

const MAP_ID = /^[a-z0-9-]{1,64}$/;
const WHOLE = /^[0-9]{1,9}$/;
/** The credential character set and length (FR-283): base64url, 22 (128 bits) to 256 characters. */
const CREDENTIAL = /^[A-Za-z0-9_-]{22,256}$/;
const NAMESPACE = /^[a-z0-9]{1,16}$/;
/** A serialised origin: lower-case scheme and host, optional port 1..65535 without leading zero, nothing after. */
const ORIGIN = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::([1-9][0-9]{0,4}))?$/;
const PORT = /^(?:0|[1-9][0-9]{0,4})$/;
const LIMIT = /^[1-9][0-9]{0,6}$/;
const MAX_LIMIT = 1_000_000;
const MAX_PORT = 65_535;

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

/** A text made only of hexadecimal digits, either case. */
const HEX_ONLY = /^[0-9A-Fa-f]+$/;
/** Hexadecimal digits carry 4 bits each: an all-hex credential needs 32 characters for 128 bits (FR-283). */
const MIN_HEX_CREDENTIAL = 32;

/**
 * The credential rule of FR-283: the character set and length, and at least 128 bits. A credential made only of hexadecimal
 * digits is read as hexadecimal (coordinator decision, M3a: a random base64url text of 22 or more characters is all hex
 * with negligible probability), so it needs at least 32 characters.
 */
const isCredential = (value: unknown): value is string =>
  typeof value === 'string' && CREDENTIAL.test(value) && !(HEX_ONLY.test(value) && value.length < MIN_HEX_CREDENTIAL);

/** The clients of `MBRG_CLIENTS` (absent or empty: none), or undefined when refused. */
const clientsOf = (text: string | undefined, operator: string | undefined): ClientSetting[] | undefined => {
  if (text === undefined || text.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const out: ClientSetting[] = [];
  const namespaces = new Set<string>();
  const credentials = new Set<string>();
  for (const element of parsed as unknown[]) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return undefined;
    const keys = Object.keys(element).sort();
    if (keys.length !== 2 || keys[0] !== 'credential' || keys[1] !== 'namespace') return undefined;
    const { namespace, credential } = element as Record<string, unknown>;
    if (typeof namespace !== 'string' || !NAMESPACE.test(namespace) || !isCredential(credential)) return undefined;
    if (namespaces.has(namespace) || credentials.has(credential) || credential === operator) return undefined;
    namespaces.add(namespace);
    credentials.add(credential);
    out.push({ namespace, credential });
  }
  return out;
};

const originsOf = (text: string | undefined): string[] | undefined => {
  if (text === undefined || text.length === 0) return [];
  const out: string[] = [];
  for (const item of text.split(',')) {
    const match = ORIGIN.exec(item);
    if (match === null) return undefined;
    if (match[1] !== undefined && Number(match[1]) > MAX_PORT) return undefined;
    out.push(item);
  }
  return out;
};

const hostOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return DEFAULT_HOST;
  return text.length === 0 || /\s/.test(text) ? undefined : text;
};

const portOf = (text: string | undefined): number | undefined => {
  if (text === undefined) return DEFAULT_PORT;
  return PORT.test(text) && Number(text) <= MAX_PORT ? Number(text) : undefined;
};

const limitOf = (text: string | undefined, fallback: number): number | undefined => {
  if (text === undefined) return fallback;
  return LIMIT.test(text) && Number(text) <= MAX_LIMIT ? Number(text) : undefined;
};

/** Reads the settings from an environment object. Variables that are not in `SETTING_VARIABLES` are ignored. */
export function readSettings(env: Readonly<Record<string, string | undefined>>): SettingsResult {
  const problems: string[] = [];
  const credential = env.MBRG_OPERATOR_CREDENTIAL;
  if (!isCredential(credential)) problems.push('MBRG_OPERATOR_CREDENTIAL');
  const maps = mapsOf(env.MBRG_MAPS);
  if (maps === undefined) problems.push('MBRG_MAPS');
  let runningMatchLimit = DEFAULT_RUNNING_MATCH_LIMIT;
  const limitText = env.MBRG_MAX_RUNNING_MATCHES;
  if (limitText !== undefined) {
    if (WHOLE.test(limitText) && Number(limitText) >= 1) runningMatchLimit = Number(limitText);
    else problems.push('MBRG_MAX_RUNNING_MATCHES');
  }
  const databasePath = env.MBRG_DATABASE === undefined || env.MBRG_DATABASE.length === 0 ? DEFAULT_DATABASE_PATH : env.MBRG_DATABASE;
  const clients = clientsOf(env.MBRG_CLIENTS, credential);
  if (clients === undefined) problems.push('MBRG_CLIENTS');
  const allowedOrigins = originsOf(env.MBRG_ALLOWED_ORIGINS);
  if (allowedOrigins === undefined) problems.push('MBRG_ALLOWED_ORIGINS');
  const host = hostOf(env.MBRG_HOST);
  if (host === undefined) problems.push('MBRG_HOST');
  const port = portOf(env.MBRG_PORT);
  if (port === undefined) problems.push('MBRG_PORT');
  const commands = limitOf(env.MBRG_LIMIT_COMMANDS, DEFAULT_LIMITS.commands);
  if (commands === undefined) problems.push('MBRG_LIMIT_COMMANDS');
  const reads = limitOf(env.MBRG_LIMIT_READS, DEFAULT_LIMITS.reads);
  if (reads === undefined) problems.push('MBRG_LIMIT_READS');
  const submissions = limitOf(env.MBRG_LIMIT_SUBMISSIONS, DEFAULT_LIMITS.submissions);
  if (submissions === undefined) problems.push('MBRG_LIMIT_SUBMISSIONS');
  const advances = limitOf(env.MBRG_LIMIT_ADVANCES, DEFAULT_LIMITS.advances);
  if (advances === undefined) problems.push('MBRG_LIMIT_ADVANCES');
  const anonymous = limitOf(env.MBRG_LIMIT_ANONYMOUS, DEFAULT_LIMITS.anonymous);
  if (anonymous === undefined) problems.push('MBRG_LIMIT_ANONYMOUS');
  const streams = limitOf(env.MBRG_LIMIT_STREAMS, DEFAULT_LIMITS.streams);
  if (streams === undefined) problems.push('MBRG_LIMIT_STREAMS');
  const anonymousStreams = limitOf(env.MBRG_LIMIT_ANONYMOUS_STREAMS, DEFAULT_LIMITS.anonymousStreams);
  if (anonymousStreams === undefined) problems.push('MBRG_LIMIT_ANONYMOUS_STREAMS');
  if (
    problems.length > 0 ||
    !isCredential(credential) ||
    maps === undefined ||
    clients === undefined ||
    allowedOrigins === undefined ||
    host === undefined ||
    port === undefined ||
    commands === undefined ||
    reads === undefined ||
    submissions === undefined ||
    advances === undefined ||
    anonymous === undefined ||
    streams === undefined ||
    anonymousStreams === undefined
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    settings: {
      operatorCredential: credential,
      maps,
      runningMatchLimit,
      databasePath,
      clients,
      allowedOrigins,
      host,
      port,
      limits: { commands, reads, submissions, advances, anonymous, streams, anonymousStreams },
    },
  };
}
