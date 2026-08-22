import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { ExcelJsWorkbookReader } from "../../src/adapters/excel/excelWorkbookReader";
import {
  ExcelImportStagingService,
  ImportPipelineError,
  InMemoryImportCommitPort,
  previewImportFromSnapshot,
} from "../../src/application/import";

describe("Excel staging pipeline", () => {
  it("selects the Formation worksheet and carries blank Team cells forward", async () => {
    const snapshot = await fixtureWorkbook({
      formationSheetName: "Team Formation",
      formationRows: [
        ["S1", 673706, "SM Yeung", "Y", "Y"],
        [null, 100001, "Staff 1", "Y", "Y"],
        ...Array.from({ length: 27 }, (_, index) => ["S2", 100002 + index, `Staff ${index + 2}`, "Y", "Y"]),
      ],
    });
    const preview = previewImportFromSnapshot(snapshot, "formation");

    expect(preview.status).toBe("valid");
    expect(preview.selectedWorksheet.name).toBe("Team Formation");
    expect(preview.rowCount).toBe(29);
    expect(preview.rows.find((row) => row.normalized?.staffNumber === "673706")?.normalized).toMatchObject({
      displayName: "SM Yeung",
      team: "S1",
    });
    expect(preview.rows.some((row) => row.issues.some((issue) => issue.code === "DUPLICATE_STAFF_NUMBER"))).toBe(false);
  });

  it("selects Qualification by latest Update on, ignores the legend, and excludes Sup. by default", async () => {
    const regularStaff = [517968, ...Array.from({ length: 28 }, (_, index) => 100001 + index)];
    const snapshot = await fixtureWorkbook({
      formationSheetName: "Team Formation",
      qualificationSheetName: "工作表1",
      formationRows: regularStaff.map((staffNumber, index) => ["S2", staffNumber, staffNumber === 517968 ? "Mak Yui Fai" : `Staff ${index}`, "Y", "Y"]),
      qualificationRows: [
        ["S2", 517968, "Mak Yui Fai", new Date("2026-10-28"), "--"],
        [null, 100001, "Staff 1", "2026-08-19 (legacy)", "--"],
        [null, 100002, "Staff 2", new Date("2026-08-18"), "--"],
        ...regularStaff.slice(3).map((staffNumber, index) => [null, staffNumber, `Staff ${index + 3}`, new Date("2027-01-01"), "--"]),
        ["Sup.", 200001, "Supervisor 1", new Date("2027-01-01"), "--"],
        [null, 200002, "Supervisor 2", new Date("2027-01-01"), "--"],
        [null, 200003, "Supervisor 3", new Date("2027-01-01"), "--"],
        [null, 200004, "Supervisor 4", new Date("2027-01-01"), "--"],
      ],
    });
    const formationPreview = previewImportFromSnapshot(snapshot, "formation");
    const knownStaffNumbers = new Set(
      formationPreview.rows.flatMap((row) => row.normalized ? [row.normalized.staffNumber] : []),
    );
    const preview = previewImportFromSnapshot(snapshot, "qualification", { knownStaffNumbers, planningDate: "2026-08-20" });


    expect(preview.selectedWorksheet.name).toBe("工作表1");
    expect(preview.selectedUpdateOn).toBe("2026-08-18");
    expect(preview.rowCount).toBe(33);
    expect(preview.rows.filter((row) => row.status === "ignored")).toHaveLength(4);
    expect(preview.rows.some((row) => row.rowNumber >= 39)).toBe(false);
    expect(preview.rows.find((row) => row.normalized?.staffNumber === "517968")?.normalized?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qualificationCode: "R00103U", state: "qualified", expiryDate: "2026-10-28" }),
      ]),
    );
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ANNOTATED_DATE_BLOCKED", severity: "error" }),
      expect.objectContaining({ code: "QUALIFICATION_EXPIRED", severity: "warning" }),
    ]));
  });

  it("blocks unknown staff numbers and duplicate rows before commit", async () => {
    const snapshot = await fixtureWorkbook({
      formationRows: [
        ["S2", 1001, "One", "Y", "Y"],
        [null, 1001, "Duplicate", "", "Y"],
      ],
      qualificationRows: [
        ["S2", 1001, "One", new Date("2027-01-01"), "--"],
        [null, 9999, "Unknown", new Date("2027-01-01"), null],
      ],
    });
    const formation = previewImportFromSnapshot(snapshot, "formation");
    expect(formation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_STAFF_NUMBER" }),
    ]));
    const qualification = previewImportFromSnapshot(snapshot, "qualification", {
      knownStaffNumbers: new Set(["1001"]),
    });
    expect(qualification.status).toBe("has-errors");
    expect(qualification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_STAFF_NUMBER" }),
    ]));
  });

  it("treats blank and -- as no qualification and commits only explicit eligible rows", async () => {
    const snapshot = await fixtureWorkbook({
      qualificationRows: [["S2", 1001, "One", "--", null]],
    });
    const preview = previewImportFromSnapshot(snapshot, "qualification");
    expect(preview.status).toBe("valid");
    const row = preview.rows.find((candidate) => candidate.normalized?.staffNumber === "1001");
    expect(row?.normalized?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualificationCode: "R00103U", state: "none", emptyMarker: "double-dash" }),
      expect.objectContaining({ qualificationCode: "R00301U", state: "none", emptyMarker: "blank" }),
    ]));

    const port = new InMemoryImportCommitPort();
    const service = new ExcelImportStagingService(new SnapshotReader(snapshot), { formation: port, qualification: port });
    const receipt = await service.commit(preview, { expectedFingerprint: preview.fingerprint });
    expect(receipt.acceptedRowCount).toBe(1);
    expect(port.getState().qualification).toHaveLength(1);
    const repeated = await service.commit(preview, { expectedFingerprint: preview.fingerprint });
    expect(repeated.id).toBe(receipt.id);
    expect(port.getState().batches).toHaveLength(1);
  });

  it("rejects a source that changes after preview", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duat-import-"));
    const path = join(directory, "source.xlsx");
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Formation");
      sheet.addRow(["Team", "Staff number", "Name", "AP", "CP"]);
      sheet.addRow(["S2", 1001, "One", "Y", "Y"]);
      await workbook.xlsx.writeFile(path);
      const reader = new ExcelJsWorkbookReader();
      const preview = await new ExcelImportStagingService(reader, {
        formation: new InMemoryImportCommitPort(),
        qualification: new InMemoryImportCommitPort(),
      }).preview(path, "formation");

      await writeFile(path, Buffer.from("changed"));
      const service = new ExcelImportStagingService(reader, {
        formation: new InMemoryImportCommitPort(),
        qualification: new InMemoryImportCommitPort(),
      });
      await expect(service.commit(preview)).rejects.toMatchObject<ImportPipelineError>({ code: "SOURCE_READ_FAILED" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class SnapshotReader {
  constructor(private readonly snapshot: Awaited<ReturnType<ExcelJsWorkbookReader["read"]>>) {}
  async read() {
    return this.snapshot;
  }
}

async function fixtureWorkbook(input: {
  formationSheetName?: string;
  qualificationSheetName?: string;
  formationRows?: readonly (readonly unknown[])[];
  qualificationRows?: readonly (readonly unknown[])[];
}) {
  const workbook = new ExcelJS.Workbook();
  if (input.formationRows) {
    const sheet = workbook.addWorksheet(input.formationSheetName ?? "Formation");
    sheet.addRow(["Team", "Staff number", "Name", "AP", "CP"]);
    for (const row of input.formationRows) sheet.addRow([...row]);
  }
  if (input.qualificationRows) {
    const sheet = workbook.addWorksheet(input.qualificationSheetName ?? "Qualification");
    sheet.getCell("A1").value = "Update on :";
    sheet.getCell("D1").value = new Date("2026-08-18");
    sheet.addRow([]);
    sheet.addRow(["Team", "S/N", "Name", "AP", "CP(P)"]);
    sheet.addRow([null, null, null, "R00103U", "R00301U"]);
    for (const row of input.qualificationRows) sheet.addRow([...row]);
  }
  const directory = await mkdtemp(join(tmpdir(), "duat-fixture-"));
  const path = join(directory, "fixture.xlsx");
  await workbook.xlsx.writeFile(path);
  const snapshot = await new ExcelJsWorkbookReader().read(path);
  await rm(directory, { recursive: true, force: true });
  return snapshot;
}
