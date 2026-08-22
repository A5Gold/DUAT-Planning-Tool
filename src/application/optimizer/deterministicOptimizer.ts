import {
  isCredentialValidOn,
  type PlanningSnapshot,
} from "../../domain/optimizer/planningSnapshot";
import type {
  Job,
  Role,
  RoleAssignment,
  RoleRequirement,
  StaffAllocation,
  Work,
} from "../../domain/reconstruction";
import { validateAllocationInvariants } from "../../domain/reconstruction";
import {
  buildProposal,
  type AllocationProposal,
} from "./proposal";
import type {
  ExclusionReasonCode,
  ConstraintConflict,
  ObjectiveBreakdown,
  OptimizationOptions,
  OptimizationPort,
  OptimizationProgress,
  OptimizationResult,
  ShortageExplanation,
} from "./optimizationPort";

const SOLVER_VERSION = "deterministic-fallback-1";
const DEFAULT_SEED = 0;

interface WorkingState {
  readonly allocations: StaffAllocation[];
  readonly assignments: RoleAssignment[];
}

interface CandidateCheck {
  readonly accepted: boolean;
  readonly reason?: ExclusionReasonCode;
}

function allRequirements(snapshot: PlanningSnapshot): RoleRequirement[] {
  return snapshot.jobs
    .flatMap((job) => job.works.flatMap((work) => work.roleRequirements))
    .filter((requirement) => requirement.requiredness === "required" || requirement.requiredness === "enabled-required")
    .sort((left, right) => left.id.localeCompare(right.id));
}

function findWork(snapshot: PlanningSnapshot, requirement: RoleRequirement): { job: Job; work: Work } | undefined {
  for (const job of snapshot.jobs) {
    const work = job.works.find((candidate) => candidate.roleRequirements.some((item) => item.id === requirement.id));
    if (work) return { job, work };
  }
  return undefined;
}

function overlaps(left: StaffAllocation, right: StaffAllocation): boolean {
  return left.workDate === right.workDate && left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function requirementAcceptsStaff(
  snapshot: PlanningSnapshot,
  role: Role,
  requirement: RoleRequirement,
  staffId: string,
): CandidateCheck {
  const staff = snapshot.staff.find((candidate) => candidate.staffId === staffId);
  if (!staff || staff.availability !== "confirmed") return { accepted: false, reason: "roster_not_confirmed" };
  if (snapshot.excludedStaffIds.includes(staffId)) return { accepted: false, reason: "excluded" };
  if (role === "SPC") return { accepted: true };
  const qualifications = requirement.qualificationPredicate.qualifications ?? [];
  const validCredentials = staff.credentials.filter((credential) => isCredentialValidOn(credential, snapshot.workDate));
  const variantMatches = (variant: string) => validCredentials.some((credential) => credential.variant === variant);
  const scopedMatches = (variant: string) => validCredentials.some((credential) =>
    credential.variant === variant
    && (!requirement.qualificationPredicate.scope || credential.scope === requirement.qualificationPredicate.scope),
  );
  if (requirement.qualificationPredicate.scope
    && qualifications.some(variantMatches)
    && !qualifications.some(scopedMatches)) {
    return { accepted: false, reason: "scope_mismatch" };
  }
  const valid = requirement.qualificationPredicate.operator === "all"
    ? qualifications.every(scopedMatches)
    : requirement.qualificationPredicate.operator === "none"
      ? qualifications.every((variant) => !scopedMatches(variant))
      : qualifications.some(scopedMatches);
  if (!valid) return { accepted: false, reason: "qualification_missing_or_invalid" };
  return { accepted: true };
}

function checkCandidate(
  snapshot: PlanningSnapshot,
  state: WorkingState,
  requirement: RoleRequirement,
  work: Work,
  staffId: string,
): CandidateCheck {
  const base = requirementAcceptsStaff(snapshot, requirement.role, requirement, staffId);
  if (!base.accepted) return base;
  const allocation: StaffAllocation = {
    id: `candidate:${requirement.id}:${staffId}`,
    staffId,
    jobId: work.jobId,
    workDate: snapshot.workDate,
    startsAt: work.startsAt,
    endsAt: work.endsAt,
    rosterAvailability: "confirmed",
  };
  const sameStaff = state.allocations.filter((candidate) => candidate.staffId === staffId && overlaps(candidate, allocation));
  for (const current of sameStaff) {
    if (current.jobId !== work.jobId) return { accepted: false, reason: "cross_job_overlap" };
    const currentRoles = state.assignments.filter((assignment) => assignment.allocationId === current.id);
    if (requirement.role !== "SPC" && currentRoles.some((assignment) => assignment.role !== "SPC")) {
      return { accepted: false, reason: "role_conflict" };
    }
    if (requirement.role === "SPC" && currentRoles.some((assignment) => assignment.role === "SPC")) {
      return { accepted: false, reason: "role_conflict" };
    }
  }
  if (requirement.role === "SPC") {
    const primaryRoles = state.assignments.filter((assignment) => {
      if (assignment.staffId !== staffId || assignment.jobId !== work.jobId || assignment.role === "SPC") return false;
      const currentAllocation = state.allocations.find((candidate) => candidate.id === assignment.allocationId);
      return Boolean(currentAllocation && overlaps(currentAllocation, allocation));
    });
    if (primaryRoles.length !== 1) return { accepted: false, reason: "spc_support_unavailable" };
    const sameJobAp = state.assignments.some((assignment) =>
      assignment.jobId === work.jobId && assignment.role === "AP" && assignment.staffId !== staffId,
    );
    if (!sameJobAp) return { accepted: false, reason: "spc_support_unavailable" };
  }
  return { accepted: true };
}

function explanation(
  requirement: RoleRequirement,
  jobId: string,
  assigned: number,
  counts: Partial<Record<ExclusionReasonCode, number>>,
): ShortageExplanation {
  const shortage = Math.max(0, requirement.quantity - assigned);
  const candidateExclusions = {
    excluded: counts.excluded ?? 0,
    roster_not_confirmed: counts.roster_not_confirmed ?? 0,
    qualification_missing_or_invalid: counts.qualification_missing_or_invalid ?? 0,
    scope_mismatch: counts.scope_mismatch ?? 0,
    cross_job_overlap: counts.cross_job_overlap ?? 0,
    role_conflict: counts.role_conflict ?? 0,
    spc_support_unavailable: counts.spc_support_unavailable ?? 0,
  } satisfies Record<ExclusionReasonCode, number>;
  const causes = (Object.entries(candidateExclusions) as [ExclusionReasonCode, number][])
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${code}=${count}`)
    .join(", ");
  return {
    requirementId: requirement.id,
    jobId,
    role: requirement.role,
    required: requirement.quantity,
    assigned,
    shortage,
    candidateExclusions,
    message: shortage > 0
      ? `${requirement.role} 尚缺少 ${shortage} 人${causes ? `；候選排除：${causes}` : ""}`
      : "Requirement 已滿足",
  };
}

function makeResult(
  snapshot: PlanningSnapshot,
  options: OptimizationOptions,
  status: OptimizationResult["status"],
  before: WorkingState,
  state: WorkingState,
  unassignedRequirements: readonly ShortageExplanation[],
  objective: ObjectiveBreakdown,
  conflictExplanations: readonly ConstraintConflict[],
  startedAt: number,
  timedOut: boolean,
): OptimizationResult {
  const proposal: AllocationProposal = buildProposal({
    proposalId: `proposal:${options.runId}`,
    runId: options.runId,
    snapshotId: snapshot.snapshotId,
    snapshotSequence: snapshot.eventSequence,
    createdAt: snapshot.generatedAt,
    beforeAllocations: before.allocations,
    beforeAssignments: before.assignments,
    afterAllocations: state.allocations,
    afterAssignments: state.assignments,
    lockedAllocationIds: snapshot.lockedAllocationIds,
  });
  return Object.freeze({
    runId: options.runId,
    status,
    snapshotId: snapshot.snapshotId,
    snapshotSequence: snapshot.eventSequence,
    policyVersions: snapshot.policyVersions,
    solverVersion: SOLVER_VERSION,
    seed: options.seed ?? DEFAULT_SEED,
    inputChecksum: snapshot.inputChecksum,
    allocations: Object.freeze([...state.allocations]),
    assignments: Object.freeze([...state.assignments]),
    unassignedRequirements: Object.freeze([...unassignedRequirements]),
    conflictExplanations: Object.freeze([...conflictExplanations]),
    objective,
    proposal,
    runtimeMs: Date.now() - startedAt,
    timedOut,
  });
}

/**
 * Deterministic, explainable fallback optimizer. It never appends events or publishes a plan.
 * A native solver can implement the same OptimizationPort later.
 */
export class DeterministicOptimizer implements OptimizationPort {
  async *run(snapshot: PlanningSnapshot, options: OptimizationOptions): AsyncGenerator<OptimizationProgress, OptimizationResult, void> {
    const startedAt = Date.now();
    const before: WorkingState = {
      allocations: [...snapshot.allocations],
      assignments: [...snapshot.assignments],
    };
    const state: WorkingState = { allocations: [...before.allocations], assignments: [...before.assignments] };
    const requirements = allRequirements(snapshot);
    yield { runId: options.runId, phase: "validating", completed: 0, total: requirements.length, message: "Snapshot 與 policy 驗證中" };

    if (options.currentEventSequence !== undefined && options.currentEventSequence !== snapshot.eventSequence) {
      return makeResult(snapshot, options, "stale_snapshot", before, state, [], {
        requiredRolesFilled: 0, safetyCriticalRolesFilled: 0, existingAssignmentsPreserved: before.assignments.length,
        reservedStaffUsed: 0, spcOverlaysUsed: 0,
      }, [], startedAt, false);
    }
    if (options.signal?.aborted) {
      return makeResult(snapshot, options, "cancelled", before, state, [], {
        requiredRolesFilled: 0, safetyCriticalRolesFilled: 0, existingAssignmentsPreserved: before.assignments.length,
        reservedStaffUsed: 0, spcOverlaysUsed: 0,
      }, [], startedAt, false);
    }

    const shortages: ShortageExplanation[] = [];
    let filled = 0;
    let safetyFilled = 0;
    let reservedUsed = 0;
    let spcOverlays = 0;
    for (let index = 0; index < requirements.length; index += 1) {
      const requirement = requirements[index];
      const target = findWork(snapshot, requirement);
      if (!target) continue;
      const assigned = () => state.assignments.filter((assignment) => assignment.requirementId === requirement.id).length;
      const counts: Partial<Record<ExclusionReasonCode, number>> = {};
      while (assigned() < requirement.quantity) {
        let selected: string | undefined;
        for (const staff of [...snapshot.staff].sort((left, right) => {
          const reserveOrder = Number(snapshot.reservedStaffIds.includes(left.staffId)) - Number(snapshot.reservedStaffIds.includes(right.staffId));
          return reserveOrder || left.staffId.localeCompare(right.staffId);
        })) {
          const check = checkCandidate(snapshot, state, requirement, target.work, staff.staffId);
          if (!check.accepted) {
            if (check.reason) counts[check.reason] = (counts[check.reason] ?? 0) + 1;
            continue;
          }
          selected = staff.staffId;
          break;
        }
        if (!selected) break;
        const existingOverlayAllocation = requirement.role === "SPC"
          ? state.allocations.find((candidate) => candidate.staffId === selected && candidate.jobId === target.work.jobId)
          : undefined;
        const allocationId = existingOverlayAllocation?.id ?? `opt:${options.runId}:${requirement.id}:${selected}:${assigned()}`;
        const allocation: StaffAllocation = {
          id: allocationId,
          staffId: selected,
          jobId: target.work.jobId,
          workDate: snapshot.workDate,
          startsAt: target.work.startsAt,
          endsAt: target.work.endsAt,
          rosterAvailability: "confirmed",
        };
        const support = requirement.role === "SPC"
          ? state.assignments.find((assignment) => assignment.jobId === target.work.jobId && assignment.role === "AP" && assignment.staffId !== selected)?.id
          : undefined;
        const assignment: RoleAssignment = {
          id: `opt-role:${options.runId}:${requirement.id}:${selected}:${assigned()}`,
          allocationId,
          staffId: selected,
          jobId: target.work.jobId,
          role: requirement.role,
          requirementId: requirement.id,
          ...(support ? { supportsAssignmentId: support } : {}),
        };
        if (!existingOverlayAllocation) state.allocations.push(allocation);
        state.assignments.push(assignment);
        filled += 1;
        if (requirement.role === "AP" || requirement.role === "CP") safetyFilled += 1;
        if (snapshot.reservedStaffIds.includes(selected)) reservedUsed += 1;
        if (requirement.role === "SPC") spcOverlays += 1;
      }
      const requirementAssigned = assigned();
      if (requirementAssigned < requirement.quantity) shortages.push(explanation(requirement, target.job.id, requirementAssigned, counts));
      yield {
        runId: options.runId,
        phase: "solving",
        completed: index + 1,
        total: requirements.length,
        message: `${requirement.id} 已處理`,
      };
      if (options.signal?.aborted) {
        return makeResult(snapshot, options, "cancelled", before, state, shortages, {
          requiredRolesFilled: filled, safetyCriticalRolesFilled: safetyFilled,
          existingAssignmentsPreserved: before.assignments.length, reservedStaffUsed: reservedUsed, spcOverlaysUsed: spcOverlays,
        }, [], startedAt, false);
      }
      if (options.timeoutMs !== undefined && Date.now() - startedAt >= options.timeoutMs) {
        return makeResult(snapshot, options, "timeout", before, state, shortages, {
          requiredRolesFilled: filled, safetyCriticalRolesFilled: safetyFilled,
          existingAssignmentsPreserved: before.assignments.length, reservedStaffUsed: reservedUsed, spcOverlaysUsed: spcOverlays,
        }, [], startedAt, true);
      }
    }
    const invariantIssues = validateAllocationInvariants({ allocations: state.allocations, assignments: state.assignments });
    const conflicts: ConstraintConflict[] = invariantIssues.map(({ code, message, assignmentId, staffId, jobId }) => ({
      code, message, assignmentId, staffId, jobId,
    }));
    for (const assignment of state.assignments) {
      const requirement = requirements.find((candidate) => candidate.id === assignment.requirementId);
      if (!requirement) continue;
      const check = requirementAcceptsStaff(snapshot, assignment.role, requirement, assignment.staffId);
      if (!check.accepted) conflicts.push({
        code: `EXISTING_ASSIGNMENT_${check.reason ?? "INVALID"}`.toUpperCase(),
        message: `既有 ${assignment.role} assignment 不符合 ${check.reason ?? "hard constraint"}。`,
        assignmentId: assignment.id,
        staffId: assignment.staffId,
        jobId: assignment.jobId,
      });
    }
    const hasBlockingInvariant = conflicts.length > 0;
    yield { runId: options.runId, phase: "explaining", completed: requirements.length, total: requirements.length, message: "產生短缺與規則證據" };
    const assignedRequired = state.assignments.filter((assignment) => requirements.some((requirement) => requirement.id === assignment.requirementId)).length;
    const status: OptimizationResult["status"] = shortages.length === requirements.length && requirements.length > 0 && assignedRequired === 0
      ? "infeasible"
      : shortages.length > 0 || hasBlockingInvariant ? "draft_with_shortage" : "feasible";
    const result = makeResult(snapshot, options, status, before, state, shortages, {
      requiredRolesFilled: filled, safetyCriticalRolesFilled: safetyFilled,
      existingAssignmentsPreserved: before.assignments.length, reservedStaffUsed: reservedUsed, spcOverlaysUsed: spcOverlays,
    }, conflicts, startedAt, false);
    yield { runId: options.runId, phase: "completed", completed: requirements.length, total: requirements.length, message: `Optimizer ${status}` };
    return result;
  }
}
