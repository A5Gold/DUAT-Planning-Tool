import {
  createPlanningState,
  PlanningService,
  type AssignmentRequest,
  type ISODate,
  type Location,
  type NightPlan,
  type PlanningData,
  type PlanningRepository,
  type PlanningState,
  type ValidationOptions,
  type Work,
} from "../domain/planning";
import type {
  AddAssignmentRequest,
  AddLocationRequest,
  ApplyScenarioRequest,
  AssignmentInputDto,
  CandidateResultDto,
  CreateScenarioRequest,
  DeleteLocationRequest,
  DeleteScenarioRequest,
  GetCandidatesRequest,
  LocationPatchDto,
  MutationEnvelopeDto,
  PlanningMutationDto,
  RenameScenarioRequest,
  RemoveAssignmentRequest,
  ReplaceAssignmentRequest,
  SaveScenarioRequest,
  ScenarioRefDto,
  UpdateLocationRequest,
  UpdateWorkRequest,
  WorkbenchSnapshotDto,
} from "./ipcContract";
import {
  AggregateRevisionConflictError,
  type PlanningContextSnapshot,
  type VersionedPlanningAggregate,
} from "../adapters/sqlite";

/** Persistence boundary consumed by the main-process application layer. */
export interface PlanningAggregateStore extends PlanningRepository {
  loadAggregate(date: ISODate): VersionedPlanningAggregate | undefined;
  loadContext(date: ISODate): PlanningContextSnapshot | undefined;
  saveAggregate(state: PlanningState, expectedRevision: number | null): VersionedPlanningAggregate;
  savePlanningData?(data: PlanningData): void;
}

export interface PlanningApplicationOptions {
  readonly defaultData?: PlanningData;
  readonly defaultState?: (date: ISODate) => PlanningState;
  readonly validationOptions?: ValidationOptions;
  readonly now?: () => string;
}

function dateOnly(date: ISODate): ISODate {
  return date.slice(0, 10);
}

function parseDate(value: ISODate): Date {
  const parsed = new Date(`${dateOnly(value)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date("2026-08-20T12:00:00") : parsed;
}

function isoDate(value: Date): ISODate {
  return value.toISOString().slice(0, 10);
}

function sundayStart(value: ISODate): Date {
  const date = parseDate(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function weekNumber(value: ISODate): number {
  const target = parseDate(value);
  const start = sundayStart(value);
  const first = sundayStart(`${target.getFullYear()}-01-01`);
  return Math.floor((start.getTime() - first.getTime()) / 604800000) + 1;
}

function clonePlan(plan: NightPlan): NightPlan {
  return {
    ...plan,
    works: plan.works.map((work) => ({
      ...work,
      locations: work.locations.map((location) => ({
        ...location,
        demand: location.demand ? { ...location.demand } : undefined,
      })),
    })),
    assignments: plan.assignments.map((assignment) => ({ ...assignment })),
  };
}

function cloneState(state: PlanningState): PlanningState {
  return {
    ...state,
    main: clonePlan(state.main),
    scenarios: state.scenarios.map((scenario) => ({ ...scenario, plan: clonePlan(scenario.plan) })),
  };
}

function selectedPlan(state: PlanningState, scenario: ScenarioRefDto): NightPlan {
  if (scenario.kind === "main") return state.main;
  return state.scenarios.find((item) => item.id === scenario.scenarioId)?.plan ?? state.main;
}

function selectedPlanOrThrow(state: PlanningState, scenario: ScenarioRefDto): NightPlan {
  if (scenario.kind === "main") return state.main;
  const selected = state.scenarios.find((item) => item.id === scenario.scenarioId);
  if (!selected) throw new PlanningEntityNotFoundError("scenario", scenario.scenarioId);
  return selected.plan;
}

function requireWork(plan: NightPlan, workId: string): Work {
  const work = plan.works.find((item) => item.id === workId);
  if (!work) throw new PlanningEntityNotFoundError("work", workId);
  return work;
}

function requireLocation(work: Work, locationId: string): Location {
  const location = work.locations.find((item) => item.id === locationId);
  if (!location) throw new PlanningEntityNotFoundError("location", locationId);
  return location;
}

function requireAssignment(plan: NightPlan, assignmentId: string): void {
  if (!plan.assignments.some((item) => item.id === assignmentId)) {
    throw new PlanningEntityNotFoundError("assignment", assignmentId);
  }
}

function updateSelectedPlan(
  service: PlanningService,
  state: PlanningState,
  scenario: ScenarioRefDto,
  update: (plan: NightPlan) => NightPlan,
): PlanningState {
  if (scenario.kind === "main") return { ...state, main: clonePlan(update(clonePlan(state.main))) };
  return service.updateScenarioPlan(state, scenario.scenarioId, (plan) => update(clonePlan(plan)));
}

function applyLocationPatch(location: Location, patch: LocationPatchDto): Location {
  return {
    ...location,
    ...(patch.locationName === undefined ? {} : { locationName: patch.locationName }),
    ...(patch.isolationPoint === undefined ? {} : { isolationPoint: patch.isolationPoint }),
    ...(patch.earthingPoint === undefined ? {} : { earthingPoint: patch.earthingPoint }),
    ...(patch.minimumTotalHeadcount === undefined
      ? {}
      : { minimumTotalHeadcount: Math.max(0, Math.trunc(patch.minimumTotalHeadcount)) }),
    ...(patch.demand === undefined ? {} : { demand: { ...(location.demand ?? {}), ...patch.demand } }),
  };
}

function assignmentRequest(input: AssignmentInputDto): AssignmentRequest {
  return {
    staffNumber: input.staffNumber,
    workId: input.workId,
    role: input.role,
    locationId: input.locationId,
    qualificationUsed: input.qualificationUsed,
    source: "manual",
  };
}

function personnelForSnapshot(
  data: PlanningData,
  plan: NightPlan,
  date: ISODate,
  repository: PlanningRepository,
) {
  return data.staff.map((staff) => {
    const roster = repository.getRosterEntry(date, staff.staffNumber);
    const assignment = plan.assignments.find((item) => item.staffNumber === staff.staffNumber);
    const work = assignment ? plan.works.find((item) => item.id === assignment.workId) : undefined;
    const available = roster
      ? roster.available === false || ["unavailable", "leave", "sickness", "training", "day-duty", "unknown"].includes(roster.status ?? "")
        ? "unavailable"
        : "available"
      : "unknown";
    return {
      staff,
      qualifications: data.qualifications
        ?.filter((qualification) => qualification.staffNumber === staff.staffNumber)
        .map(({ staffNumber: _staffNumber, ...qualification }) => qualification) ?? staff.qualifications ?? [],
      availability: available as "available" | "unavailable" | "unknown",
      rosterStatus: roster?.status,
      rosterReason: roster?.reason,
      currentWorkId: assignment?.workId,
      currentWorkSlot: work?.slot,
    };
  });
}

export class PlanningApplication {
  private readonly validationOptions: ValidationOptions;
  private readonly defaultState: (date: ISODate) => PlanningState;
  private readonly now: () => string;

  constructor(
    private readonly store: PlanningAggregateStore,
    private readonly options: PlanningApplicationOptions = {},
  ) {
    this.validationOptions = { ...options.validationOptions };
    this.defaultState = options.defaultState ?? ((date) => createPlanningState(date));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private context(date: ISODate): { aggregate: VersionedPlanningAggregate; data: PlanningData } {
    const normalizedDate = dateOnly(date);
    const existing = this.store.loadContext(normalizedDate);
    if (existing) return { aggregate: existing, data: existing.data };

    if (this.options.defaultData) this.store.savePlanningData?.(this.options.defaultData);
    const state = this.defaultState(normalizedDate);
    const saved = this.store.saveAggregate(state, null);
    const data = this.options.defaultData ?? {
      staff: this.store.getStaff(),
      qualifications: this.store.getStaff().flatMap((staff) =>
        this.store.getQualifications(staff.staffNumber).map((qualification) => ({ ...qualification, staffNumber: staff.staffNumber })),
      ),
      roster: this.store.getRosterEntries?.() ?? [],
    };
    return { aggregate: saved, data };
  }

  private snapshot(
    date: ISODate,
    aggregate: VersionedPlanningAggregate,
    data: PlanningData,
    scenario: ScenarioRefDto,
    validationOptions: ValidationOptions = this.validationOptions,
  ): WorkbenchSnapshotDto {
    const service = new PlanningService(data, validationOptions);
    const plan = selectedPlan(aggregate.state, scenario);
    const start = sundayStart(dateOnly(date));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      date: dateOnly(date),
      weekNumber: weekNumber(dateOnly(date)),
      weekStart: isoDate(start),
      weekEnd: isoDate(end),
      revision: aggregate.revision,
      main: clonePlan(aggregate.state.main),
      activePlan: clonePlan(plan),
      scenarios: aggregate.state.scenarios.map((item) => ({ ...item, plan: clonePlan(item.plan) })),
      selectedScenario: scenario,
      personnel: personnelForSnapshot(data, plan, dateOnly(date), this.store),
      validation: service.validatePlan(plan, validationOptions),
    };
  }

  private optionsFor(request: MutationEnvelopeDto): ValidationOptions {
    return request.allowS1Support === undefined
      ? this.validationOptions
      : { ...this.validationOptions, allowS1Support: request.allowS1Support };
  }

  getWorkbench(date: ISODate, scenario: ScenarioRefDto = { kind: "main" }): WorkbenchSnapshotDto {
    const context = this.context(date);
    selectedPlanOrThrow(context.aggregate.state, scenario);
    return this.snapshot(date, context.aggregate, context.data, scenario);
  }

  getCandidates(request: GetCandidatesRequest): CandidateResultDto {
    const context = this.context(request.date);
    const validationOptions = request.allowS1Support === undefined
      ? this.validationOptions
      : { ...this.validationOptions, allowS1Support: request.allowS1Support };
    const service = new PlanningService(context.data, validationOptions);
    const plan = selectedPlanOrThrow(context.aggregate.state, request.scenario);
    const candidates = service.candidates(plan, request.target, validationOptions);
    return {
      revision: context.aggregate.revision,
      candidates,
      validation: service.validatePlan(plan, validationOptions),
    };
  }

  private mutate<T extends MutationEnvelopeDto>(
    request: T,
    update: (state: PlanningState, service: PlanningService, plan: NightPlan, validationOptions: ValidationOptions) => PlanningState,
  ): PlanningMutationDto {
    const context = this.context(request.date);
    if (context.aggregate.revision !== request.expectedRevision) {
      throw new AggregateRevisionConflictError(request.date, request.expectedRevision, context.aggregate.revision);
    }
    const validationOptions = this.optionsFor(request);
    const service = new PlanningService(context.data, validationOptions);
    const selected = selectedPlanOrThrow(context.aggregate.state, request.scenario);
    const state = update(
      cloneState(context.aggregate.state),
      service,
      selected,
      validationOptions,
    );
    const saved = this.store.saveAggregate(state, request.expectedRevision);
    const snapshot = this.snapshot(request.date, saved, context.data, request.scenario, validationOptions);
    return {
      revision: saved.revision,
      snapshot,
      validation: snapshot.validation,
    };
  }

  updateWork(request: UpdateWorkRequest): PlanningMutationDto {
    return this.mutate(request, (state, _service, plan) => {
      requireWork(plan, request.workId);
      return updateSelectedPlan(_service, state, request.scenario, (selected) => ({
      ...selected,
      works: selected.works.map((work) => (work.id === request.workId ? { ...work, ...request.patch } as Work : work)),
      }));
    });
  }

  addLocation(request: AddLocationRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan) => {
      requireWork(plan, request.workId);
      return updateSelectedPlan(service, state, request.scenario, (selected) => ({
        ...selected,
        works: selected.works.map((work) => (work.id === request.workId ? { ...work, locations: [...work.locations, request.location] } : work)),
      }));
    });
  }

  updateLocation(request: UpdateLocationRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan) => {
      const work = requireWork(plan, request.workId);
      requireLocation(work, request.locationId);
      return updateSelectedPlan(service, state, request.scenario, (selected) => ({
        ...selected,
        works: selected.works.map((item) => item.id !== request.workId ? item : {
          ...item,
          locations: item.locations.map((location) => location.id === request.locationId ? applyLocationPatch(location, request.patch) : location),
        }),
      }));
    });
  }

  deleteLocation(request: DeleteLocationRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan) => {
      const work = requireWork(plan, request.workId);
      requireLocation(work, request.locationId);
      return updateSelectedPlan(service, state, request.scenario, (selected) => ({
        ...selected,
        works: selected.works.map((item) => item.id !== request.workId ? item : {
          ...item,
          locations: item.locations.filter((location) => location.id !== request.locationId),
        }),
        assignments: selected.assignments.filter((assignment) => assignment.locationId !== request.locationId),
      }));
    });
  }

  addAssignment(request: AddAssignmentRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan, validationOptions) => {
      const mutation = service.assign(plan, assignmentRequest(request.assignment), validationOptions);
      if (!mutation.accepted) throw new DomainMutationError(mutation.report);
      return updateSelectedPlan(service, state, request.scenario, () => mutation.plan);
    });
  }

  replaceAssignment(request: ReplaceAssignmentRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan, validationOptions) => {
      const mutation = service.replaceAssignment(plan, request.assignmentId, assignmentRequest(request.assignment), validationOptions);
      if (!mutation.accepted) throw new DomainMutationError(mutation.report);
      return updateSelectedPlan(service, state, request.scenario, () => mutation.plan);
    });
  }

  removeAssignment(request: RemoveAssignmentRequest): PlanningMutationDto {
    return this.mutate(request, (state, service, plan) => {
      requireAssignment(plan, request.assignmentId);
      return updateSelectedPlan(service, state, request.scenario, (selected) => service.removeAssignment(selected, request.assignmentId));
    });
  }

  createScenario(request: CreateScenarioRequest): PlanningMutationDto {
    return this.mutate(request, (state, service) => {
      if (request.sourceScenario) selectedPlanOrThrow(state, request.sourceScenario);
      return service.createScenario(state, request.scenarioId, request.name, request.sourceScenario?.kind === "scenario" ? request.sourceScenario.scenarioId : "main", request.temporary ?? true);
    });
  }

  renameScenario(request: RenameScenarioRequest): PlanningMutationDto {
    return this.mutate(request, (state, service) => {
      selectedPlanOrThrow(state, { kind: "scenario", scenarioId: request.scenarioId });
      return service.renameScenario(state, request.scenarioId, request.name);
    });
  }

  deleteScenario(request: DeleteScenarioRequest): PlanningMutationDto {
    return this.mutate(request, (state, service) => {
      selectedPlanOrThrow(state, { kind: "scenario", scenarioId: request.scenarioId });
      return service.deleteScenario(state, request.scenarioId);
    });
  }

  saveScenario(request: SaveScenarioRequest): PlanningMutationDto {
    return this.mutate(request, (state) => {
      selectedPlanOrThrow(state, { kind: "scenario", scenarioId: request.scenarioId });
      return { ...state, activeScenarioId: request.scenarioId };
    });
  }

  applyScenario(request: ApplyScenarioRequest): PlanningMutationDto {
    return this.mutate(request, (state, service) => {
      selectedPlanOrThrow(state, { kind: "scenario", scenarioId: request.scenarioId });
      return service.applyScenario(state, request.scenarioId);
    });
  }
}

export class PlanningEntityNotFoundError extends Error {
  constructor(
    readonly entity: "night" | "work" | "location" | "assignment" | "scenario" | "import",
    readonly id: string,
  ) {
    super(`找不到 ${entity}「${id}」。`);
    this.name = "PlanningEntityNotFoundError";
  }
}

export class DomainMutationError extends Error {
  constructor(readonly report: import("../domain/planning").ValidationReport) {
    super("Planning mutation rejected by domain validation");
    this.name = "DomainMutationError";
  }
}

/** Helper for tests and main handlers that need a stable initial state. */
export function createDefaultState(date: ISODate): PlanningState {
  return createPlanningState(date);
}
