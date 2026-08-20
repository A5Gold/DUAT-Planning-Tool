import {
  cellAddress,
  cellText,
  formatDate,
  type ExcelCell,
  type ExcelWorkbookReader,
  type ExcelWorkbookSnapshot,
  type ExcelWorksheetSnapshot,
} from "../../adapters/excel/excelWorkbookReader";
import type { Team } from "../../domain/planning";
import { fingerprint } from "./hash";
import type {
  ExcelImportKind,
  FormationCommitPort,
  FormationStagedRow,
  ImportBatchReceipt,
  ImportCommitContext,
  ImportIssue,
  ImportIssueCode,
  ImportPreview,
  ImportPreviewOptions,
  ImportSource,
  ImportStagingRow,
  QualificationCommitPort,
  QualificationDomain,
  QualificationKind,
  QualificationObservation,
  QualificationStagedRow,
  WorksheetDescriptor,
} from "./types";

const TEAMS = new Set<Team>(["S1", "S2", "S3", "S4", "S5"]);
const FORMATION_HEADER_NAMES = new Set(["team", "staff number", "name", "ap", "cp"]);

interface QualificationColumn {
  column: number;
  code: string;
  label?: string;
  kind: QualificationKind;
  domain: QualificationDomain;
}

interface QualificationHeader {
  headerRow: number;
  codeRow: number;
  columns: readonly QualificationColumn[];
  unsupportedColumns: readonly { column: number; value: string }[];
}

interface WorksheetAnalysis {
  formationHeaderRow?: number;
  qualificationHeader?: QualificationHeader;
  updateOn?: string;
}

const QUALIFICATION_CATALOG: Readonly<Record<string, { kind: QualificationKind; domain: QualificationDomain }>> = {
  J01005: { kind: "OTHER", domain: "OTHER" },
  JCS134: { kind: "OTHER", domain: "OTHER" },
  R00902R: { kind: "OTHER", domain: "OTHER" },
  EP2002: { kind: "OTHER", domain: "OTHER" },
  JCS135: { kind: "OTHER", domain: "OTHER" },
  JSC374: { kind: "OTHER", domain: "OTHER" },
  JCS473: { kind: "OTHER", domain: "OTHER" },
  JCS475: { kind: "OTHER", domain: "OTHER" },
  JCS478: { kind: "OTHER", domain: "OTHER" },
  JSC478: { kind: "OTHER", domain: "OTHER" },
  R00103U: { kind: "AP", domain: "DUAT" },
  OR161R: { kind: "OTHER", domain: "OTHER" },
  R00301S: { kind: "CP(P)", domain: "SIL" },
  R00302S: { kind: "CP(T)", domain: "SIL" },
  R00301U: { kind: "CP(P)", domain: "DUAT" },
  R00302U: { kind: "CP(T)", domain: "DUAT" },
  OM141C: { kind: "OTHER", domain: "OTHER" },
  R00401U: { kind: "OTHER", domain: "DUAT" },
  R00402U: { kind: "OTHER", domain: "DUAT" },
  R00501U: { kind: "OTHER", domain: "DUAT" },
  R00601: { kind: "OTHER", domain: "OTHER" },
  R00601S: { kind: "OTHER", domain: "OTHER" },
  EH118G: { kind: "OTHER", domain: "OTHER" },
  S22000: { kind: "OTHER", domain: "OTHER" },
  "S22000\u00a0": { kind: "OTHER", domain: "OTHER" },
  S22200: { kind: "OTHER", domain: "OTHER" },
  S22303: { kind: "OTHER", domain: "OTHER" },
  J01352: { kind: "OTHER", domain: "OTHER" },
  J01353: { kind: "OTHER", domain: "OTHER" },
  S11011: { kind: "OTHER", domain: "OTHER" },
  S3200: { kind: "OTHER", domain: "OTHER" },
  R00701: { kind: "OTHER", domain: "OTHER" },
};

const IMPORTABLE_QUALIFICATION_CODES = new Set(Object.keys(QUALIFICATION_CATALOG));

function normalizeHeader(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sourceRef(sheet: ExcelWorksheetSnapshot, row: number, column?: number) {
  return {
    sheetIndex: sheet.index,
    sheetName: sheet.name,
    row,
    column,
    address: column ? cellAddress(row, column) : undefined,
  };
}

function issue(
  code: ImportIssueCode,
  message: string,
  sheet: ExcelWorksheetSnapshot,
  row: number,
  column?: number,
  severity: "error" | "warning" = "error",
  field?: string,
): ImportIssue {
  return { code, severity, message, source: sourceRef(sheet, row, column), field };
}

function rowHasValues(sheet: ExcelWorksheetSnapshot, row: number, maxColumn = 3): boolean {
  const values = sheet.rows[row - 1] ?? [];
  return values.slice(0, maxColumn).some((cell) => cell.kind !== "blank");
}

function rowIsCompletelyBlank(sheet: ExcelWorksheetSnapshot, row: number): boolean {
  return !(sheet.rows[row - 1] ?? []).some((cell) => cell.kind !== "blank");
}

function isFormulaOrUnsupported(cell: ExcelCell | undefined): boolean {
  return cell?.kind === "formula" || cell?.kind === "unsupported" || cell?.kind === "error";
}

function findUpdateOn(sheet: ExcelWorksheetSnapshot): { value?: string; issue?: ImportIssue } {
  for (let row = 1; row <= Math.min(sheet.rowCount, 10); row += 1) {
    const values = sheet.rows[row - 1] ?? [];
    for (let column = 1; column <= values.length; column += 1) {
      if (normalizeHeader(cellText(values[column - 1])) !== "update on :" && normalizeHeader(cellText(values[column - 1])) !== "update on") {
        continue;
      }
      for (let next = column + 1; next <= values.length; next += 1) {
        const candidate = values[next - 1];
        if (!candidate || candidate.kind === "blank") continue;
        // ExcelJS exposes merged cells as repeated values. Ignore repeated
        // "Update on" labels until the actual date cell is reached.
        if (normalizeHeader(cellText(candidate)) === "update on :" || normalizeHeader(cellText(candidate)) === "update on") continue;
        if (candidate.kind === "date") return { value: formatDate(candidate.value) };
        return {
          issue: issue("QUALIFICATION_UPDATE_INVALID", "Update on 必須是有效日期。", sheet, row, next),
        };
      }
      return { issue: issue("QUALIFICATION_UPDATE_MISSING", "找不到 Update on 日期。", sheet, row, column) };
    }
  }
  return { issue: issue("QUALIFICATION_UPDATE_MISSING", "找不到 Update on 欄位。", sheet, 1, 1) };
}


function findFormationHeader(sheet: ExcelWorksheetSnapshot): number | undefined {
  for (let row = 1; row <= Math.min(sheet.rowCount, 15); row += 1) {
    const values = sheet.rows[row - 1] ?? [];
    const names = new Set(values.map((cell) => normalizeHeader(cellText(cell))).filter(Boolean));
    if ([...FORMATION_HEADER_NAMES].every((name) => names.has(name))) return row;
  }
  return undefined;
}

function findQualificationHeader(sheet: ExcelWorksheetSnapshot): QualificationHeader | undefined {
  for (let row = 1; row <= Math.min(sheet.rowCount, 15); row += 1) {
    const labels = sheet.rows[row - 1] ?? [];
    const firstThree = labels.slice(0, 3).map((cell) => normalizeHeader(cellText(cell)));
    if (firstThree[0] !== "team" || (firstThree[1] !== "s/n" && firstThree[1] !== "sn") || firstThree[2] !== "name") continue;
    const nextRow = sheet.rows[row] ?? [];
    const sameCodes = labels.map((cell) => cellText(cell));
    const nextCodes = nextRow.map((cell) => cellText(cell));
    const sameCount = sameCodes.slice(3).filter((code) => code && IMPORTABLE_QUALIFICATION_CODES.has(code)).length;
    const nextCount = nextCodes.slice(3).filter((code) => code && IMPORTABLE_QUALIFICATION_CODES.has(code)).length;
    const codeRow = nextCount > sameCount ? row + 1 : row;
    const codeValues = codeRow === row ? sameCodes : nextCodes;
    const labelValues = codeRow === row ? nextCodes : sameCodes;
    const columns: QualificationColumn[] = [];
    const unsupportedColumns: { column: number; value: string }[] = [];
    for (let column = 4; column <= Math.max(codeValues.length, labelValues.length); column += 1) {
      const code = (codeValues[column - 1] ?? "").replace(/\u00a0/g, " ").trim();
      const label = labelValues[column - 1]?.trim();
      if (!code) continue;
      const known = QUALIFICATION_CATALOG[code];
      if (!known && /^[A-Z][A-Z0-9]{3,}$/i.test(code)) {
        unsupportedColumns.push({ column, value: code });
        continue;
      }
      if (!known) continue;
      columns.push({ column, code, label, ...known });
    }
    if (columns.length === 0) return undefined;
    return { headerRow: row, codeRow, columns, unsupportedColumns };
  }
  return undefined;
}

function analyzeWorksheet(sheet: ExcelWorksheetSnapshot, kind: ExcelImportKind): WorksheetAnalysis {
  if (kind === "formation") return { formationHeaderRow: findFormationHeader(sheet) };
  const update = findUpdateOn(sheet);
  return { qualificationHeader: findQualificationHeader(sheet), updateOn: update.value };
}

function descriptor(sheet: ExcelWorksheetSnapshot, analysis: WorksheetAnalysis): WorksheetDescriptor {
  return {
    index: sheet.index,
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    updateOn: analysis.updateOn,
    hasFormationHeader: Boolean(analysis.formationHeaderRow),
    hasQualificationHeader: Boolean(analysis.qualificationHeader),
  };
}

function selectWorksheet(
  snapshot: ExcelWorkbookSnapshot,
  kind: ExcelImportKind,
  options: ImportPreviewOptions,
): { selected?: ExcelWorksheetSnapshot; selectedAnalysis?: WorksheetAnalysis; descriptors: readonly WorksheetDescriptor[]; issues: ImportIssue[] } {
  const analyzed = snapshot.worksheets.map((sheet) => ({ sheet, analysis: analyzeWorksheet(sheet, kind) }));
  const descriptors = analyzed.map(({ sheet, analysis }) => descriptor(sheet, analysis));
  const issues: ImportIssue[] = [];
  if (options.worksheetName) {
    const matches = analyzed.filter(({ sheet }) => sheet.name === options.worksheetName);
    if (matches.length !== 1) {
      const fallback = snapshot.worksheets[0];
      issues.push(issue("WORKSHEET_NOT_FOUND", `找不到 worksheet「${options.worksheetName}」。`, fallback, 1, 1));
      return { descriptors, issues };
    }
    const selected = matches[0];
    if (kind === "formation" && !selected.analysis.formationHeaderRow) {
      issues.push(issue("HEADER_MISSING", "指定 worksheet 缺少 Formation header。", selected.sheet, 1, 1));
    }
    if (kind === "qualification" && !selected.analysis.qualificationHeader) {
      issues.push(issue("HEADER_MISSING", "指定 worksheet 缺少 Qualification header。", selected.sheet, 1, 1));
    }
    return { selected: selected.sheet, selectedAnalysis: selected.analysis, descriptors, issues };
  }

  const candidates = analyzed.filter(({ analysis }) => kind === "formation" ? Boolean(analysis.formationHeaderRow) : Boolean(analysis.qualificationHeader));
  if (candidates.length === 0) {
    const fallback = snapshot.worksheets[0];
    issues.push(issue("NO_SUPPORTED_WORKSHEET", `找不到支援的 ${kind} worksheet。`, fallback, 1, 1));
    return { descriptors, issues };
  }
  if (kind === "formation") {
    if (candidates.length > 1) {
      issues.push(issue("WORKSHEET_AMBIGUOUS", "找到多個 Formation worksheet，請明確選擇。", candidates[0].sheet, 1, 1));
      return { descriptors, issues };
    }
    return { selected: candidates[0].sheet, selectedAnalysis: candidates[0].analysis, descriptors, issues };
  }
  const withDates = candidates.filter(({ analysis }) => analysis.updateOn);
  if (withDates.length === 0) {
    issues.push(issue("QUALIFICATION_UPDATE_MISSING", "Qualification worksheet 沒有有效 Update on 日期。", candidates[0].sheet, 1, 1));
    return { selected: candidates[0].sheet, selectedAnalysis: candidates[0].analysis, descriptors, issues };
  }
  const latestDate = withDates.reduce((latest, current) => (current.analysis.updateOn! > latest ? current.analysis.updateOn! : latest), "");
  const latest = withDates.filter(({ analysis }) => analysis.updateOn === latestDate);
  if (latest.length > 1) {
    issues.push(issue("QUALIFICATION_UPDATE_TIE", `多個 Qualification worksheet 同樣是最新日期 ${latestDate}。`, latest[0].sheet, 1, 1));
    return { selected: latest[0].sheet, selectedAnalysis: latest[0].analysis, descriptors, issues };
  }
  return { selected: latest[0].sheet, selectedAnalysis: latest[0].analysis, descriptors, issues };
}

function normalizeStaffNumber(cell: ExcelCell | undefined): { value?: string; issue?: string } {
  if (!cell || cell.kind === "blank") return { issue: "Staff number 不可留空。" };
  if (isFormulaOrUnsupported(cell)) return { issue: "Staff number 不可使用公式或錯誤值。" };
  const value = cellText(cell)?.trim() ?? "";
  if (!/^\d+$/.test(value)) return { issue: "Staff number 必須是數字識別碼。" };
  return { value };
}

function normalizeFlag(cell: ExcelCell | undefined, label: string): { value?: boolean; issue?: string } {
  if (!cell || cell.kind === "blank") return { value: false };
  if (isFormulaOrUnsupported(cell)) return { issue: `${label} 不可使用公式或錯誤值。` };
  const value = cellText(cell)?.toUpperCase();
  if (value === "Y") return { value: true };
  if (value === "N") return { value: false };
  return { issue: `${label} 只接受 Y、N 或空白。` };
}

function rowIssues<T extends FormationStagedRow | QualificationStagedRow>(row: ImportStagingRow<T>, allRows: readonly ImportStagingRow<T>[]): ImportStagingRow<T> {
  const duplicate = row.normalized && "staffNumber" in row.normalized
    ? allRows.filter((candidate) => candidate.normalized && "staffNumber" in candidate.normalized && candidate.normalized.staffNumber === row.normalized!.staffNumber).length > 1
    : false;
  if (!duplicate) return row;
  return {
    ...row,
    status: "invalid",
    disposition: "requires_action",
    issues: [...row.issues, {
      code: "DUPLICATE_STAFF_NUMBER",
      severity: "error",
      message: `Staff number ${row.normalized!.staffNumber} 在匯入批次中重複。`,
      source: row.source,
    }],
  };
}

function finalizeRows<T extends FormationStagedRow | QualificationStagedRow>(rows: readonly ImportStagingRow<T>[]): readonly ImportStagingRow<T>[] {
  const withDuplicates = rows.map((row) => rowIssues(row, rows));
  return withDuplicates.map((row) => {
    const hasError = row.issues.some((item) => item.severity === "error");
    const hasWarning = row.issues.some((item) => item.severity === "warning");
    if (row.disposition === "exclude") return { ...row, status: "ignored" };
    return {
      ...row,
      status: hasError ? "invalid" : hasWarning ? "warning" : "valid",
      disposition: hasError ? "requires_action" : row.disposition,
    };
  });
}

function parseFormationRows(sheet: ExcelWorksheetSnapshot, headerRow: number, options: ImportPreviewOptions): readonly ImportStagingRow<FormationStagedRow>[] {
  const result: ImportStagingRow<FormationStagedRow>[] = [];
  let currentTeam: Team | undefined;
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (rowIsCompletelyBlank(sheet, rowNumber)) break;
    if (!rowHasValues(sheet, rowNumber, 3)) continue;
    const values = sheet.rows[rowNumber - 1] ?? [];
    const issues: ImportIssue[] = [];
    const teamText = cellText(values[0]);
    if (teamText) {
      if (!TEAMS.has(teamText as Team)) issues.push(issue("INVALID_TEAM", `未知 Team「${teamText}」。`, sheet, rowNumber, 1, "error", "team"));
      else currentTeam = teamText as Team;
    } else if (!currentTeam) {
      issues.push(issue("TEAM_CONTEXT_MISSING", "Team 欄空白且沒有可沿用的上一個 Team。", sheet, rowNumber, 1, "error", "team"));
    }
    const staff = normalizeStaffNumber(values[1]);
    if (staff.issue) issues.push(issue("INVALID_STAFF_NUMBER", staff.issue, sheet, rowNumber, 2, "error", "staffNumber"));
    const name = cellText(values[2]);
    if (!name) issues.push(issue("MISSING_REQUIRED_FIELD", "Name 不可留空。", sheet, rowNumber, 3, "error", "displayName"));
    const ap = normalizeFlag(values[3], "AP");
    if (ap.issue) issues.push(issue("INVALID_FLAG", ap.issue, sheet, rowNumber, 4, "error", "ap"));
    const cp = normalizeFlag(values[4], "CP");
    if (cp.issue) issues.push(issue("INVALID_FLAG", cp.issue, sheet, rowNumber, 5, "error", "cp"));
    const normalized = staff.value && name && currentTeam && !issues.some((item) => item.severity === "error")
      ? { staffNumber: staff.value, displayName: name, team: currentTeam, declaredAp: ap.value ?? false, declaredCp: cp.value ?? false }
      : undefined;
    result.push({
      id: `formation:${sheet.index}:${rowNumber}`,
      rowNumber,
      source: sourceRef(sheet, rowNumber),
      normalized,
      status: issues.length ? "invalid" : "valid",
      disposition: issues.length ? "requires_action" : "include",
      issues,
    });
  }
  const finalized = finalizeRows(result);
  if (options.knownStaff) {
    return finalized.map((row) => {
      if (!row.normalized) return row;
      const known = options.knownStaff!.get(row.normalized.staffNumber);
      if (!known) return row;
      const extra: ImportIssue[] = [];
      if (known.displayName.trim() !== row.normalized.displayName.trim()) extra.push({ code: "STAFF_NAME_MISMATCH", severity: "warning", message: `Staff name 與既有資料不一致。`, source: row.source, field: "displayName" });
      if (known.team && known.team !== row.normalized.team) extra.push({ code: "TEAM_MISMATCH", severity: "warning", message: `Team 與既有資料不一致。`, source: row.source, field: "team" });
      return extra.length ? { ...row, status: "warning", issues: [...row.issues, ...extra] } : row;
    });
  }
  return finalized;
}

function parseQualificationDate(
  cell: ExcelCell | undefined,
  sheet: ExcelWorksheetSnapshot,
  rowNumber: number,
  column: number,
  code: string,
): { value?: string; issue?: ImportIssue } {
  if (!cell || cell.kind === "blank") return {};
  if (cell.kind === "string" && cell.value.trim() === "--") return {};
  if (cell.kind === "date") return { value: formatDate(cell.value) };
  if (cell.kind === "formula" || cell.kind === "error" || cell.kind === "unsupported") {
    return { issue: issue("INVALID_DATE", `${code} 日期不可使用公式、錯誤或不支援的值。`, sheet, rowNumber, column) };
  }
  const text = cellText(cell) ?? "";
  if (/\([^)]*\)/.test(text)) {
    return { issue: issue("ANNOTATED_DATE_BLOCKED", `${code} 含有註記日期「${text}」，必須先在來源修正。`, sheet, rowNumber, column) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && formatDate(date) === text) return { value: text };
  }
  return { issue: issue("INVALID_DATE", `${code} 必須是 Excel 日期或 YYYY-MM-DD。`, sheet, rowNumber, column) };
}

function parseQualificationRows(sheet: ExcelWorksheetSnapshot, header: QualificationHeader, options: ImportPreviewOptions): readonly ImportStagingRow<QualificationStagedRow>[] {
  const result: ImportStagingRow<QualificationStagedRow>[] = [];
  let currentGroup = "";
  const startRow = Math.max(header.headerRow, header.codeRow);
  for (let rowNumber = startRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (!rowHasValues(sheet, rowNumber, 3)) break;
    const values = sheet.rows[rowNumber - 1] ?? [];
    const issues: ImportIssue[] = [];
    const groupText = cellText(values[0]);
    if (groupText) currentGroup = groupText;
    const staff = normalizeStaffNumber(values[1]);
    if (staff.issue) issues.push(issue("INVALID_STAFF_NUMBER", staff.issue, sheet, rowNumber, 2, "error", "staffNumber"));
    const name = cellText(values[2]);
    if (!name) issues.push(issue("MISSING_REQUIRED_FIELD", "Name 不可留空。", sheet, rowNumber, 3, "error", "displayName"));
    if (!currentGroup) issues.push(issue("TEAM_CONTEXT_MISSING", "Team/Sup. 欄空白且沒有可沿用的上一個群組。", sheet, rowNumber, 1));
    const observations: QualificationObservation[] = [];
    for (const column of header.columns) {
      const cell = values[column.column - 1];
      if (cell?.kind === "blank" || (cell?.kind === "string" && cell.value.trim() === "--")) {
        observations.push({ qualificationCode: column.code, qualificationKind: column.kind, domain: column.domain, state: "none", emptyMarker: cell?.kind === "blank" ? "blank" : "double-dash", source: sourceRef(sheet, rowNumber, column.column) });
        continue;
      }
      const parsed = parseQualificationDate(cell, sheet, rowNumber, column.column, column.code);
      if (parsed.issue) issues.push(parsed.issue);
      observations.push({ qualificationCode: column.code, qualificationKind: column.kind, domain: column.domain, state: parsed.value ? "qualified" : "none", expiryDate: parsed.value, source: sourceRef(sheet, rowNumber, column.column) });
      if (parsed.value && options.planningDate && parsed.value < options.planningDate) {
        issues.push(issue("QUALIFICATION_EXPIRED", `${column.code} 已於 ${parsed.value} 過期。`, sheet, rowNumber, column.column, "warning", column.code));
      }
    }
    const supervisor = currentGroup === "Sup." || /^sup\.?$/i.test(currentGroup);
    if (supervisor && !options.includeSupervisors) {
      issues.push(issue("SUPERVISOR_EXCLUDED", "Sup. 人員預設排除，需透過明確流程另行納入。", sheet, rowNumber, 1, "warning", "team"));
    } else if (supervisor && !options.supervisorRemark?.trim()) {
      issues.push(issue("SUPERVISOR_REMARK_REQUIRED", "納入 Sup. 人員必須提供 remark。", sheet, rowNumber, 1, "error", "remark"));
    }
    if (options.knownStaffNumbers && staff.value && (!supervisor || options.includeSupervisors) && !options.knownStaffNumbers.has(staff.value)) {
      issues.push(issue("UNKNOWN_STAFF_NUMBER", `Staff number ${staff.value} 不在既有 Formation。`, sheet, rowNumber, 2, "error", "staffNumber"));
    }
    if (options.knownStaff && staff.value) {
      const known = options.knownStaff.get(staff.value);
      if (known) {
        if (known.displayName.trim() !== name?.trim()) issues.push(issue("STAFF_NAME_MISMATCH", "Name 與 Formation 不一致。", sheet, rowNumber, 3, "warning", "displayName"));
        if (known.team && known.team !== currentGroup && !supervisor) issues.push(issue("TEAM_MISMATCH", "Team 與 Formation 不一致。", sheet, rowNumber, 1, "warning", "team"));
      }
    }
    const normalized = staff.value && name && currentGroup && !issues.some((item) => item.severity === "error") && !(supervisor && !options.includeSupervisors)
      ? { staffNumber: staff.value, displayName: name, sourceTeam: currentGroup, supervisor, observations }
      : supervisor && !options.includeSupervisors && staff.value && name && currentGroup
        ? { staffNumber: staff.value, displayName: name, sourceTeam: currentGroup, supervisor, observations }
        : undefined;
    const excluded = supervisor && !options.includeSupervisors;
    result.push({ id: `qualification:${sheet.index}:${rowNumber}`, rowNumber, source: sourceRef(sheet, rowNumber), normalized, status: excluded ? "ignored" : issues.length ? "invalid" : "valid", disposition: excluded ? "exclude" : issues.length ? "requires_action" : "include", issues });
  }
  return finalizeRows(result);
}

function makeSource(snapshot: ExcelWorkbookSnapshot): ImportSource {
  return { ...snapshot.source };
}

function previewStatus<T extends FormationStagedRow | QualificationStagedRow>(rows: readonly ImportStagingRow<T>[], globalIssues: readonly ImportIssue[]): ImportPreview<T>["status"] {
  const all = [...globalIssues, ...rows.flatMap((row) => row.issues)];
  if (all.some((item) => item.severity === "error")) return "has-errors";
  if (all.some((item) => item.severity === "warning")) return "has-warnings";
  return "valid";
}

export function inspectImportWorkbook(snapshot: ExcelWorkbookSnapshot, kind: ExcelImportKind): readonly WorksheetDescriptor[] {
  return snapshot.worksheets.map((sheet) => descriptor(sheet, analyzeWorksheet(sheet, kind)));
}

export function previewImportFromSnapshot<T extends FormationStagedRow | QualificationStagedRow>(
  snapshot: ExcelWorkbookSnapshot,
  kind: ExcelImportKind,
  options: ImportPreviewOptions = {},
): ImportPreview<T> {
  const selectedResult = selectWorksheet(snapshot, kind, options);
  const selected = selectedResult.selected;
  const selectedAnalysis = selectedResult.selectedAnalysis;
  const fallback = selected ?? snapshot.worksheets[0];
  const globalIssues = [...selectedResult.issues];
  let rows: readonly ImportStagingRow<T>[] = [];
  if (selected && selectedAnalysis) {
    if (kind === "formation" && selectedAnalysis.formationHeaderRow) {
      rows = parseFormationRows(selected, selectedAnalysis.formationHeaderRow, options) as readonly ImportStagingRow<T>[];
    } else if (kind === "qualification" && selectedAnalysis.qualificationHeader) {
      for (const unsupported of selectedAnalysis.qualificationHeader.unsupportedColumns) {
        globalIssues.push(issue("UNSUPPORTED_QUALIFICATION_COLUMN", `不支援的 qualification code「${unsupported.value}」。`, selected, selectedAnalysis.qualificationHeader.codeRow, unsupported.column, "error", unsupported.value));
      }
      rows = parseQualificationRows(selected, selectedAnalysis.qualificationHeader, options) as readonly ImportStagingRow<T>[];
    }
  }
  const selectedDescriptor = descriptor(fallback, selectedAnalysis ?? analyzeWorksheet(fallback, kind));
  const selectedUpdateOn = selectedAnalysis?.updateOn;
  const fingerprintValue = {
    kind,
    sourceHash: snapshot.source.sourceHash,
    worksheet: selectedDescriptor.name,
    updateOn: selectedUpdateOn,
    rows: rows.map((row) => ({ id: row.id, rowNumber: row.rowNumber, normalized: row.normalized, status: row.status, disposition: row.disposition, issues: row.issues.map(({ source: _source, ...rest }) => rest) })),
    globalIssues: globalIssues.map(({ source: _source, ...rest }) => rest),
  };
  const allIssues = [...globalIssues, ...rows.flatMap((row) => row.issues)];
  return {
    importId: `${kind}:${snapshot.source.sourceHash.slice(0, 16)}:${selectedDescriptor.name}`,
    kind,
    source: makeSource(snapshot),
    selectedWorksheet: selectedDescriptor,
    selectedUpdateOn,
    fingerprint: fingerprint(fingerprintValue),
    status: previewStatus(rows, globalIssues),
    rows,
    issues: allIssues,
    rowCount: rows.length,
    validRowCount: rows.filter((row) => row.status === "valid" || row.status === "warning").length,
    warningCount: allIssues.filter((item) => item.severity === "warning").length,
    errorCount: allIssues.filter((item) => item.severity === "error").length,
  };
}

export class ImportPipelineError extends Error {
  constructor(public readonly code: ImportIssueCode, message: string, public readonly issues: readonly ImportIssue[] = []) {
    super(message);
    this.name = "ImportPipelineError";
  }
}

export interface ImportCommitPorts {
  formation: FormationCommitPort;
  qualification: QualificationCommitPort;
}

export class ExcelImportStagingService {
  constructor(private readonly reader: ExcelWorkbookReader, private readonly ports: ImportCommitPorts) {}

  async inspect(filePath: string, kind: ExcelImportKind): Promise<{ source: ImportSource; worksheets: readonly WorksheetDescriptor[] }> {
    const snapshot = await this.reader.read(filePath);
    return { source: snapshot.source, worksheets: inspectImportWorkbook(snapshot, kind) };
  }

  async preview(filePath: string, kind: ExcelImportKind, options: ImportPreviewOptions = {}): Promise<ImportPreview<FormationStagedRow | QualificationStagedRow>> {
    const snapshot = await this.reader.read(filePath);
    return previewImportFromSnapshot(snapshot, kind, options);
  }

  async commit(
    preview: ImportPreview<FormationStagedRow | QualificationStagedRow>,
    context: ImportCommitContext = {},
  ): Promise<ImportBatchReceipt> {
    if (preview.status === "has-errors") throw new ImportPipelineError("PREVIEW_NOT_COMMITTABLE", "Import preview 含有 blocking errors，不能 commit。", preview.issues);
    if (context.expectedSourceHash && context.expectedSourceHash !== preview.source.sourceHash) throw new ImportPipelineError("SOURCE_READ_FAILED", "Import source hash 與 preview 不一致。", []);
    if (context.expectedFingerprint && context.expectedFingerprint !== preview.fingerprint) throw new ImportPipelineError("SOURCE_READ_FAILED", "Import preview fingerprint 與預期不一致。", []);
    if (preview.source.filePath) {
      let current: ExcelWorkbookSnapshot;
      try {
        current = await this.reader.read(preview.source.filePath);
      } catch (error) {
        throw new ImportPipelineError("SOURCE_READ_FAILED", `無法重新讀取 Import source：${error instanceof Error ? error.message : String(error)}`, []);
      }
      if (current.source.sourceHash !== preview.source.sourceHash) throw new ImportPipelineError("SOURCE_READ_FAILED", "來源 Excel 在 preview 後已變更，請重新 preview。", []);
    }
    const acceptedIds = context.acceptedRowIds ? new Set(context.acceptedRowIds) : undefined;
    const eligible = preview.rows.filter((row) => row.normalized && row.disposition === "include" && (!acceptedIds || acceptedIds.has(row.id))).map((row) => row.normalized!);
    if (preview.kind === "formation") return this.ports.formation.commitFormation(eligible as readonly FormationStagedRow[], preview as ImportPreview<FormationStagedRow>, { ...context, expectedSourceHash: preview.source.sourceHash, expectedFingerprint: preview.fingerprint });
    return this.ports.qualification.commitQualification(eligible as readonly QualificationStagedRow[], preview as ImportPreview<QualificationStagedRow>, { ...context, expectedSourceHash: preview.source.sourceHash, expectedFingerprint: preview.fingerprint });
  }
}
