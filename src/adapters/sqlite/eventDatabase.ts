import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export const EVENT_SCHEMA_VERSION = 1;

const EVENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS event_store_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    global_sequence INTEGER NOT NULL DEFAULT 0,
    global_hash TEXT
  ) STRICT;
  INSERT INTO event_store_metadata (id, schema_version, global_sequence, global_hash)
    VALUES (1, ${EVENT_SCHEMA_VERSION}, 0, NULL)
    ON CONFLICT(id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS aggregate_heads (
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    hash TEXT,
    PRIMARY KEY (aggregate_type, aggregate_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS events (
    global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    event_type TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    effective_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    source TEXT NOT NULL,
    source_reference TEXT,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    previous_hash TEXT,
    hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE (aggregate_type, aggregate_id, sequence)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_by_aggregate ON events(aggregate_type, aggregate_id, sequence);
  CREATE TABLE IF NOT EXISTS idempotency_records (
    idempotency_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(event_id),
    result_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS projection_checkpoints (
    projector_id TEXT PRIMARY KEY,
    projector_version INTEGER NOT NULL,
    last_global_sequence INTEGER NOT NULL CHECK (last_global_sequence >= 0),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS projection_snapshots (
    projector_id TEXT NOT NULL,
    projector_version INTEGER NOT NULL,
    global_sequence INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    checksum TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (projector_id, global_sequence)
  ) STRICT;
`;

export function createEventDatabase(filename: string): Database.Database {
  if (filename !== ":memory:" && !filename.startsWith("file:")) mkdirSync(dirname(resolve(filename)), { recursive: true });
  const database = new Database(filename, { timeout: 5_000 });
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    if (filename !== ":memory:" && !filename.startsWith("file:")) {
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
    }
    database.exec(EVENT_SCHEMA);
    const metadata = database.prepare("SELECT schema_version FROM event_store_metadata WHERE id = 1").get() as { schema_version: number };
    if (metadata.schema_version > EVENT_SCHEMA_VERSION) {
      database.close();
      throw new Error(`Event database schema version ${metadata.schema_version} is newer than this application supports (latest ${EVENT_SCHEMA_VERSION}).`);
    }
    return database;
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}
