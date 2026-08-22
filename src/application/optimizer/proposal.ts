import type { RoleAssignment, StaffAllocation } from "../../domain/reconstruction";

export type ProposalChange =
  | {
    readonly id: string;
    readonly kind: "add";
    readonly assignment: RoleAssignment;
    readonly allocation: StaffAllocation;
  }
  | {
    readonly id: string;
    readonly kind: "release";
    readonly assignment: RoleAssignment;
    readonly allocation: StaffAllocation;
  }
  | {
    readonly id: string;
    readonly kind: "replace";
    readonly requirementId: string;
    readonly fromAssignment: RoleAssignment;
    readonly fromAllocation: StaffAllocation;
    readonly toAssignment: RoleAssignment;
    readonly toAllocation: StaffAllocation;
  };

export interface AllocationProposal {
  readonly proposalId: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly snapshotSequence: number;
  readonly createdAt: string;
  readonly state: "proposal_only";
  readonly changes: readonly ProposalChange[];
}

export interface AcceptProposalChangesCommand {
  readonly type: "AcceptProposalChanges";
  readonly proposalId: string;
  readonly snapshotSequence: number;
  readonly expectedPlanSequence: number;
  readonly idempotencyKey: string;
  readonly selectedChangeIds: readonly string[];
}

export interface ProposalAcceptancePlan {
  readonly command: AcceptProposalChangesCommand;
  readonly selectedChanges: readonly ProposalChange[];
  readonly remainingChanges: readonly ProposalChange[];
  readonly isPartial: boolean;
}

const assignmentKey = (assignment: RoleAssignment): string =>
  `${assignment.requirementId}|${assignment.role}|${assignment.staffId}`;

function allocationFor(
  assignment: RoleAssignment,
  allocations: readonly StaffAllocation[],
): StaffAllocation {
  const allocation = allocations.find((candidate) => candidate.id === assignment.allocationId);
  if (!allocation) throw new Error(`Allocation ${assignment.allocationId} is missing`);
  return allocation;
}

export function buildProposal(input: {
  readonly proposalId: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly snapshotSequence: number;
  readonly createdAt: string;
  readonly beforeAllocations: readonly StaffAllocation[];
  readonly beforeAssignments: readonly RoleAssignment[];
  readonly afterAllocations: readonly StaffAllocation[];
  readonly afterAssignments: readonly RoleAssignment[];
  readonly lockedAllocationIds?: readonly string[];
}): AllocationProposal {
  const before = new Map(input.beforeAssignments.map((assignment) => [assignmentKey(assignment), assignment]));
  const after = new Map(input.afterAssignments.map((assignment) => [assignmentKey(assignment), assignment]));
  const additions = [...after].filter(([key]) => !before.has(key)).map(([, assignment]) => assignment);
  const releases = [...before].filter(([key]) => !after.has(key)).map(([, assignment]) => assignment);
  const locked = new Set(input.lockedAllocationIds ?? []);
  if (releases.some((assignment) => locked.has(assignment.allocationId))) {
    throw new Error("A proposal cannot release a locked allocation");
  }

  const changes: ProposalChange[] = [];
  const consumedAdditions = new Set<string>();
  const consumedReleases = new Set<string>();
  for (const released of releases) {
    const replacement = additions.find((added) =>
      !consumedAdditions.has(added.id) && added.requirementId === released.requirementId,
    );
    if (!replacement) continue;
    consumedReleases.add(released.id);
    consumedAdditions.add(replacement.id);
    changes.push({
      id: `replace:${released.id}:${replacement.id}`,
      kind: "replace",
      requirementId: released.requirementId,
      fromAssignment: released,
      fromAllocation: allocationFor(released, input.beforeAllocations),
      toAssignment: replacement,
      toAllocation: allocationFor(replacement, input.afterAllocations),
    });
  }
  for (const assignment of additions.filter((candidate) => !consumedAdditions.has(candidate.id))) {
    changes.push({
      id: `add:${assignment.id}`,
      kind: "add",
      assignment,
      allocation: allocationFor(assignment, input.afterAllocations),
    });
  }
  for (const assignment of releases.filter((candidate) => !consumedReleases.has(candidate.id))) {
    changes.push({
      id: `release:${assignment.id}`,
      kind: "release",
      assignment,
      allocation: allocationFor(assignment, input.beforeAllocations),
    });
  }
  return Object.freeze({
    proposalId: input.proposalId,
    runId: input.runId,
    snapshotId: input.snapshotId,
    snapshotSequence: input.snapshotSequence,
    createdAt: input.createdAt,
    state: "proposal_only" as const,
    changes: Object.freeze(changes.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

export function isProposalStale(proposal: AllocationProposal, currentEventSequence: number): boolean {
  return proposal.snapshotSequence !== currentEventSequence;
}

/** Build a typed command intent. Applying it remains the command gateway's responsibility. */
export function planProposalAcceptance(input: {
  readonly proposal: AllocationProposal;
  readonly selectedChangeIds: readonly string[];
  readonly currentEventSequence: number;
  readonly expectedPlanSequence: number;
  readonly idempotencyKey: string;
}): ProposalAcceptancePlan {
  if (isProposalStale(input.proposal, input.currentEventSequence)) {
    throw new Error("STALE_PROPOSAL");
  }
  if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey is required");
  const selectedIds = new Set(input.selectedChangeIds);
  if (selectedIds.size !== input.selectedChangeIds.length) throw new Error("Duplicate proposal change id");
  const selectedChanges = input.proposal.changes.filter((change) => selectedIds.has(change.id));
  if (selectedChanges.length !== selectedIds.size) throw new Error("Unknown proposal change id");
  const remainingChanges = input.proposal.changes.filter((change) => !selectedIds.has(change.id));
  return Object.freeze({
    command: Object.freeze({
      type: "AcceptProposalChanges" as const,
      proposalId: input.proposal.proposalId,
      snapshotSequence: input.proposal.snapshotSequence,
      expectedPlanSequence: input.expectedPlanSequence,
      idempotencyKey: input.idempotencyKey,
      selectedChangeIds: Object.freeze([...input.selectedChangeIds]),
    }),
    selectedChanges: Object.freeze(selectedChanges),
    remainingChanges: Object.freeze(remainingChanges),
    isPartial: remainingChanges.length > 0,
  });
}
