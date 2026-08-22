export type ISODate = `${number}-${number}-${number}` | string;

export type WorkKind = "Standard" | "IsolationEarthing" | "Possession" | "PA Work";
export type Role = "AP" | "CP" | "NP" | "HSM" | "LOM" | "SPC";
export type RequirementScope = "job" | "work" | "location" | "isolation-earthing-group";
export type Requiredness = "required" | "optional" | "enabled-required";
export type RequirementSource = "template" | "planner" | "policy";
export type QualificationVariant = "AP" | "CP(P)" | "CP(T)" | "NP" | "HSM" | "LOM";

export interface QualificationPredicate {
  readonly operator: "any" | "all" | "none";
  readonly qualifications?: readonly QualificationVariant[];
  readonly scope?: string;
}

export interface RoleRequirement {
  readonly id: string;
  readonly scope: RequirementScope;
  readonly scopeId: string;
  readonly role: Role;
  readonly quantity: number;
  readonly requiredness: Requiredness;
  readonly qualificationPredicate: QualificationPredicate;
  readonly enabledBy: RequirementSource;
  readonly policyVersion: string;
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly lineGroupId?: string;
  readonly isolationEarthingGroupId?: string;
  readonly minimumHeadcount?: number;
}

export interface Work {
  readonly id: string;
  readonly jobId: string;
  readonly kind: WorkKind;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly locations: readonly Location[];
  readonly roleRequirements: readonly RoleRequirement[];
  readonly active?: boolean;
}

export interface Job {
  readonly id: string;
  readonly workDate: ISODate;
  readonly tn?: string;
  readonly project?: string;
  readonly lineGroupId?: string;
  readonly works: readonly Work[];
}

export interface RequirementOptions {
  readonly enableNp?: boolean;
  readonly policyVersion?: string;
  readonly source?: RequirementSource;
}

const predicate = (qualifications: readonly QualificationVariant[]): QualificationPredicate => ({
  operator: "any",
  qualifications,
});

/** Derive policy-backed requirements without hard-coding UI rows. */
export function deriveRoleRequirements(
  work: Pick<Work, "id" | "jobId" | "kind">,
  options: RequirementOptions = {},
): readonly RoleRequirement[] {
  const policyVersion = options.policyVersion ?? "initial-2026-01";
  const enabledBy = options.source ?? "policy";
  const requirements: RoleRequirement[] = [];
  const add = (
    role: Role,
    quantity: number,
    requiredness: Requiredness,
    qualificationPredicate: QualificationPredicate,
  ) => requirements.push({
    id: `${work.id}:${role}`,
    scope: "work",
    scopeId: work.id,
    role,
    quantity,
    requiredness,
    qualificationPredicate,
    enabledBy,
    policyVersion,
  });

  if (work.kind === "IsolationEarthing") {
    add("AP", 1, "required", predicate(["AP"]));
    add("CP", 1, "required", predicate(["CP(P)", "CP(T)"]));
    add("NP", 1, options.enableNp ? "enabled-required" : "optional", predicate(["NP"]));
  } else if (work.kind === "Possession") {
    add("CP", 1, "required", predicate(["CP(P)"]));
  } else if (work.kind === "PA Work") {
    add("CP", 1, "required", predicate(["CP(P)", "CP(T)"]));
  }
  return requirements;
}

export function withDerivedRoleRequirements(
  work: Omit<Work, "roleRequirements"> & { readonly roleRequirements?: readonly RoleRequirement[] },
  options: RequirementOptions = {},
): Work {
  const derived = deriveRoleRequirements(work, options);
  return {
    ...work,
    roleRequirements: [...derived, ...(work.roleRequirements ?? [])],
  };
}

