import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEventDatabase } from "../../src/adapters/sqlite/eventDatabase";
import { SQLiteEventStore } from "../../src/adapters/sqlite/eventStore";
import { backupEventDatabase, restoreEventDatabase } from "../../src/application/backup/backupService";

describe("event database backup and restore", () => {
  let directories: string[] = [];
  afterEach(() => directories.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("restores events to a new directory and verifies the manifest checksum", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "planner-event-source-"));
    const targetDir = mkdtempSync(join(tmpdir(), "planner-event-target-"));
    directories = [sourceDir, targetDir];
    const source = join(sourceDir, "events.sqlite");
    const database = createEventDatabase(source);
    const store = new SQLiteEventStore(database);
    store.append({
      aggregateType: "Staff", aggregateId: "517968", eventType: "StaffCreated", schemaVersion: 1,
      expectedSequence: 0, idempotencyKey: "backup:1", effectiveAt: "2026-08-21T00:00:00.000Z",
      actor: { id: "planner-local", role: "Planner" }, source: "test", payload: { staffNo: "517968" },
    });
    database.close();
    const backup = backupEventDatabase(source, join(sourceDir, "backup"));
    expect(readFileSync(backup.manifestPath, "utf8")).toContain("events.sqlite");
    const restored = restoreEventDatabase(backup, targetDir);
    const reopened = createEventDatabase(restored.databasePath);
    expect(new SQLiteEventStore(reopened).readAll()).toHaveLength(1);
    reopened.close();
  });
});
