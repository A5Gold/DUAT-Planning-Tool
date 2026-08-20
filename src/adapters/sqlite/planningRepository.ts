import type Database from "better-sqlite3";
import type {
  Assignment,
  ISODate,
  Location,
  NightPlan,
  PlanningData,
  PlanningRepository,
  PlanningState,
  Qualification,
  QualificationType,
  RosterEntry,
  RosterStatus,
  Scenario,
  Staff,
  Team,
  Work,
} from "../../domain/planning";

export interface VersionedPlanningAggregate {
  readonly state: PlanningState;
  readonly revision: number;
}

export interface PlanningContextSnapshot extends VersionedPlanningAggregate {
  readonly data: PlanningData;
}

export class AggregateRevisionConflictError extends Error {
  readonly code = "AGGREGATE_REVISION_CONFLICT";

  constructor(
    readonly planningDate: ISODate,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super(
      `Planning aggregate ${planningDate} revision conflict: expected ` +
        `${expectedRevision ?? "new"}, found ${actualRevision ?? "missing"}.`,
    );
    this.name = "AggregateRevisionConflictError";
  }
}

interface RevisionRow {
  revision: number;
}

interface AggregateRow {
  planning_date: string;
  revision: number;
  active_scenario_id: string;
}

interface StaffRow {
  staff_number: string;
  display_name: string;
  team: Team;
  active: number;
  is_supervisor: number;
  is_general_employee: number;
}

interface QualificationRow {
  staff_number: string;
  qualification_type: QualificationType;
  issue_date: string;
  expiry_date: string;
}

interface RosterRow {
  planning_date: string;
  staff_number: string;
  status: RosterStatus | null;
  available: number | null;
  reason: string | null;
}

interface PlanRow {
  storage_id: string;
  domain_id: string;
  plan_date: string;
  plan_kind: "main" | "scenario";
}

interface ScenarioRow {
  scenario_id: string;
  display_name: string;
  plan_storage_id: string;
  temporary: number;
  created_at: string | null;
  updated_at: string | null;
}

interface WorkRow {
  domain_id: string;
  slot: 1 | 2 | 3 | 4;
  active: number;
  project_code: string;
  work_type: Work["type"];
  job_description: string;
  remarks: string;
}

interface LocationRow {
  domain_id: string;
  work_id: string;
  sequence: number;
  location_name: string;
  isolation_point: string;
  earthing_point: string;
  minimum_total_headcount: number;
  ap_count: number;
  cp_count: number;
}

interface AssignmentRow {
  domain_id: string;
  staff_number: string;
  work_id: string;
  location_id: string | null;
  assignment_role: Assignment["role"];
  qualification_used: QualificationType | null;
  assignment_source: Assignment["source"] | null;
}

function asBoolean(value: number): boolean {
  return value === 1;
}

function storageId(date: ISODate, scenarioId: "main" | string): string {
  return `${date}\u0000${scenarioId}`;
}

function validateAggregateShape(state: PlanningState): void {
  if (state.main.date !== state.date) {
    throw new Error(`Main plan date ${state.main.date} does not match aggregate date ${state.date}.`);
  }
  if (state.main.works.length !== 4 || new Set(state.main.works.map((work) => work.slot)).size !== 4) {
    throw new Error("A planning aggregate main plan must contain exactly Work slots 1 through 4.");
  }
  const scenarioIds = new Set<string>();
  for (const scenario of state.scenarios) {
    if (scenario.id === "main" || scenarioIds.has(scenario.id)) {
      throw new Error(`Scenario id "${scenario.id}" is reserved or duplicated.`);
    }
    scenarioIds.add(scenario.id);
    if (scenario.plan.date !== state.date) {
      throw new Error(`Scenario ${scenario.id} plan date does not match aggregate date ${state.date}.`);
    }
  }
  if (state.activeScenarioId !== "main" && !scenarioIds.has(state.activeScenarioId)) {
    throw new Error(`Active scenario "${state.activeScenarioId}" does not exist in the aggregate.`);
  }
}

export class SqlitePlanningRepository implements PlanningRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  close(): void {
    if (this.database.open) this.database.close();
  }

  getStaff(): readonly Staff[] {
    return this.database
      .prepare<[], StaffRow>(
        `SELECT staff_number, display_name, team, active, is_supervisor, is_general_employee
         FROM staff ORDER BY team, staff_number`,
      )
      .all()
      .map((row) => ({
        staffNumber: row.staff_number,
        name: row.display_name,
        team: row.team,
        active: asBoolean(row.active),
        isSupervisor: asBoolean(row.is_supervisor),
        isGeneralEmployee: asBoolean(row.is_general_employee),
      }));
  }

  getQualifications(staffNumber: string): readonly Qualification[] {
    return this.database
      .prepare<[string], QualificationRow>(
        `SELECT staff_number, qualification_type, issue_date, expiry_date
         FROM qualifications WHERE staff_number = ?
         ORDER BY qualification_type, expiry_date DESC`,
      )
      .all(staffNumber)
      .map((row) => ({
        type: row.qualification_type,
        expiryDate: row.expiry_date,
        issueDate: row.issue_date || undefined,
      }));
  }

  getRosterEntry(date: ISODate, staffNumber: string): RosterEntry | undefined {
    const row = this.database
      .prepare<[string, string], RosterRow>(
        `SELECT planning_date, staff_number, status, available, reason
         FROM roster_entries WHERE planning_date = ? AND staff_number = ?`,
      )
      .get(date.slice(0, 10), staffNumber);
    return row ? this.mapRosterRow(row) : undefined;
  }

  getRosterEntries(): readonly RosterEntry[] {
    return this.database
      .prepare<[], RosterRow>(
        `SELECT planning_date, staff_number, status, available, reason
         FROM roster_entries ORDER BY planning_date, staff_number`,
      )
      .all()
      .map((row) => this.mapRosterRow(row));
  }

  loadPlanningData(date?: ISODate): PlanningData {
    const staff = this.getStaff();
    const qualificationRows = this.database
      .prepare<[], QualificationRow>(
        `SELECT staff_number, qualification_type, issue_date, expiry_date
         FROM qualifications ORDER BY staff_number, qualification_type, expiry_date DESC`,
      )
      .all();
    const qualifications = qualificationRows.map((row) => ({
      staffNumber: row.staff_number,
      type: row.qualification_type,
      expiryDate: row.expiry_date,
      issueDate: row.issue_date || undefined,
    }));
    const roster = date
      ? this.database
          .prepare<[string], RosterRow>(
            `SELECT planning_date, staff_number, status, available, reason
             FROM roster_entries WHERE planning_date = ? ORDER BY staff_number`,
          )
          .all(date.slice(0, 10))
          .map((row) => this.mapRosterRow(row))
      : this.getRosterEntries();
    return { staff, qualifications, roster };
  }

  savePlanningData(data: PlanningData): void {
    this.database.transaction(() => {
      const upsertStaff = this.database.prepare(
        `INSERT INTO staff (
           staff_number, display_name, team, active, is_supervisor, is_general_employee
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(staff_number) DO UPDATE SET
           display_name = excluded.display_name,
           team = excluded.team,
           active = excluded.active,
           is_supervisor = excluded.is_supervisor,
           is_general_employee = excluded.is_general_employee`,
      );
      for (const staff of data.staff) {
        upsertStaff.run(
          staff.staffNumber,
          staff.name,
          staff.team,
          staff.active === false ? 0 : 1,
          staff.isSupervisor ? 1 : 0,
          staff.isGeneralEmployee ? 1 : 0,
        );
      }

      const upsertQualification = this.database.prepare(
        `INSERT INTO qualifications (
           staff_number, qualification_type, issue_date, expiry_date
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(staff_number, qualification_type, issue_date, expiry_date) DO NOTHING`,
      );
      for (const staff of data.staff) {
        for (const qualification of staff.qualifications ?? []) {
          upsertQualification.run(
            staff.staffNumber,
            qualification.type,
            qualification.issueDate ?? "",
            qualification.expiryDate,
          );
        }
      }
      for (const qualification of data.qualifications ?? []) {
        upsertQualification.run(
          qualification.staffNumber,
          qualification.type,
          qualification.issueDate ?? "",
          qualification.expiryDate,
        );
      }

      const upsertRoster = this.database.prepare(
        `INSERT INTO roster_entries (
           planning_date, staff_number, status, available, reason
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(planning_date, staff_number) DO UPDATE SET
           status = excluded.status,
           available = excluded.available,
           reason = excluded.reason`,
      );
      for (const entry of data.roster ?? []) {
        upsertRoster.run(
          entry.date.slice(0, 10),
          entry.staffNumber,
          entry.status ?? null,
          entry.available === undefined ? null : entry.available ? 1 : 0,
          entry.reason ?? null,
        );
      }
    }).immediate();
  }

  loadAggregate(date: ISODate): VersionedPlanningAggregate | undefined {
    const aggregate = this.database
      .prepare<[string], AggregateRow>(
        `SELECT planning_date, revision, active_scenario_id
         FROM planning_aggregates WHERE planning_date = ?`,
      )
      .get(date.slice(0, 10));
    if (!aggregate) return undefined;

    const plans = this.database
      .prepare<[string], PlanRow>(
        `SELECT storage_id, domain_id, plan_date, plan_kind
         FROM night_plans WHERE aggregate_date = ? ORDER BY plan_kind, storage_id`,
      )
      .all(aggregate.planning_date);
    const mainRow = plans.find((plan) => plan.plan_kind === "main");
    if (!mainRow) throw new Error(`Planning aggregate ${aggregate.planning_date} has no main plan.`);

    const scenarioRows = this.database
      .prepare<[string], ScenarioRow>(
        `SELECT scenario_id, display_name, plan_storage_id, temporary, created_at, updated_at
         FROM scenarios WHERE aggregate_date = ? ORDER BY rowid`,
      )
      .all(aggregate.planning_date);
    const planByStorageId = new Map(plans.map((plan) => [plan.storage_id, plan]));
    const scenarios: Scenario[] = scenarioRows.map((row) => {
      const planRow = planByStorageId.get(row.plan_storage_id);
      if (!planRow) throw new Error(`Scenario ${row.scenario_id} references a missing plan.`);
      return {
        id: row.scenario_id,
        name: row.display_name,
        plan: this.loadPlan(planRow),
        temporary: asBoolean(row.temporary),
        createdAt: row.created_at ?? undefined,
        updatedAt: row.updated_at ?? undefined,
      };
    });

    return {
      revision: aggregate.revision,
      state: {
        date: aggregate.planning_date,
        main: this.loadPlan(mainRow),
        scenarios,
        activeScenarioId: aggregate.active_scenario_id,
      },
    };
  }

  loadContext(date: ISODate): PlanningContextSnapshot | undefined {
    const aggregate = this.loadAggregate(date);
    return aggregate ? { ...aggregate, data: this.loadPlanningData(date) } : undefined;
  }

  saveAggregate(state: PlanningState, expectedRevision: number | null = null): VersionedPlanningAggregate {
    validateAggregateShape(state);
    const date = state.date.slice(0, 10);
    return this.database.transaction(() => {
      const current = this.database
        .prepare<[string], RevisionRow>(
          "SELECT revision FROM planning_aggregates WHERE planning_date = ?",
        )
        .get(date);
      const actualRevision = current?.revision ?? null;
      // Application contracts commonly represent a never-persisted aggregate as
      // revision 0, while the repository API also accepts null explicitly.
      const revisionMatches =
        actualRevision === null
          ? expectedRevision === null || expectedRevision === 0
          : actualRevision === expectedRevision;
      if (!revisionMatches) {
        throw new AggregateRevisionConflictError(date, expectedRevision, actualRevision);
      }

      const revision = (actualRevision ?? 0) + 1;
      if (actualRevision === null) {
        this.database
          .prepare(
            `INSERT INTO planning_aggregates (
               planning_date, revision, active_scenario_id, updated_at
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(date, revision, state.activeScenarioId, this.now());
      } else {
        const updated = this.database
          .prepare(
            `UPDATE planning_aggregates
             SET revision = ?, active_scenario_id = ?, updated_at = ?
             WHERE planning_date = ? AND revision = ?`,
          )
          .run(revision, state.activeScenarioId, this.now(), date, expectedRevision);
        if (updated.changes !== 1) {
          const latest = this.database
            .prepare<[string], RevisionRow>(
              "SELECT revision FROM planning_aggregates WHERE planning_date = ?",
            )
            .get(date);
          throw new AggregateRevisionConflictError(date, expectedRevision, latest?.revision ?? null);
        }
        this.database.prepare("DELETE FROM night_plans WHERE aggregate_date = ?").run(date);
      }

      this.insertPlan(date, "main", state.main);
      for (const scenario of state.scenarios) {
        const planStorageId = this.insertPlan(date, scenario.id, scenario.plan);
        this.database
          .prepare(
            `INSERT INTO scenarios (
               aggregate_date, scenario_id, display_name, plan_storage_id,
               temporary, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            date,
            scenario.id,
            scenario.name,
            planStorageId,
            scenario.temporary ? 1 : 0,
            scenario.createdAt ?? null,
            scenario.updatedAt ?? null,
          );
      }

      return { state, revision };
    }).immediate();
  }

  /** Short aliases for application services that treat the repository as an aggregate store. */
  load(date: ISODate): VersionedPlanningAggregate | undefined {
    return this.loadAggregate(date);
  }

  save(state: PlanningState, expectedRevision: number | null = null): VersionedPlanningAggregate {
    return this.saveAggregate(state, expectedRevision);
  }

  loadState(date: ISODate): VersionedPlanningAggregate | undefined {
    return this.loadAggregate(date);
  }

  saveState(state: PlanningState, expectedRevision: number | null = null): VersionedPlanningAggregate {
    return this.saveAggregate(state, expectedRevision);
  }

  private mapRosterRow(row: RosterRow): RosterEntry {
    return {
      date: row.planning_date,
      staffNumber: row.staff_number,
      status: row.status ?? undefined,
      available: row.available === null ? undefined : asBoolean(row.available),
      reason: row.reason ?? undefined,
    };
  }

  private insertPlan(aggregateDate: string, scenarioId: "main" | string, plan: NightPlan): string {
    const planStorageId = storageId(aggregateDate, scenarioId);
    this.database
      .prepare(
        `INSERT INTO night_plans (storage_id, aggregate_date, domain_id, plan_date, plan_kind)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        planStorageId,
        aggregateDate,
        plan.id,
        plan.date,
        scenarioId === "main" ? "main" : "scenario",
      );

    const insertWork = this.database.prepare(
      `INSERT INTO works (
         plan_storage_id, domain_id, slot, active, project_code,
         work_type, job_description, remarks
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertLocation = this.database.prepare(
      `INSERT INTO locations (
         plan_storage_id, domain_id, work_id, sequence, location_name,
         isolation_point, earthing_point, minimum_total_headcount, ap_count, cp_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const work of plan.works) {
      insertWork.run(
        planStorageId,
        work.id,
        work.slot,
        work.active ? 1 : 0,
        work.projectCode,
        work.type,
        work.jobDescription,
        work.remarks,
      );
      for (const location of work.locations) {
        insertLocation.run(
          planStorageId,
          location.id,
          work.id,
          location.sequence,
          location.locationName,
          location.isolationPoint,
          location.earthingPoint,
          location.minimumTotalHeadcount,
          location.demand?.apCount ?? 1,
          location.demand?.cpCount ?? 1,
        );
      }
    }

    const insertAssignment = this.database.prepare(
      `INSERT INTO assignments (
         plan_storage_id, domain_id, staff_number, work_id, location_id,
         assignment_role, qualification_used, assignment_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const assignment of plan.assignments) {
      insertAssignment.run(
        planStorageId,
        assignment.id,
        assignment.staffNumber,
        assignment.workId,
        assignment.locationId ?? null,
        assignment.role,
        assignment.qualificationUsed ?? null,
        assignment.source ?? null,
      );
    }
    return planStorageId;
  }

  private loadPlan(row: PlanRow): NightPlan {
    const workRows = this.database
      .prepare<[string], WorkRow>(
        `SELECT domain_id, slot, active, project_code, work_type, job_description, remarks
         FROM works WHERE plan_storage_id = ? ORDER BY slot`,
      )
      .all(row.storage_id);
    const locationRows = this.database
      .prepare<[string], LocationRow>(
        `SELECT domain_id, work_id, sequence, location_name, isolation_point, earthing_point,
                minimum_total_headcount, ap_count, cp_count
         FROM locations WHERE plan_storage_id = ? ORDER BY work_id, sequence`,
      )
      .all(row.storage_id);
    const locationsByWork = new Map<string, Location[]>();
    for (const location of locationRows) {
      const rows = locationsByWork.get(location.work_id) ?? [];
      rows.push({
        id: location.domain_id,
        sequence: location.sequence,
        locationName: location.location_name,
        isolationPoint: location.isolation_point,
        earthingPoint: location.earthing_point,
        minimumTotalHeadcount: location.minimum_total_headcount,
        demand: { apCount: location.ap_count, cpCount: location.cp_count },
      });
      locationsByWork.set(location.work_id, rows);
    }
    const works: Work[] = workRows.map((work) => ({
      id: work.domain_id,
      slot: work.slot,
      active: asBoolean(work.active),
      projectCode: work.project_code,
      type: work.work_type,
      jobDescription: work.job_description,
      remarks: work.remarks,
      locations: locationsByWork.get(work.domain_id) ?? [],
    }));
    const assignments: Assignment[] = this.database
      .prepare<[string], AssignmentRow>(
        `SELECT domain_id, staff_number, work_id, location_id, assignment_role,
                qualification_used, assignment_source
         FROM assignments WHERE plan_storage_id = ? ORDER BY rowid`,
      )
      .all(row.storage_id)
      .map((assignment) => ({
        id: assignment.domain_id,
        staffNumber: assignment.staff_number,
        workId: assignment.work_id,
        role: assignment.assignment_role,
        locationId: assignment.location_id ?? undefined,
        qualificationUsed: assignment.qualification_used ?? undefined,
        source: assignment.assignment_source ?? undefined,
      }));
    return { id: row.domain_id, date: row.plan_date, works, assignments };
  }
}
