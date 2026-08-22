import type { EventEnvelope } from "../../domain/events/eventEnvelope";
import type { EventStore } from "./eventStorePort";

export interface AuditTimelineQuery {
  readonly kind: "audit-timeline";
  readonly aggregateType: string;
  readonly aggregateId: string;
}

export interface QueryResult<T> {
  readonly data: T;
  readonly sourceEventSequence: number;
  readonly projectionVersion: number;
  readonly generatedAt: string;
}

export class QueryGateway {
  constructor(private readonly store: EventStore, private readonly projectionVersion = 1, private readonly now: () => string = () => new Date().toISOString()) {}

  execute(query: AuditTimelineQuery): QueryResult<readonly EventEnvelope[]> {
    if (!query.aggregateType || !query.aggregateId) throw new TypeError("Audit timeline query requires aggregate type and id");
    const events = this.store.readStream(query.aggregateType, query.aggregateId);
    return { data: events, sourceEventSequence: events.at(-1)?.globalSequence ?? 0, projectionVersion: this.projectionVersion, generatedAt: this.now() };
  }
}
