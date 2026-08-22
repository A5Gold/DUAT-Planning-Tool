import { describe, expect, it } from "vitest";
import { CommandGateway } from "../../src/application/events/commandGateway";
import type { EventStore } from "../../src/application/events/eventStorePort";
import type { EventEnvelope } from "../../src/domain/events/eventEnvelope";

function fakeStore(): EventStore {
  const events: EventEnvelope[] = [];
  return {
    append: (input) => {
      const event = {
        ...input,
        sequence: events.length + 1,
        globalSequence: events.length + 1,
        eventId: input.eventId ?? `evt-${events.length + 1}`,
        previousHash: events.at(-1)?.hash ?? null,
        hash: "sha256:" + String(events.length + 1).padStart(64, "0"),
      } as EventEnvelope;
      events.push(event);
      return { event, duplicate: false };
    },
    readAll: () => [...events],
    readStream: () => [...events],
    head: () => ({ sequence: events.length, hash: events.at(-1)?.hash ?? null }),
    verifyHashChain: () => ({ valid: true, checked: events.length }),
  };
}

describe("typed command gateway", () => {
  it("validates permission and payload before appending", () => {
    const store = fakeStore();
    const gateway = new CommandGateway(store, {
      canExecute: (command) => command.actor.role === "Planner",
    });
    const result = gateway.execute({
      kind: "append-event",
      aggregateType: "Staff",
      aggregateId: "517968",
      eventType: "StaffCreated",
      schemaVersion: 1,
      expectedSequence: 0,
      idempotencyKey: "create:517968",
      effectiveAt: "2026-08-21T00:00:00.000Z",
      actor: { id: "planner-local", role: "Planner" },
      source: "test",
      payload: { staffNo: "517968" },
    });
    expect(result.ok).toBe(true);
    expect(gateway.execute({
      kind: "append-event",
      aggregateType: "Staff",
      aggregateId: "other",
      eventType: "StaffCreated",
      schemaVersion: 1,
      expectedSequence: 0,
      idempotencyKey: "denied",
      effectiveAt: "2026-08-21T00:00:00.000Z",
      actor: { id: "auditor", role: "Auditor" },
      source: "test",
      payload: {},
    })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });

  it("rejects malformed commands before touching the store", () => {
    const store = fakeStore();
    const gateway = new CommandGateway(store, { canExecute: () => true });
    expect(gateway.execute({
      kind: "append-event", aggregateType: "", aggregateId: "", eventType: "", schemaVersion: 0,
      expectedSequence: -1, idempotencyKey: "", effectiveAt: "", actor: { id: "", role: "Planner" }, source: "", payload: {},
    })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });
});
