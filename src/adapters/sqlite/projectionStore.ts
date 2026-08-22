import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../domain/events/eventEnvelope";

export interface ProjectionCheckpoint<State> {
  readonly projectorId: string;
  readonly projectorVersion: number;
  readonly lastGlobalSequence: number;
  readonly state: State;
}

export class SQLiteProjectionStore {
  constructor(private readonly database: Database.Database) {}

  saveCheckpoint<State>(checkpoint: ProjectionCheckpoint<State>, updatedAt = new Date().toISOString()): void {
    this.database.prepare(`INSERT INTO projection_checkpoints (projector_id,projector_version,last_global_sequence,state_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(projector_id) DO UPDATE SET projector_version=excluded.projector_version,last_global_sequence=excluded.last_global_sequence,state_json=excluded.state_json,updated_at=excluded.updated_at`).run(
      checkpoint.projectorId, checkpoint.projectorVersion, checkpoint.lastGlobalSequence, canonicalJson(checkpoint.state), updatedAt,
    );
  }

  loadCheckpoint<State>(projectorId: string): ProjectionCheckpoint<State> | undefined {
    const row = this.database.prepare("SELECT projector_id,projector_version,last_global_sequence,state_json FROM projection_checkpoints WHERE projector_id = ?").get(projectorId) as { projector_id: string; projector_version: number; last_global_sequence: number; state_json: string } | undefined;
    return row ? { projectorId: row.projector_id, projectorVersion: row.projector_version, lastGlobalSequence: row.last_global_sequence, state: JSON.parse(row.state_json) as State } : undefined;
  }

  saveSnapshot<State>(projectorId: string, projectorVersion: number, globalSequence: number, state: State, createdAt = new Date().toISOString()): string {
    const stateJson = canonicalJson(state);
    const checksum = `sha256:${createHash("sha256").update(stateJson, "utf8").digest("hex")}`;
    this.database.prepare("INSERT OR REPLACE INTO projection_snapshots (projector_id,projector_version,global_sequence,state_json,checksum,created_at) VALUES (?,?,?,?,?,?)").run(projectorId, projectorVersion, globalSequence, stateJson, checksum, createdAt);
    return checksum;
  }

  loadSnapshot<State>(projectorId: string, globalSequence: number): { state: State; checksum: string; projectorVersion: number } | undefined {
    const row = this.database.prepare("SELECT projector_version,state_json,checksum FROM projection_snapshots WHERE projector_id = ? AND global_sequence = ?").get(projectorId, globalSequence) as { projector_version: number; state_json: string; checksum: string } | undefined;
    if (!row) return undefined;
    const actual = `sha256:${createHash("sha256").update(row.state_json, "utf8").digest("hex")}`;
    if (actual !== row.checksum) throw new Error(`Projection snapshot checksum mismatch for ${projectorId} at ${globalSequence}.`);
    return { state: JSON.parse(row.state_json) as State, checksum: row.checksum, projectorVersion: row.projector_version };
  }
}
