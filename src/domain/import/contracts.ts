/**
 * Import domain contracts.
 *
 * These types deliberately describe source evidence and decisions separately
 * from the normalized projections. Import adapters may add facts, but they
 * must not discard the raw value or its worksheet/cell provenance.
 */

export type ImportKind = "formation" | "qualification" | "roster" | "job-role-record";

export type RawCellKind =
  | "blank"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "formula"
  | "error"
  | "unsupported";

export interface SourceLocation {
  artifactId: string;
  sheetIndex: number;
  sheetName: string;
  row: number;
  column?: number;
  address?: string;
}

export interface WorksheetMetadata {
  sheetIndex: number;
  name: string;
  rowCount: number;
  columnCount: number;
  usedRange?: string;
  mergedRanges: readonly string[];
  updateOn?: string;
}

export interface SourceArtifact {
  artifactId: string;
  path: string;
  filename: string;
  sha256: string;
  fileSize: number;
  importedAt: string;
  readerVersion: string;
  worksheets: readonly WorksheetMetadata[];
  rawStorageRef?: string;
}

export type RawCellValue = string | number | boolean | null;

export interface RawCell {
  source: SourceLocation;
  kind: RawCellKind;
  rawValue: RawCellValue;
  displayValue?: string;
  formula?: string;
  errorCode?: string;
}

export interface RawRow {
  source: SourceLocation;
  rowNumber: number;
  cells: readonly RawCell[];
}

export type AliasMatchMethod =
  | "staff-number"
  | "exact-name"
  | "normalized-name"
  | "manual";

export interface AliasCandidate {
  aliasId: string;
  source: SourceLocation;
  rawName: string;
  normalizedName: string;
  candidateStaffNumbers: readonly string[];
  confidence: number;
  matchMethod: AliasMatchMethod;
}

export type AliasDecisionStatus = "accepted" | "rejected" | "unresolved";

export interface AliasDecision {
  aliasId: string;
  status: AliasDecisionStatus;
  staffNumber?: string;
  actorId?: string;
  decidedAt?: string;
  reason?: string;
}

export interface AliasDecisionInput {
  status: AliasDecisionStatus;
  staffNumber?: string;
  actorId?: string;
  decidedAt?: string;
  reason?: string;
}

export type ImportExceptionSeverity = "info" | "warning" | "error" | "blocking";
export type ImportExceptionStatus = "unresolved" | "resolved" | "ignored";

export type ImportExceptionCode =
  | "UNRESOLVED_STAFF_ALIAS"
  | "UNKNOWN_STAFF_NUMBER"
  | "STAFF_NAME_MISMATCH"
  | "DUPLICATE_STAFF_NUMBER"
  | "UNKNOWN_ROSTER_CODE"
  | "ROSTER_FORMULA_ERROR"
  | "ROSTER_DATE_1900"
  | "ROSTER_MONTH_RANGE_DRIFT"
  | "QUALIFICATION_UNKNOWN_CODE"
  | "QUALIFICATION_NON_STANDARD_EXPIRY"
  | "QUALIFICATION_SCOPE_AMBIGUOUS"
  | "QUALIFICATION_INVALID_DATE"
  | "QUALIFICATION_NO_GRANT"
  | "UNKNOWN_LINE"
  | "MIXED_TN"
  | "INVALID_MULTI_ROLE"
  | "LEGACY_PLANNED_CANDIDATE"
  | "WORKSHEET_AMBIGUOUS"
  | "SOURCE_CHANGED";

export interface ImportExceptionResolution {
  actorId: string;
  resolvedAt: string;
  decision: "accept" | "reject" | "map" | "mark-legacy";
  note?: string;
}

export interface ImportException {
  issueId: string;
  code: ImportExceptionCode;
  severity: ImportExceptionSeverity;
  status: ImportExceptionStatus;
  message: string;
  source?: SourceLocation;
  artifactId?: string;
  field?: string;
  rawValue?: RawCellValue;
  createdAt: string;
  resolution?: ImportExceptionResolution;
}

export interface CreateImportExceptionInput {
  issueId?: string;
  code: ImportExceptionCode;
  severity: ImportExceptionSeverity;
  message: string;
  source?: SourceLocation;
  artifactId?: string;
  field?: string;
  rawValue?: RawCellValue;
  createdAt: string;
}

export type CredentialRole = "AP" | "CP" | "NP" | "HSM" | "LOM";
export type CredentialVariant = "CP(P)" | "CP(T)";

export interface CredentialGrant {
  credentialId: string;
  staffNumber: string;
  role: CredentialRole;
  variant?: CredentialVariant;
  scope?: string;
  validFrom?: string;
  validTo?: string;
  suspended?: boolean;
  revoked?: boolean;
  source: SourceLocation;
}

export type RosterFacet =
  | "day"
  | "night"
  | "am"
  | "pm"
  | "leave"
  | "sick"
  | "training"
  | "allowance"
  | "rest"
  | "holiday";

export type RosterAvailability = "confirmed-available" | "unavailable" | "unknown";
export type RosterSourceLayer = "grade-default" | "team-baseline" | "staff-override";

export interface RosterLayerValue {
  rawCode: string;
  facets: readonly RosterFacet[];
  availability: RosterAvailability;
  mappingId?: string;
  source?: SourceLocation;
}

export interface EffectiveRoster {
  staffNumber: string;
  date: string;
  rawCode: string;
  facets: readonly RosterFacet[];
  availability: RosterAvailability;
  sourceLayer: RosterSourceLayer;
  mappingId?: string;
  parserVersion: string;
  source?: SourceLocation;
}

export interface EffectiveRosterInput {
  staffNumber: string;
  date: string;
  parserVersion: string;
  gradeDefault?: RosterLayerValue;
  teamBaseline?: RosterLayerValue;
  staffOverride?: RosterLayerValue;
}

function hasRosterCode(value: RosterLayerValue | undefined): value is RosterLayerValue {
  return Boolean(value?.rawCode.trim());
}

/** Resolve grade default -> team baseline -> non-blank staff override. */
export function resolveEffectiveRoster(input: EffectiveRosterInput): EffectiveRoster {
  const selected: [RosterSourceLayer, RosterLayerValue] = hasRosterCode(input.staffOverride)
    ? ["staff-override", input.staffOverride]
    : hasRosterCode(input.teamBaseline)
      ? ["team-baseline", input.teamBaseline]
      : input.gradeDefault
        ? ["grade-default", input.gradeDefault]
        : ["grade-default", { rawCode: "", facets: [], availability: "unknown" }];

  const [sourceLayer, value] = selected;
  return {
    staffNumber: input.staffNumber,
    date: input.date,
    rawCode: value.rawCode,
    facets: [...value.facets],
    availability: value.availability,
    sourceLayer,
    mappingId: value.mappingId,
    parserVersion: input.parserVersion,
    source: value.source,
  };
}

/**
 * Create an explicit alias decision. Accepted decisions must name exactly one
 * candidate; unresolved/rejected decisions cannot accidentally create identity.
 */
export function createAliasDecision(candidate: AliasCandidate, input: AliasDecisionInput): AliasDecision {
  if (input.status === "accepted") {
    if (!input.staffNumber || !candidate.candidateStaffNumbers.includes(input.staffNumber)) {
      throw new Error("Accepted alias decisions require one candidate Staff No.");
    }
  }
  if (input.status !== "accepted" && input.staffNumber !== undefined) {
    throw new Error("Only accepted alias decisions may contain a Staff No.");
  }
  return {
    aliasId: candidate.aliasId,
    status: input.status,
    staffNumber: input.staffNumber,
    actorId: input.actorId,
    decidedAt: input.decidedAt,
    reason: input.reason,
  };
}

export function isAliasResolved(decision: AliasDecision): decision is AliasDecision & { status: "accepted"; staffNumber: string } {
  return decision.status === "accepted" && Boolean(decision.staffNumber);
}

function defaultIssueId(input: CreateImportExceptionInput): string {
  const source = input.source?.address ?? `${input.source?.sheetIndex ?? "-"}:${input.source?.row ?? "-"}`;
  return `${input.artifactId ?? input.source?.artifactId ?? "import"}:${source}:${input.code}`;
}

export function createImportException(input: CreateImportExceptionInput): ImportException {
  return {
    issueId: input.issueId ?? defaultIssueId(input),
    code: input.code,
    severity: input.severity,
    status: "unresolved",
    message: input.message,
    source: input.source,
    artifactId: input.artifactId ?? input.source?.artifactId,
    field: input.field,
    rawValue: input.rawValue,
    createdAt: input.createdAt,
  };
}

