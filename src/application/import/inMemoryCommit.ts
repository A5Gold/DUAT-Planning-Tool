import { randomUUID } from "node:crypto";
import type {
  FormationCommitPort,
  FormationStagedRow,
  ImportBatchReceipt,
  ImportCommitContext,
  ImportPreview,
  InMemoryImportState,
  QualificationCommitPort,
  QualificationStagedRow,
} from "./types";

function acceptedRows<T>(rows: readonly T[]): readonly T[] {
  return rows;
}

function receipt<T extends FormationStagedRow | QualificationStagedRow>(
  preview: ImportPreview<T>,
  context: ImportCommitContext,
  acceptedRowCount: number,
): ImportBatchReceipt {
  return {
    id: randomUUID(),
    kind: preview.kind,
    sourceHash: preview.source.sourceHash,
    fingerprint: preview.fingerprint,
    worksheetName: preview.selectedWorksheet.name,
    committedAt: context.committedAt ?? new Date().toISOString(),
    rowCount: preview.rowCount,
    acceptedRowCount,
  };
}

/** A deterministic repository seam for import tests and early vertical slices. */
export class InMemoryImportCommitPort implements FormationCommitPort, QualificationCommitPort {
  private state: InMemoryImportState = { formation: [], qualification: [], batches: [] };

  getState(): InMemoryImportState {
    return {
      formation: this.state.formation.map((row) => ({ ...row })),
      qualification: this.state.qualification.map((row) => ({
        ...row,
        observations: row.observations.map((observation) => ({ ...observation })),
      })),
      batches: this.state.batches.map((batch) => ({ ...batch })),
    };
  }

  commitFormation(
    rows: readonly FormationStagedRow[],
    preview: ImportPreview<FormationStagedRow>,
    context: ImportCommitContext,
  ): ImportBatchReceipt {
    const existing = this.state.batches.find((batch) => batch.kind === preview.kind && batch.fingerprint === preview.fingerprint && batch.sourceHash === preview.source.sourceHash);
    if (existing) return { ...existing };
    const accepted = acceptedRows(rows);
    this.state = {
      ...this.state,
      formation: accepted.map((row) => ({ ...row })),
    };
    const batch = receipt(preview, context, accepted.length);
    this.state.batches = [...this.state.batches, batch];
    return batch;
  }

  commitQualification(
    rows: readonly QualificationStagedRow[],
    preview: ImportPreview<QualificationStagedRow>,
    context: ImportCommitContext,
  ): ImportBatchReceipt {
    const existing = this.state.batches.find((batch) => batch.kind === preview.kind && batch.fingerprint === preview.fingerprint && batch.sourceHash === preview.source.sourceHash);
    if (existing) return { ...existing };
    const accepted = acceptedRows(rows);
    this.state = {
      ...this.state,
      qualification: accepted.map((row) => ({
        ...row,
        observations: row.observations.map((observation) => ({ ...observation })),
      })),
    };
    const batch = receipt(preview, context, accepted.length);
    this.state.batches = [...this.state.batches, batch];
    return batch;
  }
}
