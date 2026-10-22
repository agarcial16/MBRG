// Schema version 1 (spec 008 FR-291, plan section 4). Instants are INTEGER milliseconds. The absorber and the
// pending state have no column outside `records` (plan PD11); no column holds a credential text (PD12): the
// host token is stored as a digest and memo scopes are digests too.

export const SCHEMA_VERSION = 1;

export const TABLES = ['meta', 'matches', 'states', 'records', 'steps', 'predictions', 'results', 'events', 'memo'] as const;

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
