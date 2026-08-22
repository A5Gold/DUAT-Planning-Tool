import {
  createImportException,
  type AliasCandidate,
  type AliasDecision,
  type ImportException,
  type SourceLocation,
} from "../../domain/import/contracts";

export interface StaffIdentityRecord {
  staffNumber: string;
  displayName: string;
}

export interface IdentityObservation {
  rawName: string;
  staffNumber?: string;
  source: SourceLocation;
}

export interface ReconciliationResult {
  candidates: readonly AliasCandidate[];
  exceptions: readonly ImportException[];
  resolved: ReadonlyMap<string, string>;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function aliasId(source: SourceLocation): string {
  return `${source.artifactId}:${source.sheetIndex}:${source.row}:${source.column ?? 0}`;
}

export function reconcileStaffIdentities(
  observations: readonly IdentityObservation[],
  staff: readonly StaffIdentityRecord[],
  decisions: readonly AliasDecision[] = [],
  now = new Date().toISOString(),
): ReconciliationResult {
  const byNumber = new Map(staff.map((item) => [item.staffNumber, item]));
  const byName = new Map<string, string[]>();
  for (const item of staff) {
    const key = normalizeName(item.displayName);
    byName.set(key, [...(byName.get(key) ?? []), item.staffNumber]);
  }
  const candidates: AliasCandidate[] = [];
  const exceptions: ImportException[] = [];
  const resolved = new Map<string, string>();
  const decisionByAlias = new Map(decisions.map((item) => [item.aliasId, item]));

  for (const observation of observations) {
    const id = aliasId(observation.source);
    if (observation.staffNumber && byNumber.has(observation.staffNumber)) {
      resolved.set(id, observation.staffNumber);
      continue;
    }
    const candidatesForName = byName.get(normalizeName(observation.rawName)) ?? [];
    const candidate: AliasCandidate = {
      aliasId: id,
      source: observation.source,
      rawName: observation.rawName,
      normalizedName: normalizeName(observation.rawName),
      candidateStaffNumbers: candidatesForName,
      confidence: candidatesForName.length === 1 ? 0.95 : 0.5,
      matchMethod: candidatesForName.length === 1 ? "exact-name" : "normalized-name",
    };
    candidates.push(candidate);
    const decision = decisionByAlias.get(id);
    if (decision?.status === "accepted" && decision.staffNumber && candidatesForName.includes(decision.staffNumber)) {
      resolved.set(id, decision.staffNumber);
      continue;
    }
    exceptions.push(createImportException({
      issueId: id,
      code: observation.staffNumber ? "UNKNOWN_STAFF_NUMBER" : "UNRESOLVED_STAFF_ALIAS",
      severity: "blocking",
      message: observation.staffNumber
        ? `Staff No. ${observation.staffNumber} is not present in the identity registry.`
        : `Name ${observation.rawName} requires an explicit alias decision.`,
      source: observation.source,
      rawValue: observation.staffNumber ?? observation.rawName,
      createdAt: now,
    }));
  }
  return { candidates, exceptions, resolved };
}

export function formalStaffNumber(result: ReconciliationResult, aliasIdValue: string): string | undefined {
  return result.resolved.get(aliasIdValue);
}
