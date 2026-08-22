import { createHash } from "node:crypto";

import { canonicalJson } from "../events/eventEnvelope";
import type {
  Job,
  QualificationVariant,
  RoleAssignment,
  StaffAllocation,
} from "../reconstruction";

export type CredentialStatus = "active" | "suspended" | "revoked";

export interface SnapshotCredential {
  readonly variant: QualificationVariant;
  readonly scope?: string;
  readonly validFrom: string;
  readonly validTo?: string;
  readonly status: CredentialStatus;
}

export interface SnapshotStaff {
  readonly staffId: string;
  readonly staffNo: string;
  readonly displayName: string;
  readonly teamId?: string;
  readonly availability: "confirmed" | "unknown" | "unavailable";
  readonly rawRosterCode?: string;
  readonly credentials: readonly SnapshotCredential[];
}

export interface PlanningSnapshotInput {
  readonly snapshotId: string;
  readonly eventSequence: number;
  readonly generatedAt: string;
  readonly workDate: string;
  readonly scenarioId: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly jobs: readonly Job[];
  readonly staff: readonly SnapshotStaff[];
  readonly allocations?: readonly StaffAllocation[];
  readonly assignments?: readonly RoleAssignment[];
  readonly lockedAllocationIds?: readonly string[];
  readonly reservedStaffIds?: readonly string[];
  readonly excludedStaffIds?: readonly string[];
}

export interface PlanningSnapshot extends PlanningSnapshotInput {
  readonly allocations: readonly StaffAllocation[];
  readonly assignments: readonly RoleAssignment[];
  readonly lockedAllocationIds: readonly string[];
  readonly reservedStaffIds: readonly string[];
  readonly excludedStaffIds: readonly string[];
  readonly inputChecksum: string;
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  }
  if (value !== null && typeof value === "object") {
    const clone = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, cloneAndFreeze(child)]),
    );
    return Object.freeze(clone) as T;
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate identifiers`);
  }
}

/** Compile a detached, deeply immutable optimizer input at one event sequence. */
export function compilePlanningSnapshot(input: PlanningSnapshotInput): PlanningSnapshot {
  if (!Number.isSafeInteger(input.eventSequence) || input.eventSequence < 0) {
    throw new Error("eventSequence must be a non-negative safe integer");
  }
  assertUnique(input.jobs.map((job) => job.id), "jobs");
  assertUnique(input.staff.map((staff) => staff.staffId), "staff");

  const normalized = {
    ...input,
    jobs: [...input.jobs].sort((left, right) => left.id.localeCompare(right.id)),
    staff: [...input.staff].sort((left, right) => left.staffId.localeCompare(right.staffId)),
    allocations: [...(input.allocations ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    assignments: [...(input.assignments ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    lockedAllocationIds: [...new Set(input.lockedAllocationIds ?? [])].sort(),
    reservedStaffIds: [...new Set(input.reservedStaffIds ?? [])].sort(),
    excludedStaffIds: [...new Set(input.excludedStaffIds ?? [])].sort(),
    policyVersions: Object.fromEntries(Object.entries(input.policyVersions).sort(([left], [right]) => left.localeCompare(right))),
  };
  const inputChecksum = `sha256:${createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex")}`;
  return cloneAndFreeze({ ...normalized, inputChecksum });
}

export function isCredentialValidOn(credential: SnapshotCredential, workDate: string): boolean {
  return credential.status === "active"
    && credential.validFrom <= workDate
    && (!credential.validTo || credential.validTo >= workDate);
}
