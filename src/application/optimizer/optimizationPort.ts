import type { Role, RoleAssignment, StaffAllocation } from "../../domain/reconstruction";
import type { PlanningSnapshot } from "../../domain/optimizer/planningSnapshot";
import type { AllocationProposal } from "./proposal";

export type OptimizationStatus =
  | "feasible"
  | "draft_with_shortage"
  | "infeasible"
  | "stale_snapshot"
  | "cancelled"
  | "timeout";

export interface OptimizationOptions {
  readonly runId: string;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly currentEventSequence?: number;
  readonly signal?: AbortSignal;
}

export type ExclusionReasonCode =
  | "excluded"
  | "roster_not_confirmed"
  | "qualification_missing_or_invalid"
  | "scope_mismatch"
  | "cross_job_overlap"
  | "role_conflict"
  | "spc_support_unavailable";

export interface ShortageExplanation {
  readonly requirementId: string;
  readonly jobId: string;
  readonly role: Role;
  readonly required: number;
  readonly assigned: number;
  readonly shortage: number;
  readonly candidateExclusions: Readonly<Record<ExclusionReasonCode, number>>;
  readonly message: string;
}

export interface ObjectiveBreakdown {
  readonly requiredRolesFilled: number;
  readonly safetyCriticalRolesFilled: number;
  readonly existingAssignmentsPreserved: number;
  readonly reservedStaffUsed: number;
  readonly spcOverlaysUsed: number;
}

export interface ConstraintConflict {
  readonly code: string;
  readonly message: string;
  readonly assignmentId?: string;
  readonly staffId?: string;
  readonly jobId?: string;
}

export interface OptimizationProgress {
  readonly runId: string;
  readonly phase: "validating" | "solving" | "explaining" | "completed";
  readonly completed: number;
  readonly total: number;
  readonly message: string;
}

export interface OptimizationResult {
  readonly runId: string;
  readonly status: OptimizationStatus;
  readonly snapshotId: string;
  readonly snapshotSequence: number;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly solverVersion: string;
  readonly seed: number;
  readonly inputChecksum: string;
  readonly allocations: readonly StaffAllocation[];
  readonly assignments: readonly RoleAssignment[];
  readonly unassignedRequirements: readonly ShortageExplanation[];
  readonly conflictExplanations: readonly ConstraintConflict[];
  readonly objective: ObjectiveBreakdown;
  readonly proposal: AllocationProposal;
  readonly runtimeMs: number;
  readonly timedOut: boolean;
}

export interface OptimizationPort {
  run(
    input: PlanningSnapshot,
    options: OptimizationOptions,
  ): AsyncGenerator<OptimizationProgress, OptimizationResult, void>;
}

export async function collectOptimizationRun(
  run: AsyncGenerator<OptimizationProgress, OptimizationResult, void>,
  onProgress?: (progress: OptimizationProgress) => void,
): Promise<OptimizationResult> {
  while (true) {
    const next = await run.next();
    if (next.done) return next.value;
    onProgress?.(next.value);
  }
}
