import { describe, expect, it } from "vitest";
import { buildOperationsReport, exportAuditCsv } from "../../src/application/operations/reporting";

describe("operations reporting", () => {
  it("includes snapshot and policy provenance in export", () => {
    const report = buildOperationsReport({ date: "2026-08-21", snapshotSequence: 8, policyVersions: ["policy-1"], capacity: { available: 1, qualified: 1, assigned: 1, reserved: 0, spare: 0, shortage: 0, plannedUtilisation: 1, actualUtilisation: 0 }, duties: { planned: new Map([ ["p", { dutyId: "p", jobId: "j", staffNumber: "S1", role: "AP", date: "2026-08-21", publishedAt: "2026-08-20", snapshotSequence: 8, policyVersion: "policy-1" }] ]), actual: new Map() }, generatedAt: "2026-08-21T00:00:00.000Z" });
    expect(exportAuditCsv(report)).toContain("snapshotSequence,\"8\"");
    expect(report.plannedCount).toBe(1);
  });
});
