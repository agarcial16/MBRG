// The bot's configuration from the environment (spec 012, NFR-89). Pure: the environment comes in as a parameter. A missing
// variable is reported by NAME only, never by value, so no secret is echoed.

export interface BotConfig {
  readonly discordToken: string;
  readonly serverUrl: string;
  readonly credential: string;
  readonly viewerUrl: string | undefined;
  readonly stateFile: string;
}

export type ConfigResult = { readonly ok: true; readonly config: BotConfig } | { readonly ok: false; readonly missing: readonly string[] };

const REQUIRED = ['DISCORD_TOKEN', 'MBRG_SERVER_URL', 'MBRG_DISCORD_CREDENTIAL', 'MBRG_BOT_STATE_FILE'] as const;

export function readConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const has = (name: string): boolean => typeof env[name] === 'string' && (env[name] as string).trim() !== '';
  const missing = REQUIRED.filter((name) => !has(name));
  if (missing.length > 0) return { ok: false, missing };
  const viewer = has('MBRG_VIEWER_URL') ? (env.MBRG_VIEWER_URL as string).trim() : undefined;
  return {
    ok: true,
    config: {
      discordToken: (env.DISCORD_TOKEN as string).trim(),
      serverUrl: (env.MBRG_SERVER_URL as string).trim().replace(/\/+$/, ''),
      credential: (env.MBRG_DISCORD_CREDENTIAL as string).trim(),
      viewerUrl: viewer,
      stateFile: (env.MBRG_BOT_STATE_FILE as string).trim(),
    },
  };
}
