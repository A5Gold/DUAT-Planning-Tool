# OHLR-DUAT Planning Tool

## Development Specification

| Field | Value |
| --- | --- |
| Status | Approved development baseline |
| Date | 2026-08-20 |
| UI baseline | Hybrid week and single-night workbench v4 |
| Delivery target | Windows portable ZIP |
| Primary architecture seam | PlanningService |

## 1. Technical Direction

- Electron desktop shell with React, TypeScript and Vite renderer.
- Fluent UI React for accessible controls, focus states, keyboard support and form semantics.
- SQLite for local persistence. Use a versioned migration system and a native SQLite driver compatible with the Electron runtime.
- Excel reader/writer for Formation, Qualification, Roster and detailed export.
- Electron main process owns persistence, import/export, backup and domain orchestration.
- Renderer owns view state, editing state and visual interaction only.
- Typed IPC contracts are the only bridge between renderer and main process.
- Package with a Windows portable ZIP. No installer, login, network dependency or administrator privilege is required.

## 2. Architecture and Seams

### 2.1 PlanningService seam

`PlanningService` is the highest test seam. It receives a selected night, scenario state, roster availability, staff qualifications and booking rules. It returns a named allocation result, shortages, conflicts, candidate alternatives and validation messages.

The service depends on injected repository and policy ports, so domain tests can use in-memory data without Electron, SQLite or Excel.

### 2.2 Adapters

- Excel adapter: reads source workbooks into staging rows and writes detailed output.
- SQLite adapter: stores normalized entities, scenarios, assignments, backups and migrations.
- Electron IPC adapter: validates renderer requests and maps them to application commands.
- Report adapter: produces printable/PDF summaries from a stable plan snapshot.
- Clock adapter: supplies the planning date for deterministic qualification expiry tests.

### 2.3 Renderer boundaries

- Weekly planner shell and date navigation.
- Night workbench and four Work cards.
- Location editor and named assignment rows.
- S1-S5 personnel sidebar with search, qualification badges and drag sources.
- Scenario tabs and temporary-save actions.
- Import, rules, Roster, reports and backup module pages.

## 3. Domain Data Model

The database uses stable identifiers and explicit foreign keys. Names are editable display data; staff number and Project Code are operational identifiers.

### 3.1 Staff and availability

- `Staff`: staff number, display name, team, active status, supervisor flag.
- `Team`: S1-S5, team type, normal night/day pattern and support eligibility.
- `Qualification`: staff number, domain, qualification type, issue/update date and expiry date.
- `RosterEntry`: date, staff number, availability status, reason and source.

### 3.2 Projects and plans

- `Project`: Project Code, title, priority, deadline, progress gap, weekly target and notes.
- `NightPlan`: planning date, week number, formal status and selected scenario.
- `Work`: NightPlan reference, slot number 1-4, Project Code, Work type, active state, Job Description, Remarks and Work-level general employee demand.
- `Location`: Work reference, sequence, Location Name, Isolation Point, Earthing Point and editable minimum total headcount.
- `LocationDemand`: Location reference, AP count, CP requirement, qualification domain and CP type. Defaults to one AP and one CP(P), but remains data-driven.

### 3.3 Assignments and scenarios

- `Assignment`: scenario reference, night reference, Work reference, optional Location reference, staff number, role, qualification used and assignment source.
- `BookingRule`: booking type, SIL/DUAT requirement, CP(P)/CP(T) rule, Work type applicability, active dates and notes.
- `Scenario`: night reference, name, base scenario reference, temporary flag, status and timestamps.
- `ImportBatch`: source filename, source worksheet, import date, validation status and error count.
- `BackupRecord`: backup filename, creation date, schema version and restore status.

Database constraints must prevent duplicate assignment of one person to multiple Works on the same night and prevent two roles for one person in the same Work.

## 4. Application Contracts

The typed application contract exposes these behaviours:

- Preview and commit Formation, Qualification and Roster imports.
- Read and update a week and selected NightPlan.
- Create, update and remove Work 1 through Work 4.
- Create, update and remove Locations and Location demands.
- Read and maintain BookingRule records.
- Calculate named allocation suggestions for a NightPlan and Scenario.
- Add, replace and remove an Assignment with validation.
- Create, rename, delete, save and apply Scenario records.
- Export detailed Excel and printable/PDF summaries.
- Create, list and restore local backups.

IPC requests must return a typed success or typed domain error. Renderer code must never write directly to SQLite.

## 5. Import Pipeline

1. Select an Excel source and identify supported worksheets.
2. Read rows without modifying the source workbook.
3. Select the latest Qualification worksheet by `Update on`.
4. Normalize staff numbers, names, teams, qualification types and dates.
5. Treat `--` and blank qualification values as no qualification.
6. Match Qualification and Roster rows to Staff by staff number.
7. Produce a staging preview with row-level errors and warnings.
8. Commit only validated rows after Planner confirmation.
9. Preserve the import batch and source metadata for troubleshooting.

Unknown staff numbers, duplicate staff numbers, invalid dates, unsupported qualification names and missing required fields must be visible before commit.

## 6. Allocation Engine

### 6.1 Hard constraints

- Each Location requires one AP and one CP by default.
- AP and CP must be different people.
- A person may belong to only one Work and one role on one night.
- Possession requires valid CP(P).
- PA Work accepts valid CP(P) or CP(T).
- Expired qualification and unavailable Roster status are rejected.
- Minimum total headcount must be satisfied with AP, CP and general employees.
- General employees are assigned to Work, not Location.
- S1 is eligible only when selected as support.
- Sup. personnel require explicit manual inclusion and a remark.

### 6.2 Suggestion ordering

Candidate selection is deterministic. Sort by deadline, project priority, progress gap, weekly target, team eligibility and qualification fit. Prefer CP(T) for PA Work when both CP types are valid.

The result must include:

- Named assignments by Location and Work.
- Required versus available counts by role and qualification.
- Missing roles and qualifications.
- Conflicting assignments.
- Alternative candidates.
- A reason code suitable for inline warnings.

The engine may suggest alternatives but must not silently change another confirmed Work.

## 7. UI Implementation Requirements

### 7.1 Workbench layout

- Product title is `OHLR-DUAT Planning Tool`.
- Header has date selector, previous/next navigation, current-week control, week number and date range.
- Weekly overview shows Sunday through Saturday, Sunday first.
- Main area has Work 1, Work 2, Work 3 and Work 4. Inactive Works remain grey.
- Main Work area owns horizontal scrolling when four cards do not fit.
- Right personnel sidebar remains visible at desktop and 929px review width.

### 7.2 Work and Location controls

- Project Code is large, prominent and editable.
- Possession and PA Work use a segmented control.
- Job Description and Remarks are plain editable fields.
- Location Name, Isolation Point, Earthing Point and minimum total headcount are editable.
- AP and CP rows show assigned name, team and qualification.
- Work-level 一般員工 row accepts general employees without Location assignment.
- Add Location is available; add Project Code is not available inside a Work.

### 7.3 Personnel drag and drop

- Sidebar entries are grouped under S1, S2, S3, S4 and S5.
- Each entry shows name, availability state, current assignment and qualification badges.
- AP-qualified entries can be dragged to AP targets.
- CP(P)-qualified entries can be dragged to Possession CP targets.
- CP(P)/CP(T)-qualified entries can be dragged to PA Work CP targets according to BookingRule.
- General employees can be dragged to Work-level 一般員工 targets.
- Invalid drops leave the target in a red shortage state and show the missing qualification.
- Manual drop changes call the same validation path as automatic suggestions.

### 7.4 Automatic validation and scenarios

- Resource validation runs after demand, Roster, rule or assignment changes.
- Shortage warnings are red and remain visible without a separate check button.
- Scenario tabs support a formal plan plus A/B/C temporary alternatives.
- Temporary controls and labels use orange.
- Scenario delete is available on every test tab.
- Apply is an explicit action and must not be triggered by switching tabs.

## 8. Module Pages

- **排工工作台:** week strip, selected NightPlan, four Works, scenarios and personnel sidebar.
- **Projects:** Project Code, priority, deadline, progress gap, weekly target and notes.
- **人員與資格:** Staff, Formation, Qualification, expiry warnings and team membership.
- **Roster:** weekly availability, leave, training, day/night assignment and manual overrides.
- **Booking Rules:** editable SIL, DUAT, CP(P), CP(T), Possession and PA rules.
- **資料匯入:** source selection, worksheet mapping, staging preview, validation and commit.
- **報告與備份:** Excel export, PDF/print summary, backup list and restore.

## 9. Testing Strategy

### 9.1 Unit tests

Test PlanningService externally through in-memory repositories. Cover role constraints, qualification expiry, CP(P)/CP(T), Location demand, minimum headcount, general employees, S1 support, Sup. override and weekly rules.

### 9.2 Import and persistence tests

Use fixture workbooks based on the reference files. Cover latest worksheet selection, blank and `--` qualifications, unknown staff numbers, duplicate rows, invalid dates, staging errors, migration and backup restore.

### 9.3 UI tests

Use Playwright to cover date selection, Sunday-first week strip, four Work slots, Project Code and Location editing, drag/drop assignment, automatic red warnings, scenario create/delete/save/apply and module navigation.

### 9.4 Packaging tests

Run the packaged portable ZIP on Windows in a writable folder. Verify first launch, database creation, import, plan save, restart recovery, export, backup and restore without administrator rights.

## 10. Release and Data Safety

- Store runtime data beside the portable application in writable `data` and `backups` folders.
- Create an automatic backup before schema migration and before restore.
- Include schema version in every database and backup.
- Show a clear error if the application folder is read-only.
- Keep original Excel sources read-only and retain import metadata.
- Do not transmit staff or planning data to external services.

## 11. Draft Implementation Tickets

The following tickets are dependency-ordered candidates for GitHub Issues:

1. Portable planning workspace. Blocked by none.
2. Formation, Qualification and Roster import. Blocked by 1.
3. Booking Qualification and nightly rule maintenance. Blocked by 1.
4. Project and four-Work weekly workbench. Blocked by 1.
5. Named allocation suggestions. Blocked by 2, 3 and 4.
6. S1-S5 drag/drop assignment and automatic shortage validation. Blocked by 5.
7. Scenario A/B/C comparison and explicit apply. Blocked by 4 and 6.
8. Excel/PDF output and local backup/restore. Blocked by 6 and 7.
9. Windows portable release and end-to-end acceptance. Blocked by 1 through 8.

## 12. Definition of Done

- Product and development requirements are implemented against the approved v4 UI baseline.
- Domain behavior is covered by PlanningService tests.
- Import, persistence, Scenario and report flows have integration coverage.
- Main Planner workflows pass Playwright tests.
- Portable ZIP starts on a clean writable Windows folder.
- No assignment can bypass qualification, availability or duplicate-person constraints.
- A Planner can recover the plan from a local backup.
