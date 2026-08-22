import type { Actor, JsonValue } from "./eventEnvelope";

export interface AppendEventCommand {
  readonly kind: "append-event";
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly expectedSequence: number;
  readonly idempotencyKey: string;
  readonly effectiveAt: string;
  readonly recordedAt?: string;
  readonly actor: Actor;
  readonly source: string;
  readonly sourceReference?: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly payload: JsonValue;
}

export type Command = AppendEventCommand;
