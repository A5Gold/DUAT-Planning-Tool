import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../../src/adapters/sqlite";
import { bootstrapReferenceData, referenceBootstrapPaths } from "../../src/application/import";

describe("reference workbook bootstrap", () => {
  it("normalizes the three reference workbooks into the SQLite read model", async () => {
    const database = createSqliteDatabase(":memory:");
    try {
      const result = await bootstrapReferenceData(database, referenceBootstrapPaths(resolve(process.cwd())));
      const staff = (database.prepare("SELECT COUNT(*) AS count FROM staff").get() as { count: number }).count;
      const roster = (database.prepare("SELECT COUNT(*) AS count FROM roster_entries").get() as { count: number }).count;
      const qualifications = (database.prepare("SELECT COUNT(*) AS count FROM qualifications").get() as { count: number }).count;
      const jobRoles = (database.prepare("SELECT COUNT(*) AS count FROM job_role_records").get() as { count: number }).count;
      const exceptions = (database.prepare("SELECT COUNT(*) AS count FROM import_exceptions").get() as { count: number }).count;

      expect(result.rosterSheets).toBeGreaterThan(0);
      expect(staff).toBeGreaterThan(0);
      expect(roster).toBeGreaterThan(0);
      expect(qualifications).toBeGreaterThan(0);
      expect(jobRoles).toBeGreaterThan(0);
      expect(exceptions).toBeGreaterThan(0);
      expect((database.prepare("SELECT COUNT(*) AS count FROM roster_entries WHERE status = 'unknown'").get() as { count: number }).count).toBeGreaterThan(0);
      expect((database.prepare("SELECT COUNT(*) AS count FROM job_role_records WHERE match_status = 'unresolved'").get() as { count: number }).count).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  }, 120_000);
});
