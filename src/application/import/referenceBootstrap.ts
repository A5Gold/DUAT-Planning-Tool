import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ExcelJsWorkbookReader } from "../../adapters/excel/excelWorkbookReader";
import { SqliteImportCommitPort } from "../../adapters/sqlite/importCommit";
import type {
  ExcelImportKind,
  ImportPreview,
  JobRoleRecordStagedRow,
  QualificationStagedRow,
  RosterStagedRow,
} from "./types";
import { previewImportFromSnapshot } from "./stagingPipeline";

export interface ReferenceBootstrapPaths {
  roster: string;
  qualification: string;
  jobRoleRecord: string;
}

export interface ReferenceBootstrapResult {
  rosterSheets: number;
  rosterRows: number;
  qualificationRows: number;
  jobRoleRows: number;
  warningCount: number;
  errorCount: number;
}

function recordExceptions(
  database: Database.Database,
  batchId: string,
  preview: ImportPreview,
): void {
  const insert = database.prepare(
    `INSERT INTO import_exceptions
     (id, import_batch_id, kind, source_hash, source_worksheet, source_row, source_column, code, severity, message, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of preview.issues) {
    const row = item.source?.row;
    if (!row) continue;
    insert.run(
      randomUUID(),
      batchId,
      preview.kind,
      preview.source.sourceHash,
      item.source?.sheetName ?? preview.selectedWorksheet.name,
      row,
      item.source?.column ?? null,
      item.code,
      item.severity,
      item.message,
      null,
    );
  }
}

function accepted<T extends NonNullable<ImportPreview["rows"][number]["normalized"]>>(
  preview: ImportPreview<T>,
): readonly T[] {
  return preview.rows
    .filter((row) => row.normalized && !row.issues.some((item) => item.severity === "error"))
    .map((row) => row.normalized!);
}

function knownStaff(database: Database.Database): Map<string, { displayName: string; team?: string }> {
  return new Map(
    database.prepare<[], { staff_number: string; display_name: string; team: string }>(
      "SELECT staff_number, display_name, team FROM staff",
    ).all().map((row) => [row.staff_number, { displayName: row.display_name, team: row.team }]),
  );
}

export async function bootstrapReferenceData(
  database: Database.Database,
  paths: ReferenceBootstrapPaths,
  now = () => new Date().toISOString(),
): Promise<ReferenceBootstrapResult> {
  for (const path of Object.values(paths)) {
    if (!existsSync(path)) throw new Error(`Reference source not found: ${path}`);
  }

  const reader = new ExcelJsWorkbookReader();
  const port = new SqliteImportCommitPort(database, now);
  const result: ReferenceBootstrapResult = { rosterSheets: 0, rosterRows: 0, qualificationRows: 0, jobRoleRows: 0, warningCount: 0, errorCount: 0 };

  const rosterSnapshot = await reader.read(paths.roster);
  for (const worksheet of rosterSnapshot.worksheets.filter((sheet) => /\b\d{4}$/.test(sheet.name))) {
    const preview = previewImportFromSnapshot<RosterStagedRow>(rosterSnapshot, "roster", { worksheetName: worksheet.name });
    const rows = accepted(preview);
    let batch;
    try {
      batch = port.commitRoster(rows, preview, { committedAt: now() });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("was already committed")) throw error;
      continue;
    }
    recordExceptions(database, batch.id, preview);
    result.rosterSheets += 1;
    result.rosterRows += rows.length;
    result.warningCount += preview.warningCount;
    result.errorCount += preview.errorCount;
  }

  const staff = knownStaff(database);
  const qualificationSnapshot = await reader.read(paths.qualification);
  const qualificationPreview = previewImportFromSnapshot<QualificationStagedRow>(qualificationSnapshot, "qualification", {
    knownStaffNumbers: new Set(staff.keys()),
    knownStaff: staff,
    includeSupervisors: true,
    planningDate: "2026-08-20",
  });
  const qualificationBatch = port.commitQualification(accepted(qualificationPreview), qualificationPreview, { committedAt: now() });
  recordExceptions(database, qualificationBatch.id, qualificationPreview);
  result.qualificationRows = accepted(qualificationPreview).length;
  result.warningCount += qualificationPreview.warningCount;
  result.errorCount += qualificationPreview.errorCount;

  const refreshedStaff = knownStaff(database);
  const jobRoleSnapshot = await reader.read(paths.jobRoleRecord);
  const jobRolePreview = previewImportFromSnapshot<JobRoleRecordStagedRow>(jobRoleSnapshot, "job-role-record", { knownStaff: refreshedStaff });
  const jobRoleBatch = port.commitJobRoleRecords(accepted(jobRolePreview), jobRolePreview, { committedAt: now() });
  recordExceptions(database, jobRoleBatch.id, jobRolePreview);
  result.jobRoleRows = accepted(jobRolePreview).length;
  result.warningCount += jobRolePreview.warningCount;
  result.errorCount += jobRolePreview.errorCount;

  return result;
}

export function referenceBootstrapPaths(root: string): ReferenceBootstrapPaths {
  return {
    roster: `${root}/00 Reference Document/Roster/2026 Roster.xlsx`,
    qualification: `${root}/00 Reference Document/Qualification/Qualification.xlsx`,
    jobRoleRecord: `${root}/00 Reference Document/Job Role Record/Job Role Record.xlsx`,
  };
}
