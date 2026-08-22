import { describe, expect, it } from "vitest";

import {
  createDefaultPolicyRegistry,
  deriveRoleRequirements,
  validateAllocationInvariants,
  withDerivedRoleRequirements,
  type RoleAssignment,
  type StaffAllocation,
} from "../../src/domain/reconstruction";

describe("reconstruction work demand policies", () => {
  it("derives Isolation/Earthing AP, CP and optional NP requirements", () => {
    const requirements = deriveRoleRequirements({ id: "w-1", jobId: "j-1", kind: "IsolationEarthing" });
    expect(requirements.map((item) => [item.role, item.requiredness, item.qualificationPredicate.qualifications])).toEqual([
      ["AP", "required", ["AP"]],
      ["CP", "required", ["CP(P)", "CP(T)"]],
      ["NP", "optional", ["NP"]],
    ]);
  });

  it("makes NP enabled-required only when planner/template enables it", () => {
    const requirements = deriveRoleRequirements(
      { id: "w-1", jobId: "j-1", kind: "IsolationEarthing" },
      { enableNp: true, source: "planner", policyVersion: "p2" },
    );
    const np = requirements.find((item) => item.role === "NP");
    expect(np?.requiredness).toBe("enabled-required");
    expect(np?.enabledBy).toBe("planner");
    expect(np?.policyVersion).toBe("p2");
  });

  it("keeps Possession CP(P) and PA Work CP(P/T) acceptance distinct", () => {
    expect(deriveRoleRequirements({ id: "p", jobId: "j", kind: "Possession" })[0].qualificationPredicate.qualifications).toEqual(["CP(P)"]);
    expect(deriveRoleRequirements({ id: "pa", jobId: "j", kind: "PA Work" })[0].qualificationPredicate.qualifications).toEqual(["CP(P)", "CP(T)"]);
  });

  it("provides policy versions and leaves weekly two-job target disabled", () => {
    const registry = createDefaultPolicyRegistry("test-policy");
    expect(registry.require("allocation-invariants", "test-policy").enabled).toBe(true);
    expect(registry.get("weekly-two-job-target", "test-policy")?.enabled).toBe(false);
  });

  it("adds derived requirements without dropping explicitly configured rows", () => {
    const work = withDerivedRoleRequirements({
      id: "w-1", jobId: "j-1", kind: "Possession", name: "P", startsAt: "22:00", endsAt: "23:00",
      locations: [], roleRequirements: [{
        id: "w-1:custom", scope: "work", scopeId: "w-1", role: "HSM", quantity: 1,
        requiredness: "optional", qualificationPredicate: { operator: "any", qualifications: ["HSM"] },
        enabledBy: "template", policyVersion: "p1",
      }],
    });
    expect(work.roleRequirements.map((item) => item.role)).toEqual(["CP", "HSM"]);
  });
});

describe("reconstruction allocation invariants", () => {
  const allocation = (id: string, staffId: string, jobId: string, start = "22:00", end = "23:00", rosterAvailability: StaffAllocation["rosterAvailability"] = "confirmed"): StaffAllocation => ({
    id, staffId, jobId, workDate: "2026-08-21", startsAt: start, endsAt: end, rosterAvailability,
  });
  const assignment = (id: string, allocationId: string, staffId: string, jobId: string, role: RoleAssignment["role"], supportsAssignmentId?: string): RoleAssignment => ({
    id, allocationId, staffId, jobId, role, requirementId: `${jobId}:${role}`, supportsAssignmentId,
  });

  it("rejects AP and CP being assigned to the same person", () => {
    const issues = validateAllocationInvariants({
      allocations: [allocation("a", "s1", "j1")],
      assignments: [assignment("ap", "a", "s1", "j1", "AP"), assignment("cp", "a", "s1", "j1", "CP")],
    });
    expect(issues.some((issue) => issue.code === "AP_CP_SAME_PERSON")).toBe(true);
  });

  it("requires confirmed roster and rejects cross-job overlap", () => {
    const issues = validateAllocationInvariants({
      allocations: [allocation("a", "s1", "j1", "22:00", "23:00", "unknown"), allocation("b", "s1", "j2", "22:30", "23:30")],
      assignments: [assignment("ap", "a", "s1", "j1", "AP")],
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["ROSTER_NOT_CONFIRMED", "CROSS_JOB_OVERLAP"]));
  });

  it("requires SPC to overlay one same-job role and support another AP", () => {
    const issues = validateAllocationInvariants({
      allocations: [allocation("a", "spc", "j1"), allocation("b", "ap", "j1")],
      assignments: [assignment("spc", "a", "spc", "j1", "SPC"), assignment("ap", "b", "ap", "j1", "AP", undefined)],
    });
    expect(issues.some((issue) => issue.code === "SPC_OVERLAY_LIMIT")).toBe(true);
    expect(issues.some((issue) => issue.code === "SPC_SUPPORT_REQUIRED")).toBe(true);
  });

  it("accepts a valid SPC overlay supporting a separate AP", () => {
    const issues = validateAllocationInvariants({
      allocations: [allocation("a", "spc", "j1"), allocation("b", "ap", "j1")],
      assignments: [assignment("cp", "a", "spc", "j1", "CP"), assignment("ap", "b", "ap", "j1", "AP"), assignment("spc", "a", "spc", "j1", "SPC", "ap")],
    });
    expect(issues).toEqual([]);
  });

  it("enforces enabled role requirement quantity", () => {
    const issues = validateAllocationInvariants({
      allocations: [allocation("a", "ap", "j1")],
      assignments: [assignment("ap", "a", "ap", "j1", "AP")],
      requirements: [{
        id: "req-cp", scope: "work", scopeId: "j1", role: "CP", quantity: 1,
        requiredness: "enabled-required", qualificationPredicate: { operator: "any", qualifications: ["CP(P)", "CP(T)"] },
        enabledBy: "planner", policyVersion: "p1",
      }],
    });
    expect(issues.some((issue) => issue.code === "ROLE_REQUIREMENT_SHORTAGE")).toBe(true);
  });
});
