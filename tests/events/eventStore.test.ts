import { afterEach, describe, expect, it } from "vitest";
import { createEventDatabase } from "../../src/adapters/sqlite/eventDatabase";
import { SQLiteEventStore, EventStoreError } from "../../src/adapters/sqlite/eventStore";
import type { Actor } from "../../src/domain/events/eventEnvelope";

const actor: Actor = { id: "planner-local", role: "Planner" };
const base = {
  aggregateType: "Staff",
  aggregateId: "517968",
  eventType: "StaffCreated",
  schemaVersion: 1,
  effectiveAt: "2026-08-21T00:00:00.000Z",
  recordedAt: "2026-08-21T01:02:03.000Z",
  actor,
  source: "test",
  sourceReference: "fixture",
  correlationId: "cmd-1",
  causationId: null,
  idempotencyKey: "staff:create:517968",
  payload: { staffNo: "517968", displayName: "YF Mak" },
};

describe("SQLite event store", () => {
  let database: ReturnType<typeof createEventDatabase> | undefined;
  afterEach(() => database?.close());

  it("starts a clean event schema and appends a global and aggregate sequence", () => {
    database = createEventDatabase(":memory:");
    const store = new SQLiteEventStore(database);
    const first = store.append({ ...base, expectedSequence: 0 });
    const second = store.append({
      ...base,
      eventId: "evt-2",
      eventType: "StaffRenamed",
      idempotencyKey: "staff:rename:517968",
      expectedSequence: 1,
      payload: { displayName: "YF Mak (updated)" },
    });
    expect(first.event.sequence).toBe(1);
    expect(second.event.sequence).toBe(2);
    expect(first.event.globalSequence).toBe(1);
    expect(second.event.globalSequence).toBe(2);
    expect(second.event.previousHash).toBe(first.event.hash);
    expect(store.readStream("Staff", "517968")).toHaveLength(2);
    expect(store.verifyHashChain()).toEqual({ valid: true, checked: 2 });
  });

  it("rejects stale aggregate sequences and preserves the stream", () => {
    database = createEventDatabase(":memory:");
    const store = new SQLiteEventStore(database);
    store.append({ ...base, expectedSequence: 0 });
    expect(() => store.append({ ...base, eventId: "evt-stale", idempotencyKey: "stale", expectedSequence: 0 })).toThrowError(
      expect.objectContaining({ code: "CONCURRENCY_CONFLICT" }),
    );
    expect(store.readAll()).toHaveLength(1);
  });

  it("returns the original result for an idempotent retry and rejects a changed request", () => {
    database = createEventDatabase(":memory:");
    const store = new SQLiteEventStore(database);
    const first = store.append({ ...base, expectedSequence: 0 });
    const retry = store.append({ ...base, expectedSequence: 0, eventId: "different-event-id" });
    expect(retry.event.eventId).toBe(first.event.eventId);
    expect(store.readAll()).toHaveLength(1);
    expect(() => store.append({ ...base, expectedSequence: 0, payload: { staffNo: "other" } })).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
    );
  });

  it("rejects malformed future schema metadata", () => {
    database = createEventDatabase(":memory:");
    database.prepare("UPDATE event_store_metadata SET schema_version = 99").run();
    expect(() => new SQLiteEventStore(database!)).toThrow(/newer than this application supports/);
  });
});

void EventStoreError;
