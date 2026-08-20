import type Database from "better-sqlite3";

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "initial_planning_schema",
    up: `
      CREATE TABLE staff (
        staff_number TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        team TEXT NOT NULL CHECK (team IN ('S1', 'S2', 'S3', 'S4', 'S5')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        is_supervisor INTEGER NOT NULL DEFAULT 0 CHECK (is_supervisor IN (0, 1)),
        is_general_employee INTEGER NOT NULL DEFAULT 0 CHECK (is_general_employee IN (0, 1))
      ) STRICT;

      CREATE TABLE qualifications (
        staff_number TEXT NOT NULL REFERENCES staff(staff_number) ON DELETE CASCADE,
        qualification_type TEXT NOT NULL
          CHECK (qualification_type IN ('AP', 'CP(P)', 'CP(T)', 'SIL', 'DUAT')),
        issue_date TEXT NOT NULL DEFAULT '',
        expiry_date TEXT NOT NULL,
        PRIMARY KEY (staff_number, qualification_type, issue_date, expiry_date)
      ) STRICT;

      CREATE TABLE roster_entries (
        planning_date TEXT NOT NULL,
        staff_number TEXT NOT NULL REFERENCES staff(staff_number) ON DELETE CASCADE,
        status TEXT CHECK (
          status IS NULL OR status IN (
            'available', 'night-duty', 'unavailable', 'leave', 'sickness', 'training', 'day-duty'
          )
        ),
        available INTEGER CHECK (available IS NULL OR available IN (0, 1)),
        reason TEXT,
        PRIMARY KEY (planning_date, staff_number)
      ) STRICT;

      CREATE TABLE planning_aggregates (
        planning_date TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        active_scenario_id TEXT NOT NULL DEFAULT 'main',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE night_plans (
        storage_id TEXT PRIMARY KEY,
        aggregate_date TEXT NOT NULL
          REFERENCES planning_aggregates(planning_date) ON DELETE CASCADE,
        domain_id TEXT NOT NULL,
        plan_date TEXT NOT NULL,
        plan_kind TEXT NOT NULL CHECK (plan_kind IN ('main', 'scenario'))
      ) STRICT;

      CREATE UNIQUE INDEX one_main_plan_per_aggregate
        ON night_plans(aggregate_date)
        WHERE plan_kind = 'main';

      CREATE TABLE scenarios (
        aggregate_date TEXT NOT NULL
          REFERENCES planning_aggregates(planning_date) ON DELETE CASCADE,
        scenario_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        plan_storage_id TEXT NOT NULL UNIQUE
          REFERENCES night_plans(storage_id) ON DELETE CASCADE,
        temporary INTEGER NOT NULL CHECK (temporary IN (0, 1)),
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (aggregate_date, scenario_id)
      ) STRICT;

      CREATE TABLE works (
        plan_storage_id TEXT NOT NULL REFERENCES night_plans(storage_id) ON DELETE CASCADE,
        domain_id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        project_code TEXT NOT NULL,
        work_type TEXT NOT NULL CHECK (work_type IN ('Possession', 'PA Work')),
        job_description TEXT NOT NULL,
        remarks TEXT NOT NULL,
        PRIMARY KEY (plan_storage_id, domain_id),
        UNIQUE (plan_storage_id, slot)
      ) STRICT;

      CREATE TABLE locations (
        plan_storage_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        location_name TEXT NOT NULL,
        isolation_point TEXT NOT NULL,
        earthing_point TEXT NOT NULL,
        minimum_total_headcount INTEGER NOT NULL CHECK (minimum_total_headcount >= 0),
        ap_count INTEGER NOT NULL DEFAULT 1 CHECK (ap_count >= 0),
        cp_count INTEGER NOT NULL DEFAULT 1 CHECK (cp_count >= 0),
        PRIMARY KEY (plan_storage_id, domain_id),
        UNIQUE (plan_storage_id, work_id, sequence),
        FOREIGN KEY (plan_storage_id, work_id)
          REFERENCES works(plan_storage_id, domain_id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE assignments (
        plan_storage_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        staff_number TEXT NOT NULL REFERENCES staff(staff_number),
        work_id TEXT NOT NULL,
        location_id TEXT,
        assignment_role TEXT NOT NULL CHECK (assignment_role IN ('AP', 'CP', '一般員工')),
        qualification_used TEXT CHECK (
          qualification_used IS NULL OR qualification_used IN ('AP', 'CP(P)', 'CP(T)', 'SIL', 'DUAT')
        ),
        assignment_source TEXT CHECK (
          assignment_source IS NULL OR assignment_source IN ('manual', 'suggestion')
        ),
        PRIMARY KEY (plan_storage_id, domain_id),
        UNIQUE (plan_storage_id, staff_number),
        FOREIGN KEY (plan_storage_id, work_id)
          REFERENCES works(plan_storage_id, domain_id) ON DELETE CASCADE,
        FOREIGN KEY (plan_storage_id, location_id)
          REFERENCES locations(plan_storage_id, domain_id) ON DELETE CASCADE,
        CHECK (
          (assignment_role = '一般員工' AND location_id IS NULL AND qualification_used IS NULL)
          OR (assignment_role IN ('AP', 'CP') AND location_id IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX qualifications_by_staff
        ON qualifications(staff_number, qualification_type, expiry_date);
      CREATE INDEX roster_by_date
        ON roster_entries(planning_date, staff_number);
      CREATE INDEX night_plans_by_aggregate
        ON night_plans(aggregate_date, plan_kind);
      CREATE INDEX works_by_plan
        ON works(plan_storage_id, slot);
      CREATE INDEX locations_by_work
        ON locations(plan_storage_id, work_id, sequence);
      CREATE INDEX assignments_by_work
        ON assignments(plan_storage_id, work_id);
    `,
  },
  {
    version: 2,
    name: "import_staging_audit",
    up: `
      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('formation', 'qualification')),
        source_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        worksheet_name TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        row_count INTEGER NOT NULL CHECK (row_count >= 0),
        accepted_row_count INTEGER NOT NULL CHECK (accepted_row_count >= 0)
      ) STRICT;

      CREATE UNIQUE INDEX import_batches_fingerprint ON import_batches(fingerprint);

      CREATE TABLE import_batch_rows (
        batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        row_id TEXT NOT NULL,
        row_number INTEGER NOT NULL CHECK (row_number >= 1),
        disposition TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (batch_id, row_id)
      ) STRICT;
    `,
  },
];

export const LATEST_SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.at(-1)?.version ?? 0;

interface AppliedMigrationRow {
  version: number;
  name: string;
}

export function migrateSqliteDatabase(database: Database.Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database
    .prepare<[], AppliedMigrationRow>("SELECT version, name FROM schema_migrations ORDER BY version")
    .all();
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row.name]));
  const unknownVersion = appliedRows.find(
    (row) => !SQLITE_MIGRATIONS.some((migration) => migration.version === row.version),
  );
  if (unknownVersion) {
    throw new Error(
      `Database schema version ${unknownVersion.version} is newer than this application supports ` +
        `(latest ${LATEST_SQLITE_SCHEMA_VERSION}).`,
    );
  }

  for (const migration of SQLITE_MIGRATIONS) {
    const appliedName = appliedByVersion.get(migration.version);
    if (appliedName !== undefined) {
      if (appliedName !== migration.name) {
        throw new Error(
          `Migration ${migration.version} was recorded as "${appliedName}", expected "${migration.name}".`,
        );
      }
      continue;
    }

    database.transaction(() => {
      database.exec(migration.up);
      database
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
      database.pragma(`user_version = ${migration.version}`);
    }).immediate();
  }

  return LATEST_SQLITE_SCHEMA_VERSION;
}
