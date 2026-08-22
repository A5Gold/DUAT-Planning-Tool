import { canonicalJson } from "../../domain/events/eventEnvelope";
import type { Command } from "../../domain/events/commands";
import type { EventStore } from "./eventStorePort";

export type CommandErrorCode = "INVALID_REQUEST" | "PERMISSION_DENIED" | "CONCURRENCY_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "SYSTEM_FAILURE";

export interface CommandError {
  readonly code: CommandErrorCode;
  readonly message: string;
}

export type CommandResult =
  | { readonly ok: true; readonly event: ReturnType<EventStore["append"]>["event"] }
  | { readonly ok: false; readonly error: CommandError };

export interface CommandGatewayPolicy {
  canExecute(command: Command): boolean;
  validate?(command: Command): readonly string[];
}

export class CommandGateway {
  constructor(private readonly store: EventStore, private readonly policy: CommandGatewayPolicy) {}

  execute(command: Command): CommandResult {
    const errors = this.policy.validate?.(command) ?? [];
    if (!Number.isInteger(command.expectedSequence) || command.expectedSequence < 0 || !Number.isInteger(command.schemaVersion) || command.schemaVersion < 1 || !command.effectiveAt || !command.actor.id || !command.actor.role || !command.source || !command.idempotencyKey || !command.aggregateType || !command.aggregateId || !command.eventType || errors.length > 0) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: errors.join("; ") || "Command is missing required fields." } };
    }
    if (!this.policy.canExecute(command)) return { ok: false, error: { code: "PERMISSION_DENIED", message: "Actor is not permitted to execute this command." } };
    try {
      const result = this.store.append({
        ...command,
        expectedSequence: command.expectedSequence,
        recordedAt: command.recordedAt ?? new Date().toISOString(),
        correlationId: command.correlationId ?? command.idempotencyKey,
      });
      return { ok: true, event: result.event };
    } catch (error) {
      const code = (error as { code?: CommandErrorCode }).code;
      if (code === "CONCURRENCY_CONFLICT" || code === "IDEMPOTENCY_CONFLICT") return { ok: false, error: { code, message: (error as Error).message } };
      return { ok: false, error: { code: "SYSTEM_FAILURE", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  requestHash(command: Command): string {
    return canonicalJson(command);
  }
}
