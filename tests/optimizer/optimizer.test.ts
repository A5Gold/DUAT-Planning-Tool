import { describe, expect, it } from "vitest";

import { compilePlanningSnapshot, type PlanningSnapshotInput } from "../../src/domain/optimizer/planningSnapshot";
import { DeterministicOptimizer } from "../../src/application/optimizer/deterministicOptimizer";
import { collectOptimizationRun } from "../../src/application/optimizer/optimizationPort";
import { buildProposal, isProposalStale, planProposalAcceptance } from "../../src/application/optimizer/proposal";
import type { RoleAssignment, StaffAllocation } from "../../src/domain/reconstruction";

const requirement = (id: string, role: "AP" | "CP", qualifications: ("AP" | "CP(P)" | "CP(T)")[]) => ({
  id,
  scope: "work" as const,
  scopeId: "work-1",
  role,
  quantity: 1,
  requiredness: "required" as const,
  qualificationPredicate: { operator: "any" as const, qualifications },
  enabledBy: "policy" as const,
  policyVersion: "p1",
});

const baseInput: PlanningSnapshotInput = {
  snapshotId: "snap-1",
  eventSequence: 12,
  generatedAt: "2026-08-21T10:00:00Z",
  workDate: "2026-08-21",
  scenarioId: "scenario-a",
  policyVersions: { allocation: "p1" },
  jobs: [{
    id: "job-1",
    workDate: "2026-08-21",
    works: [{
      id: "work-1",
      jobId: "job-1",
      kind: "IsolationEarthing",
      name: "Isolation",
      startsAt: "22:00",
      endsAt: "23:00",
      locations: [],
      roleRequirements: [requirement("req-ap", "AP", ["AP"]), requirement("req-cp", "CP", ["CP(P)", "CP(T)"])],
    }],
  }],
  staff: [
    { staffId: "s-ap", staffNo: "100", displayName: "AP", availability: "confirmed", credentials: [{ variant: "AP", validFrom: "2026-01-01", status: "active" }] },
    { staffId: "s-cp", staffNo: "200", displayName: "CP", availability: "confirmed", credentials: [{ variant: "CP(T)", validFrom: "2026-01-01", status: "active" }] },
  ],
};

describe("PlanningSnapshot", () => {
  it("is detached, deterministic and deeply immutable", () => {
    const source = { ...baseInput, jobs: [...baseInput.jobs] };
    const snapshot = compilePlanningSnapshot(source);
    expect(snapshot.inputChecksum).toMatch(/^sha256:/);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.jobs)).toBe(true);
    expect(snapshot.inputChecksum).toBe(compilePlanningSnapshot(baseInput).inputChecksum);
    expect(() => (snapshot.jobs as unknown as unknown[]).push({})).toThrow();
  });
});

describe("DeterministicOptimizer", () => {
  it("returns repeatable feasible proposal without publishing", async () => {
    const snapshot = compilePlanningSnapshot(baseInput);
    const optimizer = new DeterministicOptimizer();
    const first = await collectOptimizationRun(optimizer.run(snapshot, { runId: "run-1", seed: 7 }));
    const second = await collectOptimizationRun(optimizer.run(snapshot, { runId: "run-1", seed: 7 }));
    expect(first.status).toBe("feasible");
    expect(first.assignments.map((item) => [item.role, item.staffId])).toEqual([["AP", "s-ap"], ["CP", "s-cp"]]);
    expect(first.proposal.state).toBe("proposal_only");
    expect(first.proposal.changes).toHaveLength(2);
    expect(first.assignments).toEqual(second.assignments);
    expect(first.inputChecksum).toBe(snapshot.inputChecksum);
  });

  it("explains shortage for unknown roster or invalid qualification", async () => {
    const snapshot = compilePlanningSnapshot({
      ...baseInput,
      staff: [{ ...baseInput.staff[0], availability: "unknown" }],
    });
    const result = await collectOptimizationRun(new DeterministicOptimizer().run(snapshot, { runId: "run-short" }));
    expect(result.status).toBe("infeasible");
    expect(result.unassignedRequirements).toHaveLength(2);
    expect(result.unassignedRequirements[0].candidateExclusions.roster_not_confirmed).toBe(1);
    expect(result.unassignedRequirements[0].message).toContain("尚缺少");
  });

  it("enforces possession CP(P) instead of accepting CP(T)", async () => {
    const possession = compilePlanningSnapshot({
      ...baseInput,
      jobs: [{
        ...baseInput.jobs[0],
        works: [{ ...baseInput.jobs[0].works[0], kind: "Possession", roleRequirements: [requirement("req-pos-cp", "CP", ["CP(P)"])] }],
      }],
    });
    const result = await collectOptimizationRun(new DeterministicOptimizer().run(possession, { runId: "run-pos" }));
    expect(result.status).toBe("infeasible");
    expect(result.unassignedRequirements[0].candidateExclusions.qualification_missing_or_invalid).toBe(2);
  });

  it("returns stale and cancelled results without allocations", async () => {
    const snapshot = compilePlanningSnapshot(baseInput);
    const stale = await collectOptimizationRun(new DeterministicOptimizer().run(snapshot, { runId: "run-stale", currentEventSequence: 13 }));
    expect(stale.status).toBe("stale_snapshot");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await collectOptimizationRun(new DeterministicOptimizer().run(snapshot, { runId: "run-cancel", signal: controller.signal }));
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("proposal diff and partial acceptance", () => {
  const allocation = (id: string, staffId: string): StaffAllocation => ({
    id, staffId, jobId: "job-1", workDate: "2026-08-21", startsAt: "22:00", endsAt: "23:00", rosterAvailability: "confirmed",
  });
  const assignment = (id: string, allocationId: string, staffId: string): RoleAssignment => ({
    id, allocationId, staffId, jobId: "job-1", role: "AP", requirementId: "req-ap",
  });

  it("builds changes and creates a typed partial accept intent", () => {
    const beforeAllocation = allocation("before-a", "old");
    const afterAllocation = allocation("after-a", "new");
    const proposal = buildProposal({
      proposalId: "proposal-1", runId: "run-1", snapshotId: "snap-1", snapshotSequence: 12, createdAt: "2026-08-21T10:00:00Z",
      beforeAllocations: [beforeAllocation], beforeAssignments: [assignment("before", "before-a", "old")],
      afterAllocations: [afterAllocation], afterAssignments: [assignment("after", "after-a", "new")],
    });
    expect(proposal.changes[0].kind).toBe("replace");
    expect(isProposalStale(proposal, 13)).toBe(true);
    const accepted = planProposalAcceptance({
      proposal, selectedChangeIds: [proposal.changes[0].id], currentEventSequence: 12,
      expectedPlanSequence: 4, idempotencyKey: "accept-1",
    });
    expect(accepted.command.type).toBe("AcceptProposalChanges");
    expect(accepted.isPartial).toBe(false);
    expect(() => planProposalAcceptance({ ...accepted.command, proposal, selectedChangeIds: [], currentEventSequence: 13, expectedPlanSequence: 4, idempotencyKey: "accept-2" })).toThrow("STALE_PROPOSAL");
  });
});
