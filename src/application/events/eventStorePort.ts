import type { EventEnvelope, EventEnvelopeInput } from "../../domain/events/eventEnvelope";

export interface AppendEventInput extends Omit<EventEnvelopeInput, "eventId" | "sequence" | "globalSequence" | "previousHash" | "recordedAt" | "correlationId"> {
  readonly eventId?: string;
  readonly recordedAt?: string;
  readonly correlationId?: string;
  readonly expectedSequence: number;
}

export interface EventHead {
  readonly sequence: number;
  readonly hash: string | null;
}

export interface AppendEventResult {
  readonly event: EventEnvelope;
  readonly duplicate: boolean;
}

export interface EventStore {
  append(input: AppendEventInput): AppendEventResult;
  readAll(): readonly EventEnvelope[];
  readStream(aggregateType: string, aggregateId: string): readonly EventEnvelope[];
  head(aggregateType: string, aggregateId: string): EventHead;
  verifyHashChain(): { readonly valid: boolean; readonly checked: number; readonly error?: string };
}
