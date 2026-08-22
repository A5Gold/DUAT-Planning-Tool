/**
 * Pure planning domain seam.
 *
 * This module deliberately has no Electron, SQLite, Excel or React dependency.
 * The renderer can use the immutable mutation methods while the main process
 * can later provide the same PlanningData from its repositories.
 */

export type ISODate = string;

export type Team = "S1" | "S2" | "S3" | "S4" | "S5";
export type WorkType = "Possession" | "PA Work";
export type AssignmentRole = "AP" | "CP" | "一般員工";
export type QualificationType = "AP" | "CP(P)" | "CP(T)" | "SIL" | "DUAT";

export const WORK_TYPES = {
  possession: "Possession" as WorkType,
  paWork: "PA Work" as WorkType,
} as const;

export const ASSIGNMENT_ROLES = {
  ap: "AP" as AssignmentRole,
  cp: "CP" as AssignmentRole,
  generalEmployee: "一般員工" as AssignmentRole,
} as const;

export const QUALIFICATION_TYPES = {
  ap: "AP" as QualificationType,
  cpPossession: "CP(P)" as QualificationType,
  cpPaWork: "CP(T)" as QualificationType,
  sil: "SIL" as QualificationType,
  duat: "DUAT" as QualificationType,
} as const;

export interface Qualification {
  type: QualificationType;
  expiryDate: ISODate;
  issueDate?: ISODate;
}

export interface Staff {
  staffNumber: string;
  name: string;
  team: Team;
  active?: boolean;
  isSupervisor?: boolean;
  /** Optional convenience field for adapters that already join qualifications. */
  qualifications?: readonly Qualification[];
  /** Use this when a source explicitly marks a person as a general employee. */
  isGeneralEmployee?: boolean;
}

export type RosterStatus =
  | "available"
  | "night-duty"
  | "unavailable"
  | "leave"
  | "sickness"
  | "training"
  | "day-duty"
  | "unknown";

export interface RosterEntry {
  date: ISODate;
  staffNumber: string;
  status?: RosterStatus;
  /** `available: false` is accepted for simple roster adapters. */
  available?: boolean;
  reason?: string;
}

export interface PlanningData {
  staff: readonly Staff[];
  /** Qualification rows may be kept separate from Staff by the Excel adapter. */
  qualifications?: readonly (Qualification & { staffNumber: string })[];
  roster?: readonly RosterEntry[];
}

/** Repository port used by the main-process adapters and in-memory tests. */
export interface PlanningRepository {
  getStaff(): readonly Staff[];
  getQualifications(staffNumber: string): readonly Qualification[];
  getRosterEntry(date: ISODate, staffNumber: string): RosterEntry | undefined;
  getRosterEntries?(): readonly RosterEntry[];
}

/** Small repository implementation for unit tests and renderer mock data. */
export class InMemoryPlanningRepository implements PlanningRepository {
  constructor(private readonly data: PlanningData) {}

  getStaff(): readonly Staff[] {
    return this.data.staff;
  }

  getQualifications(staffNumber: string): readonly Qualification[] {
    const joined = this.data.staff.find((staff) => staff.staffNumber === staffNumber)?.qualifications ?? [];
    const rows = (this.data.qualifications ?? [])
      .filter((qualification) => qualification.staffNumber === staffNumber)
      .map(({ staffNumber: _staffNumber, ...qualification }) => qualification);
    return [...joined, ...rows];
  }

  getRosterEntry(date: ISODate, staffNumber: string): RosterEntry | undefined {
    const targetDate = dateOnly(date);
    return (this.data.roster ?? []).find(
      (entry) => dateOnly(entry.date) === targetDate && entry.staffNumber === staffNumber,
    );
  }

  getRosterEntries(): readonly RosterEntry[] {
    return this.data.roster ?? [];
  }
}

export interface LocationDemand {
  apCount: number;
  cpCount: number;
}

export interface Location {
  id: string;
  sequence: number;
  locationName: string;
  isolationPoint: string;
  earthingPoint: string;
  minimumTotalHeadcount: number;
  /** Defaults to one AP and one CP when omitted. */
  demand?: Partial<LocationDemand>;
}

export interface Work {
  id: string;
  slot: 1 | 2 | 3 | 4 | 5;
  active: boolean;
  projectCode: string;
  type: WorkType;
  jobDescription: string;
  remarks: string;
  locations: readonly Location[];
}

export interface Assignment {
  id: string;
  staffNumber: string;
  workId: string;
  role: AssignmentRole;
  /** AP/CP assignments must identify a Location. General employees must not. */
  locationId?: string;
  qualificationUsed?: QualificationType;
  source?: "manual" | "suggestion";
}

export interface NightPlan {
  id: string;
  date: ISODate;
  /** A plan always contains Work 1 through Work 5, with the first two active by default. */
  works: readonly Work[];
  assignments: readonly Assignment[];
}

export interface Scenario {
  id: string;
  name: string;
  plan: NightPlan;
  temporary: boolean;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}

export interface PlanningState {
  date: ISODate;
  main: NightPlan;
  scenarios: readonly Scenario[];
  /** Switching this value never changes `main`; Apply is required. */
  activeScenarioId: "main" | string;
}

export interface ValidationOptions {
  /** S1 is a support team and is only eligible when the Planner enables it. */
  allowS1Support?: boolean;
  /** Supervisor personnel are excluded unless explicitly enabled. */
  allowSupervisors?: boolean;
  /** A supervisor assignment must carry a non-empty reason/remark. */
  supervisorRemark?: string;
}

/** Policy port alias. A future rules adapter can provide these defaults. */
export type PlanningPolicy = ValidationOptions;

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
  | "WORK_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "STAFF_NOT_FOUND"
  | "STAFF_INACTIVE"
  | "S1_SUPPORT_NOT_ENABLED"
  | "SUPERVISOR_NOT_ENABLED"
  | "SUPERVISOR_REMARK_REQUIRED"
  | "ROSTER_UNAVAILABLE"
  | "QUALIFICATION_REQUIRED"
  | "QUALIFICATION_EXPIRED"
  | "AP_QUALIFICATION_REQUIRED"
  | "CP_P_QUALIFICATION_REQUIRED"
  | "CP_T_OR_CP_P_QUALIFICATION_REQUIRED"
  | "LOCATION_AP_REQUIRED"
  | "LOCATION_CP_REQUIRED"
  | "LOCATION_AP_OVERALLOCATED"
  | "LOCATION_CP_OVERALLOCATED"
  | "AP_CP_SAME_PERSON"
  | "DUPLICATE_ASSIGNMENT"
  | "GENERAL_EMPLOYEE_LOCATION_FORBIDDEN"
  | "GENERAL_EMPLOYEE_QUALIFICATION_FORBIDDEN"
  | "GENERAL_EMPLOYEE_HEADCOUNT_SHORTAGE"
  | "MIN_HEADCOUNT_SHORTAGE"
  | "WORK_NOT_ACTIVE"
  | "SCENARIO_NOT_FOUND"
  | "SCENARIO_DELETE_FORBIDDEN"
  | "SCENARIO_APPLY_FORBIDDEN";

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  /** Blocking issues reject an assignment mutation; shortages remain editable. */
  blocking: boolean;
  message: string;
  workId?: string;
  locationId?: string;
  staffNumber?: string;
  assignmentId?: string;
  role?: AssignmentRole;
}

export interface ValidationSummary {
  workId: string;
  locationId?: string;
  role: AssignmentRole;
  required: number;
  assigned: number;
  missing: number;
}

export interface ValidationReport {
  valid: boolean;
  issues: readonly ValidationIssue[];
  summaries: readonly ValidationSummary[];
}

export interface AssignmentRequest {
  staffNumber: string;
  workId: string;
  role: AssignmentRole;
  locationId?: string;
  /** Optional requested qualification; CP suggestions fill this automatically. */
  qualificationUsed?: QualificationType;
  source?: Assignment["source"];
}

export interface AssignmentMutation {
  accepted: boolean;
  plan: NightPlan;
  report: ValidationReport;
  assignment?: Assignment;
}

export interface Candidate {
  staff: Staff;
  qualificationUsed?: QualificationType;
}

/** Public service contract consumed by IPC/application adapters. */
export interface PlanningServiceApi {
  validateAssignment(
    plan: NightPlan,
    request: AssignmentRequest,
    options?: ValidationOptions,
  ): ValidationReport;
  assign(plan: NightPlan, request: AssignmentRequest, options?: ValidationOptions): AssignmentMutation;
  removeAssignment(plan: NightPlan, assignmentId: string): NightPlan;
  validatePlan(plan: NightPlan, options?: ValidationOptions): ValidationReport;
  candidates(
    plan: NightPlan,
    request: Pick<AssignmentRequest, "workId" | "role" | "locationId">,
    options?: ValidationOptions,
  ): readonly Candidate[];
  switchScenario(state: PlanningState, scenarioId: "main" | string): PlanningState;
  applyScenario(state: PlanningState, scenarioId: string): PlanningState;
}

const BLOCKING_CODES = new Set<ValidationCode>([
  "WORK_NOT_FOUND",
  "LOCATION_NOT_FOUND",
  "STAFF_NOT_FOUND",
  "STAFF_INACTIVE",
  "S1_SUPPORT_NOT_ENABLED",
  "SUPERVISOR_NOT_ENABLED",
  "SUPERVISOR_REMARK_REQUIRED",
  "ROSTER_UNAVAILABLE",
  "QUALIFICATION_REQUIRED",
  "QUALIFICATION_EXPIRED",
  "AP_QUALIFICATION_REQUIRED",
  "CP_P_QUALIFICATION_REQUIRED",
  "CP_T_OR_CP_P_QUALIFICATION_REQUIRED",
  "LOCATION_AP_OVERALLOCATED",
  "LOCATION_CP_OVERALLOCATED",
  "AP_CP_SAME_PERSON",
  "DUPLICATE_ASSIGNMENT",
  "GENERAL_EMPLOYEE_LOCATION_FORBIDDEN",
  "GENERAL_EMPLOYEE_QUALIFICATION_FORBIDDEN",
  "WORK_NOT_ACTIVE",
]);

// Shortages are red inline warnings in the workbench but do not block a
// Planner from adding the next assignment while a Location is incomplete.
const RED_WARNING_CODES = new Set<ValidationCode>([
  "LOCATION_AP_REQUIRED",
  "LOCATION_CP_REQUIRED",
  "MIN_HEADCOUNT_SHORTAGE",
  "GENERAL_EMPLOYEE_HEADCOUNT_SHORTAGE",
]);

const ROLE_QUALIFICATIONS: Record<AssignmentRole, readonly QualificationType[]> = {
  AP: ["AP"],
  CP: ["CP(P)", "CP(T)"],
  一般員工: [],
};

function cloneLocation(location: Location): Location {
  return {
    ...location,
    demand: location.demand ? { ...location.demand } : undefined,
  };
}

function cloneWork(work: Work): Work {
  return { ...work, locations: work.locations.map(cloneLocation) };
}

function clonePlan(plan: NightPlan): NightPlan {
  return {
    ...plan,
    works: plan.works.map(cloneWork),
    assignments: plan.assignments.map((assignment) => ({ ...assignment })),
  };
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function isQualificationExpired(qualification: Qualification, planningDate: ISODate): boolean {
  // Qualification expiry is inclusive: it remains valid on the expiry date.
  return dateOnly(planningDate) > dateOnly(qualification.expiryDate);
}

function defaultDemand(location: Location): LocationDemand {
  return {
    apCount: location.demand?.apCount ?? 1,
    cpCount: location.demand?.cpCount ?? 1,
  };
}

function issue(
  code: ValidationCode,
  message: string,
  details: Omit<ValidationIssue, "code" | "message" | "severity" | "blocking"> = {},
): ValidationIssue {
  return {
    code,
    severity: BLOCKING_CODES.has(code) || RED_WARNING_CODES.has(code) ? "error" : "warning",
    blocking: BLOCKING_CODES.has(code),
    message,
    ...details,
  };
}

function activeWork(plan: NightPlan, workId: string): Work | undefined {
  return plan.works.find((work) => work.id === workId);
}

function activeLocation(plan: NightPlan, workId: string, locationId: string): Location | undefined {
  return activeWork(plan, workId)?.locations.find((location) => location.id === locationId);
}

function makeAssignmentId(request: AssignmentRequest): string {
  const locationPart = request.locationId ?? "work";
  return `${request.workId}:${locationPart}:${request.role}:${request.staffNumber}`;
}

/** Construct a four-Work plan with no Locations or assignments. */
export function createEmptyNightPlan(date: ISODate, id = `night:${date}`): NightPlan {
  const works: Work[] = ([1, 2, 3, 4, 5] as const).map((slot) => ({
    id: `${id}:work-${slot}`,
    slot,
    active: slot <= 2,
    projectCode: "",
    type: "Possession",
    jobDescription: "",
    remarks: "",
    locations: [],
  }));
  return { id, date, works, assignments: [] };
}

export function createLocation(
  id: string,
  sequence: number,
  overrides: Partial<Omit<Location, "id" | "sequence">> = {},
): Location {
  return {
    id,
    sequence,
    locationName: "",
    isolationPoint: "",
    earthingPoint: "",
    minimumTotalHeadcount: 2,
    ...overrides,
  };
}

export function createPlanningState(date: ISODate): PlanningState {
  return {
    date,
    main: createEmptyNightPlan(date),
    scenarios: [],
    activeScenarioId: "main",
  };
}

/**
 * The service is intentionally stateless. Repositories can be replaced with
 * in-memory fixtures in unit tests and with SQLite/IPC adapters in production.
 */
export class PlanningService implements PlanningServiceApi {
  private readonly data: PlanningData;
  private readonly defaultOptions: ValidationOptions;
  private readonly repository?: PlanningRepository;
  private readonly staffByNumber: ReadonlyMap<string, Staff>;
  private readonly qualificationsByStaff: ReadonlyMap<string, readonly Qualification[]>;
  private readonly rosterByDateAndStaff: ReadonlyMap<string, RosterEntry>;

  constructor(source: PlanningData | PlanningRepository, defaultOptions: ValidationOptions = {}) {
    this.defaultOptions = { ...defaultOptions };
    this.repository = "staff" in source ? undefined : source;
    const data: PlanningData = "staff" in source
      ? source
      : {
          staff: source.getStaff(),
          qualifications: source.getStaff().flatMap((staff) =>
            source.getQualifications(staff.staffNumber).map((qualification) => ({
              ...qualification,
              staffNumber: staff.staffNumber,
            })),
          ),
          roster: source.getRosterEntries?.() ?? [],
        };
    this.data = data;
    this.staffByNumber = new Map(data.staff.map((staff) => [staff.staffNumber, staff]));

    const qualificationMap = new Map<string, Qualification[]>();
    for (const staff of data.staff) {
      qualificationMap.set(staff.staffNumber, [...(staff.qualifications ?? [])]);
    }
    for (const qualification of data.qualifications ?? []) {
      const rows = qualificationMap.get(qualification.staffNumber) ?? [];
      rows.push({
        type: qualification.type,
        expiryDate: qualification.expiryDate,
        issueDate: qualification.issueDate,
      });
      qualificationMap.set(qualification.staffNumber, rows);
    }
    this.qualificationsByStaff = new Map(
      [...qualificationMap.entries()].map(([staffNumber, qualifications]) => [
        staffNumber,
        qualifications,
      ]),
    );
    this.rosterByDateAndStaff = new Map(
      (data.roster ?? []).map((entry) => [`${dateOnly(entry.date)}:${entry.staffNumber}`, entry]),
    );
  }

  private effectiveOptions(options: ValidationOptions): ValidationOptions {
    return { ...this.defaultOptions, ...options };
  }

  getStaff(staffNumber: string): Staff | undefined {
    return this.staffByNumber.get(staffNumber);
  }

  getQualifications(staffNumber: string): readonly Qualification[] {
    return this.qualificationsByStaff.get(staffNumber) ?? [];
  }

  isRosterAvailable(date: ISODate, staffNumber: string): boolean {
    const entry = this.getRosterEntry(date, staffNumber);
    // Missing roster data is unknown, never an implicit supply source.
    if (!entry) return false;
    if (entry.available === false) return false;
    return entry.status === "available" || entry.status === "night-duty";
  }

  getRosterEntry(date: ISODate, staffNumber: string): RosterEntry | undefined {
    return (
      this.rosterByDateAndStaff.get(`${dateOnly(date)}:${staffNumber}`) ??
      this.repository?.getRosterEntry(date, staffNumber)
    );
  }

  isQualificationValid(
    staffNumber: string,
    type: QualificationType,
    planningDate: ISODate,
  ): boolean {
    return this.getQualifications(staffNumber).some(
      (qualification) =>
        qualification.type === type && !isQualificationExpired(qualification, planningDate),
    );
  }

  /** Return the best CP type for a Work. CP(T) is preferred for PA Work. */
  preferredCpQualification(
    staffNumber: string,
    workType: WorkType,
    planningDate: ISODate,
  ): QualificationType | undefined {
    const preferred: readonly QualificationType[] =
      workType === "PA Work" ? ["CP(T)", "CP(P)"] : ["CP(P)"];
    return preferred.find((type) => this.isQualificationValid(staffNumber, type, planningDate));
  }

  private staffQualificationState(
    staffNumber: string,
    accepted: readonly QualificationType[],
    planningDate: ISODate,
  ): { valid?: QualificationType; expired: boolean; hasRecord: boolean } {
    const qualifications = this.getQualifications(staffNumber).filter((qualification) =>
      accepted.includes(qualification.type),
    );
    const valid = qualifications.find((qualification) => !isQualificationExpired(qualification, planningDate));
    return {
      valid: valid?.type,
      expired: qualifications.length > 0 && !valid,
      hasRecord: qualifications.length > 0,
    };
  }

  private validateStaffForAssignment(
    plan: NightPlan,
    request: AssignmentRequest,
    options: ValidationOptions,
  ): ValidationIssue[] {
    const work = activeWork(plan, request.workId);
    if (!work) return [issue("WORK_NOT_FOUND", "找不到指定 Work。", { workId: request.workId })];
    if (!work.active) {
      return [issue("WORK_NOT_ACTIVE", "未啟用的 Work 不可分配人員。", { workId: request.workId })];
    }

    const location = request.locationId
      ? activeLocation(plan, request.workId, request.locationId)
      : undefined;
    if (request.role === "一般員工") {
      if (request.locationId) {
        return [
          issue("GENERAL_EMPLOYEE_LOCATION_FORBIDDEN", "一般員工只能分配至 Work 層級。", {
            workId: request.workId,
            locationId: request.locationId,
            role: request.role,
          }),
        ];
      }
    } else if (!location) {
      return [
        issue("LOCATION_NOT_FOUND", "AP 或 CP 分配必須指定有效 Location。", {
          workId: request.workId,
          locationId: request.locationId,
          role: request.role,
        }),
      ];
    }
    if (request.locationId && !location) {
      return [
        issue("LOCATION_NOT_FOUND", "找不到指定 Location。", {
          workId: request.workId,
          locationId: request.locationId,
          role: request.role,
        }),
      ];
    }

    const staff = this.getStaff(request.staffNumber);
    if (!staff) {
      return [
        issue("STAFF_NOT_FOUND", "找不到指定人員。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }
    if (staff.active === false) {
      return [
        issue("STAFF_INACTIVE", "人員已停用。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }
    if (staff.team === "S1" && !options.allowS1Support) {
      return [
        issue("S1_SUPPORT_NOT_ENABLED", "S1 人員必須先啟用支援後才可分配。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }
    if (staff.isSupervisor && !options.allowSupervisors) {
      return [
        issue("SUPERVISOR_NOT_ENABLED", "Sup. 人員必須明確加入後才可分配。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }
    if (staff.isSupervisor && options.allowSupervisors && !options.supervisorRemark?.trim()) {
      return [
        issue("SUPERVISOR_REMARK_REQUIRED", "加入 Sup. 人員時必須記錄 Remarks。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }
    if (!this.isRosterAvailable(plan.date, staff.staffNumber)) {
      return [
        issue("ROSTER_UNAVAILABLE", "Roster 顯示人員當晚不可用。", {
          workId: request.workId,
          locationId: request.locationId,
          staffNumber: request.staffNumber,
          role: request.role,
        }),
      ];
    }

    if (request.role === "一般員工") {
      const hasOperationalQualification = this.getQualifications(staff.staffNumber).some((qualification) =>
        ROLE_QUALIFICATIONS.AP.includes(qualification.type) ||
        ROLE_QUALIFICATIONS.CP.includes(qualification.type),
      );
      if (staff.isGeneralEmployee === false || hasOperationalQualification) {
        return [
          issue("GENERAL_EMPLOYEE_QUALIFICATION_FORBIDDEN", "具 AP 或 CP 資格的人員不可當作一般員工分配。", {
            workId: request.workId,
            staffNumber: request.staffNumber,
            role: request.role,
          }),
        ];
      }
      return [];
    }

    const acceptedQualifications =
      request.role === "AP"
        ? ["AP" as QualificationType]
        : work.type === "Possession"
          ? ["CP(P)" as QualificationType]
          : (["CP(T)", "CP(P)"] as QualificationType[]);
    const qualificationState = this.staffQualificationState(
      staff.staffNumber,
      acceptedQualifications,
      plan.date,
    );
    if (!qualificationState.valid) {
      const qualificationCode: ValidationCode =
        request.role === "AP"
          ? "AP_QUALIFICATION_REQUIRED"
          : work.type === "Possession"
            ? "CP_P_QUALIFICATION_REQUIRED"
            : "CP_T_OR_CP_P_QUALIFICATION_REQUIRED";
      const qualificationNames = acceptedQualifications.join(" / ");
      return [
        issue(
          qualificationState.expired ? "QUALIFICATION_EXPIRED" : qualificationCode,
          qualificationState.expired
            ? `${qualificationNames} 資格已過期。`
            : `人員缺少有效 ${qualificationNames} 資格。`,
          {
            workId: request.workId,
            locationId: request.locationId,
            staffNumber: request.staffNumber,
            role: request.role,
          },
        ),
      ];
    }
    if (request.qualificationUsed && request.qualificationUsed !== qualificationState.valid) {
      // The requested qualification must be a valid qualification for this Work.
      if (!this.isQualificationValid(staff.staffNumber, request.qualificationUsed, plan.date)) {
        return [
          issue("QUALIFICATION_REQUIRED", "指定資格目前無效。", {
            workId: request.workId,
            locationId: request.locationId,
            staffNumber: request.staffNumber,
            role: request.role,
          }),
        ];
      }
    }
    return [];
  }

  private validateDuplicateAssignment(plan: NightPlan, request: AssignmentRequest): ValidationIssue[] {
    const duplicate = plan.assignments.find(
      (assignment) => assignment.staffNumber === request.staffNumber,
    );
    if (!duplicate) return [];
    return [
      issue("DUPLICATE_ASSIGNMENT", "同一人員不可在同一晚分配至多個 Work 或角色。", {
        workId: request.workId,
        locationId: request.locationId,
        staffNumber: request.staffNumber,
        role: request.role,
        assignmentId: duplicate.id,
      }),
    ];
  }

  /** Validate one proposed assignment against the current plan. */
  validateAssignment(
    plan: NightPlan,
    request: AssignmentRequest,
    options: ValidationOptions = {},
  ): ValidationReport {
    const effectiveOptions = this.effectiveOptions(options);
    const candidatePlan: NightPlan = {
      ...plan,
      assignments: [
        ...plan.assignments,
        {
          id: makeAssignmentId(request),
          staffNumber: request.staffNumber,
          workId: request.workId,
          role: request.role,
          locationId: request.locationId,
          source: request.source ?? "manual",
        },
      ],
    };
    const directIssues = [
      ...this.validateDuplicateAssignment(plan, request),
      ...this.validateStaffForAssignment(plan, request, effectiveOptions),
    ];
    const planReport = this.validatePlan(candidatePlan, effectiveOptions);
    const issueKeys = new Set(directIssues.map((item) => `${item.code}:${item.staffNumber ?? ""}:${item.locationId ?? ""}`));
    const issues = [
      ...directIssues,
      ...planReport.issues.filter(
        (item) => !issueKeys.has(`${item.code}:${item.staffNumber ?? ""}:${item.locationId ?? ""}`),
      ),
    ];
    return {
      valid: issues.every((item) => !item.blocking),
      issues,
      summaries: planReport.summaries,
    };
  }

  /**
   * Add an assignment through the same validation path used by UI drag/drop
   * and by future automatic suggestions. Incomplete shortages are accepted so
   * a Planner can fill AP, CP and general employee rows incrementally.
   */
  assign(
    plan: NightPlan,
    request: AssignmentRequest,
    options: ValidationOptions = {},
  ): AssignmentMutation {
    const report = this.validateAssignment(plan, request, options);
    if (!report.valid) return { accepted: false, plan: clonePlan(plan), report };
    const assignment: Assignment = {
      id: makeAssignmentId(request),
      staffNumber: request.staffNumber,
      workId: request.workId,
      role: request.role,
      locationId: request.locationId,
      qualificationUsed:
        request.role === "CP"
          ? request.qualificationUsed &&
              this.isQualificationValid(request.staffNumber, request.qualificationUsed, plan.date)
            ? request.qualificationUsed
            : this.preferredCpQualification(
                request.staffNumber,
                activeWork(plan, request.workId)?.type ?? "Possession",
                plan.date,
              )
          : request.role === "AP"
            ? "AP"
            : undefined,
      source: request.source ?? "manual",
    };
    return {
      accepted: true,
      plan: {
        ...clonePlan(plan),
        assignments: [...plan.assignments.map((item) => ({ ...item })), assignment],
      },
      report,
      assignment,
    };
  }

  removeAssignment(plan: NightPlan, assignmentId: string): NightPlan {
    return {
      ...clonePlan(plan),
      assignments: plan.assignments.filter((assignment) => assignment.id !== assignmentId),
    };
  }

  replaceAssignment(
    plan: NightPlan,
    assignmentId: string,
    request: AssignmentRequest,
    options: ValidationOptions = {},
  ): AssignmentMutation {
    const existing = plan.assignments.find((assignment) => assignment.id === assignmentId);
    if (!existing) {
      const report: ValidationReport = {
        valid: false,
        issues: [issue("DUPLICATE_ASSIGNMENT", "找不到要替換的 assignment。", { assignmentId })],
        summaries: [],
      };
      return { accepted: false, plan: clonePlan(plan), report };
    }
    const withoutExisting: NightPlan = {
      ...plan,
      assignments: plan.assignments.filter((assignment) => assignment.id !== assignmentId),
    };
    return this.assign(withoutExisting, request, options);
  }

  /** Validate all assignments and all Location demands for the current plan. */
  validatePlan(plan: NightPlan, options: ValidationOptions = {}): ValidationReport {
    const effectiveOptions = this.effectiveOptions(options);
    const issues: ValidationIssue[] = [];
    const summaries: ValidationSummary[] = [];
    const workById = new Map(plan.works.map((work) => [work.id, work]));
    const locationById = new Map<string, { work: Work; location: Location }>();
    for (const work of plan.works) {
      for (const location of work.locations) {
        locationById.set(location.id, { work, location });
      }
    }

    const seenStaff = new Map<string, Assignment>();
    for (const assignment of plan.assignments) {
      const work = workById.get(assignment.workId);
      if (!work) {
        issues.push(issue("WORK_NOT_FOUND", "Assignment 指向不存在的 Work。", { workId: assignment.workId, assignmentId: assignment.id }));
        continue;
      }
      const existing = seenStaff.get(assignment.staffNumber);
      if (existing) {
        issues.push(
          issue("DUPLICATE_ASSIGNMENT", "同一人員不可在同一晚分配至多個 Work 或角色。", {
            workId: assignment.workId,
            locationId: assignment.locationId,
            staffNumber: assignment.staffNumber,
            role: assignment.role,
            assignmentId: assignment.id,
          }),
        );
      } else {
        seenStaff.set(assignment.staffNumber, assignment);
      }

      const assignmentIssues = this.validateStaffForAssignment(
        plan,
        {
          staffNumber: assignment.staffNumber,
          workId: assignment.workId,
          role: assignment.role,
          locationId: assignment.locationId,
          source: assignment.source,
        },
        effectiveOptions,
      );
      for (const item of assignmentIssues) {
        issues.push({ ...item, assignmentId: assignment.id });
      }

      if (assignment.role === "一般員工" && assignment.locationId) {
        issues.push(
          issue("GENERAL_EMPLOYEE_LOCATION_FORBIDDEN", "一般員工只能分配至 Work 層級。", {
            workId: assignment.workId,
            locationId: assignment.locationId,
            staffNumber: assignment.staffNumber,
            role: assignment.role,
            assignmentId: assignment.id,
          }),
        );
      }
      if (assignment.role !== "一般員工") {
        const location = assignment.locationId ? locationById.get(assignment.locationId) : undefined;
        if (!location || location.work.id !== assignment.workId) {
          issues.push(
            issue("LOCATION_NOT_FOUND", "AP 或 CP assignment 必須指向同一 Work 的 Location。", {
              workId: assignment.workId,
              locationId: assignment.locationId,
              staffNumber: assignment.staffNumber,
              role: assignment.role,
              assignmentId: assignment.id,
            }),
          );
        }
      }
    }

    for (const work of plan.works) {
      if (!work.active) continue;
      const workAssignments = plan.assignments.filter((assignment) => assignment.workId === work.id);
      const generalEmployeeCount = workAssignments.filter(
        (assignment) => assignment.role === "一般員工",
      ).length;
      let requiredHeadcount = 0;
      let assignedLocationPeople = generalEmployeeCount;
      for (const location of work.locations) {
        const demand = defaultDemand(location);
        requiredHeadcount += Math.max(0, location.minimumTotalHeadcount);
        const locationAssignments = workAssignments.filter(
          (assignment) => assignment.locationId === location.id,
        );
        const apAssignments = locationAssignments.filter((assignment) => assignment.role === "AP");
        const cpAssignments = locationAssignments.filter((assignment) => assignment.role === "CP");
        assignedLocationPeople += apAssignments.length + cpAssignments.length;
        summaries.push(
          {
            workId: work.id,
            locationId: location.id,
            role: "AP",
            required: demand.apCount,
            assigned: apAssignments.length,
            missing: Math.max(0, demand.apCount - apAssignments.length),
          },
          {
            workId: work.id,
            locationId: location.id,
            role: "CP",
            required: demand.cpCount,
            assigned: cpAssignments.length,
            missing: Math.max(0, demand.cpCount - cpAssignments.length),
          },
        );
        if (apAssignments.length < demand.apCount) {
          issues.push(
            issue("LOCATION_AP_REQUIRED", "Location 尚缺少 AP。", {
              workId: work.id,
              locationId: location.id,
              role: "AP",
            }),
          );
        } else if (apAssignments.length > demand.apCount) {
          issues.push(
            issue("LOCATION_AP_OVERALLOCATED", "Location AP 已超出需求。", {
              workId: work.id,
              locationId: location.id,
              role: "AP",
            }),
          );
        }
        if (cpAssignments.length < demand.cpCount) {
          issues.push(
            issue("LOCATION_CP_REQUIRED", "Location 尚缺少 CP。", {
              workId: work.id,
              locationId: location.id,
              role: "CP",
            }),
          );
        } else if (cpAssignments.length > demand.cpCount) {
          issues.push(
            issue("LOCATION_CP_OVERALLOCATED", "Location CP 已超出需求。", {
              workId: work.id,
              locationId: location.id,
              role: "CP",
            }),
          );
        }
        if (apAssignments.some((ap) => cpAssignments.some((cp) => cp.staffNumber === ap.staffNumber))) {
          issues.push(
            issue("AP_CP_SAME_PERSON", "同一 Location 的 AP 與 CP 必須是不同人員。", {
              workId: work.id,
              locationId: location.id,
            }),
          );
        }
      }

      if (assignedLocationPeople < requiredHeadcount) {
        issues.push(
          issue(
            "MIN_HEADCOUNT_SHORTAGE",
            `Work ${work.slot} 人數不足，最低需要 ${requiredHeadcount} 人，目前 ${assignedLocationPeople} 人。`,
            { workId: work.id },
          ),
        );
      }
      if (generalEmployeeCount > 0) {
        summaries.push({
          workId: work.id,
          role: "一般員工",
          required: Math.max(0, requiredHeadcount - (assignedLocationPeople - generalEmployeeCount)),
          assigned: generalEmployeeCount,
          missing: Math.max(0, requiredHeadcount - assignedLocationPeople),
        });
      }
    }

    return {
      valid: issues.every((item) => !item.blocking),
      issues,
      summaries,
    };
  }

  /** Deterministic sidebar/suggestion candidates for one target row. */
  candidates(
    plan: NightPlan,
    request: Pick<AssignmentRequest, "workId" | "role" | "locationId">,
    options: ValidationOptions = {},
  ): readonly Candidate[] {
    const work = activeWork(plan, request.workId);
    if (!work) return [];
    return this.data.staff
      .map((staff) => {
        const report = this.validateAssignment(
          plan,
          { staffNumber: staff.staffNumber, ...request, source: "suggestion" },
          options,
        );
        const blocking = report.issues.some((item) => item.blocking);
        if (blocking) return undefined;
        const qualificationUsed =
          request.role === "CP"
            ? this.preferredCpQualification(staff.staffNumber, work.type, plan.date)
            : request.role === "AP"
              ? "AP"
              : undefined;
        return { staff, qualificationUsed } as Candidate;
      })
      .filter((candidate): candidate is Candidate => Boolean(candidate))
      .sort((left, right) => {
        // Keep CP(T) before CP(P) for PA Work while otherwise preserving source order.
        if (left.qualificationUsed === right.qualificationUsed) {
          return left.staff.staffNumber.localeCompare(right.staff.staffNumber);
        }
        if (left.qualificationUsed === "CP(T)") return -1;
        if (right.qualificationUsed === "CP(T)") return 1;
        return left.staff.staffNumber.localeCompare(right.staff.staffNumber);
      });
  }

  /** Scenario tab switch; this is view state only and never mutates main. */
  switchScenario(state: PlanningState, scenarioId: "main" | string): PlanningState {
    if (scenarioId !== "main" && !state.scenarios.some((scenario) => scenario.id === scenarioId)) {
      return state;
    }
    return { ...state, activeScenarioId: scenarioId };
  }

  createScenario(
    state: PlanningState,
    scenarioId: string,
    name: string,
    sourceScenarioId: "main" | string = state.activeScenarioId,
    temporary = true,
  ): PlanningState {
    if (state.scenarios.some((scenario) => scenario.id === scenarioId) || scenarioId === "main") {
      return state;
    }
    const sourcePlan =
      sourceScenarioId === "main"
        ? state.main
        : state.scenarios.find((scenario) => scenario.id === sourceScenarioId)?.plan;
    if (!sourcePlan) return state;
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: scenarioId,
      name,
      temporary,
      plan: clonePlan(sourcePlan),
      createdAt: now,
      updatedAt: now,
    };
    return { ...state, scenarios: [...state.scenarios, scenario], activeScenarioId: scenarioId };
  }

  renameScenario(state: PlanningState, scenarioId: string, name: string): PlanningState {
    return {
      ...state,
      scenarios: state.scenarios.map((scenario) =>
        scenario.id === scenarioId
          ? { ...scenario, name, updatedAt: new Date().toISOString() }
          : scenario,
      ),
    };
  }

  deleteScenario(state: PlanningState, scenarioId: string): PlanningState {
    if (scenarioId === "main" || !state.scenarios.some((scenario) => scenario.id === scenarioId)) {
      return state;
    }
    const scenarios = state.scenarios.filter((scenario) => scenario.id !== scenarioId);
    return {
      ...state,
      scenarios,
      activeScenarioId: state.activeScenarioId === scenarioId ? "main" : state.activeScenarioId,
    };
  }

  /** Explicitly apply an alternative plan to main. Tab switching never calls this. */
  applyScenario(state: PlanningState, scenarioId: string): PlanningState {
    const scenario = state.scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return state;
    return {
      ...state,
      main: clonePlan(scenario.plan),
      activeScenarioId: "main",
    };
  }

  updateScenarioPlan(
    state: PlanningState,
    scenarioId: string,
    update: (plan: NightPlan) => NightPlan,
  ): PlanningState {
    return {
      ...state,
      scenarios: state.scenarios.map((scenario) =>
        scenario.id === scenarioId
          ? { ...scenario, plan: clonePlan(update(clonePlan(scenario.plan))), updatedAt: new Date().toISOString() }
          : scenario,
      ),
    };
  }

  assignToScenario(
    state: PlanningState,
    scenarioId: string,
    request: AssignmentRequest,
    options: ValidationOptions = {},
  ): AssignmentMutation & { state: PlanningState } {
    const scenario = state.scenarios.find((item) => item.id === scenarioId);
    if (!scenario) {
      const report: ValidationReport = {
        valid: false,
        issues: [issue("SCENARIO_NOT_FOUND", "找不到指定 Scenario。")],
        summaries: [],
      };
      return { accepted: false, plan: state.main, report, state };
    }
    const mutation = this.assign(scenario.plan, request, options);
    if (!mutation.accepted) return { ...mutation, state };
    return {
      ...mutation,
      state: this.updateScenarioPlan(state, scenarioId, () => mutation.plan),
    };
  }
}
