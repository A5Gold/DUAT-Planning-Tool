import { createHash, randomUUID } from "node:crypto";

export interface Actor {
  readonly id: string;
  readonly role: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface EventEnvelopeInput {
  readonly eventId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly globalSequence?: number;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly effectiveAt: string;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly source: string;
  readonly sourceReference?: string;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly idempotencyKey: string;
  readonly previousHash?: string | null;
  readonly payload: JsonValue;
}

export interface EventEnvelope extends EventEnvelopeInput {
  readonly eventId: string;
  readonly globalSequence: number;
  readonly previousHash: string | null;
  readonly hash: string;
}

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && value !== undefined) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  throw new TypeError("Event payload must contain only JSON-compatible values");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function hashInput(envelope: EventEnvelopeInput): string {
  return canonicalJson({
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    sequence: envelope.sequence,
    eventType: envelope.eventType,
    schemaVersion: envelope.schemaVersion,
    effectiveAt: envelope.effectiveAt,
    recordedAt: envelope.recordedAt,
    actor: envelope.actor,
    source: envelope.source,
    sourceReference: envelope.sourceReference,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId ?? null,
    idempotencyKey: envelope.idempotencyKey,
    previousHash: envelope.previousHash ?? null,
    payload: envelope.payload,
  });
}

export function computeEventHash(envelope: EventEnvelope): string {
  return `sha256:${createHash("sha256").update(hashInput(envelope), "utf8").digest("hex")}`;
}

export function createEventEnvelope(input: EventEnvelopeInput): EventEnvelope {
  const envelope: EventEnvelope = {
    ...input,
    eventId: input.eventId ?? randomUUID(),
    globalSequence: input.globalSequence ?? 0,
    previousHash: input.previousHash ?? null,
    payload: normalize(input.payload),
    hash: "",
  };
  return { ...envelope, hash: `sha256:${createHash("sha256").update(hashInput(envelope), "utf8").digest("hex")}` };
}
