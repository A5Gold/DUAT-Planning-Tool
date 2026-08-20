import { openSqliteDatabase, type OpenSqliteDatabaseOptions } from "./database";
import { SqlitePlanningRepository } from "./planningRepository";

export { createSqliteDatabase, openSqliteDatabase } from "./database";
export type { OpenSqliteDatabaseOptions } from "./database";
export {
  LATEST_SQLITE_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  migrateSqliteDatabase,
} from "./migrations";
export type { SqliteMigration } from "./migrations";
export {
  AggregateRevisionConflictError,
  SqlitePlanningRepository,
} from "./planningRepository";
export type {
  PlanningContextSnapshot,
  VersionedPlanningAggregate,
} from "./planningRepository";
export { SqliteImportCommitPort } from "./importCommit";

/** Open a migrated database and return a repository ready for main-process use. */
export function createSqliteRepository(
  filename = ":memory:",
  options: OpenSqliteDatabaseOptions = {},
): SqlitePlanningRepository {
  return new SqlitePlanningRepository(openSqliteDatabase(filename, { ...options, migrate: true }));
}

export const createSqlitePlanningRepository = createSqliteRepository;
