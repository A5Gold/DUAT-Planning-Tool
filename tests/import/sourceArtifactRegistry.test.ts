import { describe, expect, it } from "vitest";
import { assertSourceUnchanged, stageSourceArtifact } from "../../src/application/import/sourceArtifactRegistry";
import type { ExcelWorkbookSnapshot } from "../../src/adapters/excel/excelWorkbookReader";

const snapshot = (value: string): ExcelWorkbookSnapshot => ({
  source: { filePath: "fixture.xlsx", fileName: "fixture.xlsx", sourceHash: value, byteLength: 10 },
  date1904: false,
  worksheets: [{ index: 0, name: "Roster", rowCount: 1, columnCount: 1, mergedRanges: ["A1:B1"], rows: [[{ kind: "string", value }]] }],
});

describe("source artifact registry", () => {
  it("keeps artifact hash, merged metadata and cell provenance", () => {
    const staged = stageSourceArtifact(snapshot("a"), "roster", "2026-08-21T00:00:00.000Z");
    expect(staged.artifact.sha256).toBe("a");
    expect(staged.artifact.worksheets[0]?.mergedRanges).toEqual(["A1:B1"]);
    expect(staged.rows[0]?.cells[0]?.source.address).toBe("A1");
  });

  it("rejects a changed source after preview", () => {
    const staged = stageSourceArtifact(snapshot("a"), "roster");
    expect(() => assertSourceUnchanged(staged, stageSourceArtifact(snapshot("b"), "roster"))).toThrow("SOURCE_CHANGED");
  });
});
