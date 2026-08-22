import type { ActualDuty, PlannedDuty } from "./duty";

export interface CapacityInput {
  date: string;
  staffNumber: string;
  available: boolean;
  qualified: boolean;
  reserved?: boolean;
}

export interface CapacityMetrics {
  available: number;
  qualified: number;
  assigned: number;
  reserved: number;
  spare: number;
  shortage: number;
  plannedUtilisation: number;
  actualUtilisation: number;
}

export function calculateCapacity(
  inputs: readonly CapacityInput[],
  planned: readonly PlannedDuty[],
  actual: readonly ActualDuty[],
  required = 0,
): CapacityMetrics {
  const available = inputs.filter((item) => item.available).length;
  const qualified = inputs.filter((item) => item.available && item.qualified).length;
  const reserved = inputs.filter((item) => item.available && item.reserved).length;
  const assigned = new Set(planned.map((item) => item.staffNumber)).size;
  const actualAssigned = new Set(actual.filter((item) => item.status !== "absent" && item.status !== "cancelled").map((item) => item.staffNumber).filter(Boolean)).size;
  return {
    available,
    qualified,
    assigned,
    reserved,
    spare: Math.max(0, qualified - assigned),
    shortage: Math.max(0, required - assigned),
    plannedUtilisation: qualified === 0 ? 0 : assigned / qualified,
    actualUtilisation: qualified === 0 ? 0 : actualAssigned / qualified,
  };
}

export interface ExpiryWindow {
  days: 30 | 60 | 90;
  staffNumbers: readonly string[];
}

export function qualificationExpiryWindows(
  qualifications: readonly { staffNumber: string; validTo?: string }[],
  asOf: string,
): readonly ExpiryWindow[] {
  const base = Date.parse(asOf);
  return ([30, 60, 90] as const).map((days) => ({
    days,
    staffNumbers: qualifications
      .filter((item) => {
        if (!item.validTo) return false;
        const delta = (Date.parse(item.validTo) - base) / 86_400_000;
        return delta >= 0 && delta <= days;
      })
      .map((item) => item.staffNumber),
  }));
}
