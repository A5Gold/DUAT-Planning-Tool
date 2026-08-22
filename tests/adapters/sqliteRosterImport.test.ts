import { describe, expect, it } from "vitest";
import { createSqliteDatabase, SqlitePlanningRepository, SqliteImportCommitPort } from "../../src/adapters/sqlite";
import type { ImportPreview, RosterStagedRow } from "../../src/application/import";

describe("SQLite roster import commit", () => {
  it("writes roster rows that the planning repository reads immediately", () => {
    const database = createSqliteDatabase(":memory:");
    try {
      const repository = new SqlitePlanningRepository(database);
      repository.savePlanningData({ staff: [{ staffNumber: "123456", name: "Test", team: "S2" }] });
      const row: RosterStagedRow = { staffNumber: "123456", date: "2026-08-21", rawCode: "N", status: "night-duty", available: true };
      const preview = { importId: "roster:test", kind: "roster", source: { sourceHash: "hash", byteLength: 1 }, selectedWorksheet: { index: 0, name: "August 2026", rowCount: 1, columnCount: 1, hasFormationHeader: false, hasQualificationHeader: false }, fingerprint: "fingerprint", status: "valid", rows: [{ id: "roster:0:1:5", rowNumber: 1, source: { sheetIndex: 0, sheetName: "August 2026", row: 1, column: 5 }, normalized: row, status: "valid", disposition: "include", issues: [] }], issues: [], rowCount: 1, validRowCount: 1, warningCount: 0, errorCount: 0 } satisfies ImportPreview<RosterStagedRow>;
      new SqliteImportCommitPort(database).commitRoster([row], preview, {});
      expect(repository.getRosterEntry("2026-08-21", "123456")).toMatchObject({ status: "night-duty", available: true });
    } finally {
      database.close();
    }
  });

  it("persists unknown roster codes as unavailable without rejecting the batch", () => {
    const database = createSqliteDatabase(":memory:");
    try {
      const repository = new SqlitePlanningRepository(database);
      repository.savePlanningData({ staff: [{ staffNumber: "654321", name: "Unknown shift", team: "S2" }] });
      const row: RosterStagedRow = { staffNumber: "654321", date: "2026-08-21", rawCode: "ALPM", status: "unknown", available: false, reason: "Unmapped roster code: ALPM" };
      const preview = { importId: "roster:unknown", kind: "roster", source: { sourceHash: "hash-unknown", byteLength: 1 }, selectedWorksheet: { index: 0, name: "August 2026", rowCount: 1, columnCount: 1, hasFormationHeader: false, hasQualificationHeader: false }, fingerprint: "fingerprint-unknown", status: "has-warnings", rows: [{ id: "roster:unknown:1", rowNumber: 1, source: { sheetIndex: 0, sheetName: "August 2026", row: 1, column: 5 }, normalized: row, status: "warning", disposition: "include", issues: [] }], issues: [], rowCount: 1, validRowCount: 1, warningCount: 1, errorCount: 0 } satisfies ImportPreview<RosterStagedRow>;
      new SqliteImportCommitPort(database).commitRoster([row], preview, {});
      expect(repository.getRosterEntry("2026-08-21", "654321")).toMatchObject({ status: "unknown", available: false, reason: "Unmapped roster code: ALPM" });
    } finally {
      database.close();
    }
  });
});
