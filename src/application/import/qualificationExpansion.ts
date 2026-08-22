/**
 * Pure expansion of qualification columns into auditable grant facts.
 *
 * Excel stores a merged expiry once, in the merge anchor.  This module keeps
 * that raw cell provenance while materialising a grant for every CP(P)/CP(T)
 * column covered by the merge.  It deliberately does not guess ambiguous
 * dates; callers can route blocking issues to the import exception queue.
 */

export type QualificationRawValue = string | Date | number | null | undefined;

export interface QualificationCellProvenance {
  sheetIndex?: number;
  sheetName?: string;
  row: number;
  column: number;
  address?: string;
}

export interface QualificationColumnObservation {
  /** Canonical name, e.g. CP(P) or CP(T). */
  qualification?: string;
  /** Compatibility aliases used by staging/header adapters. */
  qualificationKind?: string;
  kind?: string;
  qualificationCode?: string;
  rawValue?: QualificationRawValue;
  value?: QualificationRawValue;
  source?: QualificationCellProvenance;
  row?: number;
  column?: number;
  address?: string;
  mergeRange?: string;
  mergeAnchor?: string;
}

export type QualificationGrantState = "qualified" | "none";

export interface QualificationGrantProvenance extends QualificationCellProvenance {
  mergeRange?: string;
  mergeAnchor?: string;
}

export interface QualificationGrant {
  qualification: string;
  qualificationCode?: string;
  state: QualificationGrantState;
  expiryDate?: string;
  emptyMarker?: "blank" | "double-dash";
  source: QualificationGrantProvenance;
  /** Alias retained for consumers that call the source object provenance. */
  provenance: QualificationGrantProvenance;
}

export type QualificationExpansionIssueCode =
  | "ANNOTATED_DATE_BLOCKED"
  | "NON_STANDARD_EXPIRY"
  | "MERGED_VALUE_CONFLICT"
  | "INVALID_COLUMN_OBSERVATION";

export interface QualificationExpansionIssue {
  code: QualificationExpansionIssueCode;
  message: string;
  severity: "error";
  blocking: true;
  qualification?: string;
  source?: QualificationGrantProvenance;
  mergeRange?: string;
}

export interface QualificationExpansionResult {
  grants: readonly QualificationGrant[];
  issues: readonly QualificationExpansionIssue[];
}

interface NormalizedObservation {
  qualification: string;
  qualificationCode?: string;
  rawValue: QualificationRawValue;
  source: QualificationGrantProvenance;
  mergeRange?: string;
  mergeAnchor?: string;
}

const CP_VARIANTS = new Set(["CP(P)", "CP(T)"]);

function qualificationOf(observation: QualificationColumnObservation): string | undefined {
  const value = observation.qualification ?? observation.qualificationKind ?? observation.kind;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function valueOf(observation: QualificationColumnObservation): QualificationRawValue {
  return observation.rawValue !== undefined ? observation.rawValue : observation.value;
}

function sourceOf(observation: QualificationColumnObservation): QualificationGrantProvenance | undefined {
  const source = observation.source;
  if (source && Number.isInteger(source.row) && Number.isInteger(source.column)) {
    return { ...source, mergeRange: observation.mergeRange, mergeAnchor: observation.mergeAnchor };
  }
  if (Number.isInteger(observation.row) && Number.isInteger(observation.column)) {
    return {
      row: observation.row as number,
      column: observation.column as number,
      ...(observation.address ? { address: observation.address } : {}),
      mergeRange: observation.mergeRange,
      mergeAnchor: observation.mergeAnchor,
    };
  }
  return undefined;
}

function normalizeObservation(observation: QualificationColumnObservation): NormalizedObservation | undefined {
  const qualification = qualificationOf(observation);
  const source = sourceOf(observation);
  if (!qualification || !source) return undefined;
  return {
    qualification,
    qualificationCode: observation.qualificationCode,
    rawValue: valueOf(observation),
    source,
    mergeRange: observation.mergeRange,
    mergeAnchor: observation.mergeAnchor,
  };
}

function isBlank(value: QualificationRawValue): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function isDoubleDash(value: QualificationRawValue): boolean {
  return typeof value === "string" && value.trim() === "--";
}

function isoDate(date: Date): string | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseExpiry(value: QualificationRawValue):
  | { state: "none"; emptyMarker: "blank" | "double-dash" }
  | { state: "qualified"; expiryDate: string }
  | { issueCode: "ANNOTATED_DATE_BLOCKED" | "NON_STANDARD_EXPIRY"; text: string } {
  if (isBlank(value)) return { state: "none", emptyMarker: "blank" };
  if (isDoubleDash(value)) return { state: "none", emptyMarker: "double-dash" };
  if (value instanceof Date) {
    const expiryDate = isoDate(value);
    return expiryDate ? { state: "qualified", expiryDate } : { issueCode: "NON_STANDARD_EXPIRY", text: String(value) };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/\([^)]*\)/.test(text)) return { issueCode: "ANNOTATED_DATE_BLOCKED", text };
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parsed = new Date(`${text}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) {
        return { state: "qualified", expiryDate: text };
      }
    }
    return { issueCode: "NON_STANDARD_EXPIRY", text };
  }
  return { issueCode: "NON_STANDARD_EXPIRY", text: String(value) };
}

function issueFor(
  code: "ANNOTATED_DATE_BLOCKED" | "NON_STANDARD_EXPIRY",
  observation: NormalizedObservation,
  text: string,
  mergeRange?: string,
): QualificationExpansionIssue {
  const label = observation.qualificationCode ?? observation.qualification;
  return {
    code,
    message: `${label} expiry「${text}」不是可安全使用的標準日期，必須先在來源修正。`,
    severity: "error",
    blocking: true,
    qualification: observation.qualification,
    source: observation.source,
    mergeRange,
  };
}

function conflictIssue(group: readonly NormalizedObservation[], mergeRange: string): QualificationExpansionIssue {
  const first = group[0];
  return {
    code: "MERGED_VALUE_CONFLICT",
    message: `合併範圍 ${mergeRange} 的 expiry 有多個不一致值，必須人工對帳。`,
    severity: "error",
    blocking: true,
    qualification: first?.qualification,
    source: first?.source,
    mergeRange,
  };
}

function columnNumber(value: string): number | undefined {
  const letters = value.match(/^[A-Za-z]+/u)?.[0].toUpperCase();
  if (!letters) return undefined;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function isAnchor(item: NormalizedObservation, anchor: string): boolean {
  if (item.source.address && item.source.address.toUpperCase() === anchor.toUpperCase()) return true;
  const match = anchor.match(/^[A-Za-z]+(\d+)$/u);
  const anchorColumn = columnNumber(anchor);
  return Boolean(
    match && anchorColumn !== undefined &&
    item.source.row === Number(match[1]) && item.source.column === anchorColumn,
  );
}

function makeGrant(observation: NormalizedObservation, parsed: ReturnType<typeof parseExpiry>): QualificationGrant {
  if ("issueCode" in parsed) {
    throw new Error("makeGrant cannot materialize a blocking expiry issue");
  }
  const source = {
    ...observation.source,
    mergeRange: observation.mergeRange,
    mergeAnchor: observation.mergeAnchor,
  };
  if (parsed.state === "none") {
    return {
      qualification: observation.qualification,
      qualificationCode: observation.qualificationCode,
      state: "none",
      emptyMarker: parsed.emptyMarker,
      source,
      provenance: source,
    };
  }
  return {
    qualification: observation.qualification,
    qualificationCode: observation.qualificationCode,
    state: "qualified",
    expiryDate: parsed.expiryDate,
    source,
    provenance: source,
  };
}

/**
 * Expand column observations. A merge group is expanded only when every
 * column is CP(P) or CP(T); other qualification columns retain their own
 * cell semantics. This prevents a merged visual label from granting an
 * unrelated qualification.
 */
export function expandQualificationColumns(
  observations: readonly QualificationColumnObservation[],
): QualificationExpansionResult {
  const normalized = observations.map(normalizeObservation);
  const grants: QualificationGrant[] = [];
  const issues: QualificationExpansionIssue[] = [];
  const invalidCount = normalized.filter((item) => !item).length;
  if (invalidCount > 0) {
    issues.push({
      code: "INVALID_COLUMN_OBSERVATION",
      message: "Qualification column 缺少 qualification 或 cell provenance。",
      severity: "error",
      blocking: true,
    });
  }

  const groups = new Map<string, NormalizedObservation[]>();
  for (const item of normalized) {
    if (!item) continue;
    const key = item.mergeRange ? `merge:${item.mergeRange}` : `cell:${item.source.row}:${item.source.column}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const mergeRange = group[0]?.mergeRange;
    const expandable = Boolean(mergeRange) && group.every((item) => CP_VARIANTS.has(item.qualification));
    if (!expandable || !mergeRange) {
      for (const item of group) {
        const parsed = parseExpiry(item.rawValue);
        if ("issueCode" in parsed) issues.push(issueFor(parsed.issueCode, item, parsed.text));
        else grants.push(makeGrant(item, parsed));
      }
      continue;
    }

    const nonEmpty = group.filter((item) => !isBlank(item.rawValue) && !isDoubleDash(item.rawValue));
    const distinctValues = new Set(nonEmpty.map((item) => `${typeof item.rawValue}:${String(item.rawValue)}`));
    if (distinctValues.size > 1) {
      issues.push(conflictIssue(group, mergeRange));
      continue;
    }
    const declaredAnchor = group.find((item) => item.mergeAnchor)?.mergeAnchor;
    const declaredAnchorMatch = declaredAnchor ? group.find((item) => isAnchor(item, declaredAnchor)) : undefined;
    const anchor = declaredAnchorMatch
      ?? group.find((item) => !isBlank(item.rawValue) || isDoubleDash(item.rawValue))
      ?? group.at(0);
    if (!anchor) {
      issues.push({
        code: "INVALID_COLUMN_OBSERVATION",
        severity: "error",
        message: "Qualification merged range does not contain an observation.",
        source: group[0]?.source,
        blocking: true,
      });
      continue;
    }
    const parsed = parseExpiry(anchor.rawValue);
    if ("issueCode" in parsed) {
      issues.push(issueFor(parsed.issueCode, anchor, parsed.text, mergeRange));
      continue;
    }
    for (const item of group) {
      const withAnchor = { ...item, rawValue: anchor.rawValue, mergeRange, mergeAnchor: anchor.source.address ?? anchor.mergeAnchor };
      grants.push(makeGrant(withAnchor, parsed));
    }
  }

  return { grants, issues };
}

/** Descriptive alias for callers working explicitly with merged cells. */
export const expandMergedQualificationColumns = expandQualificationColumns;
export const expandQualificationObservations = expandQualificationColumns;
