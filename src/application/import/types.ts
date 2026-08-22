import type { Team } from "../../domain/planning";

export type ExcelImportKind = "formation" | "qualification" | "roster" | "job-role-record";
export type ImportIssueSeverity = "error" | "warning";
export type ImportRowStatus = "valid" | "warning" | "invalid" | "ignored";
export type ImportDisposition = "include" | "exclude" | "requires_action";

export type ImportIssueCode =
  | "SOURCE_READ_FAILED"
  | "PREVIEW_NOT_COMMITTABLE"
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_AMBIGUOUS"
  | "NO_SUPPORTED_WORKSHEET"
  | "QUALIFICATION_UPDATE_MISSING"
  | "QUALIFICATION_UPDATE_INVALID"
  | "QUALIFICATION_UPDATE_TIE"
  | "HEADER_MISSING"
  | "HEADER_CONFLICT"
  | "DATA_AFTER_BLANK_SEPARATOR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_STAFF_NUMBER"
  | "DUPLICATE_STAFF_NUMBER"
  | "UNKNOWN_STAFF_NUMBER"
  | "INVALID_TEAM"
  | "TEAM_CONTEXT_MISSING"
  | "INVALID_FLAG"
  | "INVALID_DATE"
  | "ANNOTATED_DATE_BLOCKED"
  | "UNSUPPORTED_QUALIFICATION_COLUMN"
  | "SUPERVISOR_EXCLUDED"
  | "SUPERVISOR_REMARK_REQUIRED"
  | "STAFF_NAME_MISMATCH"
  | "TEAM_MISMATCH"
  | "QUALIFICATION_EXPIRED"
  | "UNKNOWN_ROSTER_CODE"
  | "UNRESOLVED_STAFF_NAME"
  | "JOB_ROLE_HEADER_MISSING";

export interface ImportSource {
  filePath?: string;
  fileName?: string;
  sourceHash: string;
  byteLength: number;
  modifiedAt?: string;
}

export interface SourceRef {
  sheetIndex: number;
  sheetName: string;
  row: number;
  column?: number;
  address?: string;
}

export interface ImportIssue {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  message: string;
  source?: SourceRef;
  field?: string;
}

export interface FormationStagedRow {
  staffNumber: string;
  displayName: string;
  team: Team;
  declaredAp: boolean;
  declaredCp: boolean;
}

export type QualificationDomain = "DUAT" | "SIL" | "OTHER";
export type QualificationKind = "AP" | "CP(P)" | "CP(T)" | "OTHER";

export interface QualificationObservation {
  qualificationCode: string;
  qualificationKind: QualificationKind;
  domain: QualificationDomain;
  state: "qualified" | "none";
  expiryDate?: string;
  emptyMarker?: "blank" | "double-dash";
  source: SourceRef;
}

export interface QualificationStagedRow {
  staffNumber: string;
  displayName: string;
  sourceTeam: string;
  supervisor: boolean;
  observations: readonly QualificationObservation[];
}

export interface RosterStagedRow {
  staffNumber: string;
  displayName?: string;
  sourceTeam?: string;
  grade?: string;
  isSupervisor?: boolean;
  date: string;
  rawCode: string;
  status: "available" | "night-duty" | "unavailable" | "leave" | "sickness" | "training" | "day-duty" | "unknown";
  available: boolean;
  reason?: string;
}

export type JobRoleRecordRole = "AP" | "CP(P)" | "CP(T)" | "SPC" | "HSM" | "LOM";

export interface JobRoleRecordStagedRow {
  workDate: string;
  tn: string;
  line: string;
  workNature: string;
  timeIndicator: string;
  role: JobRoleRecordRole;
  rawStaffName: string;
  staffNumber?: string;
  matchStatus: "matched" | "unresolved" | "non-person";
  remark?: string;
}

export type StagedRowValue = FormationStagedRow | QualificationStagedRow | RosterStagedRow | JobRoleRecordStagedRow;

export interface ImportStagingRow<T extends StagedRowValue = StagedRowValue> {
  id: string;
  rowNumber: number;
  source: SourceRef;
  normalized?: T;
  status: ImportRowStatus;
  disposition: ImportDisposition;
  issues: readonly ImportIssue[];
}

export interface WorksheetDescriptor {
  index: number;
  name: string;
  rowCount: number;
  columnCount: number;
  updateOn?: string;
  hasFormationHeader: boolean;
  hasQualificationHeader: boolean;
  hasJobRoleHeader?: boolean;
}

export interface ImportPreview<T extends StagedRowValue = StagedRowValue> {
  importId: string;
  kind: ExcelImportKind;
  source: ImportSource;
  selectedWorksheet: WorksheetDescriptor;
  selectedUpdateOn?: string;
  fingerprint: string;
  status: "valid" | "has-warnings" | "has-errors";
  rows: readonly ImportStagingRow<T>[];
  issues: readonly ImportIssue[];
  rowCount: number;
  validRowCount: number;
  warningCount: number;
  errorCount: number;
}

export interface ImportPreviewOptions {
  worksheetName?: string;
  knownStaffNumbers?: ReadonlySet<string>;
  knownStaff?: ReadonlyMap<string, { displayName: string; team?: string }>;
  includeSupervisors?: boolean;
  supervisorRemark?: string;
  planningDate?: string;
}

export interface ImportCommitContext {
  committedAt?: string;
  acceptedRowIds?: readonly string[];
  expectedSourceHash?: string;
  expectedFingerprint?: string;
}

export interface ImportBatchReceipt {
  id: string;
  kind: ExcelImportKind;
  sourceHash: string;
  fingerprint: string;
  worksheetName: string;
  committedAt: string;
  rowCount: number;
  acceptedRowCount: number;
}

export interface FormationCommitPort {
  commitFormation(
    rows: readonly FormationStagedRow[],
    preview: ImportPreview<FormationStagedRow>,
    context: ImportCommitContext,
  ): Promise<ImportBatchReceipt> | ImportBatchReceipt;
}

export interface RosterCommitPort {
  commitRoster(
    rows: readonly RosterStagedRow[],
    preview: ImportPreview<RosterStagedRow>,
    context: ImportCommitContext,
  ): Promise<ImportBatchReceipt> | ImportBatchReceipt;
}

export interface JobRoleRecordCommitPort {
  commitJobRoleRecords(
    rows: readonly JobRoleRecordStagedRow[],
    preview: ImportPreview<JobRoleRecordStagedRow>,
    context: ImportCommitContext,
  ): Promise<ImportBatchReceipt> | ImportBatchReceipt;
}

export interface QualificationCommitPort {
  commitQualification(
    rows: readonly QualificationStagedRow[],
    preview: ImportPreview<QualificationStagedRow>,
    context: ImportCommitContext,
  ): Promise<ImportBatchReceipt> | ImportBatchReceipt;
}

export interface InMemoryImportState {
  formation: readonly FormationStagedRow[];
  qualification: readonly QualificationStagedRow[];
  roster?: readonly RosterStagedRow[];
  jobRoleRecords?: readonly JobRoleRecordStagedRow[];
  batches: readonly ImportBatchReceipt[];
}
