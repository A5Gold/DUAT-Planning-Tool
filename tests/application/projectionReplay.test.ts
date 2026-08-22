import { describe, expect, it } from "vitest";
import { ProjectionRunner } from "../../src/application/events/projectionRunner";
import type { EventEnvelope } from "../../src/domain/events/eventEnvelope";

const event = (sequence: number, eventType: string, payload: Record<string, unknown>): EventEnvelope => ({
  eventId: `evt-${sequence}`,
  aggregateType: "Staff",
  aggregateId: "517968",
  sequence,
  globalSequence: sequence,
  eventType,
  schemaVersion: 1,
  effectiveAt: "2026-08-21T00:00:00.000Z",
  recordedAt: "2026-08-21T01:02:03.000Z",
  actor: { id: "planner-local", role: "Planner" },
  source: "test",
  sourceReference: undefined,
  correlationId: `cmd-${sequence}`,
  causationId: undefined,
  idempotencyKey: `key-${sequence}`,
  previousHash: null,
  hash: `sha256:${String(sequence).padStart(64, "0")}`,
  payload,
});

describe("projection replay", () => {
  it("keeps incremental and full replay equivalent and resumes from a snapshot", () => {
    const events = [event(1, "StaffCreated", { name: "YF Mak" }), event(2, "StaffRenamed", { name: "YF Mak updated" })];
    const runner = new ProjectionRunner({
      version: 1,
      initial: () => ({ name: "", changes: 0 }),
      reduce: (state, current) => ({
        name: String((current.payload as { name?: string }).name ?? state.name),
        changes: state.changes + 1,
      }),
    });
    expect(runner.replay(events)).toEqual({ state: { name: "YF Mak updated", changes: 2 }, lastGlobalSequence: 2 });
    const checkpoint = runner.replay(events.slice(0, 1));
    expect(runner.resume(checkpoint, events.slice(1))).toEqual(runner.replay(events));
  });

  it("fails explicitly for an unknown event schema version", () => {
    const runner = new ProjectionRunner({ version: 1, initial: () => 0, reduce: (state) => state });
    expect(() => runner.replay([{ ...event(1, "Unknown", {}), schemaVersion: 2 }])).toThrow(/schema version/);
  });
});
