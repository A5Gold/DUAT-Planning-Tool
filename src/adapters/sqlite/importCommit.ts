import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  FormationCommitPort,
  FormationStagedRow,
  ImportBatchReceipt,
  ImportCommitContext,
  ImportPreview,
  QualificationCommitPort,
  QualificationStagedRow,
} from "../../application/import";

function qualificationType(kind: QualificationStagedRow["observations"][number]["qualificationKind"]) {
  return kind === "AP" || kind === "CP(P)" || kind === "CP(T)" ? kind : kind === "OTHER" ? undefined : kind;
}

/** SQLite transaction-backed commit port for validated staging previews. */
export class SqliteImportCommitPort implements FormationCommitPort, QualificationCommitPort {
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
        `INSERT INTO qualifications (staff_number, qualification_type, issue_date, expiry_date)
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

  private insertBatch(
    kind: "formation" | "qualification",
    preview: ImportPreview<FormationStagedRow> | ImportPreview<QualificationStagedRow>,
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
