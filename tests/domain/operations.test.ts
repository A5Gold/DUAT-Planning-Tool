import { describe, expect, it } from "vitest";
import { calculateCapacity, qualificationExpiryWindows, replayDutyEvents } from "../../src/domain/operations";

describe("operations projection", () => {
  it("keeps planned and actual layers separate", () => {
    const projection = replayDutyEvents([
      { type: "PlannedDutyPublished", duty: { dutyId: "p1", jobId: "j1", staffNumber: "S1", role: "AP", date: "2026-08-21", publishedAt: "2026-08-20", snapshotSequence: 3, policyVersion: "p1" } },
      { type: "DutyAbsent", duty: { actualId: "a1", plannedDutyId: "p1", jobId: "j1", role: "AP", date: "2026-08-21", status: "absent", recordedAt: "2026-08-21", reason: "sick" } },
    ]);
    expect(projection.planned.get("p1")?.staffNumber).toBe("S1");
    expect(projection.actual.get("a1")?.status).toBe("absent");
  });

  it("calculates capacity and 30/60/90 expiry windows", () => {
    const metrics = calculateCapacity([{ date: "2026-08-21", staffNumber: "S1", available: true, qualified: true }, { date: "2026-08-21", staffNumber: "S2", available: true, qualified: false }], [{ dutyId: "p1", jobId: "j1", staffNumber: "S1", role: "AP", date: "2026-08-21", publishedAt: "2026-08-20", snapshotSequence: 3, policyVersion: "p1" }], [], 2);
    expect(metrics).toMatchObject({ available: 2, qualified: 1, assigned: 1, shortage: 1, plannedUtilisation: 1 });
    expect(qualificationExpiryWindows([{ staffNumber: "S1", validTo: "2026-09-10" }], "2026-08-21")[0]?.staffNumbers).toEqual(["S1"]);
  });
});
