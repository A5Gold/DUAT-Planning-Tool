import type { ISODate, Role, RoleRequirement } from "./workDemand";

export type RosterAvailability = "confirmed" | "unknown" | "unavailable";

export interface StaffAllocation {
  readonly id: string;
  readonly staffId: string;
  readonly jobId: string;
  readonly workDate: ISODate;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly rosterAvailability: RosterAvailability;
}

export interface RoleAssignment {
  readonly id: string;
  readonly allocationId: string;
  readonly staffId: string;
  readonly jobId: string;
  readonly role: Role;
  readonly requirementId: string;
  readonly supportsAssignmentId?: string;
}

export interface AllocationValidationIssue {
  readonly code: string;
  readonly blocking: true;
  readonly message: string;
  readonly assignmentId?: string;
  readonly staffId?: string;
  readonly jobId?: string;
}

export interface AllocationValidationInput {
  readonly allocations: readonly StaffAllocation[];
  readonly assignments: readonly RoleAssignment[];
  readonly requirements?: readonly RoleRequirement[];
}

const overlaps = (a: StaffAllocation, b: StaffAllocation): boolean =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

const issue = (code: string, message: string, extra: Partial<AllocationValidationIssue> = {}): AllocationValidationIssue => ({
  code,
  blocking: true,
  message,
  ...extra,
});

/** Validate hard allocation invariants for planned allocations. */
export function validateAllocationInvariants(input: AllocationValidationInput): readonly AllocationValidationIssue[] {
  const issues: AllocationValidationIssue[] = [];
  const allocationById = new Map(input.allocations.map((allocation) => [allocation.id, allocation]));
  const assignmentsByStaff = new Map<string, RoleAssignment[]>();
  for (const assignment of input.assignments) {
    const allocation = allocationById.get(assignment.allocationId);
    if (!allocation) {
      issues.push(issue("ALLOCATION_NOT_FOUND", "Role assignment 指向不存在的 StaffAllocation。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
      continue;
    }
    if (allocation.staffId !== assignment.staffId || allocation.jobId !== assignment.jobId) {
      issues.push(issue("ALLOCATION_IDENTITY_MISMATCH", "Role assignment 與 StaffAllocation 身份不一致。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
    }
    const staffRows = assignmentsByStaff.get(assignment.staffId) ?? [];
    staffRows.push(assignment);
    assignmentsByStaff.set(assignment.staffId, staffRows);
    if (allocation.rosterAvailability !== "confirmed") {
      issues.push(issue("ROSTER_NOT_CONFIRMED", "未知或不可用 Roster 不計入可用人力。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
    }
  }

  for (const assignment of input.assignments) {
    if (assignment.role !== "SPC") continue;
    const allocation = allocationById.get(assignment.allocationId);
    if (!allocation) continue;
    const sameJobRows = (assignmentsByStaff.get(assignment.staffId) ?? []).filter((item) => item.jobId === assignment.jobId);
    const otherRoles = sameJobRows.filter((item) => {
      if (item.id === assignment.id) return false;
      const otherAllocation = allocationById.get(item.allocationId);
      return Boolean(otherAllocation && overlaps(allocation, otherAllocation));
    });
    if (otherRoles.length !== 1 || otherRoles[0].role === "SPC") {
      issues.push(issue("SPC_OVERLAY_LIMIT", "SPC 只能在同一 Job 兼任一個其他角色。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
    } else if (otherRoles[0].jobId !== assignment.jobId) {
      issues.push(issue("SPC_CROSS_JOB", "SPC overlay 必須與主角色位於同一 Job。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
    }
    if (!assignment.supportsAssignmentId || assignment.supportsAssignmentId === assignment.id) {
      issues.push(issue("SPC_SUPPORT_REQUIRED", "SPC 必須支援另一名 AP，且不可 self-support。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
    } else {
      const supported = input.assignments.find((item) => item.id === assignment.supportsAssignmentId);
      if (!supported || supported.role !== "AP" || supported.staffId === assignment.staffId || supported.jobId !== assignment.jobId) {
        issues.push(issue("SPC_SUPPORT_INVALID", "SPC support link 必須指向同一 Job 的另一名 AP。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
      }
    }
  }

  for (const [staffId, rows] of assignmentsByStaff) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const left = rows[i];
        const right = rows[j];
        const leftAllocation = allocationById.get(left.allocationId);
        const rightAllocation = allocationById.get(right.allocationId);
        if (!leftAllocation || !rightAllocation || leftAllocation.workDate !== rightAllocation.workDate || !overlaps(leftAllocation, rightAllocation)) continue;
        if ((left.role === "AP" && right.role === "CP") || (left.role === "CP" && right.role === "AP")) {
          issues.push(issue("AP_CP_SAME_PERSON", "同一人不可同時擔任 AP 與 CP。", { staffId, jobId: left.jobId }));
        }
        if (left.jobId === right.jobId && left.role !== "SPC" && right.role !== "SPC" && left.role !== right.role) {
          issues.push(issue("MULTIPLE_PRIMARY_ROLES", "只有 SPC 可以兼任第二個角色。", { staffId, jobId: left.jobId }));
        }
      }
    }
  }

  if (input.requirements) {
    const requirementById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));
    const assignedByRequirement = new Map<string, RoleAssignment[]>();
    for (const assignment of input.assignments) {
      const requirement = requirementById.get(assignment.requirementId);
      if (!requirement) {
        issues.push(issue("ROLE_REQUIREMENT_NOT_FOUND", "Role assignment 指向不存在的 RoleRequirement。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
      } else if (requirement.role !== assignment.role) {
        issues.push(issue("ROLE_REQUIREMENT_ROLE_MISMATCH", "Role assignment 與 RoleRequirement 角色不一致。", { assignmentId: assignment.id, staffId: assignment.staffId, jobId: assignment.jobId }));
      }
      const rows = assignedByRequirement.get(assignment.requirementId) ?? [];
      rows.push(assignment);
      assignedByRequirement.set(assignment.requirementId, rows);
    }
    for (const requirement of input.requirements) {
      const assigned = assignedByRequirement.get(requirement.id)?.length ?? 0;
      const isRequired = requirement.requiredness === "required" || requirement.requiredness === "enabled-required";
      if (isRequired && assigned < requirement.quantity) {
        issues.push(issue("ROLE_REQUIREMENT_SHORTAGE", `${requirement.role} requirement 尚缺少 ${requirement.quantity - assigned} 人。`, { jobId: requirement.scopeId }));
      }
      if (assigned > requirement.quantity) {
        issues.push(issue("ROLE_REQUIREMENT_OVERALLOCATED", `${requirement.role} requirement 超出 ${assigned - requirement.quantity} 人。`, { jobId: requirement.scopeId }));
      }
    }
  }

  for (let i = 0; i < input.allocations.length; i += 1) {
    for (let j = i + 1; j < input.allocations.length; j += 1) {
      const left = input.allocations[i];
      const right = input.allocations[j];
      if (left.staffId === right.staffId && left.jobId !== right.jobId && left.workDate === right.workDate && overlaps(left, right)) {
        issues.push(issue("CROSS_JOB_OVERLAP", "同一人不可跨 Job 重疊派遣。", { staffId: left.staffId, jobId: right.jobId }));
      }
    }
  }
  return issues;
}
