import { describe, expect, it } from "vitest";
import {
  InMemoryPlanningRepository,
  createLocation,
  createPlanningState,
  type ISODate,
  type PlanningData,
  type PlanningState,
} from "../../src/domain/planning";
import {
  DomainMutationError,
  PlanningApplication,
  PlanningEntityNotFoundError,
  type PlanningAggregateStore,
} from "../../src/application/planningApplication";
import type { PlanningContextSnapshot, VersionedPlanningAggregate } from "../../src/adapters/sqlite";

const date: ISODate = "2026-08-20";

const data: PlanningData = {
  staff: [
    {
      staffNumber: "S1-AP",
      name: "支援 AP",
      team: "S1",
      qualifications: [{ type: "AP", expiryDate: "2026-12-31" }],
    },
  ],
  roster: [{ date, staffNumber: "S1-AP", status: "night-duty" }],
};

class MemoryAggregateStore implements PlanningAggregateStore {
  private readonly repository = new InMemoryPlanningRepository(data);
  private aggregate: VersionedPlanningAggregate | undefined;

  getStaff() { return this.repository.getStaff(); }
  getQualifications(staffNumber: string) { return this.repository.getQualifications(staffNumber); }
  getRosterEntry(planningDate: ISODate, staffNumber: string) { return this.repository.getRosterEntry(planningDate, staffNumber); }
  getRosterEntries() { return this.repository.getRosterEntries(); }
  savePlanningData() {}

  loadAggregate() { return this.aggregate; }

  loadContext(): PlanningContextSnapshot | undefined {
    return this.aggregate ? { ...this.aggregate, data } : undefined;
  }

  saveAggregate(state: PlanningState, expectedRevision: number | null): VersionedPlanningAggregate {
    const actualRevision = this.aggregate?.revision;
    if (expectedRevision !== null && expectedRevision !== (actualRevision ?? 0)) {
      throw new Error("unexpected revision in test store");
    }
    const saved = { state, revision: (actualRevision ?? 0) + 1 };
    this.aggregate = saved;
    return saved;
  }
}

function application(): PlanningApplication {
  const initial = createPlanningState(date);
  const firstWork = initial.main.works[0];
  const state: PlanningState = {
    ...initial,
    main: {
      ...initial.main,
      works: initial.main.works.map((work) => work.id === firstWork.id
        ? { ...work, active: true, locations: [createLocation(`${work.id}:location-1`, 1)] }
        : work),
    },
  };
  const store = new MemoryAggregateStore();
  return new PlanningApplication(store, {
    defaultData: data,
    defaultState: () => state,
  });
}

describe("PlanningApplication policy propagation", () => {
  it("rejects S1 without support and accepts it when the request opts in", () => {
    const app = application();
    const snapshot = app.getWorkbench(date);
    const workId = snapshot.main.works[0].id;
    const locationId = snapshot.main.works[0].locations[0].id;
    const request = {
      date,
      scenario: { kind: "main" as const },
      expectedRevision: snapshot.revision,
      assignment: { staffNumber: "S1-AP", workId, locationId, role: "AP" as const },
    };

    expect(() => app.addAssignment(request)).toThrow(DomainMutationError);

    const accepted = app.addAssignment({ ...request, allowS1Support: true, expectedRevision: snapshot.revision });
    expect(accepted.snapshot.main.assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ staffNumber: "S1-AP", role: "AP" })]),
    );
    expect(accepted.validation.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "S1_SUPPORT_NOT_ENABLED" })]),
    );
  });

  it("rejects mutations that target a missing work instead of silently saving", () => {
    const app = application();
    const snapshot = app.getWorkbench(date);

    expect(() => app.updateWork({
      date,
      scenario: { kind: "main" },
      expectedRevision: snapshot.revision,
      workId: "missing-work",
      patch: { projectCode: "P-404" },
    })).toThrowError(PlanningEntityNotFoundError);

    expect(app.getWorkbench(date).revision).toBe(snapshot.revision);
  });
});
