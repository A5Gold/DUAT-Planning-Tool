import {
  resolveEffectiveRoster,
  type EffectiveRoster,
  type EffectiveRosterInput,
  type ImportException,
  type RosterFacet,
  type RosterLayerValue,
  type SourceLocation,
} from "../../domain/import";

export interface RosterCodeMapping {
  rawCode: string;
  facets: readonly RosterFacet[];
  availability: RosterLayerValue["availability"];
  mappingId: string;
}

export interface RosterCodeResolution {
  value: RosterLayerValue;
  issue?: ImportException;
}

export interface EffectiveRosterRequest {
  staffNumber: string;
  date: string;
  grade?: string;
  teamBaseline?: string;
  staffOverride?: string;
  parserVersion: string;
  source?: SourceLocation;
}

const EXPLICIT_MAPPINGS: readonly RosterCodeMapping[] = [
  { rawCode: "D", facets: ["day"], availability: "confirmed-available", mappingId: "legend:D:v1" },
  { rawCode: "N", facets: ["night"], availability: "confirmed-available", mappingId: "legend:N:v1" },
  { rawCode: "N0", facets: ["night"], availability: "confirmed-available", mappingId: "legend:N0:v1" },
  { rawCode: "AL", facets: ["leave"], availability: "unavailable", mappingId: "legend:AL:v1" },
  { rawCode: "RD", facets: ["rest"], availability: "unavailable", mappingId: "legend:RD:v1" },
  { rawCode: "SH", facets: ["sick"], availability: "unavailable", mappingId: "legend:SH:v1" },
  { rawCode: "SL", facets: ["leave"], availability: "unavailable", mappingId: "legend:SL:v1" },
];

const mappingByCode = new Map(EXPLICIT_MAPPINGS.map((mapping) => [mapping.rawCode, mapping]));

function issueId(source: SourceLocation | undefined, rawCode: string): string {
  return `${source?.artifactId ?? "roster"}:${source?.address ?? `${source?.sheetIndex ?? "-"}:${source?.row ?? "-"}`}:ROSTER_UNKNOWN_CODE:${rawCode}`;
}

export function resolveRosterCode(rawCode: string | null | undefined, source?: SourceLocation): RosterCodeResolution {
  const normalized = rawCode?.trim() ?? "";
  const mapping = mappingByCode.get(normalized);
  if (mapping) {
    return {
      value: {
        rawCode: normalized,
        facets: mapping.facets,
        availability: mapping.availability,
        mappingId: mapping.mappingId,
        source,
      },
    };
  }

  return {
    value: { rawCode: normalized, facets: [], availability: "unknown", source },
    issue: {
      issueId: issueId(source, normalized),
      code: "UNKNOWN_ROSTER_CODE",
      severity: "blocking",
      status: "unresolved",
      message: `Roster code「${normalized || "(blank)"}」尚未完成正式 mapping，不能計入可用人力。`,
      source,
      artifactId: source?.artifactId,
      rawValue: normalized,
      createdAt: new Date().toISOString(),
    },
  };
}

export function s40GradeDefault(date: string, source?: SourceLocation): RosterLayerValue {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return { rawCode: "Rest", facets: ["rest"], availability: "unavailable", mappingId: "grade:S40:rest:v1", source };
  }
  return { rawCode: "D", facets: ["day"], availability: "confirmed-available", mappingId: "grade:S40:weekday-day:v1", source };
}

function layerValue(rawCode: string | undefined, source?: SourceLocation): RosterCodeResolution | undefined {
  if (rawCode === undefined || rawCode.trim() === "") return undefined;
  return resolveRosterCode(rawCode, source);
}

export function resolveEffectiveRosterForStaff(request: EffectiveRosterRequest): {
  effective: EffectiveRoster;
  issues: readonly ImportException[];
} {
  const gradeDefault = request.grade === "S40" ? s40GradeDefault(request.date, request.source) : undefined;
  const team = layerValue(request.teamBaseline, request.source);
  const override = layerValue(request.staffOverride, request.source);
  const input: EffectiveRosterInput = {
    staffNumber: request.staffNumber,
    date: request.date,
    parserVersion: request.parserVersion,
    gradeDefault,
    teamBaseline: team?.value,
    staffOverride: override?.value,
  };
  return {
    effective: resolveEffectiveRoster(input),
    issues: [team?.issue, override?.issue].filter((issue): issue is ImportException => Boolean(issue)),
  };
}
