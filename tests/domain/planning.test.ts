import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_ROLES,
  InMemoryPlanningRepository,
  PlanningService,
  createEmptyNightPlan,
  createLocation,
  createPlanningState,
  type NightPlan,
  type Staff,
} from "../../src/domain/planning";

const planningDate = "2026-08-20";

function fixtureStaff(): Staff[] {
  return [
    {
      staffNumber: "AP-01",
      name: "陳 AP",
      team: "S2",
      qualifications: [{ type: "AP", expiryDate: "2026-12-31" }],
    },
    {
      staffNumber: "AP-EXPIRED",
      name: "過期 AP",
      team: "S2",
      qualifications: [{ type: "AP", expiryDate: "2026-08-19" }],
    },
    {
      staffNumber: "CP-P-01",
      name: "李 CP(P)",
      team: "S3",
      qualifications: [{ type: "CP(P)", expiryDate: "2026-12-31" }],
    },
    {
      staffNumber: "CP-T-01",
      name: "王 CP(T)",
      team: "S4",
      qualifications: [{ type: "CP(T)", expiryDate: "2026-12-31" }],
    },
    {
      staffNumber: "CP-EXPIRED",
      name: "過期 CP",
      team: "S4",
      qualifications: [{ type: "CP(P)", expiryDate: "2026-08-19" }],
    },
    {
      staffNumber: "GEN-01",
      name: "周 一般員工",
      team: "S5",
      isGeneralEmployee: true,
    },
    {
      staffNumber: "S1-AP-01",
      name: "支援 AP",
      team: "S1",
      qualifications: [{ type: "AP", expiryDate: "2026-12-31" }],
    },
    {
      staffNumber: "UNAVAILABLE-AP",
      name: "Roster 不可用 AP",
      team: "S2",
      qualifications: [{ type: "AP", expiryDate: "2026-12-31" }],
    },
  ];
}

function makeService() {
  return new PlanningService(new InMemoryPlanningRepository({
    staff: fixtureStaff(),
    roster: [
      {
        date: planningDate,
        staffNumber: "UNAVAILABLE-AP",
        status: "unavailable",
        reason: "leave",
      },
    ],
  }));
}

function makePlan(type: "Possession" | "PA Work" = "Possession", minimumTotalHeadcount = 2): NightPlan {
  const base = createEmptyNightPlan(planningDate, "night-1");
  const firstWork = base.works[0];
  const work = {
    ...firstWork,
    active: true,
    type,
    projectCode: "P-001",
    locations: [createLocation("loc-1", 1, { locationName: "L1", minimumTotalHeadcount })],
  };
  return { ...base, works: [work, ...base.works.slice(1)] };
}

function assign(service: PlanningService, plan: NightPlan, request: Parameters<PlanningService["assign"]>[1], options = {}) {
  const mutation = service.assign(plan, request, options);
  expect(mutation.accepted).toBe(true);
  return mutation.plan;
}

describe("PlanningService Location and assignment rules", () => {
  it("requires one AP and one CP for every Location by default", () => {
    const service = makeService();
    const plan = makePlan();
    const report = service.validatePlan(plan);

    expect(report.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["LOCATION_AP_REQUIRED", "LOCATION_CP_REQUIRED"]),
    );
    expect(report.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "AP", required: 1, assigned: 0, missing: 1 }),
        expect.objectContaining({ role: "CP", required: 1, assigned: 0, missing: 1 }),
      ]),
    );
  });

  it("does not allow the same person in AP and CP rows", () => {
    const service = makeService();
    let plan = makePlan();
    plan = assign(service, plan, {
      staffNumber: "AP-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    const mutation = service.assign(plan, {
      staffNumber: "AP-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });

    expect(mutation.accepted).toBe(false);
    expect(mutation.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_ASSIGNMENT" })]),
    );
  });

  it("requires CP(P) for Possession", () => {
    const service = makeService();
    const plan = makePlan("Possession");
    const invalid = service.assign(plan, {
      staffNumber: "CP-T-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(invalid.accepted).toBe(false);
    expect(invalid.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CP_P_QUALIFICATION_REQUIRED" })]),
    );

    const valid = service.assign(plan, {
      staffNumber: "CP-P-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(valid.accepted).toBe(true);
    expect(valid.assignment?.qualificationUsed).toBe("CP(P)");
  });

  it("accepts CP(P) and CP(T) for PA Work, preferring CP(T)", () => {
    const service = makeService();
    const plan = makePlan("PA Work");

    const cpT = service.assign(plan, {
      staffNumber: "CP-T-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(cpT.accepted).toBe(true);
    expect(cpT.assignment?.qualificationUsed).toBe("CP(T)");

    const candidates = service.candidates(plan, {
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(candidates[0]?.qualificationUsed).toBe("CP(T)");

    const cpPOnly = new PlanningService({
      staff: fixtureStaff().filter((staff) => staff.staffNumber !== "CP-T-01"),
    }).assign(plan, {
      staffNumber: "CP-P-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(cpPOnly.accepted).toBe(true);
    expect(cpPOnly.assignment?.qualificationUsed).toBe("CP(P)");
  });

  it("prevents assigning one person to multiple Works on the same night", () => {
    const service = makeService();
    const initial = makePlan();
    const secondWork = {
      ...initial.works[1],
      active: true,
      locations: [createLocation("loc-2", 1)],
    };
    let plan: NightPlan = { ...initial, works: [initial.works[0], secondWork, ...initial.works.slice(2)] };
    plan = assign(service, plan, {
      staffNumber: "AP-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    const mutation = service.assign(plan, {
      staffNumber: "AP-01",
      workId: "night-1:work-2",
      locationId: "loc-2",
      role: ASSIGNMENT_ROLES.ap,
    });
    expect(mutation.accepted).toBe(false);
    expect(mutation.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_ASSIGNMENT" })]),
    );
  });

  it("only allows 一般員工 at Work level", () => {
    const service = makeService();
    const plan = makePlan();
    const locationDrop = service.assign(plan, {
      staffNumber: "GEN-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.generalEmployee,
    });
    expect(locationDrop.accepted).toBe(false);
    expect(locationDrop.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "GENERAL_EMPLOYEE_LOCATION_FORBIDDEN" })]),
    );

    const workDrop = service.assign(plan, {
      staffNumber: "GEN-01",
      workId: "night-1:work-1",
      role: ASSIGNMENT_ROLES.generalEmployee,
    });
    expect(workDrop.accepted).toBe(true);
  });

  it("rejects expired qualifications and unavailable Roster entries", () => {
    const service = makeService();
    const plan = makePlan();
    const expired = service.assign(plan, {
      staffNumber: "AP-EXPIRED",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    expect(expired.accepted).toBe(false);
    expect(expired.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "QUALIFICATION_EXPIRED" })]),
    );

    const unavailable = service.assign(plan, {
      staffNumber: "UNAVAILABLE-AP",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    expect(unavailable.accepted).toBe(false);
    expect(unavailable.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ROSTER_UNAVAILABLE" })]),
    );
  });

  it("reports minimum total headcount and lets general employees fill it", () => {
    const service = makeService();
    let plan = makePlan("Possession", 3);
    plan = assign(service, plan, {
      staffNumber: "AP-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    plan = assign(service, plan, {
      staffNumber: "CP-P-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.cp,
    });
    expect(service.validatePlan(plan).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MIN_HEADCOUNT_SHORTAGE" })]),
    );

    plan = assign(service, plan, {
      staffNumber: "GEN-01",
      workId: "night-1:work-1",
      role: ASSIGNMENT_ROLES.generalEmployee,
    });
    expect(service.validatePlan(plan).issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MIN_HEADCOUNT_SHORTAGE" })]),
    );
  });

  it("requires explicit opt-in before using S1 support", () => {
    const service = makeService();
    const plan = makePlan();
    const withoutSupport = service.assign(plan, {
      staffNumber: "S1-AP-01",
      workId: "night-1:work-1",
      locationId: "loc-1",
      role: ASSIGNMENT_ROLES.ap,
    });
    expect(withoutSupport.accepted).toBe(false);
    expect(withoutSupport.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "S1_SUPPORT_NOT_ENABLED" })]),
    );

    const withSupport = service.assign(
      plan,
      {
        staffNumber: "S1-AP-01",
        workId: "night-1:work-1",
        locationId: "loc-1",
        role: ASSIGNMENT_ROLES.ap,
      },
      { allowS1Support: true },
    );
    expect(withSupport.accepted).toBe(true);
  });
});

describe("PlanningService scenario isolation", () => {
  it("does not affect main until Apply Scenario is explicit", () => {
    const service = makeService();
    const initial = createPlanningState(planningDate);
    const withScenario = service.createScenario(initial, "scenario-a", "測試方案 A");
    const changedScenario = service.updateScenarioPlan(withScenario, "scenario-a", (plan) => ({
      ...plan,
      works: plan.works.map((work) =>
        work.slot === 1 ? { ...work, active: true, projectCode: "SCENARIO-A" } : work,
      ),
    }));
    const switched = service.switchScenario(changedScenario, "scenario-a");

    expect(switched.main.works[0].projectCode).toBe("");
    expect(switched.scenarios[0].plan.works[0].projectCode).toBe("SCENARIO-A");

    const applied = service.applyScenario(switched, "scenario-a");
    expect(applied.main.works[0].projectCode).toBe("SCENARIO-A");
    expect(applied.activeScenarioId).toBe("main");
  });
});
