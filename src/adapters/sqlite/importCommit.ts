import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

function rosterTeam(rawTeam: string | undefined): "S1" | "S2" | "S3" | "S4" | "S5" | undefined {
  const value = rawTeam?.trim().toUpperCase() ?? "";
  if (/^S1/.test(value)) return "S1";
  if (/^S2/.test(value)) return "S2";
  if (/^S3/.test(value)) return "S3";
  if (/^S4/.test(value)) return "S4";
  if (/^S5/.test(value)) return "S5";
  // Supervisors and central teams are kept in source metadata; S1 is only
  // the legacy planner bucket required by the compatibility read model.
  if (value === "SUP." || value === "SR. SUP." || value === "P&C" || value === "APPRENTICE" || value === "SMART MAIN") return "S1";
  return undefined;
}
import type {
  FormationCommitPort,
  FormationStagedRow,
  ImportBatchReceipt,
  ImportCommitContext,
  ImportPreview,
  QualificationCommitPort,
  QualificationStagedRow,
  RosterCommitPort,
  RosterStagedRow,
  JobRoleRecordCommitPort,
  JobRoleRecordStagedRow,
} from "../../application/import";

function qualificationType(kind: QualificationStagedRow["observations"][number]["qualificationKind"]) {
  return kind === "AP" || kind === "CP(P)" || kind === "CP(T)" ? kind : kind === "OTHER" ? undefined : kind;
}

/** SQLite transaction-backed commit port for validated staging previews. */
export class SqliteImportCommitPort implements FormationCommitPort, QualificationCommitPort, RosterCommitPort, JobRoleRecordCommitPort {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  commitFormation(
    rows: readonly FormationStagedRow[],
    preview: ImportPreview<FormationStagedRow>,
    context: ImportCommitContext,
  ): ImportBatchReceipt {
    return this.database.transaction(() => {
      const batch = this.insertBatch("formation", preview, context, rows.length);
      const upsert = this.database.prepare(
        `INSERT INTO staff (staff_number, display_name, team, active, is_supervisor, is_general_employee)
         VALUES (?, ?, ?, 1, 0, ?)
         ON CONFLICT(staff_number) DO UPDATE SET display_name = excluded.display_name,
           team = excluded.team, is_general_employee = excluded.is_general_employee`,
      );
      const rowInsert = this.database.prepare(
        `INSERT INTO import_batch_rows (batch_id, row_id, row_number, disposition, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        upsert.run(row.staffNumber, row.displayName, row.team, row.declaredAp || row.declaredCp ? 0 : 1);
        const staged = preview.rows.find((item) => item.normalized?.staffNumber === row.staffNumber);
        if (staged) rowInsert.run(batch.id, staged.id, staged.rowNumber, "include", JSON.stringify(row));
      }
      return batch;
    }).immediate();
  }

  commitQualification(
    rows: readonly QualificationStagedRow[],
    preview: ImportPreview<QualificationStagedRow>,
    context: ImportCommitContext,
  ): ImportBatchReceipt {
    return this.database.transaction(() => {
      const batch = this.insertBatch("qualification", preview, context, rows.length);
      const knownStaff = new Set(
        (this.database.prepare<[], { staff_number: string }>("SELECT staff_number FROM staff").all()).map((row) => row.staff_number),
      );
      const accepted = rows.filter((row) => knownStaff.has(row.staffNumber));
      const deleteQualifications = this.database.prepare("DELETE FROM qualifications WHERE staff_number = ?");
      const insertQualification = this.database.prepare(
        `INSERT OR IGNORE INTO qualifications (staff_number, qualification_type, issue_date, expiry_date)
         VALUES (?, ?, '', ?)`,
      );
      const rowInsert = this.database.prepare(
        `INSERT INTO import_batch_rows (batch_id, row_id, row_number, disposition, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of accepted) {
        deleteQualifications.run(row.staffNumber);
        for (const observation of row.observations) {
          const type = qualificationType(observation.qualificationKind);
          if (type && observation.state === "qualified" && observation.expiryDate) {
            insertQualification.run(row.staffNumber, type, observation.expiryDate);
          }
        }
        const staged = preview.rows.find((item) => item.normalized?.staffNumber === row.staffNumber);
        if (staged) rowInsert.run(batch.id, staged.id, staged.rowNumber, "include", JSON.stringify(row));
      }
      return batch;
    }).immediate();
  }

  commitRoster(rows: readonly RosterStagedRow[], preview: ImportPreview<RosterStagedRow>, context: ImportCommitContext): ImportBatchReceipt {
    return this.database.transaction(() => {
      const batch = this.insertBatch("roster", preview, context, rows.length);
      const upsertStaff = this.database.prepare(
        `INSERT INTO staff (staff_number, display_name, team, active, is_supervisor, is_general_employee)
         VALUES (?, ?, ?, 1, ?, 0)
         ON CONFLICT(staff_number) DO UPDATE SET display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE staff.display_name END,
           team = excluded.team, is_supervisor = excluded.is_supervisor`,
      );
      const metadata = this.database.prepare(
        `INSERT INTO staff_source_metadata (staff_number, raw_team, grade, title, source_hash, source_worksheet, source_row)
         VALUES (?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(staff_number) DO UPDATE SET raw_team = excluded.raw_team, grade = excluded.grade,
           source_hash = excluded.source_hash, source_worksheet = excluded.source_worksheet, source_row = excluded.source_row`,
      );
      const upsert = this.database.prepare(
        `INSERT INTO roster_entries (planning_date, staff_number, status, available, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(planning_date, staff_number) DO UPDATE SET status = excluded.status,
           available = excluded.available, reason = excluded.reason`,
      );
      const rowInsert = this.database.prepare(
        `INSERT INTO import_batch_rows (batch_id, row_id, row_number, disposition, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        const team = rosterTeam(row.sourceTeam);
        if (row.displayName && team) {
          upsertStaff.run(row.staffNumber, row.displayName, team, row.isSupervisor ? 1 : 0);
          metadata.run(row.staffNumber, row.sourceTeam ?? team, row.grade ?? null, preview.source.sourceHash, preview.selectedWorksheet.name, preview.rows.find((item) => item.normalized?.staffNumber === row.staffNumber)?.rowNumber ?? 1);
        }
        const staffExists = this.database.prepare<[string], { staff_number: string }>("SELECT staff_number FROM staff WHERE staff_number = ?").get(row.staffNumber);
        if (!staffExists) continue;
        upsert.run(row.date, row.staffNumber, row.status, row.available ? 1 : 0, row.reason ?? null);
        const staged = preview.rows.find((item) => item.normalized?.staffNumber === row.staffNumber && item.normalized?.date === row.date);
        if (staged) rowInsert.run(batch.id, staged.id, staged.rowNumber, "include", JSON.stringify(row));
      }
      return batch;
    }).immediate();
  }

  commitJobRoleRecords(rows: readonly JobRoleRecordStagedRow[], preview: ImportPreview<JobRoleRecordStagedRow>, context: ImportCommitContext): ImportBatchReceipt {
    return this.database.transaction(() => {
      const batch = this.insertBatch("job-role-record", preview, context, rows.length);
      const insert = this.database.prepare(
        `INSERT INTO job_role_records
         (id, work_date, tn, line, work_nature, time_indicator, role, raw_staff_name, staff_number, match_status, layer, remark, source_hash, source_worksheet, source_row, source_column, raw_payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy_planned_candidate', ?, ?, ?, ?, ?, ?)`,
      );
      const rowInsert = this.database.prepare(
        `INSERT INTO import_batch_rows (batch_id, row_id, row_number, disposition, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        const staged = preview.rows.find((item) => item.normalized?.workDate === row.workDate && item.normalized?.rawStaffName === row.rawStaffName && item.normalized?.role === row.role && item.normalized?.staffNumber === row.staffNumber);
        const recordId = randomUUID();
        insert.run(
          recordId, row.workDate, row.tn, row.line, row.workNature, row.timeIndicator, row.role,
          row.rawStaffName, row.staffNumber ?? null, row.matchStatus, row.remark ?? null, preview.source.sourceHash,
          preview.selectedWorksheet.name, staged?.rowNumber ?? 1, staged?.source.column ?? 1, JSON.stringify(row),
        );
        if (staged) rowInsert.run(batch.id, recordId, staged.rowNumber, "include", JSON.stringify(row));
      }
      return batch;
    }).immediate();
  }

  private insertBatch(
    kind: "formation" | "qualification" | "roster" | "job-role-record",
    preview: ImportPreview<FormationStagedRow> | ImportPreview<QualificationStagedRow> | ImportPreview<RosterStagedRow> | ImportPreview<JobRoleRecordStagedRow>,
    context: ImportCommitContext,
    acceptedRowCount: number,
  ): ImportBatchReceipt {
    const existing = this.database.prepare<[string], { id: string }>("SELECT id FROM import_batches WHERE fingerprint = ?").get(preview.fingerprint);
    if (existing) throw new Error(`Import fingerprint ${preview.fingerprint} was already committed.`);
    const receipt: ImportBatchReceipt = {
      id: randomUUID(),
      kind,
      sourceHash: preview.source.sourceHash,
      fingerprint: preview.fingerprint,
      worksheetName: preview.selectedWorksheet.name,
      committedAt: context.committedAt ?? this.now(),
      rowCount: preview.rowCount,
      acceptedRowCount,
    };
    this.database.prepare(
      `INSERT INTO import_batches (id, kind, source_hash, fingerprint, worksheet_name, committed_at, row_count, accepted_row_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(receipt.id, receipt.kind, receipt.sourceHash, receipt.fingerprint, receipt.worksheetName, receipt.committedAt, receipt.rowCount, receipt.acceptedRowCount);
    return receipt;
  }
}
