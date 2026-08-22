import type { QualificationVariant, Requiredness, Role, WorkKind } from "./workDemand";

export interface PolicyVersion {
  readonly key: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly enabled: boolean;
  readonly description: string;
}

export interface RolePolicy {
  readonly workKind: WorkKind | "*";
  readonly role: Role;
  readonly qualifications: readonly QualificationVariant[];
  readonly requiredness: Requiredness;
}

export class PolicyRegistry {
  private readonly policies = new Map<string, PolicyVersion>();
  private readonly rolePolicies: RolePolicy[] = [];

  register(policy: PolicyVersion): this {
    this.policies.set(`${policy.key}@${policy.version}`, policy);
    return this;
  }

  registerRolePolicy(policy: RolePolicy): this {
    this.rolePolicies.push(policy);
    return this;
  }

  get(key: string, version: string): PolicyVersion | undefined {
    return this.policies.get(`${key}@${version}`);
  }

  require(key: string, version: string): PolicyVersion {
    const policy = this.get(key, version);
    if (!policy || !policy.enabled) throw new Error(`Policy ${key}@${version} is not enabled`);
    return policy;
  }

  resolveRolePolicy(workKind: WorkKind, role: Role): RolePolicy | undefined {
    return this.rolePolicies.find((candidate) =>
      candidate.role === role && (candidate.workKind === workKind || candidate.workKind === "*"),
    );
  }

  list(): readonly PolicyVersion[] {
    return [...this.policies.values()];
  }
}

export function createDefaultPolicyRegistry(version = "initial-2026-01"): PolicyRegistry {
  const registry = new PolicyRegistry();
  registry
    .register({ key: "qualification-acceptance", version, effectiveFrom: "2026-01-01", enabled: true, description: "CP(P/T) acceptance by Work kind" })
    .register({ key: "roster-availability", version, effectiveFrom: "2026-01-01", enabled: true, description: "Unknown roster codes are unavailable" })
    .register({ key: "allocation-invariants", version, effectiveFrom: "2026-01-01", enabled: true, description: "AP/CP and SPC allocation constraints" })
    .register({ key: "weekly-two-job-target", version, effectiveFrom: "2026-01-01", enabled: false, description: "Disabled legacy 2 Job Night target" });
  registry
    .registerRolePolicy({ workKind: "IsolationEarthing", role: "AP", qualifications: ["AP"], requiredness: "required" })
    .registerRolePolicy({ workKind: "IsolationEarthing", role: "CP", qualifications: ["CP(P)", "CP(T)"], requiredness: "required" })
    .registerRolePolicy({ workKind: "IsolationEarthing", role: "NP", qualifications: ["NP"], requiredness: "optional" })
    .registerRolePolicy({ workKind: "Possession", role: "CP", qualifications: ["CP(P)"], requiredness: "required" })
    .registerRolePolicy({ workKind: "PA Work", role: "CP", qualifications: ["CP(P)", "CP(T)"], requiredness: "required" })
    .registerRolePolicy({ workKind: "*", role: "SPC", qualifications: [], requiredness: "optional" });
  return registry;
}

