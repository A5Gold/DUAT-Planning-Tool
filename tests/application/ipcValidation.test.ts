import { describe, expect, it } from "vitest";

import {
  IPC_CHANNELS,
  type IpcResult,
  type WorkbenchSnapshotDto,
} from "../../src/application/ipcContract";
import {
  assertIpcRequest,
  assertIpcResponse,
  isStructuredCloneSafe,
  validateAssignmentDto,
  validateImportCommitDto,
  validateIpcRequest,
  validateIpcResponse,
  validateRosterEntryDto,
  validateScenarioDto,
} from "../../src/application/ipcValidation";
import { createEmptyNightPlan } from "../../src/domain/planning";

const date = "2026-08-20";
const emptyReport = { valid: true, issues: [], summaries: [] } as const;

function snapshot(): WorkbenchSnapshotDto {
  const plan = createEmptyNightPlan(date, "night:2026-08-20");
  return {
    date,
    weekNumber: 34,
    weekStart: "2026-08-16",
    weekEnd: "2026-08-22",
    revision: 7,
    main: plan,
    activePlan: plan,
    scenarios: [],
    selectedScenario: { kind: "main" },
    personnel: [],
    validation: emptyReport,
  };
}

function mutationEnvelope(extra: Record<string, unknown> = {}) {
  return {
    date,
    scenario: { kind: "main" },
    expectedRevision: 7,
    ...extra,
  };
}

describe("typed IPC channel contract", () => {
  it("exposes fixed channels and validates a health request", () => {
    expect(IPC_CHANNELS.getWorkbench).toBe("planning:get-workbench");
    expect(IPC_CHANNELS.commitImport).toBe("import:commit");

    expect(validateIpcRequest("app:health", undefined)).toEqual({ ok: true, value: undefined });
    expect(validateIpcRequest("app:health", {})).toMatchObject({ ok: false });
  });

  it("accepts import preview rows without an unresolved staff number", () => {
    const response: IpcResult<{ preview: unknown }> = {
      ok: true,
      data: {
        preview: {
          importId: "job-role-record:test:Sheet1",
          kind: "job-role-record",
          source: { filePath: "C:/tmp/roles.xlsx", worksheetName: "Sheet1" },
          selectedWorksheet: "Sheet1",
          status: "has-warnings",
          rowCount: 1,
          validRowCount: 1,
          warningCount: 1,
          errorCount: 0,
          rows: [{
            rowNumber: 4,
            status: "warning",
            values: { rawStaffName: "Unresolved", matchStatus: "unresolved" },
            issues: [{ rowNumber: 4, severity: "warning", code: "UNRESOLVED_STAFF_NAME", message: "legacy candidate" }],
          }],
          issues: [],
        },
      },
    };
    expect(validateIpcResponse("import:preview", response).ok).toBe(true);
  });

  it("rejects unknown fields and invalid expectedRevision before main loads state", () => {
    const unknownField = validateIpcRequest("planning:update-work", {
      ...mutationEnvelope({ workId: "night:work-1", patch: { remarks: "updated" } }),
      unexpected: true,
    });
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "$.unexpected" })]),
      );
    }

    const negativeRevision = validateIpcRequest("planning:update-work", {
      ...mutationEnvelope({ expectedRevision: -1, workId: "night:work-1", patch: { active: true } }),
    });
    expect(negativeRevision.ok).toBe(false);
    if (!negativeRevision.ok) {
      expect(negativeRevision.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "$.expectedRevision" })]),
      );
    }
  });

  it("accepts work, location and scenario mutation requests with a shared revision envelope", () => {
    const work = validateIpcRequest("planning:update-work", {
      ...mutationEnvelope({
        workId: "night:work-1",
        patch: { projectCode: "P-001", type: "Possession", remarks: "Remarks" },
      }),
    });
    expect(work.ok).toBe(true);

    const location = validateIpcRequest("planning:add-location", {
      ...mutationEnvelope({
        workId: "night:work-1",
        location: {
          id: "loc-1",
          sequence: 1,
          locationName: "North",
          isolationPoint: "IP-1",
          earthingPoint: "EP-1",
          minimumTotalHeadcount: 2,
        },
      }),
    });
    expect(location.ok).toBe(true);

    const scenario = validateIpcRequest("planning:create-scenario", {
      ...mutationEnvelope({
        scenarioId: "scenario-a",
        name: "測試方案 A",
        sourceScenario: { kind: "main" },
        temporary: true,
      }),
    });
    expect(scenario.ok).toBe(true);

    const apply = validateIpcRequest("planning:apply-scenario", {
      ...mutationEnvelope({ scenarioId: "scenario-a" }),
    });
    expect(apply.ok).toBe(true);
  });

  it("enforces assignment target shape while leaving cross-plan semantics to PlanningService", () => {
    const apWithoutLocation = validateIpcRequest("planning:add-assignment", {
      ...mutationEnvelope({
        assignment: { staffNumber: "AP-01", workId: "night:work-1", role: "AP" },
      }),
    });
    expect(apWithoutLocation.ok).toBe(false);

    const generalAtLocation = validateIpcRequest("planning:add-assignment", {
      ...mutationEnvelope({
        assignment: {
          staffNumber: "GEN-01",
          workId: "night:work-1",
          role: "一般員工",
          locationId: "loc-1",
        },
      }),
    });
    expect(generalAtLocation.ok).toBe(false);

    const validCp = validateIpcRequest("planning:add-assignment", {
      ...mutationEnvelope({
        assignment: {
          staffNumber: "CP-01",
          workId: "night:work-1",
          role: "CP",
          locationId: "loc-1",
          qualificationUsed: "CP(P)",
        },
      }),
    });
    expect(validCp.ok).toBe(true);
  });

  it("validates import preview and commit DTOs without accepting non-finite cells", () => {
    const preview = validateIpcRequest("import:preview", {
      kind: "qualification",
      source: { filePath: "C:\\imports\\qualification.xlsx", worksheetName: "2026-08-20" },
    });
    expect(preview.ok).toBe(true);

    const candidates = validateIpcRequest("planning:get-candidates", {
      date: "2026-08-20",
      scenario: { kind: "main" },
      target: { workId: "work-1", role: "CP", locationId: "location-1" },
      allowS1Support: true,
    });
    expect(candidates.ok).toBe(true);

    const commit = validateIpcRequest("import:commit", {
      ...mutationEnvelope({ importId: "import-1", acceptedRowNumbers: [1, 2, 3] }),
    });
    expect(commit.ok).toBe(true);

    const invalidRow = validateImportCommitDto({
      revision: 8,
      batch: {
        id: "import-1",
        kind: "qualification",
        sourceFilePath: "qualification.xlsx",
        sourceWorksheet: "2026-08-20",
        importedAt: "2026-08-20T01:00:00.000Z",
        status: "committed",
        rowCount: 1,
        errorCount: 0,
      },
      snapshot: {
        ...snapshot(),
        personnel: [],
      },
    });
    expect(invalidRow.ok).toBe(true);

    const nonFinite = validateIpcResponse("import:preview", {
      ok: true,
      data: {
        preview: {
          importId: "import-1",
          kind: "qualification",
          source: { filePath: "qualification.xlsx" },
          selectedWorksheet: "Sheet1",
          status: "valid",
          rowCount: 1,
          validRowCount: 1,
          warningCount: 0,
          errorCount: 0,
          rows: [
            {
              rowNumber: 1,
              values: { expiry: Number.NaN },
              issues: [],
            },
          ],
          issues: [],
        },
      },
    });
    expect(nonFinite.ok).toBe(false);
  });

  it("validates structured-clone-safe DTOs and rejects native objects/cycles", () => {
    expect(isStructuredCloneSafe({ date, values: ["x", 1, null, true] })).toBe(true);
    expect(isStructuredCloneSafe(new Date())).toBe(false);
    expect(isStructuredCloneSafe(new Map())).toBe(false);
    expect(isStructuredCloneSafe(() => undefined)).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(isStructuredCloneSafe(cycle)).toBe(false);
  });

  it("validates response success and typed error branches", () => {
    const success: IpcResult<{ snapshot: WorkbenchSnapshotDto }> = {
      ok: true,
      data: { snapshot: snapshot() },
    };
    expect(validateIpcResponse("planning:get-workbench", success)).toMatchObject({ ok: true });

    const conflict = {
      ok: false as const,
      error: {
        kind: "conflict" as const,
        code: "STALE_REVISION" as const,
        message: "Plan changed",
        expectedRevision: 7,
        actualRevision: 8,
      },
    };
    expect(validateIpcResponse("planning:update-work", conflict)).toMatchObject({ ok: true });

    const malformed = validateIpcResponse("planning:update-work", {
      ok: false,
      error: { kind: "domain", code: "NOT_A_DOMAIN_CODE", message: "bad", report: {} },
    });
    expect(malformed.ok).toBe(false);
  });

  it("exports typed DTO validators and assertion helpers", () => {
    expect(validateRosterEntryDto({ date, staffNumber: "S-1", status: "available" }).ok).toBe(true);
    expect(validateScenarioDto({
      id: "scenario-a",
      name: "A",
      temporary: true,
      plan: createEmptyNightPlan(date),
    }).ok).toBe(true);
    expect(validateAssignmentDto({
      id: "a-1",
      staffNumber: "AP-01",
      workId: "night:work-1",
      role: "AP",
      locationId: "loc-1",
    }).ok).toBe(true);

    expect(assertIpcRequest("planning:delete-scenario", {
      ...mutationEnvelope({ scenarioId: "scenario-a" }),
    }).scenario).toEqual({ kind: "main" });
    expect(() => assertIpcResponse("planning:update-work", { ok: true, data: {} })).toThrow();
  });
});
