import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeEventHash,
  createEventEnvelope,
  type EventEnvelopeInput,
} from "../../src/domain/events/eventEnvelope";

const input: EventEnvelopeInput = {
  eventId: "evt-1",
  aggregateType: "Staff",
  aggregateId: "517968",
  sequence: 1,
  eventType: "StaffCreated",
  schemaVersion: 1,
  effectiveAt: "2026-08-21T00:00:00.000Z",
  recordedAt: "2026-08-21T01:02:03.000Z",
  actor: { id: "planner-local", role: "Planner" },
  source: "test",
  sourceReference: "fixture",
  correlationId: "cmd-1",
  causationId: undefined,
  idempotencyKey: "staff:create:517968",
  previousHash: null,
  payload: { displayName: "YF Mak", staffNo: "517968", tags: ["S1", "夜班"] },
};

describe("event envelope", () => {
  it("canonicalizes object keys without changing array order or unicode", () => {
    expect(canonicalJson({ b: 1, a: { d: "夜班", c: true }, list: [2, 1] })).toBe(
      '{"a":{"c":true,"d":"夜班"},"b":1,"list":[2,1]}',
    );
  });

  it("creates a deterministic hash chain envelope", () => {
    const first = createEventEnvelope(input);
    const second = createEventEnvelope({ ...input, payload: { staffNo: "517968", displayName: "YF Mak", tags: ["S1", "夜班"] } });
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.hash).toBe(second.hash);
    expect(computeEventHash(first)).toBe(first.hash);
  });

  it("changes the hash when the previous hash or payload changes", () => {
    const first = createEventEnvelope(input);
    expect(computeEventHash({ ...first, previousHash: "sha256:" + "a".repeat(64) })).not.toBe(first.hash);
    expect(computeEventHash({ ...first, payload: { ...first.payload, displayName: "Other" } })).not.toBe(first.hash);
  });
});
