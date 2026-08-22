/**
 * Shared application boundary for the Electron main process and renderer.
 *
 * This file intentionally contains only data contracts. Every value in the
 * contract is composed of structured-clone-safe primitives, arrays and plain
 * records. Electron types, SQLite rows, Excel workbooks and callbacks must
 * stay outside this boundary.
 */

import type {
  AssignmentRole,
  Assignment as DomainAssignment,
  Candidate as DomainCandidate,
  ISODate,
  Location as DomainLocation,
  NightPlan as DomainNightPlan,
  Qualification as DomainQualification,
  QualificationType,
  RosterEntry as DomainRosterEntry,
  Scenario as DomainScenario,
  Staff as DomainStaff,
  ValidationCode,
  ValidationIssue as DomainValidationIssue,
  ValidationReport as DomainValidationReport,
  ValidationSeverity,
  ValidationSummary as DomainValidationSummary,
  Work as DomainWork,
  WorkType,
} from "../domain/planning";

/** Fixed channel names. Do not accept arbitrary channel strings from UI code. */
export const IPC_CHANNELS = {
  health: "app:health",
  getWorkbench: "planning:get-workbench",
  getCandidates: "planning:get-candidates",
  updateWork: "planning:update-work",
  addLocation: "planning:add-location",
  updateLocation: "planning:update-location",
  deleteLocation: "planning:delete-location",
  addAssignment: "planning:add-assignment",
  replaceAssignment: "planning:replace-assignment",
  removeAssignment: "planning:remove-assignment",
  createScenario: "planning:create-scenario",
  renameScenario: "planning:rename-scenario",
  deleteScenario: "planning:delete-scenario",
  saveScenario: "planning:save-scenario",
  applyScenario: "planning:apply-scenario",
  previewImport: "import:preview",
  selectImportFile: "import:select-file",
  commitImport: "import:commit",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type ScenarioRefDto =
  | { kind: "main" }
  | { kind: "scenario"; scenarioId: string };

export type ImportKind = "formation" | "qualification" | "roster" | "job-role-record";
export type ImportPreviewStatus = "valid" | "has-warnings" | "has-errors";
export type ImportBatchStatus = "staged" | "committed" | "rejected";

/** Domain DTOs are explicit aliases to keep the mapping lossless and auditable. */
export type QualificationDto = DomainQualification;
export type StaffDto = DomainStaff;
export type RosterEntryDto = DomainRosterEntry;
export type LocationDto = DomainLocation;
export type WorkDto = DomainWork;
export type AssignmentDto = DomainAssignment;
export type NightPlanDto = DomainNightPlan;
export type ScenarioDto = DomainScenario;
export type ValidationIssueDto = DomainValidationIssue;
export type ValidationSummaryDto = DomainValidationSummary;
export type ValidationReportDto = DomainValidationReport;
export type CandidateDto = DomainCandidate;

export interface HealthDto {
  ok: boolean;
  runtime: "electron" | "browser" | "test";
}

export interface ScenarioSummaryDto {
  id: string;
  name: string;
  temporary: boolean;
  updatedAt?: ISODate;
}

export interface PersonnelAvailabilityDto {
  staff: StaffDto;
  qualifications: readonly QualificationDto[];
  availability: "available" | "unavailable" | "unknown";
  rosterStatus?: RosterEntryDto["status"];
  rosterReason?: string;
  currentWorkId?: string;
  currentWorkSlot?: 1 | 2 | 3 | 4 | 5;
}

export interface WorkbenchSnapshotDto {
  date: ISODate;
  weekNumber: number;
  weekStart: ISODate;
  weekEnd: ISODate;
  revision: number;
  main: NightPlanDto;
  activePlan: NightPlanDto;
  scenarios: readonly ScenarioDto[];
  selectedScenario: ScenarioRefDto;
  personnel: readonly PersonnelAvailabilityDto[];
  validation: ValidationReportDto;
}

export interface MutationEnvelopeDto {
  date: ISODate;
  scenario: ScenarioRefDto;
  expectedRevision: number;
  /** Reconstruction event-store fields. Legacy revision remains during migration. */
  expectedSequence?: number;
  idempotencyKey?: string;
  /** Explicit Planner choice for optional S1 support on this mutation. */
  allowS1Support?: boolean;
}

export interface WorkPatchDto {
  active?: boolean;
  projectCode?: string;
  type?: WorkType;
  jobDescription?: string;
  remarks?: string;
}

export interface LocationPatchDto {
  locationName?: string;
  isolationPoint?: string;
  earthingPoint?: string;
  minimumTotalHeadcount?: number;
  demand?: {
    apCount?: number;
    cpCount?: number;
  };
}

export interface LocationInputDto {
  id: string;
  sequence: number;
  locationName: string;
  isolationPoint: string;
  earthingPoint: string;
  minimumTotalHeadcount: number;
  demand?: {
    apCount?: number;
    cpCount?: number;
  };
}

export interface AssignmentInputDto {
  staffNumber: string;
  workId: string;
  role: AssignmentRole;
  locationId?: string;
  qualificationUsed?: QualificationType;
}

export interface AssignmentTargetDto {
  workId: string;
  role: AssignmentRole;
  locationId?: string;
}

export interface GetWorkbenchRequest {
  date: ISODate;
}

export interface GetCandidatesRequest {
  date: ISODate;
  scenario: ScenarioRefDto;
  target: AssignmentTargetDto;
  allowS1Support?: boolean;
}

export interface UpdateWorkRequest extends MutationEnvelopeDto {
  workId: string;
  patch: WorkPatchDto;
}

export interface AddLocationRequest extends MutationEnvelopeDto {
  workId: string;
  location: LocationInputDto;
}

export interface UpdateLocationRequest extends MutationEnvelopeDto {
  workId: string;
  locationId: string;
  patch: LocationPatchDto;
}

export interface DeleteLocationRequest extends MutationEnvelopeDto {
  workId: string;
  locationId: string;
}

export interface AddAssignmentRequest extends MutationEnvelopeDto {
  assignment: AssignmentInputDto;
}

export interface ReplaceAssignmentRequest extends MutationEnvelopeDto {
  assignmentId: string;
  assignment: AssignmentInputDto;
}

export interface RemoveAssignmentRequest extends MutationEnvelopeDto {
  assignmentId: string;
}

export interface CreateScenarioRequest extends MutationEnvelopeDto {
  scenarioId: string;
  name: string;
  sourceScenario?: ScenarioRefDto;
  temporary?: boolean;
}

export interface RenameScenarioRequest extends MutationEnvelopeDto {
  scenarioId: string;
  name: string;
}

export interface DeleteScenarioRequest extends MutationEnvelopeDto {
  scenarioId: string;
}

/** Persist the selected temporary scenario; this does not apply it to main. */
export interface SaveScenarioRequest extends MutationEnvelopeDto {
  scenarioId: string;
}

/** Apply is deliberately a separate command. Switching a tab never applies. */
export interface ApplyScenarioRequest extends MutationEnvelopeDto {
  scenarioId: string;
}

export interface PlanningMutationDto {
  revision: number;
  snapshot: WorkbenchSnapshotDto;
  validation: ValidationReportDto;
}

export interface CandidateResultDto {
  revision: number;
  candidates: readonly CandidateDto[];
  validation: ValidationReportDto;
}

export interface ImportSourceDto {
  filePath: string;
  worksheetName?: string;
}

export interface ImportPreviewRequest {
  kind: ImportKind;
  source: ImportSourceDto;
}

export interface SelectImportFileRequest {
  kind: ImportKind;
}

export interface SelectImportFileDto {
  canceled: boolean;
  filePath?: string;
}

export type ImportCellDto = string | number | boolean | null;

export interface ImportRowIssueDto {
  rowNumber: number;
  severity: ValidationSeverity;
  code: string;
  message: string;
  column?: string;
}

export interface ImportStagingRowDto {
  rowNumber: number;
  status: "valid" | "warning" | "invalid" | "ignored";
  staffNumber?: string;
  values: Readonly<Record<string, ImportCellDto>>;
  issues: readonly ImportRowIssueDto[];
}

export interface ImportPreviewDto {
  importId: string;
  kind: ImportKind;
  source: ImportSourceDto;
  selectedWorksheet: string;
  status: ImportPreviewStatus;
  rowCount: number;
  validRowCount: number;
  warningCount: number;
  errorCount: number;
  rows: readonly ImportStagingRowDto[];
  issues: readonly ImportRowIssueDto[];
}

export interface ImportCommitRequest extends MutationEnvelopeDto {
  importId: string;
  acceptedRowNumbers?: readonly number[];
}

export interface ImportBatchDto {
  id: string;
  kind: ImportKind;
  sourceFilePath: string;
  sourceWorksheet: string;
  importedAt: ISODate;
  status: ImportBatchStatus;
  rowCount: number;
  errorCount: number;
}

export interface ImportCommitDto {
  revision: number;
  batch: ImportBatchDto;
  snapshot: WorkbenchSnapshotDto;
}

export interface FieldValidationErrorDto {
  path: string;
  message: string;
}

export type IpcError =
  | {
      kind: "invalid-request";
      code: "INVALID_REQUEST";
      message: string;
      fields: readonly FieldValidationErrorDto[];
    }
  | {
      kind: "domain";
      code: ValidationCode;
      message: string;
      report: ValidationReportDto;
    }
  | {
      kind: "conflict";
      code: "STALE_REVISION";
      message: string;
      expectedRevision: number;
      actualRevision: number;
    }
  | {
      kind: "not-found";
      code: "NOT_FOUND";
      entity: "night" | "work" | "location" | "assignment" | "scenario" | "import";
      id: string;
      message: string;
    }
  | {
      kind: "import";
      code: "IMPORT_FAILED" | "IMPORT_NOT_READY";
      message: string;
      importId?: string;
      fields?: readonly FieldValidationErrorDto[];
    }
  | {
      kind: "system";
      code: "PERSISTENCE_ERROR" | "IPC_ERROR";
      message: string;
      retryable: boolean;
    };

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

export interface IpcCommandMap {
  "app:health": {
    request: undefined;
    response: IpcResult<HealthDto>;
  };
  "planning:get-workbench": {
    request: GetWorkbenchRequest;
    response: IpcResult<{ snapshot: WorkbenchSnapshotDto }>;
  };
  "planning:get-candidates": {
    request: GetCandidatesRequest;
    response: IpcResult<CandidateResultDto>;
  };
  "planning:update-work": {
    request: UpdateWorkRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:add-location": {
    request: AddLocationRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:update-location": {
    request: UpdateLocationRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:delete-location": {
    request: DeleteLocationRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:add-assignment": {
    request: AddAssignmentRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:replace-assignment": {
    request: ReplaceAssignmentRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:remove-assignment": {
    request: RemoveAssignmentRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:create-scenario": {
    request: CreateScenarioRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:rename-scenario": {
    request: RenameScenarioRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:delete-scenario": {
    request: DeleteScenarioRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:save-scenario": {
    request: SaveScenarioRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "planning:apply-scenario": {
    request: ApplyScenarioRequest;
    response: IpcResult<PlanningMutationDto>;
  };
  "import:preview": {
    request: ImportPreviewRequest;
    response: IpcResult<{ preview: ImportPreviewDto }>;
  };
  "import:select-file": {
    request: SelectImportFileRequest;
    response: IpcResult<SelectImportFileDto>;
  };
  "import:commit": {
    request: ImportCommitRequest;
    response: IpcResult<ImportCommitDto>;
  };
}

export type IpcRequest<C extends IpcChannel> = IpcCommandMap[C]["request"];
export type IpcResponse<C extends IpcChannel> = IpcCommandMap[C]["response"];

export type IpcMethod<C extends IpcChannel> = IpcRequest<C> extends undefined
  ? () => Promise<IpcResponse<C>>
  : (request: IpcRequest<C>) => Promise<IpcResponse<C>>;

export type IpcInvoker = { [C in IpcChannel]: IpcMethod<C> };

/** Renderer-facing facade. It deliberately exposes no raw ipcRenderer. */
export type OhlrApi = IpcInvoker & {
  health: IpcMethod<"app:health">;
  planning: {
    getWorkbench: IpcMethod<"planning:get-workbench">;
    getCandidates: IpcMethod<"planning:get-candidates">;
    updateWork: IpcMethod<"planning:update-work">;
    addLocation: IpcMethod<"planning:add-location">;
    updateLocation: IpcMethod<"planning:update-location">;
    deleteLocation: IpcMethod<"planning:delete-location">;
    addAssignment: IpcMethod<"planning:add-assignment">;
    replaceAssignment: IpcMethod<"planning:replace-assignment">;
    removeAssignment: IpcMethod<"planning:remove-assignment">;
    createScenario: IpcMethod<"planning:create-scenario">;
    renameScenario: IpcMethod<"planning:rename-scenario">;
    deleteScenario: IpcMethod<"planning:delete-scenario">;
    saveScenario: IpcMethod<"planning:save-scenario">;
    applyScenario: IpcMethod<"planning:apply-scenario">;
  };
  imports: {
    preview: IpcMethod<"import:preview">;
    selectFile: IpcMethod<"import:select-file">;
    commit: IpcMethod<"import:commit">;
    getPathForFile: (file: File) => string;
  };
};

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail(error: IpcError): IpcResult<never> {
  return { ok: false, error };
}
