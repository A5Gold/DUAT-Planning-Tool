/** Runtime validation for the shared Electron application boundary.
 *
 * TypeScript types disappear at the preload boundary. These validators are
 * deliberately dependency-free and strict: unknown keys, class instances,
 * functions and non-finite numbers are rejected before a main-process handler
 * loads a repository or invokes a domain service.
 */

import type {
  AssignmentDto,
  ImportKind,
  ImportCommitDto,
  ImportPreviewDto,
  IpcChannel,
  IpcCommandMap,
  IpcRequest,
  IpcResponse,
  IpcResult,
  LocationDto,
  NightPlanDto,
  QualificationDto,
  RosterEntryDto,
  ScenarioDto,
  StaffDto,
  ValidationReportDto,
  WorkDto,
} from "./ipcContract";
import { IPC_CHANNELS } from "./ipcContract";

export interface ValidationFailure {
  ok: false;
  issues: readonly FieldValidationIssue[];
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface FieldValidationIssue {
  path: string;
  message: string;
}

export class IpcValidationError extends Error {
  readonly issues: readonly FieldValidationIssue[];

  constructor(issues: readonly FieldValidationIssue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join("; ") || "Invalid IPC value");
    this.name = "IpcValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;
type Validator = (value: unknown, path: string) => FieldValidationIssue[];

const IMPORT_KINDS = new Set<ImportKind>(["formation", "qualification", "roster"]);
const TEAMS = new Set(["S1", "S2", "S3", "S4", "S5"]);
const WORK_TYPES = new Set(["Possession", "PA Work"]);
const ASSIGNMENT_ROLES = new Set(["AP", "CP", "一般員工"]);
const QUALIFICATION_TYPES = new Set(["AP", "CP(P)", "CP(T)", "SIL", "DUAT"]);
const ROSTER_STATUS = new Set([
  "available",
  "night-duty",
  "unavailable",
  "leave",
  "sickness",
  "training",
  "day-duty",
]);
const VALIDATION_SEVERITIES = new Set(["error", "warning"]);
const VALIDATION_CODES = new Set([
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
  "LOCATION_AP_REQUIRED",
  "LOCATION_CP_REQUIRED",
  "LOCATION_AP_OVERALLOCATED",
  "LOCATION_CP_OVERALLOCATED",
  "AP_CP_SAME_PERSON",
  "DUPLICATE_ASSIGNMENT",
  "GENERAL_EMPLOYEE_LOCATION_FORBIDDEN",
  "GENERAL_EMPLOYEE_QUALIFICATION_FORBIDDEN",
  "GENERAL_EMPLOYEE_HEADCOUNT_SHORTAGE",
  "MIN_HEADCOUNT_SHORTAGE",
  "WORK_NOT_ACTIVE",
  "SCENARIO_NOT_FOUND",
  "SCENARIO_DELETE_FORBIDDEN",
  "SCENARIO_APPLY_FORBIDDEN",
]);

const CHANNEL_LIST = Object.values(IPC_CHANNELS) as readonly string[];

function issue(path: string, message: string): FieldValidationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): { object: UnknownRecord; issues: FieldValidationIssue[] } | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([...required, ...optional]);
  const issues: FieldValidationIssue[] = [];
  for (const key of required) {
    if (!hasOwn(value, key)) issues.push(issue(`${path}.${key}`, "required"));
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(issue(`${path}.${key}`, "unknown field"));
  }
  return { object: value, issues };
}

function stringValue(value: unknown, path: string, nonEmpty = true): FieldValidationIssue[] {
  if (typeof value !== "string") return [issue(path, "must be a string")];
  if (nonEmpty && value.trim().length === 0) return [issue(path, "must not be empty")];
  return [];
}

function booleanValue(value: unknown, path: string): FieldValidationIssue[] {
  return typeof value === "boolean" ? [] : [issue(path, "must be a boolean")];
}

function integerValue(value: unknown, path: string, minimum = 0): FieldValidationIssue[] {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum
    ? []
    : [issue(path, `must be an integer >= ${minimum}`)];
}

function finiteNumberValue(value: unknown, path: string): FieldValidationIssue[] {
  return typeof value === "number" && Number.isFinite(value)
    ? []
    : [issue(path, "must be a finite number")];
}

function enumValue(value: unknown, path: string, allowed: ReadonlySet<string>): FieldValidationIssue[] {
  return typeof value === "string" && allowed.has(value)
    ? []
    : [issue(path, `must be one of: ${[...allowed].join(", ")}`)];
}

function optional(value: UnknownRecord, key: string, validator: Validator, path: string): FieldValidationIssue[] {
  return hasOwn(value, key) ? validator(value[key], `${path}.${key}`) : [];
}

function arrayValue(
  value: unknown,
  path: string,
  validator: Validator,
): FieldValidationIssue[] {
  if (!Array.isArray(value)) return [issue(path, "must be an array")];
  return value.flatMap((item, index) => validator(item, `${path}[${index}]`));
}

function dateValue(value: unknown, path: string): FieldValidationIssue[] {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return [issue(path, "must be an ISO date (YYYY-MM-DD)")];
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return [issue(path, "must be a real calendar date")];
  }
  return [];
}

function timestampValue(value: unknown, path: string): FieldValidationIssue[] {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return [issue(path, "must be an ISO timestamp")];
  }
  return [];
}

function optionalDate(value: UnknownRecord, key: string, path: string): FieldValidationIssue[] {
  return hasOwn(value, key) ? dateValue(value[key], `${path}.${key}`) : [];
}

function optionalTimestamp(value: UnknownRecord, key: string, path: string): FieldValidationIssue[] {
  return hasOwn(value, key) ? timestampValue(value[key], `${path}.${key}`) : [];
}

function result<T>(issues: readonly FieldValidationIssue[], value: T): ValidationResult<T> {
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
}

function validate<T>(value: unknown, validator: Validator): ValidationResult<T> {
  const issues = validator(value, "$" );
  return result(issues, value as T);
}

function validateObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optionalKeys: readonly string[],
  fields: (object: UnknownRecord, path: string) => FieldValidationIssue[],
): FieldValidationIssue[] {
  const checked = exactObject(value, path, required, optionalKeys);
  if (!checked) return [issue(path, "must be a plain object")];
  return [...checked.issues, ...fields(checked.object, path)];
}

function validateScenarioRef(value: unknown, path: string): FieldValidationIssue[] {
  if (!isRecord(value)) return [issue(path, "must be a plain object")];
  if (value.kind === "main") {
    return exactObject(value, path, ["kind"])?.issues ?? [issue(path, "invalid object")];
  }
  if (value.kind === "scenario") {
    return validateObject(value, path, ["kind", "scenarioId"], [], (object, childPath) => [
      ...stringValue(object.scenarioId, `${childPath}.scenarioId`),
    ]);
  }
  return [issue(`${path}.kind`, "must be main or scenario")];
}

function validateQualification(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["type", "expiryDate"], ["issueDate"], (object, childPath) => [
    ...enumValue(object.type, `${childPath}.type`, QUALIFICATION_TYPES),
    ...dateValue(object.expiryDate, `${childPath}.expiryDate`),
    ...optionalDate(object, "issueDate", childPath),
  ]);
}

function validateStaff(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(
    value,
    path,
    ["staffNumber", "name", "team"],
    ["active", "isSupervisor", "qualifications", "isGeneralEmployee"],
    (object, childPath) => [
      ...stringValue(object.staffNumber, `${childPath}.staffNumber`),
      ...stringValue(object.name, `${childPath}.name`),
      ...enumValue(object.team, `${childPath}.team`, TEAMS),
      ...optional(object, "active", booleanValue, childPath),
      ...optional(object, "isSupervisor", booleanValue, childPath),
      ...(hasOwn(object, "qualifications")
        ? arrayValue(object.qualifications, `${childPath}.qualifications`, validateQualification)
        : []),
      ...optional(object, "isGeneralEmployee", booleanValue, childPath),
    ],
  );
}

function validateRosterEntry(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "staffNumber"], ["status", "available", "reason"], (object, childPath) => [
    ...dateValue(object.date, `${childPath}.date`),
    ...stringValue(object.staffNumber, `${childPath}.staffNumber`),
    ...(hasOwn(object, "status") ? enumValue(object.status, `${childPath}.status`, ROSTER_STATUS) : []),
    ...optional(object, "available", booleanValue, childPath),
    ...(hasOwn(object, "reason") ? stringValue(object.reason, `${childPath}.reason`, false) : []),
  ]);
}

function validateDemand(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, [], ["apCount", "cpCount"], (object, childPath) => [
    ...optional(object, "apCount", (item, itemPath) => integerValue(item, itemPath, 0), childPath),
    ...optional(object, "cpCount", (item, itemPath) => integerValue(item, itemPath, 0), childPath),
  ]);
}

function validateLocation(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(
    value,
    path,
    ["id", "sequence", "locationName", "isolationPoint", "earthingPoint", "minimumTotalHeadcount"],
    ["demand"],
    (object, childPath) => [
      ...stringValue(object.id, `${childPath}.id`),
      ...integerValue(object.sequence, `${childPath}.sequence`, 1),
      ...stringValue(object.locationName, `${childPath}.locationName`, false),
      ...stringValue(object.isolationPoint, `${childPath}.isolationPoint`, false),
      ...stringValue(object.earthingPoint, `${childPath}.earthingPoint`, false),
      ...integerValue(object.minimumTotalHeadcount, `${childPath}.minimumTotalHeadcount`, 0),
      ...(hasOwn(object, "demand") ? validateDemand(object.demand, `${childPath}.demand`) : []),
    ],
  );
}

function validateWork(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(
    value,
    path,
    ["id", "slot", "active", "projectCode", "type", "jobDescription", "remarks", "locations"],
    [],
    (object, childPath) => [
      ...stringValue(object.id, `${childPath}.id`),
      ...integerValue(object.slot, `${childPath}.slot`, 1),
      ...(typeof object.slot === "number" && object.slot > 4 ? [issue(`${childPath}.slot`, "must be between 1 and 4")] : []),
      ...booleanValue(object.active, `${childPath}.active`),
      ...stringValue(object.projectCode, `${childPath}.projectCode`, false),
      ...enumValue(object.type, `${childPath}.type`, WORK_TYPES),
      ...stringValue(object.jobDescription, `${childPath}.jobDescription`, false),
      ...stringValue(object.remarks, `${childPath}.remarks`, false),
      ...arrayValue(object.locations, `${childPath}.locations`, validateLocation),
    ],
  );
}

function validateAssignment(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["id", "staffNumber", "workId", "role"], ["locationId", "qualificationUsed", "source"], (object, childPath) => [
    ...stringValue(object.id, `${childPath}.id`),
    ...stringValue(object.staffNumber, `${childPath}.staffNumber`),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...enumValue(object.role, `${childPath}.role`, ASSIGNMENT_ROLES),
    ...(hasOwn(object, "locationId") ? stringValue(object.locationId, `${childPath}.locationId`) : []),
    ...(hasOwn(object, "qualificationUsed")
      ? enumValue(object.qualificationUsed, `${childPath}.qualificationUsed`, QUALIFICATION_TYPES)
      : []),
    ...(hasOwn(object, "source")
      ? enumValue(object.source, `${childPath}.source`, new Set(["manual", "suggestion"]))
      : []),
    ...validateAssignmentRoleLocation(object, childPath),
  ]);
}

function validateAssignmentRoleLocation(object: UnknownRecord, path: string): FieldValidationIssue[] {
  if (object.role === "一般員工" && hasOwn(object, "locationId")) {
    return [issue(`${path}.locationId`, "一般員工 assignment must be Work-level")];
  }
  if ((object.role === "AP" || object.role === "CP") && !hasOwn(object, "locationId")) {
    return [issue(`${path}.locationId`, "AP and CP assignments require a Location")];
  }
  return [];
}

function validateNightPlan(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["id", "date", "works", "assignments"], [], (object, childPath) => {
    const issues = [
      ...stringValue(object.id, `${childPath}.id`),
      ...dateValue(object.date, `${childPath}.date`),
      ...arrayValue(object.works, `${childPath}.works`, validateWork),
      ...arrayValue(object.assignments, `${childPath}.assignments`, validateAssignment),
    ];
    if (Array.isArray(object.works)) {
      if (object.works.length !== 4) issues.push(issue(`${childPath}.works`, "must contain exactly four Work slots"));
      const slots = object.works.map((work) => (isRecord(work) ? work.slot : undefined));
      if (new Set(slots).size !== slots.length) issues.push(issue(`${childPath}.works`, "Work slots must be unique"));
    }
    return issues;
  });
}

function validateScenario(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["id", "name", "plan", "temporary"], ["createdAt", "updatedAt"], (object, childPath) => [
    ...stringValue(object.id, `${childPath}.id`),
    ...stringValue(object.name, `${childPath}.name`),
    ...validateNightPlan(object.plan, `${childPath}.plan`),
    ...booleanValue(object.temporary, `${childPath}.temporary`),
    ...optionalTimestamp(object, "createdAt", childPath),
    ...optionalTimestamp(object, "updatedAt", childPath),
  ]);
}

function validateValidationIssue(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["code", "severity", "blocking", "message"], ["workId", "locationId", "staffNumber", "assignmentId", "role"], (object, childPath) => [
    ...enumValue(object.code, `${childPath}.code`, VALIDATION_CODES),
    ...enumValue(object.severity, `${childPath}.severity`, VALIDATION_SEVERITIES),
    ...booleanValue(object.blocking, `${childPath}.blocking`),
    ...stringValue(object.message, `${childPath}.message`, false),
    ...optional(object, "workId", stringValue, childPath),
    ...optional(object, "locationId", stringValue, childPath),
    ...optional(object, "staffNumber", stringValue, childPath),
    ...optional(object, "assignmentId", stringValue, childPath),
    ...(hasOwn(object, "role") ? enumValue(object.role, `${childPath}.role`, ASSIGNMENT_ROLES) : []),
  ]);
}

function validateValidationSummary(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["workId", "role", "required", "assigned", "missing"], ["locationId"], (object, childPath) => [
    ...stringValue(object.workId, `${childPath}.workId`),
    ...enumValue(object.role, `${childPath}.role`, ASSIGNMENT_ROLES),
    ...(hasOwn(object, "locationId") ? stringValue(object.locationId, `${childPath}.locationId`) : []),
    ...integerValue(object.required, `${childPath}.required`, 0),
    ...integerValue(object.assigned, `${childPath}.assigned`, 0),
    ...integerValue(object.missing, `${childPath}.missing`, 0),
  ]);
}

function validateValidationReport(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["valid", "issues", "summaries"], [], (object, childPath) => [
    ...booleanValue(object.valid, `${childPath}.valid`),
    ...arrayValue(object.issues, `${childPath}.issues`, validateValidationIssue),
    ...arrayValue(object.summaries, `${childPath}.summaries`, validateValidationSummary),
  ]);
}

function validateCandidate(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["staff"], ["qualificationUsed"], (object, childPath) => [
    ...validateStaff(object.staff, `${childPath}.staff`),
    ...(hasOwn(object, "qualificationUsed")
      ? enumValue(object.qualificationUsed, `${childPath}.qualificationUsed`, QUALIFICATION_TYPES)
      : []),
  ]);
}

function validatePersonnelAvailability(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["staff", "qualifications", "availability"], ["rosterStatus", "rosterReason", "currentWorkId", "currentWorkSlot"], (object, childPath) => [
    ...validateStaff(object.staff, `${childPath}.staff`),
    ...arrayValue(object.qualifications, `${childPath}.qualifications`, validateQualification),
    ...enumValue(object.availability, `${childPath}.availability`, new Set(["available", "unavailable", "unknown"])),
    ...(hasOwn(object, "rosterStatus") ? enumValue(object.rosterStatus, `${childPath}.rosterStatus`, ROSTER_STATUS) : []),
    ...(hasOwn(object, "rosterReason") ? stringValue(object.rosterReason, `${childPath}.rosterReason`, false) : []),
    ...(hasOwn(object, "currentWorkId") ? stringValue(object.currentWorkId, `${childPath}.currentWorkId`) : []),
    ...(hasOwn(object, "currentWorkSlot")
      ? integerValue(object.currentWorkSlot, `${childPath}.currentWorkSlot`, 1).concat(
          typeof object.currentWorkSlot === "number" && object.currentWorkSlot > 4
            ? [issue(`${childPath}.currentWorkSlot`, "must be between 1 and 4")]
            : [],
        )
      : []),
  ]);
}

function validateWorkbenchSnapshot(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "weekNumber", "weekStart", "weekEnd", "revision", "main", "activePlan", "scenarios", "selectedScenario", "personnel", "validation"], [], (object, childPath) => [
    ...dateValue(object.date, `${childPath}.date`),
    ...integerValue(object.weekNumber, `${childPath}.weekNumber`, 1),
    ...(typeof object.weekNumber === "number" && object.weekNumber > 53 ? [issue(`${childPath}.weekNumber`, "must be between 1 and 53")] : []),
    ...dateValue(object.weekStart, `${childPath}.weekStart`),
    ...dateValue(object.weekEnd, `${childPath}.weekEnd`),
    ...integerValue(object.revision, `${childPath}.revision`, 0),
    ...validateNightPlan(object.main, `${childPath}.main`),
    ...validateNightPlan(object.activePlan, `${childPath}.activePlan`),
    ...arrayValue(object.scenarios, `${childPath}.scenarios`, validateScenario),
    ...validateScenarioRef(object.selectedScenario, `${childPath}.selectedScenario`),
    ...arrayValue(object.personnel, `${childPath}.personnel`, validatePersonnelAvailability),
    ...validateValidationReport(object.validation, `${childPath}.validation`),
  ]);
}

function validateMutationEnvelope(value: unknown, path: string): FieldValidationIssue[] {
  if (!isRecord(value)) return [issue(path, "must be a plain object")];
  const issues: FieldValidationIssue[] = [];
  for (const key of ["date", "scenario", "expectedRevision"] as const) {
    if (!hasOwn(value, key)) issues.push(issue(`${path}.${key}`, "required"));
  }
  if (hasOwn(value, "date")) issues.push(...dateValue(value.date, `${path}.date`));
  if (hasOwn(value, "scenario")) issues.push(...validateScenarioRef(value.scenario, `${path}.scenario`));
  if (hasOwn(value, "expectedRevision")) {
    issues.push(...integerValue(value.expectedRevision, `${path}.expectedRevision`, 0));
  }
  if (hasOwn(value, "allowS1Support")) issues.push(...booleanValue(value.allowS1Support, `${path}.allowS1Support`));
  return issues;
}

function validateWorkPatch(value: unknown, path: string): FieldValidationIssue[] {
  const issues = validateObject(value, path, [], ["active", "projectCode", "type", "jobDescription", "remarks"], (object, childPath) => [
    ...optional(object, "active", booleanValue, childPath),
    ...(hasOwn(object, "projectCode") ? stringValue(object.projectCode, `${childPath}.projectCode`, false) : []),
    ...(hasOwn(object, "type") ? enumValue(object.type, `${childPath}.type`, WORK_TYPES) : []),
    ...(hasOwn(object, "jobDescription") ? stringValue(object.jobDescription, `${childPath}.jobDescription`, false) : []),
    ...(hasOwn(object, "remarks") ? stringValue(object.remarks, `${childPath}.remarks`, false) : []),
  ]);
  if (isRecord(value) && Object.keys(value).length === 0) issues.push(issue(path, "must contain at least one field"));
  return issues;
}

function validateLocationPatch(value: unknown, path: string): FieldValidationIssue[] {
  const issues = validateObject(value, path, [], ["locationName", "isolationPoint", "earthingPoint", "minimumTotalHeadcount", "demand"], (object, childPath) => [
    ...(hasOwn(object, "locationName") ? stringValue(object.locationName, `${childPath}.locationName`, false) : []),
    ...(hasOwn(object, "isolationPoint") ? stringValue(object.isolationPoint, `${childPath}.isolationPoint`, false) : []),
    ...(hasOwn(object, "earthingPoint") ? stringValue(object.earthingPoint, `${childPath}.earthingPoint`, false) : []),
    ...(hasOwn(object, "minimumTotalHeadcount") ? integerValue(object.minimumTotalHeadcount, `${childPath}.minimumTotalHeadcount`, 0) : []),
    ...(hasOwn(object, "demand") ? validateDemand(object.demand, `${childPath}.demand`) : []),
  ]);
  if (isRecord(value) && Object.keys(value).length === 0) issues.push(issue(path, "must contain at least one field"));
  return issues;
}

function validateLocationInput(value: unknown, path: string): FieldValidationIssue[] {
  return validateLocation(value, path);
}

function validateAssignmentInput(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["staffNumber", "workId", "role"], ["locationId", "qualificationUsed"], (object, childPath) => [
    ...stringValue(object.staffNumber, `${childPath}.staffNumber`),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...enumValue(object.role, `${childPath}.role`, ASSIGNMENT_ROLES),
    ...(hasOwn(object, "locationId") ? stringValue(object.locationId, `${childPath}.locationId`) : []),
    ...(hasOwn(object, "qualificationUsed")
      ? enumValue(object.qualificationUsed, `${childPath}.qualificationUsed`, QUALIFICATION_TYPES)
      : []),
    ...validateAssignmentRoleLocation(object, childPath),
  ]);
}

function validateAssignmentTarget(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["workId", "role"], ["locationId"], (object, childPath) => [
    ...stringValue(object.workId, `${childPath}.workId`),
    ...enumValue(object.role, `${childPath}.role`, ASSIGNMENT_ROLES),
    ...(hasOwn(object, "locationId") ? stringValue(object.locationId, `${childPath}.locationId`) : []),
    ...validateAssignmentRoleLocation(object, childPath),
  ]);
}

function validateGetWorkbenchRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date"], [], (object, childPath) => dateValue(object.date, `${childPath}.date`));
}

function validateGetCandidatesRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "target"], ["allowS1Support"], (object, childPath) => [
    ...dateValue(object.date, `${childPath}.date`),
    ...validateScenarioRef(object.scenario, `${childPath}.scenario`),
    ...validateAssignmentTarget(object.target, `${childPath}.target`),
    ...(hasOwn(object, "allowS1Support") ? booleanValue(object.allowS1Support, `${childPath}.allowS1Support`) : []),
  ]);
}

function validateUpdateWorkRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "workId", "patch"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...validateWorkPatch(object.patch, `${childPath}.patch`),
  ]);
}

function validateAddLocationRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "workId", "location"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...validateLocationInput(object.location, `${childPath}.location`),
  ]);
}

function validateUpdateLocationRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "workId", "locationId", "patch"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...stringValue(object.locationId, `${childPath}.locationId`),
    ...validateLocationPatch(object.patch, `${childPath}.patch`),
  ]);
}

function validateDeleteLocationRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "workId", "locationId"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.workId, `${childPath}.workId`),
    ...stringValue(object.locationId, `${childPath}.locationId`),
  ]);
}

function validateAddAssignmentRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "assignment"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...validateAssignmentInput(object.assignment, `${childPath}.assignment`),
  ]);
}

function validateReplaceAssignmentRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "assignmentId", "assignment"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.assignmentId, `${childPath}.assignmentId`),
    ...validateAssignmentInput(object.assignment, `${childPath}.assignment`),
  ]);
}

function validateRemoveAssignmentRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "assignmentId"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.assignmentId, `${childPath}.assignmentId`),
  ]);
}

function validateCreateScenarioRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "scenarioId", "name"], ["sourceScenario", "temporary", "allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.scenarioId, `${childPath}.scenarioId`),
    ...stringValue(object.name, `${childPath}.name`),
    ...(hasOwn(object, "sourceScenario") ? validateScenarioRef(object.sourceScenario, `${childPath}.sourceScenario`) : []),
    ...optional(object, "temporary", booleanValue, childPath),
  ]);
}

function validateRenameScenarioRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "scenarioId", "name"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.scenarioId, `${childPath}.scenarioId`),
    ...stringValue(object.name, `${childPath}.name`),
  ]);
}

function validateDeleteScenarioRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "scenarioId"], ["allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.scenarioId, `${childPath}.scenarioId`),
  ]);
}

function validateScenarioMutationRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateDeleteScenarioRequest(value, path);
}

function validateImportSource(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["filePath"], ["worksheetName"], (object, childPath) => [
    ...stringValue(object.filePath, `${childPath}.filePath`),
    ...(hasOwn(object, "worksheetName") ? stringValue(object.worksheetName, `${childPath}.worksheetName`) : []),
  ]);
}

function validateImportPreviewRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["kind", "source"], [], (object, childPath) => [
    ...enumValue(object.kind, `${childPath}.kind`, IMPORT_KINDS),
    ...validateImportSource(object.source, `${childPath}.source`),
  ]);
}

function validateSelectImportFileRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["kind"], [], (object, childPath) => [
    ...enumValue(object.kind, `${childPath}.kind`, IMPORT_KINDS),
  ]);
}

function validateSelectImportFile(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["canceled"], ["filePath"], (object, childPath) => [
    ...booleanValue(object.canceled, `${childPath}.canceled`),
    ...(hasOwn(object, "filePath") ? stringValue(object.filePath, `${childPath}.filePath`) : []),
  ]);
}

function validateImportCell(value: unknown, path: string): FieldValidationIssue[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  return finiteNumberValue(value, path);
}

function validateImportRowIssue(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["rowNumber", "severity", "code", "message"], ["column"], (object, childPath) => [
    ...integerValue(object.rowNumber, `${childPath}.rowNumber`, 1),
    ...enumValue(object.severity, `${childPath}.severity`, VALIDATION_SEVERITIES),
    ...stringValue(object.code, `${childPath}.code`),
    ...stringValue(object.message, `${childPath}.message`, false),
    ...(hasOwn(object, "column") ? stringValue(object.column, `${childPath}.column`) : []),
  ]);
}

function validateImportStagingRow(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["rowNumber", "status", "values", "issues"], ["staffNumber"], (object, childPath) => {
    const issues = [
      ...integerValue(object.rowNumber, `${childPath}.rowNumber`, 1),
      ...enumValue(object.status, `${childPath}.status`, new Set(["valid", "warning", "invalid", "ignored"])),
      ...(hasOwn(object, "staffNumber") ? stringValue(object.staffNumber, `${childPath}.staffNumber`) : []),
      ...arrayValue(object.issues, `${childPath}.issues`, validateImportRowIssue),
    ];
    if (!isRecord(object.values)) {
      issues.push(issue(`${childPath}.values`, "must be a plain object"));
    } else {
      for (const [key, cell] of Object.entries(object.values)) issues.push(...validateImportCell(cell, `${childPath}.values.${key}`));
    }
    return issues;
  });
}

function validateImportPreview(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["importId", "kind", "source", "selectedWorksheet", "status", "rowCount", "validRowCount", "warningCount", "errorCount", "rows", "issues"], [], (object, childPath) => [
    ...stringValue(object.importId, `${childPath}.importId`),
    ...enumValue(object.kind, `${childPath}.kind`, IMPORT_KINDS),
    ...validateImportSource(object.source, `${childPath}.source`),
    ...stringValue(object.selectedWorksheet, `${childPath}.selectedWorksheet`),
    ...enumValue(object.status, `${childPath}.status`, new Set(["valid", "has-warnings", "has-errors"])),
    ...integerValue(object.rowCount, `${childPath}.rowCount`, 0),
    ...integerValue(object.validRowCount, `${childPath}.validRowCount`, 0),
    ...integerValue(object.warningCount, `${childPath}.warningCount`, 0),
    ...integerValue(object.errorCount, `${childPath}.errorCount`, 0),
    ...arrayValue(object.rows, `${childPath}.rows`, validateImportStagingRow),
    ...arrayValue(object.issues, `${childPath}.issues`, validateImportRowIssue),
  ]);
}

function validateImportCommitRequest(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["date", "scenario", "expectedRevision", "importId"], ["acceptedRowNumbers", "allowS1Support"], (object, childPath) => [
    ...validateMutationEnvelope(object, childPath),
    ...stringValue(object.importId, `${childPath}.importId`),
    ...(hasOwn(object, "acceptedRowNumbers")
      ? arrayValue(object.acceptedRowNumbers, `${childPath}.acceptedRowNumbers`, (item, itemPath) => integerValue(item, itemPath, 1))
      : []),
  ]);
}

function validateHealth(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["ok", "runtime"], [], (object, childPath) => [
    ...booleanValue(object.ok, `${childPath}.ok`),
    ...enumValue(object.runtime, `${childPath}.runtime`, new Set(["electron", "browser", "test"])),
  ]);
}

function validatePlanningMutation(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["revision", "snapshot", "validation"], [], (object, childPath) => [
    ...integerValue(object.revision, `${childPath}.revision`, 0),
    ...validateWorkbenchSnapshot(object.snapshot, `${childPath}.snapshot`),
    ...validateValidationReport(object.validation, `${childPath}.validation`),
  ]);
}

function validateCandidateResult(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["revision", "candidates", "validation"], [], (object, childPath) => [
    ...integerValue(object.revision, `${childPath}.revision`, 0),
    ...arrayValue(object.candidates, `${childPath}.candidates`, validateCandidate),
    ...validateValidationReport(object.validation, `${childPath}.validation`),
  ]);
}

function validateImportBatch(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["id", "kind", "sourceFilePath", "sourceWorksheet", "importedAt", "status", "rowCount", "errorCount"], [], (object, childPath) => [
    ...stringValue(object.id, `${childPath}.id`),
    ...enumValue(object.kind, `${childPath}.kind`, IMPORT_KINDS),
    ...stringValue(object.sourceFilePath, `${childPath}.sourceFilePath`),
    ...stringValue(object.sourceWorksheet, `${childPath}.sourceWorksheet`),
    ...timestampValue(object.importedAt, `${childPath}.importedAt`),
    ...enumValue(object.status, `${childPath}.status`, new Set(["staged", "committed", "rejected"])),
    ...integerValue(object.rowCount, `${childPath}.rowCount`, 0),
    ...integerValue(object.errorCount, `${childPath}.errorCount`, 0),
  ]);
}

function validateImportCommit(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["revision", "batch", "snapshot"], [], (object, childPath) => [
    ...integerValue(object.revision, `${childPath}.revision`, 0),
    ...validateImportBatch(object.batch, `${childPath}.batch`),
    ...validateWorkbenchSnapshot(object.snapshot, `${childPath}.snapshot`),
  ]);
}

function validateIpcError(value: unknown, path: string): FieldValidationIssue[] {
  if (!isRecord(value)) return [issue(path, "must be a plain object")];
  const kind = value.kind;
  if (kind === "invalid-request") {
    return validateObject(value, path, ["kind", "code", "message", "fields"], [], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, new Set(["INVALID_REQUEST"])),
      ...stringValue(object.message, `${childPath}.message`, false),
      ...arrayValue(object.fields, `${childPath}.fields`, validateFieldValidationError),
    ]);
  }
  if (kind === "domain") {
    return validateObject(value, path, ["kind", "code", "message", "report"], [], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, VALIDATION_CODES),
      ...stringValue(object.message, `${childPath}.message`, false),
      ...validateValidationReport(object.report, `${childPath}.report`),
    ]);
  }
  if (kind === "conflict") {
    return validateObject(value, path, ["kind", "code", "message", "expectedRevision", "actualRevision"], [], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, new Set(["STALE_REVISION"])),
      ...stringValue(object.message, `${childPath}.message`, false),
      ...integerValue(object.expectedRevision, `${childPath}.expectedRevision`, 0),
      ...integerValue(object.actualRevision, `${childPath}.actualRevision`, 0),
    ]);
  }
  if (kind === "not-found") {
    return validateObject(value, path, ["kind", "code", "entity", "id", "message"], [], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, new Set(["NOT_FOUND"])),
      ...enumValue(object.entity, `${childPath}.entity`, new Set(["night", "work", "location", "assignment", "scenario", "import"])),
      ...stringValue(object.id, `${childPath}.id`),
      ...stringValue(object.message, `${childPath}.message`, false),
    ]);
  }
  if (kind === "import") {
    return validateObject(value, path, ["kind", "code", "message"], ["importId", "fields"], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, new Set(["IMPORT_FAILED", "IMPORT_NOT_READY"])),
      ...stringValue(object.message, `${childPath}.message`, false),
      ...(hasOwn(object, "importId") ? stringValue(object.importId, `${childPath}.importId`) : []),
      ...(hasOwn(object, "fields") ? arrayValue(object.fields, `${childPath}.fields`, validateFieldValidationError) : []),
    ]);
  }
  if (kind === "system") {
    return validateObject(value, path, ["kind", "code", "message", "retryable"], [], (object, childPath) => [
      ...enumValue(object.code, `${childPath}.code`, new Set(["PERSISTENCE_ERROR", "IPC_ERROR"])),
      ...stringValue(object.message, `${childPath}.message`, false),
      ...booleanValue(object.retryable, `${childPath}.retryable`),
    ]);
  }
  return [issue(`${path}.kind`, "unknown error kind")];
}

function validateFieldValidationError(value: unknown, path: string): FieldValidationIssue[] {
  return validateObject(value, path, ["path", "message"], [], (object, childPath) => [
    ...stringValue(object.path, `${childPath}.path`, false),
    ...stringValue(object.message, `${childPath}.message`, false),
  ]);
}

function validateIpcResult(
  value: unknown,
  path: string,
  dataValidator: Validator,
): FieldValidationIssue[] {
  if (!isRecord(value)) return [issue(path, "must be a plain object")];
  if (value.ok === true) {
    return validateObject(value, path, ["ok", "data"], [], (object, childPath) => [
      ...booleanValue(object.ok, `${childPath}.ok`),
      ...dataValidator(object.data, `${childPath}.data`),
    ]);
  }
  if (value.ok === false) {
    return validateObject(value, path, ["ok", "error"], [], (object, childPath) => [
      ...booleanValue(object.ok, `${childPath}.ok`),
      ...validateIpcError(object.error, `${childPath}.error`),
    ]);
  }
  return [issue(`${path}.ok`, "must be true or false")];
}

function validateResponseForChannel(channel: IpcChannel, value: unknown, path: string): FieldValidationIssue[] {
  switch (channel) {
    case "app:health":
      return validateIpcResult(value, path, validateHealth);
    case "planning:get-workbench":
      return validateIpcResult(value, path, (item, childPath) =>
        validateObject(item, childPath, ["snapshot"], [], (object, nestedPath) =>
          validateWorkbenchSnapshot(object.snapshot, `${nestedPath}.snapshot`),
        ),
      );
    case "planning:get-candidates":
      return validateIpcResult(value, path, validateCandidateResult);
    case "planning:update-work":
    case "planning:add-location":
    case "planning:update-location":
    case "planning:delete-location":
    case "planning:add-assignment":
    case "planning:replace-assignment":
    case "planning:remove-assignment":
    case "planning:create-scenario":
    case "planning:rename-scenario":
    case "planning:delete-scenario":
    case "planning:save-scenario":
    case "planning:apply-scenario":
      return validateIpcResult(value, path, validatePlanningMutation);
    case "import:preview":
      return validateIpcResult(value, path, (item, childPath) =>
        validateObject(item, childPath, ["preview"], [], (object, nestedPath) =>
          validateImportPreview(object.preview, `${nestedPath}.preview`),
        ),
      );
    case "import:select-file":
      return validateIpcResult(value, path, validateSelectImportFile);
    case "import:commit":
      return validateIpcResult(value, path, validateImportCommit);
    default:
      return [issue(path, "unknown IPC channel")];
  }
}

function validateRequestForChannel(channel: IpcChannel, value: unknown, path: string): FieldValidationIssue[] {
  switch (channel) {
    case "app:health":
      return value === undefined ? [] : [issue(path, "health request must be undefined")];
    case "planning:get-workbench":
      return validateGetWorkbenchRequest(value, path);
    case "planning:get-candidates":
      return validateGetCandidatesRequest(value, path);
    case "planning:update-work":
      return validateUpdateWorkRequest(value, path);
    case "planning:add-location":
      return validateAddLocationRequest(value, path);
    case "planning:update-location":
      return validateUpdateLocationRequest(value, path);
    case "planning:delete-location":
      return validateDeleteLocationRequest(value, path);
    case "planning:add-assignment":
      return validateAddAssignmentRequest(value, path);
    case "planning:replace-assignment":
      return validateReplaceAssignmentRequest(value, path);
    case "planning:remove-assignment":
      return validateRemoveAssignmentRequest(value, path);
    case "planning:create-scenario":
      return validateCreateScenarioRequest(value, path);
    case "planning:rename-scenario":
      return validateRenameScenarioRequest(value, path);
    case "planning:delete-scenario":
    case "planning:save-scenario":
    case "planning:apply-scenario":
      return validateScenarioMutationRequest(value, path);
    case "import:preview":
      return validateImportPreviewRequest(value, path);
    case "import:select-file":
      return validateSelectImportFileRequest(value, path);
    case "import:commit":
      return validateImportCommitRequest(value, path);
    default:
      return [issue(path, "unknown IPC channel")];
  }
}

/**
 * Check the stricter JSON-like subset used by this contract. Structured clone
 * supports more values (Map, Date, ArrayBuffer), but those values are not part
 * of the application DTO boundary and are rejected intentionally.
 */
export function isStructuredCloneSafe(value: unknown): boolean {
  const visiting = new WeakSet<object>();
  const visit = (item: unknown): boolean => {
    if (item === null || item === undefined) return true;
    const type = typeof item;
    if (type === "string" || type === "boolean") return true;
    if (type === "number") return Number.isFinite(item);
    if (type !== "object") return false;
    if (visiting.has(item as object)) return false;
    visiting.add(item as object);
    const valid = Array.isArray(item)
      ? item.every(visit)
      : isRecord(item) && Object.entries(item).every(([key, child]) => key !== "__proto__" && visit(child));
    visiting.delete(item as object);
    return valid;
  };
  return visit(value);
}

export function validateIpcRequest<C extends IpcChannel>(
  channel: C,
  value: unknown,
): ValidationResult<IpcRequest<C>> {
  if (!CHANNEL_LIST.includes(channel)) return { ok: false, issues: [issue("channel", "unknown IPC channel")] };
  if (!isStructuredCloneSafe(value)) return { ok: false, issues: [issue("$", "must be structured-clone-safe")] };
  return validate(value, (item, path) => validateRequestForChannel(channel, item, path));
}

export function validateIpcResponse<C extends IpcChannel>(
  channel: C,
  value: unknown,
): ValidationResult<IpcResponse<C>> {
  if (!CHANNEL_LIST.includes(channel)) return { ok: false, issues: [issue("channel", "unknown IPC channel")] };
  if (!isStructuredCloneSafe(value)) return { ok: false, issues: [issue("$", "must be structured-clone-safe")] };
  return validate(value, (item, path) => validateResponseForChannel(channel, item, path));
}

export function assertIpcRequest<C extends IpcChannel>(
  channel: C,
  value: unknown,
): IpcRequest<C> {
  const checked = validateIpcRequest(channel, value);
  if (checked.ok === false) throw new IpcValidationError(checked.issues);
  return checked.value;
}

export function assertIpcResponse<C extends IpcChannel>(
  channel: C,
  value: unknown,
): IpcResponse<C> {
  const checked = validateIpcResponse(channel, value);
  if (checked.ok === false) throw new IpcValidationError(checked.issues);
  return checked.value;
}

/** DTO validators are exported for repository/import adapter tests as well as IPC handlers. */
export function validateQualificationDto(value: unknown): ValidationResult<QualificationDto> {
  return validate<QualificationDto>(value, validateQualification);
}

export function validateStaffDto(value: unknown): ValidationResult<StaffDto> {
  return validate<StaffDto>(value, validateStaff);
}

export function validateRosterEntryDto(value: unknown): ValidationResult<RosterEntryDto> {
  return validate<RosterEntryDto>(value, validateRosterEntry);
}

export function validateLocationDto(value: unknown): ValidationResult<LocationDto> {
  return validate<LocationDto>(value, validateLocation);
}

export function validateWorkDto(value: unknown): ValidationResult<WorkDto> {
  return validate<WorkDto>(value, validateWork);
}

export function validateAssignmentDto(value: unknown): ValidationResult<AssignmentDto> {
  return validate<AssignmentDto>(value, validateAssignment);
}

export function validateNightPlanDto(value: unknown): ValidationResult<NightPlanDto> {
  return validate<NightPlanDto>(value, validateNightPlan);
}

export function validateScenarioDto(value: unknown): ValidationResult<ScenarioDto> {
  return validate<ScenarioDto>(value, validateScenario);
}

export function validateValidationReportDto(value: unknown): ValidationResult<ValidationReportDto> {
  return validate<ValidationReportDto>(value, validateValidationReport);
}

export function validateImportPreviewDto(value: unknown): ValidationResult<ImportPreviewDto> {
  return validate<ImportPreviewDto>(value, validateImportPreview);
}

export function validateImportCommitDto(value: unknown): ValidationResult<ImportCommitDto> {
  return validate<ImportCommitDto>(value, validateImportCommit);
}

/** Type-only helper for handlers that need to return a typed IpcResult. */
export function isIpcSuccess<T>(value: IpcResult<T>): value is { ok: true; data: T } {
  return value.ok;
}

export type ContractRequestByChannel = {
  [C in IpcChannel]: IpcCommandMap[C]["request"];
};
