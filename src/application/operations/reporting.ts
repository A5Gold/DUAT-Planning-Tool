import type { CapacityMetrics } from "../../domain/operations/analytics";
import type { DutyProjection } from "../../domain/operations/duty";

export interface ReportEnvelope {
  reportId: string;
  generatedAt: string;
  snapshotSequence: number;
  policyVersions: readonly string[];
  format: "json" | "csv";
}

export interface OperationsReport extends ReportEnvelope {
  date: string;
  capacity: CapacityMetrics;
  plannedCount: number;
  actualCount: number;
  substitutions: number;
  absences: number;
}

export function buildOperationsReport(input: {
  date: string;
  snapshotSequence: number;
  policyVersions: readonly string[];
  capacity: CapacityMetrics;
  duties: DutyProjection;
  generatedAt?: string;
}): OperationsReport {
  const actual = [...input.duties.actual.values()];
  return {
    reportId: `operations:${input.date}:${input.snapshotSequence}`,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    snapshotSequence: input.snapshotSequence,
    policyVersions: [...input.policyVersions],
    format: "json",
    date: input.date,
    capacity: input.capacity,
    plannedCount: input.duties.planned.size,
    actualCount: actual.length,
    substitutions: actual.filter((item) => item.status === "substituted").length,
    absences: actual.filter((item) => item.status === "absent").length,
  };
}

export function exportAuditCsv(report: OperationsReport): string {
  const rows = [
    ["reportId", report.reportId],
    ["generatedAt", report.generatedAt],
    ["snapshotSequence", String(report.snapshotSequence)],
    ["policyVersions", report.policyVersions.join("|")],
    ["date", report.date],
    ["plannedCount", String(report.plannedCount)],
    ["actualCount", String(report.actualCount)],
    ["substitutions", String(report.substitutions)],
    ["absences", String(report.absences)],
    ["available", String(report.capacity.available)],
    ["qualified", String(report.capacity.qualified)],
    ["assigned", String(report.capacity.assigned)],
    ["reserved", String(report.capacity.reserved)],
    ["spare", String(report.capacity.spare)],
    ["shortage", String(report.capacity.shortage)],
    ["plannedUtilisation", String(report.capacity.plannedUtilisation)],
    ["actualUtilisation", String(report.capacity.actualUtilisation)],
  ];
  return rows.map(([key, value]) => `${key},${JSON.stringify(value)}`).join("\n");
}
