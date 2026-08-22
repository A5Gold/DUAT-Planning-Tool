import { describe, expect, it } from "vitest";

import {
  createAliasDecision,
  createImportException,
  isAliasResolved,
  resolveEffectiveRoster,
  type AliasCandidate,
  type SourceArtifact,
} from "../../src/domain/import";

const source = {
  artifactId: "artifact-qualification",
  sheetIndex: 0,
  sheetName: "CQA",
  row: 11,
  column: 2,
  address: "B11",
};

describe("Phase 1 import reconciliation contracts", () => {
  it("keeps source artifact worksheet metadata and raw provenance typed", () => {
    const artifact: SourceArtifact = {
      artifactId: "artifact-1",
      path: "Qualification.xlsx",
      filename: "Qualification.xlsx",
      sha256: "sha256:fixture",
      fileSize: 24030,
      importedAt: "2026-08-21T00:00:00Z",
      readerVersion: "exceljs-4.4",
      worksheets: [{ sheetIndex: 0, name: "CQA", rowCount: 41, columnCount: 29, mergedRanges: ["M12:N12"] }],
    };
    expect(artifact.worksheets[0].mergedRanges).toContain("M12:N12");
  });

  it("requires an explicit candidate for an accepted alias", () => {
    const candidate: AliasCandidate = {
      aliasId: "alias-1",
      source,
      rawName: "YF Mak",
      normalizedName: "yf mak",
      candidateStaffNumbers: ["517968"],
      confidence: 0.92,
      matchMethod: "normalized-name",
    };
    const accepted = createAliasDecision(candidate, {
      status: "accepted",
      staffNumber: "517968",
      actorId: "admin",
      decidedAt: "2026-08-21T01:00:00Z",
    });
    expect(isAliasResolved(accepted)).toBe(true);
    expect(() => createAliasDecision(candidate, { status: "accepted", staffNumber: "999999" })).toThrow();
    expect(isAliasResolved(createAliasDecision(candidate, { status: "unresolved" }))).toBe(false);
  });

  it("resolves roster inheritance and preserves unknown availability", () => {
    const effective = resolveEffectiveRoster({
      staffNumber: "517968",
      date: "2026-08-21",
      parserVersion: "roster-v1",
      gradeDefault: { rawCode: "D", facets: ["day"], availability: "confirmed-available" },
      teamBaseline: { rawCode: "N0", facets: ["night"], availability: "confirmed-available" },
      staffOverride: { rawCode: "T01", facets: ["training"], availability: "unknown" },
    });
    expect(effective.sourceLayer).toBe("staff-override");
    expect(effective.availability).toBe("unknown");

    const inherited = resolveEffectiveRoster({
      staffNumber: "517968",
      date: "2026-08-22",
      parserVersion: "roster-v1",
      gradeDefault: { rawCode: "D", facets: ["day"], availability: "confirmed-available" },
      teamBaseline: { rawCode: "N0", facets: ["night"], availability: "confirmed-available" },
      staffOverride: { rawCode: "", facets: [], availability: "unknown" },
    });
    expect(inherited.sourceLayer).toBe("team-baseline");
    expect(inherited.rawCode).toBe("N0");
  });

  it("creates deterministic unresolved exceptions linked to raw source", () => {
    const issue = createImportException({
      code: "QUALIFICATION_NON_STANDARD_EXPIRY",
      severity: "blocking",
      message: "Expiry contains an annotation and cannot be interpreted safely.",
      source,
      rawValue: "05/06/27 (JSC475)",
      createdAt: "2026-08-21T00:00:00Z",
    });
    expect(issue.status).toBe("unresolved");
    expect(issue.issueId).toBe("artifact-qualification:B11:QUALIFICATION_NON_STANDARD_EXPIRY");
    expect(issue.source?.address).toBe("B11");
  });
});
