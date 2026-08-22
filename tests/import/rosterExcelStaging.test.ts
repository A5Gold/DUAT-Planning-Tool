import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ExcelJsWorkbookReader } from "../../src/adapters/excel/excelWorkbookReader";
import { previewImportFromSnapshot } from "../../src/application/import";

describe("Roster Excel staging", () => {
  it("expands a monthly roster sheet and preserves unknown codes as unavailable", async () => {
    const snapshot = await new ExcelJsWorkbookReader().read(resolve(process.cwd(), "00 Reference Document/Roster/2026 Roster.xlsx"));
    const preview = previewImportFromSnapshot(snapshot, "roster", { worksheetName: "August 2026" });
    expect(preview.selectedWorksheet.name).toBe("August 2026");
    expect(preview.rows.some((row) => row.normalized?.staffNumber === "231061" && row.normalized.date === "2026-08-01")).toBe(true);
    const halfDayLeave = preview.rows.find((row) => row.normalized?.rawCode === "ALPM");
    expect(halfDayLeave?.normalized).toMatchObject({ status: "leave", available: false });
    expect(halfDayLeave?.issues.some((issue) => issue.code === "UNKNOWN_ROSTER_CODE")).toBe(false);
    const combinedShift = preview.rows.find((row) => row.normalized?.rawCode === "D+N");
    expect(combinedShift?.normalized).toMatchObject({ status: "night-duty", available: true });
    const training = preview.rows.find((row) => row.normalized?.rawCode === "T01");
    expect(training?.normalized).toMatchObject({ status: "training", available: false });
  });

});
