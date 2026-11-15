// Schema version 1 (spec 008 FR-291, plan section 4) and its additions of version 2 (spec 011 FR-391, plan section 3).
// Instants are INTEGER milliseconds. The absorber and the pending state have no column outside `records` (plan PD11); no
// column holds a credential text (PD12): the host token is stored as a digest and memo scopes are digests too.
// Version 2 only ADDS tables: `matches` and every other table of version 1 keep their definition, so a file written by
// the 008 code opens unchanged (no data migration).

export const SCHEMA_VERSION = 2;

export const TABLES = ['meta', 'matches', 'states', 'records', 'steps', 'predictions', 'results', 'events', 'memo', 'lobbies', 'players'] as const;

/** Every statement is idempotent; the caller runs them all inside one transaction. */
export const SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    schema_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT NOT NULL PRIMARY KEY,
    map_id TEXT NOT NULL,
    map_digest TEXT NOT NULL,
    secret BLOB NOT NULL,
    commitment TEXT NOT NULL,
    timing TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    stage TEXT NOT NULL,
    n INTEGER NOT NULL,
    t INTEGER NOT NULL,
    t0_ms INTEGER NOT NULL,
    c1_ms INTEGER,
    c2_ms INTEGER,
    a_ms INTEGER,
    last_step_ms INTEGER NOT NULL,
    victim INTEGER,
    reveal_ms INTEGER,
    halt_reason TEXT,
    winner INTEGER,
    host_token_digest TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS states (
    match_id TEXT NOT NULL REFERENCES matches (id),
    round INTEGER NOT NULL,
    owners_json TEXT NOT NULL,
    state_digest TEXT NOT NULL,
    PRIMARY KEY (match_id, round)
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    match_id TEXT NOT NULL REFERENCES matches (id),
    round INTEGER NOT NULL,
    eliminated INTEGER NOT NULL,
    absorber INTEGER NOT NULL,
    transferred_json TEXT NOT NULL,
    PRIMARY KEY (match_id, round)
  )`,
  `CREATE TABLE IF NOT EXISTS steps (
    match_id TEXT NOT NULL REFERENCES matches (id),
    round INTEGER NOT NULL,
    kind TEXT NOT NULL,
    instant_ms INTEGER NOT NULL,
    cause TEXT NOT NULL,
    first_seq INTEGER NOT NULL,
    last_seq INTEGER NOT NULL,
    PRIMARY KEY (match_id, round, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS predictions (
    match_id TEXT NOT NULL REFERENCES matches (id),
    player_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    round INTEGER NOT NULL,
    choice INTEGER NOT NULL,
    version INTEGER NOT NULL,
    stored_ms INTEGER NOT NULL,
    winner_candidates INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id, kind, round)
  )`,
  `CREATE TABLE IF NOT EXISTS results (
    match_id TEXT NOT NULL REFERENCES matches (id),
    round INTEGER NOT NULL,
    kind TEXT NOT NULL,
    player_id TEXT NOT NULL,
    choice INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (match_id, round, kind, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    match_id TEXT NOT NULL REFERENCES matches (id),
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (match_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS memo (
    scope TEXT NOT NULL,
    request_id TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    reply_json TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    PRIMARY KEY (scope, request_id)
  )`,
  // The running-match count (FR-232) reads matches by stage.
  'CREATE INDEX IF NOT EXISTS matches_by_stage ON matches (stage)',
];

/**
 * The tables of version 2 (spec 011 plan section 3): `lobbies` has one row for every match created through the public path
 * (an operator match has none); `players` is created here and filled from M3 (it holds a token digest, never a token).
 * Every statement is idempotent; the caller runs them inside the same transaction as the version change.
 */
export const SCHEMA_V2_ADDITIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS lobbies (
    match_id TEXT NOT NULL PRIMARY KEY REFERENCES matches (id),
    public INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    started_ms INTEGER,
    expired_ms INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    match_id TEXT NOT NULL REFERENCES matches (id),
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    token_digest TEXT NOT NULL,
    joined_seq INTEGER NOT NULL,
    joined_ms INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id),
    UNIQUE (match_id, name_key)
  )`,
  // The counts of the open lobbies and of the public running matches read the lobbies by these columns.
  'CREATE INDEX IF NOT EXISTS lobbies_by_state ON lobbies (public, started_ms, expired_ms)',
  'CREATE INDEX IF NOT EXISTS players_by_token ON players (token_digest)',
];
