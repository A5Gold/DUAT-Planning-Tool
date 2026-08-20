import { dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcError,
  type IpcRequest,
  type IpcResponse,
  type ImportPreviewDto,
  type ImportBatchDto,
  type ImportPreviewRequest,
} from "../src/application/ipcContract";
import { assertIpcRequest, validateIpcResponse } from "../src/application/ipcValidation";
import {
  DomainMutationError,
  PlanningEntityNotFoundError,
  PlanningApplication,
  type PlanningAggregateStore,
} from "../src/application/planningApplication";
import {
  AggregateRevisionConflictError,
  SqliteImportCommitPort,
  SqlitePlanningRepository,
} from "../src/adapters/sqlite";
import {
  ExcelImportStagingService,
  ImportPipelineError,
  type ImportPreview,
  type FormationStagedRow,
  type QualificationStagedRow,
} from "../src/application/import";
import { ExcelJsWorkbookReader } from "../src/adapters/excel";
import type { ExcelImportKind } from "../src/application/import";
import type Database from "better-sqlite3";

export interface MainIpcRuntime {
  readonly application: PlanningApplication;
  readonly repository: PlanningAggregateStore;
  readonly importService: ExcelImportStagingService;
  readonly previews: Map<string, ImportPreview<FormationStagedRow | QualificationStagedRow>>;
}

function errorResult(error: IpcError): { ok: false; error: IpcError } {
  return { ok: false, error };
}

function invalidRequest(error: unknown): IpcError {
  const fields = error && typeof error === "object" && "issues" in error
    ? (error as { issues: readonly { path: string; message: string }[] }).issues
    : [{ path: "$", message: error instanceof Error ? error.message : "Invalid request" }];
  return { kind: "invalid-request", code: "INVALID_REQUEST", message: "IPC request validation failed.", fields };
}

function mapImportPreview(preview: ImportPreview<FormationStagedRow | QualificationStagedRow>): ImportPreviewDto {
  return {
    importId: preview.importId,
    kind: preview.kind,
    source: { filePath: preview.source.filePath ?? preview.source.fileName ?? "", worksheetName: preview.selectedWorksheet.name },
    selectedWorksheet: preview.selectedWorksheet.name,
    status: preview.status,
    rowCount: preview.rowCount,
    validRowCount: preview.validRowCount,
    warningCount: preview.warningCount,
    errorCount: preview.errorCount,
    rows: preview.rows.map((row) => {
      const normalized = row.normalized;
      const values: Record<string, string | number | boolean | null> = {
        staffNumber: normalized?.staffNumber ?? null,
        displayName: normalized?.displayName ?? null,
        status: row.status,
      };
      if (normalized && "team" in normalized) values.team = normalized.team;
      if (normalized && "sourceTeam" in normalized) values.team = normalized.sourceTeam;
      return {
        rowNumber: row.rowNumber,
        status: row.status,
        staffNumber: normalized?.staffNumber,
        values,
        issues: row.issues.map((item) => ({
          rowNumber: row.rowNumber,
          severity: item.severity,
          code: item.code,
          message: item.message,
          column: item.field,
        })),
      };
    }),
    issues: preview.issues.map((item) => ({
      rowNumber: item.source?.row ?? 1,
      severity: item.severity,
      code: item.code,
      message: item.message,
      column: item.field,
    })),
  };
}

function mapError(error: unknown): IpcError {
  if (error instanceof DomainMutationError) {
    const first = error.report.issues[0];
    return {
      kind: "domain",
      code: first?.code ?? "QUALIFICATION_REQUIRED",
      message: first?.message ?? "Planning mutation rejected.",
      report: error.report,
    };
  }
  if (error instanceof AggregateRevisionConflictError) {
    return {
      kind: "conflict",
      code: "STALE_REVISION",
      message: error.message,
      expectedRevision: error.expectedRevision ?? 0,
      actualRevision: error.actualRevision ?? 0,
    };
  }
  if (error instanceof PlanningEntityNotFoundError) {
    return {
      kind: "not-found",
      code: "NOT_FOUND",
      entity: error.entity,
      id: error.id,
      message: error.message,
    };
  }
  if (error instanceof ImportPipelineError) {
    return {
      kind: "import",
      code: "IMPORT_FAILED",
      message: error.message,
      fields: error.issues.map((item) => ({ path: item.field ?? "$", message: item.message })),
    };
  }
  return {
    kind: "system",
    code: "IPC_ERROR",
    message: error instanceof Error ? error.message : "IPC operation failed.",
    retryable: false,
  };
}

function importKind(kind: ImportPreviewRequest["kind"]): ExcelImportKind {
  if (kind === "formation" || kind === "qualification") return kind;
  throw new ImportPipelineError("NO_SUPPORTED_WORKSHEET", "Roster import staging will be enabled in a later phase.");
}

function register<C extends IpcChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, rawRequest) => {
    try {
      const request = assertIpcRequest(channel, rawRequest);
      const response = await handler(event, request);
      const checked = validateIpcResponse(channel, response);
      if (!checked.ok) return errorResult({ kind: "system", code: "IPC_ERROR", message: "IPC response validation failed.", retryable: false });
      return response;
    } catch (error) {
      return errorResult(error instanceof Error && error.name === "IpcValidationError" ? invalidRequest(error) : mapError(error));
    }
  });
}

export function registerIpcHandlers(runtime: MainIpcRuntime): void {
  register(IPC_CHANNELS.health, () => ({ ok: true, data: { ok: true, runtime: "electron" as const } }));
  register(IPC_CHANNELS.getWorkbench, (_event, request) => ({ ok: true, data: { snapshot: runtime.application.getWorkbench(request.date) } }));
  register(IPC_CHANNELS.getCandidates, (_event, request) => ({ ok: true, data: runtime.application.getCandidates(request) }));
  register(IPC_CHANNELS.updateWork, (_event, request) => ({ ok: true, data: runtime.application.updateWork(request) }));
  register(IPC_CHANNELS.addLocation, (_event, request) => ({ ok: true, data: runtime.application.addLocation(request) }));
  register(IPC_CHANNELS.updateLocation, (_event, request) => ({ ok: true, data: runtime.application.updateLocation(request) }));
  register(IPC_CHANNELS.deleteLocation, (_event, request) => ({ ok: true, data: runtime.application.deleteLocation(request) }));
  register(IPC_CHANNELS.addAssignment, (_event, request) => ({ ok: true, data: runtime.application.addAssignment(request) }));
  register(IPC_CHANNELS.replaceAssignment, (_event, request) => ({ ok: true, data: runtime.application.replaceAssignment(request) }));
  register(IPC_CHANNELS.removeAssignment, (_event, request) => ({ ok: true, data: runtime.application.removeAssignment(request) }));
  register(IPC_CHANNELS.createScenario, (_event, request) => ({ ok: true, data: runtime.application.createScenario(request) }));
  register(IPC_CHANNELS.renameScenario, (_event, request) => ({ ok: true, data: runtime.application.renameScenario(request) }));
  register(IPC_CHANNELS.deleteScenario, (_event, request) => ({ ok: true, data: runtime.application.deleteScenario(request) }));
  register(IPC_CHANNELS.saveScenario, (_event, request) => ({ ok: true, data: runtime.application.saveScenario(request) }));
  register(IPC_CHANNELS.applyScenario, (_event, request) => ({ ok: true, data: runtime.application.applyScenario(request) }));

  register(IPC_CHANNELS.previewImport, async (_event, request) => {
    const knownStaff = new Map(
      runtime.repository.getStaff().map((staff) => [staff.staffNumber, { displayName: staff.name, team: staff.team }]),
    );
    const preview = await runtime.importService.preview(request.source.filePath, importKind(request.kind), {
      worksheetName: request.source.worksheetName,
      knownStaffNumbers: new Set(knownStaff.keys()),
      knownStaff,
    });
    runtime.previews.set(preview.importId, preview);
    return { ok: true, data: { preview: mapImportPreview(preview) } };
  });

  register(IPC_CHANNELS.selectImportFile, async () => {
    const result = await dialog.showOpenDialog({
      title: "選擇 Excel 資料來源",
      properties: ["openFile"],
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    return result.canceled
      ? { ok: true, data: { canceled: true } }
      : { ok: true, data: { canceled: false, filePath: result.filePaths[0] } };
  });

  register(IPC_CHANNELS.commitImport, async (_event, request) => {
    const currentSnapshot = runtime.application.getWorkbench(request.date, request.scenario);
    if (currentSnapshot.revision !== request.expectedRevision) {
      throw new AggregateRevisionConflictError(request.date, request.expectedRevision, currentSnapshot.revision);
    }
    const preview = runtime.previews.get(request.importId);
    if (!preview) throw new ImportPipelineError("SOURCE_READ_FAILED", "找不到 import preview，請重新預覽。");
    const batch = await runtime.importService.commit(preview, {
      expectedSourceHash: preview.source.sourceHash,
      expectedFingerprint: preview.fingerprint,
      acceptedRowIds: request.acceptedRowNumbers?.map((row) => `${preview.kind}:${preview.selectedWorksheet.index}:${row}`),
    });
    runtime.previews.delete(request.importId);
    const snapshot = runtime.application.getWorkbench(request.date, request.scenario);
    const batchDto: ImportBatchDto = {
      id: batch.id,
      kind: batch.kind,
      sourceFilePath: preview.source.filePath ?? preview.source.fileName ?? "",
      sourceWorksheet: batch.worksheetName,
      importedAt: batch.committedAt,
      status: "committed",
      rowCount: batch.rowCount,
      errorCount: 0,
    };
    return { ok: true, data: { revision: snapshot.revision, batch: batchDto, snapshot } };
  });
}

export function createMainIpcRuntime(database: Database.Database): MainIpcRuntime {
  const repository = new SqlitePlanningRepository(database) as PlanningAggregateStore;
  const importPort = new SqliteImportCommitPort(database);
  return {
    application: new PlanningApplication(repository),
    repository,
    importService: new ExcelImportStagingService(new ExcelJsWorkbookReader(), {
      formation: importPort,
      qualification: importPort,
    }),
    previews: new Map(),
  };
}
