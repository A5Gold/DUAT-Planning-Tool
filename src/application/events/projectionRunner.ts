import type { EventEnvelope } from "../../domain/events/eventEnvelope";

export interface ProjectionDefinition<State> {
  readonly version: number;
  initial(): State;
  reduce(state: State, event: EventEnvelope): State;
  supportsSchemaVersion?(event: EventEnvelope): boolean;
}

export interface ProjectionCheckpoint<State> {
  readonly state: State;
  readonly lastGlobalSequence: number;
}

export class ProjectionRunner<State> {
  constructor(private readonly definition: ProjectionDefinition<State>) {}

  replay(events: readonly EventEnvelope[]): ProjectionCheckpoint<State> {
    return this.resume({ state: this.definition.initial(), lastGlobalSequence: 0 }, events);
  }

  resume(checkpoint: ProjectionCheckpoint<State>, events: readonly EventEnvelope[]): ProjectionCheckpoint<State> {
    let state = checkpoint.state;
    let lastGlobalSequence = checkpoint.lastGlobalSequence;
    for (const event of events) {
      if (event.globalSequence <= lastGlobalSequence) continue;
      if (event.schemaVersion !== this.definition.version && !this.definition.supportsSchemaVersion?.(event)) {
        throw new Error(`Projection does not support event schema version ${event.schemaVersion}.`);
      }
      state = this.definition.reduce(state, event);
      lastGlobalSequence = event.globalSequence;
    }
    return { state, lastGlobalSequence };
  }
}
