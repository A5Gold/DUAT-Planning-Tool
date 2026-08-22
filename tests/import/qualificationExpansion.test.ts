import { describe, expect, it } from "vitest";
import {
  expandQualificationColumns,
  type QualificationColumnObservation,
} from "../../src/application/import/qualificationExpansion";

const source = (column: number, address: string) => ({
  sheetIndex: 2,
  sheetName: "CQA1",
  row: 11,
  column,
  address,
});

describe("qualification merged-cell expansion", () => {
  it("expands one anchor expiry to CP(P) and CP(T), retaining each cell provenance", () => {
    const observations: QualificationColumnObservation[] = [
      {
        qualification: "CP(P)",
        qualificationCode: "R00103U",
        rawValue: "2027-06-05",
        source: source(4, "D11"),
        mergeRange: "D11:E11",
        mergeAnchor: "D11",
      },
      {
        qualification: "CP(T)",
        qualificationCode: "R00104U",
        rawValue: undefined,
        source: source(5, "E11"),
        mergeRange: "D11:E11",
        mergeAnchor: "D11",
      },
    ];

    const result = expandQualificationColumns(observations);

    expect(result.issues).toEqual([]);
    expect(result.grants).toHaveLength(2);
    expect(result.grants.map((grant) => [grant.qualification, grant.expiryDate])).toEqual([
      ["CP(P)", "2027-06-05"],
      ["CP(T)", "2027-06-05"],
    ]);
    expect(result.grants[0].source).toMatchObject({
      sheetName: "CQA1",
      row: 11,
      column: 4,
      address: "D11",
      mergeRange: "D11:E11",
      mergeAnchor: "D11",
    });
    expect(result.grants[1].source).toMatchObject({ column: 5, address: "E11", mergeRange: "D11:E11" });
  });

  it("emits a blocking annotated-date exception and does not create grants", () => {
    const result = expandQualificationColumns([
      {
        qualification: "CP(P)",
        rawValue: "05/06/27 (JSC475)",
        source: source(4, "D11"),
        mergeRange: "D11:E11",
        mergeAnchor: "D11",
      },
      {
        qualification: "CP(T)",
        rawValue: undefined,
        source: source(5, "E11"),
        mergeRange: "D11:E11",
        mergeAnchor: "D11",
      },
    ]);

    expect(result.grants).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "ANNOTATED_DATE_BLOCKED",
        severity: "error",
        blocking: true,
        mergeRange: "D11:E11",
        source: expect.objectContaining({ address: "D11" }),
      }),
    ]);
  });

  it("represents blank and double-dash as explicit none grants", () => {
    const result = expandQualificationColumns([
      { qualification: "CP(P)", rawValue: "", source: source(4, "D11") },
      { qualification: "CP(T)", rawValue: "--", source: source(5, "E11") },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.grants).toEqual([
      expect.objectContaining({ qualification: "CP(P)", state: "none", emptyMarker: "blank" }),
      expect.objectContaining({ qualification: "CP(T)", state: "none", emptyMarker: "double-dash" }),
    ]);
  });

  it("blocks non-standard unannotated expiry values without guessing", () => {
    const result = expandQualificationColumns([
      { qualification: "CP(P)", rawValue: "05/06/27", source: source(4, "D11") },
    ]);

    expect(result.grants).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "NON_STANDARD_EXPIRY", blocking: true });
  });
});

