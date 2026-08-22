import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { canonicalJson, computeEventHash, createEventEnvelope, type EventEnvelope, type Actor } from "../../domain/events/eventEnvelope";
import type { AppendEventInput, AppendEventResult, EventHead, EventStore } from "../../application/events/eventStorePort";

export class EventStoreError extends Error {
  constructor(readonly code: "CONCURRENCY_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "EVENT_INTEGRITY_ERROR", message: string) {
    super(message);
    this.name = "EventStoreError";
  }
}

interface EventRow {
  global_sequence: number;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  event_type: string;
  schema_version: number;
  effective_at: string;
  recorded_at: string;
  actor_json: string;
  source: string;
  source_reference: string | null;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
  previous_hash: string | null;
  hash: string;
  payload_json: string;
}

function mapRow(row: EventRow): EventEnvelope {
  return {
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sequence: row.sequence,
    globalSequence: row.global_sequence,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
    actor: JSON.parse(row.actor_json) as Actor,
    source: row.source,
    sourceReference: row.source_reference ?? undefined,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    previousHash: row.previous_hash,
    hash: row.hash,
    payload: JSON.parse(row.payload_json),
  };
}

export class SQLiteEventStore implements EventStore {
  constructor(private readonly database: Database.Database) {
    const schema = database.prepare("SELECT schema_version FROM event_store_metadata WHERE id = 1").get() as { schema_version?: number } | undefined;
    if (!schema || schema.schema_version !== 1) throw new Error("Event database schema is missing or newer than this application supports");
  }

  append(input: AppendEventInput): AppendEventResult {
    const requestWithoutEventId = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "eventId"));
    const requestHash = `sha256:${createHash("sha256").update(canonicalJson(requestWithoutEventId), "utf8").digest("hex")}`;
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare("SELECT request_hash, event_id, result_json FROM idempotency_records WHERE idempotency_key = ?").get(input.idempotencyKey) as { request_hash: string; event_id: string; result_json: string } | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new EventStoreError("IDEMPOTENCY_CONFLICT", `Idempotency key ${input.idempotencyKey} was already used for a different request.`);
        return { event: JSON.parse(existing.result_json) as EventEnvelope, duplicate: true };
      }
      const head = this.head(input.aggregateType, input.aggregateId);
      if (head.sequence !== input.expectedSequence) throw new EventStoreError("CONCURRENCY_CONFLICT", `Expected aggregate sequence ${input.expectedSequence}, actual ${head.sequence}.`);
      const metadata = this.database.prepare("SELECT global_sequence, global_hash FROM event_store_metadata WHERE id = 1").get() as { global_sequence: number; global_hash: string | null };
      const globalSequence = metadata.global_sequence + 1;
      const event = createEventEnvelope({
        ...input,
        sequence: head.sequence + 1,
        globalSequence,
        eventId: input.eventId,
        previousHash: metadata.global_hash,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        correlationId: input.correlationId ?? input.idempotencyKey,
      });
      this.database.prepare(`INSERT INTO events (global_sequence,event_id,aggregate_type,aggregate_id,sequence,event_type,schema_version,effective_at,recorded_at,actor_json,source,source_reference,correlation_id,causation_id,idempotency_key,previous_hash,hash,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        event.globalSequence, event.eventId, event.aggregateType, event.aggregateId, event.sequence, event.eventType, event.schemaVersion,
        event.effectiveAt, event.recordedAt, canonicalJson(event.actor), event.source, event.sourceReference ?? null, event.correlationId,
        event.causationId ?? null, event.idempotencyKey, event.previousHash, event.hash, canonicalJson(event.payload),
      );
      this.database.prepare(`INSERT INTO aggregate_heads (aggregate_type,aggregate_id,sequence,hash) VALUES (?,?,?,?) ON CONFLICT(aggregate_type,aggregate_id) DO UPDATE SET sequence=excluded.sequence, hash=excluded.hash`).run(event.aggregateType, event.aggregateId, event.sequence, event.hash);
      this.database.prepare("UPDATE event_store_metadata SET global_sequence = ?, global_hash = ? WHERE id = 1").run(event.globalSequence, event.hash);
      this.database.prepare("INSERT INTO idempotency_records (idempotency_key,request_hash,event_id,result_json) VALUES (?,?,?,?)").run(event.idempotencyKey, requestHash, event.eventId, JSON.stringify(event));
      return { event, duplicate: false };
    });
    return transaction.immediate() as AppendEventResult;
  }

  readAll(): readonly EventEnvelope[] {
    return (this.database.prepare("SELECT * FROM events ORDER BY global_sequence").all() as EventRow[]).map(mapRow);
  }

  readStream(aggregateType: string, aggregateId: string): readonly EventEnvelope[] {
    return (this.database.prepare("SELECT * FROM events WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY sequence").all(aggregateType, aggregateId) as EventRow[]).map(mapRow);
  }

  head(aggregateType: string, aggregateId: string): EventHead {
    const row = this.database.prepare("SELECT sequence, hash FROM aggregate_heads WHERE aggregate_type = ? AND aggregate_id = ?").get(aggregateType, aggregateId) as { sequence: number; hash: string | null } | undefined;
    return row ? { sequence: row.sequence, hash: row.hash } : { sequence: 0, hash: null };
  }

  verifyHashChain(): { valid: boolean; checked: number; error?: string } {
    let previous: string | null = null;
    const events = this.readAll();
    for (const event of events) {
      if (event.previousHash !== previous || computeEventHash(event) !== event.hash) return { valid: false, checked: events.indexOf(event), error: `Hash chain failed at global sequence ${event.globalSequence}.` };
      previous = event.hash;
    }
    return { valid: true, checked: events.length };
  }
}
