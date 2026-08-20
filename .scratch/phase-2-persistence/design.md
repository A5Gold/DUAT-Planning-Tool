# Phase 2 Persistence and Import Design

## Objective

Add the second-phase application boundary in this order: typed Electron IPC,
SQLite persistence, and an Excel staging pipeline with an import preview and an
explicit commit action. The existing `PlanningService` remains the domain seam;
renderer code does not gain direct access to Electron, SQLite, or Excel.

## Decisions

### Typed IPC

`src/application/ipcContract.ts` owns structured-clone-safe request and response
DTOs. Each application command has a fixed channel name in a typed channel map.
The preload exposes a fixed `window.ohlr` facade and never exposes
`ipcRenderer.invoke` or arbitrary channel names. Every response is
`IpcResult<T>` with discriminated success and typed error variants.

Mutation requests include `date`, a `ScenarioRef`, and `expectedRevision`.
Main-process handlers validate request shape before loading repositories. A
successful mutation returns the refreshed snapshot and revision; domain errors
are returned without saving. Scenario tab selection remains renderer view state;
only an explicit Apply command changes the main plan.

### SQLite adapter

The main process owns a `better-sqlite3@12.11.1` connection. The adapter is
isolated behind repository ports and uses bundled, ordered migrations tracked by
`PRAGMA user_version`. It enables foreign keys and a busy timeout, performs
optimistic revision checks inside transactions, and rejects future schema
versions. The first schema stores planning snapshots, staff, qualifications,
roster entries, scenarios and import batches. JSON snapshot storage is used for
the existing aggregate while normalized reference tables provide the next
phase's import/query seam; no domain type imports SQLite.

### Excel staging

`src/application/import` defines staging DTOs that contain source references,
normalized values, row status and auditable issues. The Excel adapter is isolated
behind an `ExcelWorkbookReader` port and uses ExcelJS for `.xlsx` files.
Formation selects the worksheet by header signature and carries forward Team
within a contiguous data region. Qualification selects the worksheet with the
latest valid `Update on` date and recognizes either historical header
orientation. Blank and `--` qualification cells become explicit `none` rows;
annotated or ambiguous dates are blocking errors. Supervisor rows are shown and
excluded by default.

Preview results are identified by source hash and fingerprint. Commit rechecks
the source fingerprint and repository version, blocks included error rows, and
persists one import batch transactionally. The renderer can choose a worksheet,
acknowledge warnings, and confirm commit, but cannot submit arbitrary normalized
rows.

## Data flow

```text
Renderer -> fixed preload facade -> validated main handler
         -> repository/context load -> PlanningService -> save transaction
         -> structured-clone snapshot/result -> renderer

Excel file -> reader -> inspect -> normalize -> validate -> preview UI
          -> explicit commit -> SQLite import batch and reference data
```

## Error and safety rules

- Invalid request, stale revision, domain validation, not-found and system
  failures have distinct typed error kinds.
- No handler silently moves an assignment from another confirmed Work.
- SQLite constraints are a final defense; domain validation remains authoritative.
- Migration and import commits are atomic. Source changes after preview abort the
  commit and require a new preview.
- Native SQLite is loaded only by the Electron main bundle and is unpacked when
  packaged.

## Verification

Add contract serialization and runtime-validation tests, repository contract and
SQLite migration tests, Excel staging fixture tests, import handler tests, and a
Playwright workflow for import preview/commit plus existing workbench flows.
Run unit tests, lint, typecheck, build, and an Electron smoke test after native
rebuild/package configuration.

