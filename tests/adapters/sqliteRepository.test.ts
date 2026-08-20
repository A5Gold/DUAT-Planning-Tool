import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AggregateRevisionConflictError,
  createSqliteDatabase,
  createSqliteRepository,
  LATEST_SQLITE_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  migrateSqliteDatabase,
  openSqliteDatabase,
  SqlitePlanningRepository,
} from "../../src/adapters/sqlite";
import { createMockState, mockPlanningData } from "../../src/data/mockData";
import type { PlanningState } from "../../src/domain/planning";

describe("SQLite planning adapter", () => {
  let database: ReturnType<typeof createSqliteDatabase>;
  let repository: SqlitePlanningRepository;

  beforeEach(() => {
    database = createSqliteDatabase(":memory:");
    repository = new SqlitePlanningRepository(database, () => "2026-08-20T00:00:00.000Z");
    repository.savePlanningData(mockPlanningData);
  });

  afterEach(() => {
    database.close();
  });

  it("applies migrations once and enables foreign keys", () => {
    expect(migrateSqliteDatabase(database)).toBe(LATEST_SQLITE_SCHEMA_VERSION);
    expect(database.pragma("user_version", { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    const rows = database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toHaveLength(SQLITE_MIGRATIONS.length);
    expect(rows.map((row) => row.name)).toEqual(SQLITE_MIGRATIONS.map((migration) => migration.name));
  });

  it("provides a repository factory with an owned close lifecycle", () => {
    const owned = createSqliteRepository(":memory:");
    expect(owned.load("2026-08-20")).toBeUndefined();
    owned.close();
  });

  it("rejects unsafe SQLite timeout values before opening a connection", () => {
    expect(() => openSqliteDatabase(":memory:", { timeoutMs: Number.NaN })).toThrow(TypeError);
    expect(() => openSqliteDatabase(":memory:", { timeoutMs: -1 })).toThrow(TypeError);
  });

  it("round-trips staff, qualifications and roster context", () => {
    const data = repository.loadPlanningData("2026-08-20");
    expect(data.staff).toHaveLength(mockPlanningData.staff.length);
    expect(data.staff.find((staff) => staff.staffNumber === "517968")).toMatchObject({
      name: "YF Mak",
      team: "S1",
    });
    expect(data.qualifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ staffNumber: "517968", type: "AP", expiryDate: "2026-10-28" }),
      ]),
    );
    expect(data.roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-08-20", staffNumber: "517968", status: "available" }),
      ]),
    );
    expect(repository.getQualifications("517968")).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "CP(T)" })]),
    );
  });

  it("round-trips main plan and temporary scenarios without changing domain IDs", () => {
    const state = createMockState("2026-08-20");
    const saved = repository.saveAggregate(state, null);
    expect(saved.revision).toBe(1);

    const loaded = repository.loadAggregate(state.date);
    expect(loaded?.revision).toBe(1);
    expect(loaded?.state).toMatchObject({
      date: state.date,
      activeScenarioId: state.activeScenarioId,
      main: state.main,
      scenarios: state.scenarios,
    });
    expect(loaded?.state.main.works[0].locations[0].demand).toEqual({ apCount: 1, cpCount: 1 });
    expect(repository.loadContext(state.date)?.data.staff).toHaveLength(mockPlanningData.staff.length);
  });

  it("opens a file database, persists across close/reopen, and migrates it", () => {
    const directory = mkdtempSync(join(tmpdir(), "ohlr-duat-sqlite-"));
    const filename = join(directory, "planning.sqlite");
    const connections: ReturnType<typeof openSqliteDatabase>[] = [];
    try {
      const first = openSqliteDatabase(filename);
      connections.push(first);
      const firstRepository = new SqlitePlanningRepository(first);
      firstRepository.savePlanningData(mockPlanningData);
      firstRepository.saveAggregate(createMockState("2026-08-20"), null);
      first.close();

      const reopened = openSqliteDatabase(filename, { fileMustExist: true });
      connections.push(reopened);
      const reopenedRepository = new SqlitePlanningRepository(reopened);
      expect(reopenedRepository.loadAggregate("2026-08-20")?.revision).toBe(1);
      expect(reopened.pragma("user_version", { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION);
    } finally {
      for (const connection of connections) {
        if (connection.open) connection.close();
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses compare-and-swap revisions and rejects stale writes", () => {
    const state = createMockState("2026-08-20");
    repository.saveAggregate(state, 0);
    const current = repository.loadAggregate(state.date);
    expect(current?.revision).toBe(1);

    const next: PlanningState = {
      ...state,
      main: {
        ...state.main,
        works: state.main.works.map((work) =>
          work.slot === 1 ? { ...work, remarks: "revision two" } : work,
        ),
      },
    };
    expect(repository.saveAggregate(next, 1).revision).toBe(2);
    expect(() => repository.saveAggregate(state, 1)).toThrowError(AggregateRevisionConflictError);
    expect(repository.loadAggregate(state.date)?.revision).toBe(2);
    expect(repository.loadAggregate(state.date)?.state.main.works[0].remarks).toBe("revision two");
  });

  it("enforces one person per plan at the database boundary", () => {
    const state = createMockState("2026-08-20");
    const duplicate = {
      ...state,
      main: {
        ...state.main,
        assignments: [
          ...state.main.assignments,
          {
            id: "duplicate-assignment",
            staffNumber: state.main.assignments[0].staffNumber,
            workId: state.main.works[1].id,
            role: "AP" as const,
            locationId: state.main.works[1].locations[0].id,
          },
        ],
      },
    };
    expect(() => repository.saveAggregate(duplicate, null)).toThrow();
    expect(repository.loadAggregate(state.date)).toBeUndefined();
  });
});
